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
in-flight read per note (`serverLoads`); a burst of edits shares it. The
decision is taken once, when the state lands:

| Note | Resolver | Local side |
|---|---|---|
| closed | `adoptHistoryLessNote` (the existing fan-out adopt) | disk, read at landing |
| open | the live binding's `resolveLoaded` (`decideLoadedReconcile`) | editor buffer: file as opened + queued keystrokes |
| server state has no structs (row predates CRDT state) | `openLoadGate`: gate opens, edit re-routes from disk and seeds | n/a, nothing to rival |

An open note normally loads through its own room (the binding enrolls on
attach); the STEP2 seeds the doc and the binding resolves. Keystrokes queue in
the editor the whole time: the binding is not live while the doc is empty
(`deferSeed`).

Both resolvers give the same three outcomes, from the same base
(`provableBase`: the server text if it still hashes to the recorded baseline,
else the body discovery wrote if THAT does; the binding also accepts disk when
disk is unchanged since sync):

1. local equals server, or nothing local: synced, disk/editor takes the server.
2. `merge3(base, local, server)` clean: both edits kept, applied as a minimal
   diff onto the server lineage.
3. otherwise exactly ONE conflict copy of the local text; the note takes the
   server's. No base at all is also a conflict (Relay's two-way rule).

**The one written deviation from Relay:** with a provable base Relay would
still raise a two-way conflict for a fresh local doc; we 3-way merge from the
discovery body, because it is a real common ancestor (both the disk edit and
the server's later edits descend from it) and a conflict copy for every
concurrent edit to a just-discovered note is worse than the merge.

## Retry: the input is never lost

The held edit lives on disk (closed) or in the editor (open), so a load that
fails or never arrives costs nothing. Retried by: the next edit, crdt rejoin
(`retryHeldLocalEdits`, called from `onCrdtTopicJoined`), and cold-start
reconcile after a restart (disk differs from the baseline).

`heldForServer` is the only hide-state: note ids whose load failed. Clearing
events: the load lands (adopt `applied`, or the doc already has history), the
note has no path any more, or the vault sweep (`track(["vault","destroy"])`).

The gate's read ignores the `crdt_doc_state` capability latch
(`readServerDocState(..., honorLatch = false)`). The latch protects bulk
reads; honouring it here stranded held edits for the rest of the session
(PR #619 review delta 4, major 3).

## Known edges (accepted)

- A room STEP2 that lands after the editor closed, on a note whose disk holds
  unsynced typing, flushes the server text over disk (the registry flush
  listener does not know about the held input). Needs open, type, autosave,
  close all inside one handshake round trip.
- A bound note whose server copy has frontmatter: the first remote flush writes
  disk under the editor (`fmChanged` starts true). Obsidian merges its buffer
  with the external write; the binding then resolves editor vs server, so
  nothing doubles, but this is the #544 doc-to-disk channel, still open.
- `merge3` refuses an insert that contains the other side's insert at the same
  point (an extension it cannot tell from a coincidence): that is a conflict
  copy, not a merge.
- A backend without `crdt_doc_state`: closed notes stay held (never seeded,
  never lost) until opened, when the room loads them.

## Tests

- `tests/sync-discovered-note-gate.test.ts`: real registry, production wiring.
  The body-doubling repro, edits queued during an in-flight load, server moved
  (merge), same-line conflict (one copy), load never arrives then rejoin, the
  latched frame, cold-start reconcile, and the frontmatter doubling repro.
- `tests/crdt-live-binding-decisions.test.ts` `decideLoadedReconcile`: the open
  editor's outcomes, including queued keystrokes and pre-open disk drift.
- `tests/sim/regressions.test.ts` "fresh device edits a discovered note": the
  sim models `crdt_doc_state`.

## Related

- `live-binding-544-investigation.md`: the general "typing while a note loads"
  problem. The gate closes its root cause (disk written into an entering doc)
  for held notes only.
- `history-less-drift-keep-both-on-own-base.md`: `adoptHistoryLessNote`, the
  closed-note resolver.
- `crdt-pull-gated-by-create-ack.md`: `hasServerNote`, the oracle reused here.
