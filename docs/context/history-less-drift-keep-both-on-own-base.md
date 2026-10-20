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
baseline, `fastForwardHistoryLess` applies the delta, then
`mergeLocalEditFromBase(preview, disk)` seeds the edit as a minimal diff,
checking and seeding with no await in between.

Do NOT use `applyLocalEdit` here. These notes have no `baseStore` entry (the
catch-up discovery leg never sets one), so it falls to a 2-way diff from the
doc to the stale `disk` snapshot, deleting any fan-out or autosave that
landed during the apply flush and broadcasting the deletion.

The apply flush writes the base over disk, so the edit lives only in memory
from then on. Every path must land it:
- doc still projects the base: seed the edit, flush.
- doc moved: keep-both copy (old behaviour, nothing diffed away).
- copy write throws: forced 3-way merge of base→disk onto the doc (may be
  dirty or duplicate text, never loses it).
- merge's disk flush throws: warn only; the doc already holds and broadcast
  the edit, so no copy.

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
