# Context Doc: the load gate (no local input before the server state loads)

_Last verified: 2026-10-25 (supersedes PR #619's lineage-adopt design)_

**Trigger:** a note's server copy holds its old body followed by the edited
body; a frontmatter block comes back with every key twice; an edit to a note
this device only ever discovered "does nothing" until reconnect; you are adding
a path that writes disk or editor text into a Y.Doc.

## The bug it closes

Catch-up's discovery leg writes a note's row body to disk and marks the note
server-known (`markServerKnown`), but never touches the Y.Doc. The doc is
history-less. Any local input seeded into it gets a fresh clientID, a rival
lineage. Yjs merges by op identity, so the server unions the rival with its own
copy: the body appears twice (staging 0.59.0, 8/8). Same for frontmatter: the
open editor's autosave ingests frontmatter straight into the doc
(`ingestFrontmatter`), and the keys double. Background:
`../engram/docs/context/crdt-lineage-doubling.md` ("Remaining single-encoder
hazard").

## The rule (Relay System Invariant #3)

A note the server holds, whose doc has no history on this device, accepts NO
local input until it has loaded the server's state. One predicate decides it:
`ProviderRegistry.awaitsServerState(noteId)` = resident doc,
`!docHasAnyHistory`, and `serverHolds` (wired to `canSendLive`, i.e.
`SyncEngine.hasServerNote`, the same oracle the create-ack gate reads).

Both disk-to-doc entry points check it:

- `applyLocalEdit` (pushFile, cold-start reconcile, create-ack seeds): disk
  unchanged since sync is no input and returns as before; anything else returns
  null (not consumed) and fires `onAwaitingServer`. The edit stays on disk.
- `ingestFrontmatter` (the bound-note autosave path): returns without writing.

`handleModify` also skips `recordLiveBoundBaseline` while held, or the
unsynced buffer would be stamped as synced and hidden from cold reconcile.

## Loading, and who resolves the held input

`SyncEngine.loadServerState(noteId)` reads `crdt_doc_state` (room-free). One
in-flight read per note (`serverLoads`); a burst of edits shares it. A state
with no structs (a row that predates CRDT state) opens the gate instead
(`openLoadGate`): there is no lineage to rival, so a closed note's edit
re-routes from disk and seeds, and an open editor seeds from its buffer
(`onLoadGateOpen`, the binding's way out of waiting for a seed that never
comes; its waiter is cleared when it fires, on detach, or with the entry).

Who resolves the held input depends on whether an editor is open when the
server state lands, by ANY route (fan-out, `crdt_doc_state`, room STEP2):

| Note | Resolver | Local side |
|---|---|---|
| closed | the disk-drift interlock in `flushFromCrdt` (`resolveDriftOnLoad`) | disk, read at the write |
| open | the live binding's `resolveLoaded` (`decideLoadedReconcile`) | editor buffer: file as opened + queued keystrokes |

**The interlock (Relay's `acceptsRemoteEnrollment`, `MergeHSM.ts:1306`).** The
registry marks the flush of a doc's FIRST server state (`firstLoad`: the doc
had no history before this update). Wiring passes it to `flushFromCrdt` as
`loadedId` for a closed note. Before overwriting, the write reads disk: if
disk drifted from the recorded baseline it is held input, and the write
becomes the merge (seeded into the doc so it syncs) or the server text after
one conflict copy. A failed copy forces the merge in (base known) or leaves
disk alone (no base): never overwritten. Flushes after the first wait for it
(`loadFlush`) and project afresh, so a fan-out racing the merge cannot write
first. `adoptHistoryLessNote` no longer handles drift itself: it applies, and
this one choke point resolves.

This is what makes the offline case safe: B opens a discovered note offline
(the binding enrolls), types, autosaves, closes, reconnects; the provider
re-sends STEP1, STEP2 lands on a closed note whose disk holds the typing, and
the interlock merges it (sim: "held typing survives the reconnect handshake").

Both resolvers give the same three outcomes, from the same base
(`provableBase`: the server text if it still hashes to the recorded baseline,
else the body discovery wrote if THAT does; the binding also accepts disk when
disk is unchanged since sync):

1. local equals server, or nothing local: synced, disk/editor takes the server.
2. `merge3(base, local, server)` clean: both edits kept, applied as a minimal
   diff onto the server lineage.
3. otherwise exactly ONE conflict copy of the local text; the note takes the
   server's. No base at all is also a conflict (Relay's two-way rule). If the
   open editor's copy fails it merges its text back as an edit; if the editor
   closed meanwhile, `restoreLocalText` writes it over the note on disk.

## Deviations from Relay (each with its reason)

1. **3-way merge from the discovery body.** With a provable base Relay still
   raises a two-way conflict for a fresh local doc. The discovery body is a
   real common ancestor (the local edit and every later server edit descend
   from it), and a conflict copy for every concurrent edit to a just-discovered
   note is worse than the merge.
2. **An empty server state opens the gate.** Relay waits until enrollment
   content arrives (`MergeHSM.ts:5536-5542`). Our server can hold a row with no
   CRDT state; a room would seed it from content, but `crdt_doc_state` returns
   nothing, so waiting would hold the edit (and leave an open editor not live)
   indefinitely. With no server structs a local seed cannot rival anything:
   this is the pre-gate behaviour, for exactly the case where it was safe.
3. **Queued keystrokes are merged as editor text, not replayed as keystrokes.**
   Relay replays buffered CM6 changes after its merge. Our binding keeps no
   keystroke log, and the #544 investigation found Relay's replay doubles text
   when an autosave was ingested meanwhile. Here nothing is ingested while held
   (the gate), so the editor text versus the base is the exact local diff and a
   line-level `merge3` applies it once.

## Retry: the input is never lost

The held edit lives on disk (closed) or in the editor (open), so a load that
fails or never arrives costs nothing. Retried by: the next edit, crdt rejoin
(`retryHeldLocalEdits`, called from `onCrdtTopicJoined`), and cold-start
reconcile after a restart (disk differs from the baseline).

`heldForServer` is the only hide-state: note ids whose load failed. Clearing
events: the load lands (adopt `applied`, gate opened, or the doc already has
history), the note has no path any more, or the vault sweep
(`track(["vault","destroy"])`).

The gate's read ignores the `crdt_doc_state` capability latch
(`readServerDocState(..., honorLatch = false)`). The latch protects bulk
reads; honouring it here stranded held edits for the rest of the session
(PR #619 review delta 4, major 3).

**Accepted risk: rate limits.** `crdt_doc_state` bills the handshake rate lane
(backend `crdt_channel.ex` `handle_in("crdt_doc_state")`). A bulk first sync
over a locally edited vault can draw `rate_limited` replies; those edits stay
held, not lost, until the next edit, rejoin or restart. No backoff retry: the
held input is durable, and a timer retry is what #619's review found stranding
bound notes.

## Known edges (accepted)

- An open note whose server copy has frontmatter: the first remote flush still
  writes disk under the editor when `fmChanged` (the interlock covers closed
  notes only; the binding owns open ones). Obsidian merges its buffer with the
  write and the binding then resolves editor vs server, so nothing doubles,
  but this is the #544 doc-to-disk channel, still open.
- `merge3` refuses an insert that contains the other side's insert at the same
  point (an extension it cannot tell from a coincidence): that is a conflict
  copy, not a merge.
- A backend without `crdt_doc_state`: closed notes stay held (never seeded,
  never lost) until opened, when the room loads them.
- `discoveryBases` is path-keyed and in memory: a rename or restart before the
  load turns a merge into a conflict copy (no loss).

## Tests

- `tests/sync-discovered-note-gate.test.ts`: real registry, production wiring.
  The body-doubling repro, edits queued during an in-flight load, server moved
  (merge), same-line conflict (one copy), load never arrives then rejoin, the
  latched frame, cold-start reconcile, and the frontmatter doubling repro.
  Also: an empty server state for an open and a closed note.
- `tests/crdt-live-binding-decisions.test.ts` `decideLoadedReconcile`: the open
  editor's outcomes, including queued keystrokes and pre-open disk drift.
- `tests/crdt-live-binding-resolve-loaded.test.ts`: the binding itself with a
  fake editor (merge, conflict, copy failure open and closed, gate opening).
- `tests/sim/regressions.test.ts`: "fresh device edits a discovered note" and
  "held typing survives the reconnect handshake" (the sim models
  `crdt_doc_state`). #282 and test_85 open the note on B first so the gate does
  not mask the equal-seq fence they guard.

## Related

- `live-binding-544-investigation.md`: the general "typing while a note loads"
  problem. The gate closes its root cause (disk written into an entering doc)
  for held notes only.
- `history-less-drift-keep-both-on-own-base.md`: the history-less adopt's
  earlier drift handling, now done by the interlock.
- `crdt-pull-gated-by-create-ack.md`: `hasServerNote`, the oracle reused here.
