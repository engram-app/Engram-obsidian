# CRDT convergence sim — tier-fidelity gaps

_Last verified: 2026-10-03_

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

> **Rule for any sim-reproduced bug:** a sim "repro" can be a model-server artifact, not a real defect. Two incidents were mis-filed that way: the model server was pull-only and never solicited a held struct (it mis-filed #299 as a backend bug), and an earlier #299b repro ran on a checkout nine commits behind `origin/main`. Reproduce on current `origin/main` in a worktree (the shared checkout is often parked behind) and confirm the real backend behaves as the model does before calling it a product bug.

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

## Finding #3: suspected strand, CLOSED (#295)

Seed `3440604223` (note `n22.md`, server seq 262) once showed replicas whose catch-up cursor advanced to a note's seq without materializing it. #295 was closed 2026-09-25 as not reproducible: the client was rebuilt on Relay's model (#331), the adjacent seq-fence defect was fixed (#296), and neither sim tier could produce the witness. The trade it probed still stands: `walkOpLog` (#378) advances past every row SEEN, applied or skipped, so a permanently-unappliable op cannot stall the feed (*can't stall* was bought with *can strand*). If a stranded note ever resurfaces, that is the one place to look.
