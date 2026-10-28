# Context Doc: Rapid same-note saves revert the server (receiver pushes stale text back)

_Last verified: 2026-10-28_

## Status
Fixed. Engram#2271, fixed by Engram-obsidian PR #653 (merge `8dbcb42b`), shipped in plugin 1.39.0. The server-side e2e check that proves it is Engram#2287. The sibling backend ordering bug is Engram#2286 (open as of this date).

## What This Is
Five REST saves to one new note about 16 ms apart (e2e test_49, `test_rapid_api_edits_final_content_arrives`). A receiving plugin wrote an older version to disk, then read its own write back as a user edit and pushed it. The server ended on `Version 4 of 5`, or `Version 51 of 5` (a merge of a stale and a fresh text). That is data loss, not a flake.

## The mechanism
`pushFile` / drift capture (`captureDiskDriftBeforeRemote`) treats "disk differs from the recorded baseline" as a user edit and folds it into the doc with `applyLocalEdit`. That is only sound if every plugin write puts the doc's current text on disk AND records that exact text as the baseline. Two paths broke it:

1. **Write from a snapshot captured before an await.** Several writers (stream-event first-delivery apply, catch-up replay, one registry flush per fan-out) each captured text, then awaited (disk check, `vault.create`, rename follow, first-load interlock). When they overlapped on a new note, the loser of the create race ran the "already exists" fallback and overwrote the winner with its older text. Same for a flush whose doc moved on while it awaited. Disk now held v4 while the doc was at v5.
2. **Overlapping writes skipping the baseline record.** The #578 start-order bookkeeping (`flushGen`, `order.recorded = order.started`) assumed writes land in the order they start. Trace: `flush 3` found disk already at v3 and returned early while `flush 4`'s write was in flight; the bookkeeping then marked v4 as superseded, so v4 landed without being recorded. Baseline v3, disk v4, so the next fan-out's drift capture ran `applyLocalEdit("...4 of 5")` on a doc at v5 and sent it. This one was only found after the server check existed (commit `12d7c816`).

## The invariant (keep it)
Every note-file write for a CRDT note goes through `textForWrite` in `src/sync.ts` (via `writeNoteFile` / `createFileWithFolders`, wrapped by `writeCrdtNote` / `flushFromCrdt`):
- it asks the doc for its current text right before the disk call (not before the await),
- marks that text in `flushingHash`,
- returns the text it actually wrote, and the caller records THAT as the baseline.

When writes overlap (two in flight, or an already-matching check during one), each records its baseline only if disk still holds its text. `flushGen` is deleted. A blank doc never replaces a caller's text (`latest()` drops blank doc text), so the re-ask cannot slip a wipe past the empty-write guard.

Adding a new write path for a note file? It must go through `textForWrite` and record its return value. A raw `vault.modify`/`vault.create` with a captured string reopens this bug.

Intentional exceptions: `restoreLocalText` (writes the user's own held text), conflict copies (new paths), legacy `applyChange` (non-CRDT notes only). Discovery (doc with no history) writes the row body; the first-load interlock keeps its resolved text only when it resolved held input (merge or forced merge), otherwise it re-asks.

This is Relay's "disk writes come from the doc" rule (`merge-hsm/MergeHSM.ts`, `emitWriteDisk`, `diskMatchesLCA`). We still have several writers per note; porting Relay's single-owner HSM is the larger follow-up (see workspace `docs/context/relay-pattern-audit.md`).

## Why device-side asserts missed it
test_49 originally checked only that device B showed `Version 5 of 5`. B can be correct while the OTHER receiver pushes stale text to the server. The first 20/20 green on `057b679b` never checked the server, so it proved nothing about the server copy. Engram#2287 adds: wait until both receivers owe nothing outbound (`await_quiescent`, no fullSync kick, so a pull cannot mask the revert), then assert the server holds exactly `# Rapid Edit\nVersion 5 of 5`. That check caught the second revert path (2 of 20 on `350f9b03`). Lesson: a sync e2e that only reads devices cannot see server corruption; assert the server.

## How to repro
- Unit (fast, deterministic): `bun test tests/rapid-rest-fanout.test.ts tests/sync-crdt-discovery-echo.test.ts`. Real registry with production wiring, Obsidian-like `create` that rejects an existing path, disk latency as seeded microtask turns.
- e2e: on a throwaway backend branch (never merged), parametrize the test to repeat, e.g. `@pytest.mark.parametrize("rep", range(10))` on `test_rapid_api_edits_final_content_arrives` in `e2e/tests/test_49_cross_auth_sync.py`, and put `[e2e: clerk/test_rapid_api_edits_final_content_arrives]` in the HEAD commit message so CI runs only that test. Reference: Engram branch `test/e2e-test49-server-check-proof`. Pairing a plugin branch with it: workspace `docs/context/oauth-e2e-pairing-and-token-binding.md`.
- Bug rate: about 4/10 on 1.38.x heads; 40/40 green on `12d7c816` (runs 40634054885 and 40634479202).

## Gotchas
- **One e2e-clerk run at a time.** Each run mints Clerk test users and the dev instance caps at 100. Parallel or crashed runs exhaust it and every later run fails at sign-up. The reaper is the `e2e-orphans` task in backend `.github/workflows/cron.yml` (scheduled, or `workflow_dispatch` with `task: e2e-orphans`), and it only reaps `e2e-*` users older than 1 hour. So after a burst you wait, there is no instant reset.
- A targeted `[e2e: ...]` run is never mergeable (the `ci` job stays red by design). Do not read that red as a failure.
- **Sibling bug Engram#2286 (backend, not fixed by #653):** `Engram.Notes.FanoutPacer.emit/4` queues a note's first (cold) `note_yjs_update` for the 100 ms drain while the next (hot) frames go inline, so the first update arrives LAST. Yjs tolerates it (full states), but it adds one more concurrent apply and drift capture on the receiver (widened this race) and regresses `crdtHead`. Fix belongs in `FanoutPacer.emit/4`: per-note FIFO. Symptom in logs: a trailing `note_yjs_update` with no `request_id` and no matching `note_changed`, ~100 ms after the first POST.
- Draft #646 (per-note fan-out lane) fixes readers, not writers; it still corrupted the server (`Version 51 of 5`, run 40624004365) because stream-event and catch-up writers sit outside the lane.

## Failed Approaches / Dead Ends
- Re-asking the doc only at the start of `flushFromCrdt`: still red, the await after the ask is the window.
- Start-order bookkeeping (`flushGen`) to pick which overlapping write records: start order cannot tell which write landed last. Replaced by "record only if disk still holds your text".
- Trusting device-only e2e green (see above).

## Accepted risk
If two overlapping disk calls land out of issue order (only when `latest()` resolutions reorder), the older text lands last and records. Disk equals baseline, so no push and no corruption, but disk lags the doc until the next flush.

## References
- `src/sync.ts`: `textForWrite`, `writeNoteFile`, `createFileWithFolders`, `writeCrdtNote`, `flushFromCrdt`
- `tests/rapid-rest-fanout.test.ts`, `tests/sync-crdt-discovery-echo.test.ts`
- `docs/context/crdt-flush-echo-read-as-local-edit.md` (the #578 echo class this extends)
- Engram#2271, Engram-obsidian#653, Engram#2287, Engram#2286
