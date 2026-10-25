# Context Doc: the CRDT delete tombstone is seq-fenced

_Last verified: 2026-10-25_

## What this is
When a note is deleted (here or by the server), `ProviderRegistry.removeDoc`
tombstones its note_id: every later access throws `NoteDestroyedError`, so a
late frame cannot rebuild a deleted note's room. The tombstone used to be
permanent, on the assumption that an id is never reused. Safer delete
(backend Engram#2233) breaks that assumption: `restore_deleted` brings back
the SAME id at a fresh seq. So the tombstone is a hiding layer, and it needs a
clearing event (see `crdt-sync-store-hiding-layers.md`).

## The rule
Each tombstone stores a seq fence (`removedAtSeq`). It is the delete's seq
when known: a seq-replay tombstone row, or a delete broadcast that carries
`seq` (Engram#2233 adds it). Otherwise it is the newest seq this device held
for the note (an older server's broadcast, or a local delete), read BEFORE the
sync-state row is dropped. The fence only ever rises: any later delete op for
an already-tombstoned id raises it to that op's seq (`raiseFence`), even when
the file is already gone and no teardown runs.

In `SyncEngine.applyOp`, for an upsert of a tombstoned id:

1. **Own delete still queued** (`crdtHasPendingDelete(id)`, wired in main.ts to
   `CrdtOpQueue.hasPending(id, "delete", vault)`): skip, however long ago the
   60 s `recentlyDeleted` window lapsed. Offline deletes sit in the CRDT op
   queue, never in the REST queue. NOT `crdtHasPendingOp`: that port is
   create-only by design (the #416 evidence rule), so a guard on it never
   fires for a delete. It clears the moment the delete is dequeued.
2. **No seq** (a live `note_changed` broadcast): skip and `scheduleSeqHeal()`.
   A broadcast cannot tell a restore from a late pre-delete upsert; the replay
   row carries a seq and goes through the fence.
3. **`seq <= fence`**: skip. This is history from before the delete.
4. Otherwise `revive(id, seq)` and apply. If `applyChange` lands nothing,
   restore the tombstone.

The fence covers the DISK write too, not just the doc. Before this, main
already re-materialized a stale pre-delete upsert's body on disk while the doc
stayed dead (a half-resurrection). Test: "a stale pre-delete upsert neither
revives nor writes disk" in `tests/sync-delete-restore.test.ts`.

## After a revive: no room storm
The revived doc is EMPTY (removeDoc cleared IndexedDB). It is loaded from the
server, never seeded from disk (that mints a rival lineage, backend
`crdt-lineage-doubling.md`). A live-bound note takes the room
(`socketConverge`). An IDLE note does a room-free `crdt_doc_state` read with
NO room fallback: a folder restore of thousands of notes must open zero rooms
(#1409). Those reads go through a small pool (`Semaphore(4)`), and a failed one
does NOT strike the frame: a timed-out burst would otherwise latch room-free
reads off for the session, and `convergeColdNoteRoomFree` would then open a
room per cold note. If the read fails, the doc stays empty until the note is
opened or edited.

## Known gap
Against an older server (no `seq` on delete broadcasts), the fence after a
live delete is only this device's last known seq. A row seq'd between that and
the real delete seq can revive the id. If the replay's tombstone row comes
AFTER that row, it deletes the note again. If the tombstone row came FIRST, it
already raised the fence (above), so the row is refused. The window is only
"live delete received, its replay row not yet seen". It closes for good once
the server stamps `seq` on every `note_changed`.
