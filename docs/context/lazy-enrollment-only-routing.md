# Context Doc: Lazy enrollment is the only path

_Last verified: 2026-07-11_

If you need to understand why disk edits to closed notes now route legacy REST instead of CRDT, why the eager per-note-room enrollment is gone, or how to migrate an eager-era sync test, read this. (Commit 16f8483, v1.12.13.)

## Root cause it fixes
The connect storm survived the 2026-07-09 pool-exhaustion fix because lazy enrollment shipped in plugin PR #222 behind a `lazyEnrollment` flag that **defaulted OFF and was never flipped**. Every deployed client ran the EAGER path, opening a CRDT room per note on connect. Backend #984 only made the storm survivable, not prevented. Real fix: remove the flag, hard-wire lazy.

## What "lazy is the only path" means in code (`src/sync.ts`, `src/main.ts`)
- `isCrdtManagedOffline` (the push gate) now **requires `isLiveBound`**. This is the #222 correctness hinge: a cold confirmed note edited without a handshaked Y.Doc would seed a DUPLICATE lineage (#846/#161 class), so it must route to convergent REST instead.
- Removed the two eager pull-discovery `enroll` sites in the `/changes` apply loop.
- Removed the eager cold-start reconcile block in `main.ts` + the now-dead `reconcileColdStart` helper. Cold-note drift reconciles via REST `fullSync`.
- `coldReceive` always frees a transient doc when not live-bound.

## Key mental model: the two edit paths (this cost hours)
- **`handleModify`** (disk-change event): if the note IS live-bound, it RETURNS EARLY at the "Editor-owns-the-file gate" (`src/sync.ts` ~L1265) because the live CodeMirror binding already streamed the edit per keystroke. So `handleModify` only reaches `pushFile` for NOT-live-bound notes.
- **`pushFile`** uses `isCrdtManagedOffline` (now requires live-bound) to pick CRDT-ops-durable-queue vs legacy whole-doc REST.
- **Net behavior change:** a disk edit to a NOT-open note routes legacy REST (base_hash CAS), NOT CRDT ops. Open-note edits are unchanged (the editor binding handles them live). Correct: a closed note has no room under lazy.

## Migrating an eager-era sync test
The eager suite asserted "confirmed markdown note routes CRDT" everywhere. Under lazy:
- A test driving CRDT routing via `handleModify` on a confirmed note must instead call `pushFile` directly AND set `engine.setLiveBoundCheck(() => true)` (models an open note), since `handleModify(live-bound)` early-returns.
- A test driving `pushFile`/`pushNotesViaBatch` for CRDT routing just needs `setLiveBoundCheck(() => true)` added.
- Cold-note echo tests (after `flushFromCrdt`) suppress via the echo-hash gate in `pushFile` (not the diff layer); align the mock `cachedRead` to the flushed content and assert nothing re-transmits.
- Cold discovered/existing notes are NOT enrolled anymore, so flip `expect(enroll).toHaveBeenCalled()` → `.not.toHaveBeenCalled()`.
