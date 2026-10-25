# Context Doc: history-less keep-both copied an edit made on the delta's own base

**Trigger:** an edit on a just-discovered note lands in a `(conflict <date>).md`
copy and the original reverts; or e2e `test_concurrent_edits_both_survive` /
`test_edit_after_discovery_round_trips` fail intermittently, usually the first
CRDT test after session start.


> **Superseded mechanism (2026-10-25, PR #640):** `fastForwardHistoryLess` and
> the pre-apply keep-both in `adoptHistoryLessNote` are gone. The same rules
> (fast-forward, 3-way merge on the discovered body, one copy otherwise) now run
> in ONE place, the disk-drift interlock in `flushFromCrdt`, for every route a
> first server state arrives by. See `crdt-load-gate.md`. The history below is
> still why the rules are what they are.

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

## Divergence on the discovered body

When BOTH sides edited the body discovery wrote (A's edit is in the fan-out,
B's is on disk), the preview no longer hashes to the baseline and the note
used to go keep-both: e2e `test_no_conflict_modal_on_divergence` found B's
edit in `NoModal (conflict ...).md`.

The discovery leg now remembers the body it wrote (`discoveryBases`, in
memory, cleared once the adopt gives the doc history, 10 min TTL swept on
write, 4M-char cap, over-limit notes skipped). When its hash equals the
baseline, the adopt 3-way merges with `merge3(base, disk, doc)` and keeps
both edits; overlapping edits still go keep-both.

Not `baseStore`: `lcaFor` feeds that to every later `applyLocalEdit` merge
and CRDT flushes never refresh it, so a body stored there goes stale and
re-applies remote edits (#544 class).

Not `mergeDiskOntoDoc`: diff-match-patch's fuzzy `patch_apply` reports a
same-word conflict as clean and silently drops one side ("one TWO three" vs
"one deux three" merges clean to "one TWO three"). `applyLocalEdit` still
uses it; that is a separate change.

`merge3` rules, each from a probe counterexample (PR 615 review):
- Line granularity, like diff3. Character diffs shift alignment with
  cleanup, so the same edit on both sides stopped looking identical and was
  kept twice, and same-point inserts split a `\r\n` into a bare CR.
- Overlapping or touching edits conflict, like git. With repeated lines the
  line diff can pin an edit to the wrong copy; touching edits are where that
  lost a side's line.
- Exception: two pure inserts at one point (both appended a line) keep both,
  remote first. Refused if one contains the other (an extended edit would be
  duplicated) or either lacks a trailing newline (two lines would join).
- Known, accepted: with repeated identical lines the merge can place blank
  lines differently, and two sides producing the same line apply it once.
  Randomized probes found no lost line content.

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
