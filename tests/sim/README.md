# CRDT convergence sim tier

A seeded, deterministic N-replica convergence simulation that boots the REAL
`SyncEngine`/`CrdtManager`/`NoteChannel` classes (obsidian shimmed, vault =
real temp-dir fs) against an in-process model server, drives them through a
seeded scheduler that owns every source of nondeterminism, and asserts
structural convergence (disk + Y.Doc text + noteIdMap, all three surfaces).
Runs in CI as the "Sim convergence tier" step (`.github/workflows/ci.yml`) —
milliseconds, no wall clock, no flakiness.

Design rationale + the full trap list (T1-T6) this tier was built to dodge:
`docs/context/testing-architecture-migration.md` (workspace repo).

## Running it

```bash
bun test tests/sim/                 # the committed differential gate (this is what CI runs)
bun test tests/sim/regressions.test.ts   # just the gate
```

## Replaying a random-exploration seed

The seeded 5-replica random suite **is a gate** — `random.test.ts`, collected by
`bun test`. Replay a specific seed with:

```bash
SIM_SEED=123 bun test tests/sim/random.test.ts
```

Alongside it, `random-harness.ts` stays a **runnable tool, not a test** (a `.ts`,
so `bun test` never collects it). It is for longer exploration runs than a gate
should take — many fresh seeds in one go via `SIM_ITERATIONS`:

```bash
SIM_SEED=123 bun --preload ./tests/preload.ts tests/sim/random-harness.ts
```

`--preload` is required — `obsidian` is mocked in `tests/preload.ts`. The seed
is always printed at the start of a run and on any divergence, so a failure
anyone reports is a one-line rerun.

## Adding a scenario

Scenarios live in `scenarios.ts` as named, seeded, fully-deterministic
scripts (no randomness beyond the scheduler's seeded PRNG, which itself
replays identically for a fixed seed). To add one:

1. Write a `boot()`-based async function returning a `Topology` (or a small
   wrapper struct like `GenesisWipeResult`) — see `equalSeqFence`,
   `test85MissedDeliveryLocalPush`, `genesisWipe` for the shape.
2. Use `scheduler.hold(lane)` / `release(lane)` and `server.dropNext(id)` for
   fault injection; drive the exact interleaving the bug needs.
3. Add a test in `regressions.test.ts` that calls `assertConverged` (or, if
   the scenario is a documented model-tier limit rather than a fix-gate,
   pin the actual boundary behavior explicitly — see the `#288` test for the
   pattern of pinning "doesn't falsely detect X, but does diverge via Y").
4. **Prove the gate is real**: reproduce the bug on the pre-fix engine SHA via
   source overlay (`git checkout <pre-fix-sha> -- src/sync.ts`, rerun, confirm
   RED) before trusting the post-fix GREEN. A scenario that only ever passes
   proves nothing (trap T1). Record both SHAs in the test's docblock.

## What this tier proves

A deterministic differential regression gate: it reproduces the #282
seq-fence bug (`change.seq <= stored.seq` vs the fixed strict `<`) on the
pre-fix engine and passes on the fix, with `test_85`'s missed-delivery shape
as a second independent witness on the same fence class. Both scenarios were
confirmed RED via source-overlay against the pre-fix SHA before being trusted
as a gate — see `regressions.test.ts` docblocks for the exact commits.

## What this tier does NOT prove (T1/T2 disclosure)

- **Server-side correctness.** The model server (`model-server.ts`) is a
  MODEL of the Elixir backend, not the backend. It exists to test CLIENT
  merge/apply/fence logic. Server-side bugs (e.g. #285's stale converge head)
  are invisible to it by construction and are the P2 tier's job (backend
  repo: ExUnit property tests + a headless layer against the real backend).
- **Full Obsidian integration.** No real Obsidian process, no editor,
  vault events are fired explicitly by the sim rather than by fs watchers.
- **Editor-binding behavior.** Sim replicas never enroll a note as
  history-full via the real `isBound`/edit path (see Gap #1 below) — no
  editor exists to bind.
- **#288 (genesis wipe).** Confirmed empirically NOT reproducible by this
  tier: a plain-content genesis is truly empty in the real backend too
  (`crdt_create` → `genesis_crdt_note` with `content=""` produces zero ops in
  reality, same as in the model), so #289's guard is unreachable via a plain
  genesis in EITHER the model or reality. The model's `genesisWipe` scenario
  diverges via a different mechanism and is pinned as a documented boundary,
  not a fix-gate (see `regressions.test.ts`, the `#288` test). Full #288
  repro needs a frontmatter-bearing empty-body note + a bind race — a P2
  server-tier concern.
- **A general 5-replica random-op suite.** Two tier-fidelity gaps block it
  from being trustworthy as a gate today — see
  `docs/context/crdt-convergence-sim-fidelity-gaps.md` for the full
  write-up:
  - **Gap #1** — headless replicas never enroll history-full (`isBound`
    always false with no editor), so concurrent edits on a shared note take
    the keep-both drift path and spawn re-conflicting copies instead of
    merging.
  - **Gap #2** — the model never emits `note_changed`, so rename/delete only
    converge via a later reconnect catch-up, not live.
  - A third finding (a suspected real catch-up strand bug, seed
    `3440604223`) is HELD pending #1/#2 landing — see the fidelity-gaps doc.

## File map

| File | Role |
|---|---|
| `clock.ts` | `SimClock` — deterministic virtual time; owns every `window.setTimeout`/`clearInterval` the engine schedules. |
| `prng.ts` | `mulberry32` seeded PRNG — all sim randomness traces to one seed. |
| `scheduler.ts` | `Scheduler` — owns delivery order, faults (`hold`/`release`, `dropNext`), and timer firing; `drain()` is the quiescence barrier. |
| `vault-fs.ts` | Real-fs-backed vault adapter implementing the `SyncEngine`'s vault surface, structurally matching `mockApp`. |
| `obsidian-shim.ts` | Re-exports the real `TFile`/`TFolder`/etc identities (so `instanceof` checks pass) with an injectable `requestUrl`. |
| `model-server.ts` | In-process Phoenix-v2-framed model of the backend — HTTP + WS surfaces `EngramApi`/`NoteChannel` actually use, real `yjs` docs per note. MODEL, not the backend (T2 disclosure in the file header). |
| `replica.ts` | `Replica` — boots a real `SyncEngine` headless, wired in the same order as `main.ts` production wiring. |
| `oracle.ts` | `assertConverged` (strict 3-surface equality + reconnect) and `findWipes` (the #288 non-empty→empty write-journal detector). |
| `scenarios.ts` | Named, seeded, deterministic scripts (`equalSeqFence`, `test85MissedDeliveryLocalPush`, `genesisWipe`) backing the differential gate. |
| `regressions.test.ts` | The differential regression gate itself — what CI runs. |
| `random.test.ts` | The seeded 5-replica random convergence gate — random interleaved concurrent edits under drop faults, strict oracle at quiescence. Green since fidelity gap #1 closed. |
| `random-harness.ts` | NON-test seeded 5-replica exploration tool (see "Replaying a seed" above) — for long multi-seed runs (`SIM_ITERATIONS`) beyond what a gate should cost. |
