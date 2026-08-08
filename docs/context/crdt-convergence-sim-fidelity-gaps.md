# CRDT convergence sim — tier-fidelity gaps

The convergence sim tier (`tests/sim/`) boots N real headless `SyncEngine`
replicas against a CRDT-only `ModelServer` + deterministic `Scheduler`, then
`assertConverged` (`oracle.ts`) checks all three surfaces strictly: disk +
Y.Doc projected text + `noteIdMap` id, plus no-extra-notes and `findWipes`
(#288).

Two suites run in `bun test` today, both gating:

- `regressions.test.ts` — the scripted **differential gate**
- `random.test.ts` — the **seeded random-op suite**: 5 replicas driving a long
  stream of random, interleaved concurrent edits under drop faults + full-sync
  churn. Fresh seed per iteration from real entropy (the one sanctioned
  nondeterminism: *which* seed to explore), deterministic under that seed,
  `SIM_SEED=n bun test tests/sim/random.test.ts` to replay. The seed and its
  replay command are printed for every iteration.

> **History.** The random suite used to be a de-tested tool
> (`random-harness.ts`, `.ts` not `.test.ts`) because it could not converge in
> this tier. Gap #1 below is what blocked it; that gap is now closed and the
> suite is a real test.

## Gap #1 — headless replicas never enroll → history-less conflict storm — **CLOSED**

Sim replicas had no Obsidian editor, so `deps.isBound(path) → false` ALWAYS
(`replica.ts`, by design). STEP1 enrollment (giving a note a live CRDT Y.Doc
with history) happens ONLY when `isBound` is true
(`src/crdt/wiring.ts` `onCrdtDocReady`). So every sim note stayed perpetually
history-less (materialized via catch-up-to-disk, never a live handshake). Two
replicas concurrently editing a shared history-less note took the keep-both
drift path (`src/sync.ts` `reconcileDriftOntoServer` → `writeDriftConflictCopy`),
spawning `<name> (conflict <date>).md` copies that were themselves history-less
and re-conflicted without bound.

Never a production bug: in real Obsidian you can't edit a note without opening
it, which enrolls it history-FULL (the `applyLocalEdit` diff-merge path).

**Closed by** modelling editor binding/enrollment in the tier: `Replica.openNote`
→ `isBound` true → real STEP1 enrollment → history-FULL Y.Doc, edits stream via
the live-editor path, `deferUntilSeeded` honored. With notes history-FULL,
sustained concurrent editing converges through the real 3-way CRDT merge.

## Gap #2 — model omits `note_changed` → delete + rename don't propagate live — **OPEN** (#406)

`ModelServer` never emits `note_changed` (its documented CRDT-only divergence).
That event drives, on remote devices: rename old-path cleanup via
`moveIfIdRelocated` (`src/sync.ts`) and live delete-trash. So a rename/delete
only reaches other replicas via a later reconnect catch-up, leaving stale
old-path files / undeleted stragglers at quiescence. Delete and rename are
therefore excluded from the random suite's op mix.

A model gap, not a plugin bug: e2e `test_10`/`test_34` converge renames against
the REAL backend.

**Fix:** model `note_changed` fan-out, or route delete/rename to a tier backed by
the real backend. Tracked in #406.

## Finding #3 — suspected strand — **FILED as #295**

Under drop/offline, some notes end **stranded on a replica whose catch-up cursor
has advanced to that note's seq without materializing its content** → permanent
strand. Witness: seed `3440604223`, `n22.md` server seq 262, replicas A/B report
`getCatchupSeq() === 262` while missing the note; catch-up delivers only
`seq > cursor`, so 262 never re-delivers. Iterated reconnect (5 rounds) does NOT
heal it; zero `seq-replay: skipped` lines.

Hypothesis: a catch-up `applySyncChange` that echo/hash-dedups a row still lets
the walk advance the cursor past that row's seq, so a row not materialized
locally is never revisited — the "silent-skip consumes a feed entry" hazard the
code's own comment warns about (`applyLiveOpWithSeq`, `src/sync.ts`).

The advance itself is deliberate and now lives in exactly one place —
`walkOpLog` (#378) advances past every row SEEN, applied or skipped, so that a
permanently-unappliable op cannot stall the feed. That is the trade this
finding probes: *can't stall* was bought with *can strand*. One place to fix,
if it is confirmed.

> This was originally held from filing pending gaps #1 and #2. It has since been
> filed as #295, and gap #1 has closed — so the faithful tier it was waiting for
> now exists. Re-isolate from the witness seed above.
