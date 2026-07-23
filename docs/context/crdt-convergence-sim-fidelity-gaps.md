# CRDT convergence sim — tier-fidelity gaps

The convergence sim tier (`tests/sim/`) boots N real headless `SyncEngine`
replicas against a CRDT-only `ModelServer` + deterministic `Scheduler`, then
`assertConverged` (`oracle.ts`) checks all three surfaces strictly: disk +
Y.Doc projected text + `noteIdMap` id, plus no-extra-notes and `findWipes`
(#288). The scripted **differential gate** (`regressions.test.ts`) is green and
pays rent today.

A **seeded random-op suite** (5 replicas × 1000 ops) does NOT converge in this
tier and is kept as a runnable tool, not a test:

    tests/sim/random-harness.ts   →   SIM_SEED=n bun --preload ./tests/preload.ts tests/sim/random-harness.ts

(`.ts`, not `.test.ts`, so `bun test` never collects it — no skipped test.
`--preload` is required because `obsidian` is mocked in `tests/preload.ts`.)

## Why the random suite can't be green yet — two fidelity gaps

### Gap #1 — headless replicas never enroll → history-less conflict storm
Sim replicas have no Obsidian editor, so `deps.isBound(path) → false` ALWAYS
(`replica.ts`, by design). STEP1 enrollment (giving a note a live CRDT Y.Doc
with history) happens ONLY when `isBound` is true
(`src/crdt/wiring.ts` `onCrdtDocReady:340-343`). So every sim note stays
perpetually history-less (materialized via catch-up-to-disk, never a live
handshake). Two replicas concurrently editing a shared history-less note take
the keep-both drift path (`src/sync.ts reconcileDriftOntoServer:1294-1356 →
writeDriftConflictCopy:1358`), spawning `<name> (conflict <date>).md` copies
that are themselves history-less and re-conflict without bound.

Not a production bug: in real Obsidian you can't edit a note without opening it,
which enrolls it history-FULL (the `applyLocalEdit` diff-merge path,
`sync.ts:1314-1337`). **Fix (P2 tier fidelity):** model editor
binding/enrollment so a note can go history-FULL (e.g. a Replica op that "opens"
a note → `isBound` true → STEP1 enroll).

### Gap #2 — model omits `note_changed` → delete + rename don't propagate live
`ModelServer` never emits `note_changed` (its documented CRDT-only divergence).
That event drives, on remote devices: rename old-path cleanup via
`moveIfIdRelocated` (`src/sync.ts:4030-4046`) and live delete-trash. So a
rename/delete only reaches other replicas via a later reconnect catch-up,
leaving stale old-path files / undeleted stragglers at quiescence. Rename is
already excluded from the harness op mix for this reason; e2e test_10/test_34
converge renames against the REAL backend, so this is a model gap, not a plugin
bug. **Fix (P2):** model `note_changed` fan-out — or route delete/rename to the
P2 headless tier that uses the real backend.

## Finding #3 — suspected REAL bug, HELD from filing
Under drop/offline, some notes end **stranded on a replica whose catch-up cursor
has advanced to that note's seq without materializing its content** → permanent
strand. Witness: seed `3440604223`, `n22.md` server seq 262, replicas A/B report
`getCatchupSeq() === 262` while missing the note; catch-up delivers only
`seq > cursor`, so 262 never re-delivers. Iterated reconnect (5 rounds) does NOT
heal it; zero `seq-replay: skipped` lines.

Hypothesis (file:line): a catch-up `applySyncChange` that echo/hash-dedups a row
(`src/sync.ts:4048-4069`) still lets the loop advance the cursor past that row's
seq (`runSeqReplayOnce:4432`), so a row not materialized locally is never
revisited — the "silent-skip consumes a feed entry" hazard the code's own
comment warns about (`applyLiveOpWithSeq`, `sync.ts:1604-1606`).

**Why held:** entangled with #1/#2 (the always-history-less state changes which
apply branch a catch-up row takes). Re-isolate on a faithful tier (after #1/#2
land), starting from the witness seed above, before filing an issue.
