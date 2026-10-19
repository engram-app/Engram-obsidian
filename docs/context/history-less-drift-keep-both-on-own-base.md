# Context Doc: history-less keep-both copied an edit made on the delta's own base

**Trigger:** an edit on a just-discovered note lands in a `(conflict <date>).md`
copy and the original reverts; or e2e `test_concurrent_edits_both_survive` /
`test_edit_after_discovery_round_trips` fail intermittently, usually the first
CRDT test after session start.

## What happened

Backend #2043 (atomic genesis) made the genesis op-log row carry the note
body. A device discovering the note through catch-up now writes the body to
disk from the row, while its Y.Doc stays empty ("history-less"). The genesis
fan-out (`note_yjs_update`) can arrive seconds later.

If the user edits in that window, `applyPushedNoteUpdate` routes to
`adoptHistoryLessNote`, which saw disk drift and no merge base, so it wrote a
keep-both copy and let the apply flush the row body over the original. The
edit only ever reached other devices as a new copy note.

There WAS a merge base: the delta rebuilt exactly the text the drift was
edited from (the recorded baseline hash).

## Fix

`ProviderRegistry.previewUpdate` applies the delta to a scratch doc and
projects it (null if it pends). When the projection hashes to the recorded
baseline, `fastForwardHistoryLess` applies the delta, then merges disk back
with `applyLocalEdit` (doc has history now, so a minimal diff, no #234
doubling), same shape as `adoptCreateAck`'s M1. Keep-both remains for real
divergence and as the fallback if the merge does not land.

Known window: the apply's flush writes the base over disk before the merge
flush restores the edit. The edit lives only in memory between the two.

## How it was found

Remote client logs only ship warn+, and the keep-both line is info. A
throwaway backend branch re-emitting every client line plus a plugin branch
logging every disk write with caller frames and before/after hashes
(`DIAG disk-write ... prev=23B new=9B`), paired by identical branch name and
looped with `gh run rerun --job` on the e2e-crdt job until it failed (about
1 in 4 to 7 suite runs).

## Related

- `crdt-convergence-sim-fidelity-gaps.md` gap #1 (history-less keep-both storm)
- backend `docs/context/crdt-catchup-backfill-revert-and-seq-fence.md`
