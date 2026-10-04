# An empty file lies three ways (and the first-sync placeholder it hides)

_Last verified: 2026-10-03_

Plugin #477 / PR #478. Filed as "cold-note catch-up opens a room per note" off a prod first sync (833 rooms for ~1,000 notes). Chasing it found a real defect underneath and killed the perf premise.

## The chain

1. Device A pushes. The op-log feed emits a `v=1` create row whose `content` is EMPTY (every such row shares the empty-content hash).
2. Device B's catch-up discovery leg materializes the row's body: a **0-byte file**, with that empty recorded as its baseline (20 of 150 notes on a bulk first sync).
3. The real body lands later in a row with a fresh hash.
4. Disk (0b) differs from the row, so the quiet-record guard's `localNow === content` fails and the note takes the cold-converge leg to fetch a body the row already carries.

## An empty file is not a license to write

`isUnconvergedEmptyPlaceholder` guards the shortcut "disk is empty, so just write the row's body". An empty file lies three ways:

1. **The emptiness IS the converged state.** A remote clear applied through `flushFromCrdt` calls `recordCrdtBaseline("")`, so `stored.hash === fnv1a("")` and the drift-copy escape hatch never fires; a later checkpoint-lagged row carrying the PRE-clear body would resurrect deleted content. `crdtHead` separates them: a converged note carries a REAL head; a discovery placeholder carries only the `CRDT_HEAD_CREATED` sentinel ("the server has this note, we have never applied its ops").
2. **The doc holds local work.** `hasUndeliveredOps` is the precondition `convergeColdNoteRoomFree` enforces for the same reason: a snapshot write cannot carry anything upward.
3. **The cache invented it.** `localNow` is a `cachedRead`, and right after a create is exactly where Obsidian's cache lies. Prove the 0 bytes with `adapter.read`; a read failure answers false and the converge always runs.

## Never record what you cannot verify

The leg writes the body and records exactly what the discovery leg records: `hash` via `recordCrdtBaseline`, plus `markServerKnown`. NO `serverHash`, NO `seq`. A row can lag its own `content_hash` (fresh hash, stale bytes: the test_82 "went deaf on the stale bytes" class), so recording it marks the note in sync at bytes you cannot verify, and every later row carrying it compares equal and is skipped, permanently. It also drops any staged `pendingConvergence` for the note: `commitCrdtConvergence` records unconditionally once a stage exists (no text-verify gate), so an in-flight room's STEP2 would otherwise commit an OLDER `serverHash`/`version`/`seq` over what this row just materialized and walk `seq` backward.

## What this did NOT buy (measured, do not quote the original numbers)

- No visible empty-note window: an e2e asserting "B holds no 0-byte notes after catch-up" passed on plain `main` too (the cold converge fills the placeholder inside the same `trigger_full_sync()`). The test could not fail, so it was deleted; a test that cannot fail reads as coverage.
- No room-count win: over a 150-note bulk first sync (n=3 each) `main` shows 1-3 rooms and the final fix 0-4. The consistent 0 of the first, unsafe fix came entirely from recording a hash it could not verify, i.e. from suppressing convergence. The real benefit is ~13% of first-sync notes skipping one `crdt_doc_state` round-trip.
- The issue's 833/1,000 is pre-#474-shaped (`main` is ~1-3 per 150 since the room-free path), and room count was never a RAM proxy.

## Method that worked

`enrollSites` buckets by stack frame so it can only name `fireCrdtReHandshake`, the funnel every caller collapses into. Two ~10-line instruments cracked it: an explicit label passed at each `socketConverge` call site (`convergeSites`, a `Map<string, number>` bumped in `fireCrdtReHandshake`), and a per-condition miss counter at the quiet-record guard (answer: `disk-differs`, 100%). Neither is in the tree; re-add rather than hunt for the deleted branch. Confirm a leg you added actually fires (probe log + `docker logs | grep -c`): "0 rooms" means nothing if it never ran. Room count needs n>=3; single runs range 0-4 on identical code.

## Repro

`test_77_bulk_first_sync` on `main` is single-device, and the #477 chain only appears on a device that PULLS the create row. Add a second device (`cdp_b`), drive `await cdp_b.trigger_full_sync()` and inspect B. `E2E_BULK_NOTE_COUNT` lowers the count locally (CI runs 1,000 and the default must never be lowered). Stack and env per `../engram-workspace/docs/context/local-crdt-e2e-repro.md`. Client `rlog()` lines land in the engram container log as `[client:*]` with ship-time timestamps, so never order by them.

## Gotchas

- `stampSyncedRow` REPLACES the row by contract and `crdtHead` lives in that row: a `markServerKnown` before it is erased by the next line, and one after it writes the CREATED sentinel over a hole where a real head used to be. Use `patchSyncedRow` when the row must survive.
- `test_34_folder_rename_propagation` fails whenever it runs after `tests/crdt/` on the dev box (leftover state from the Playwright specs that time out there); it passes solo. Control the batch, not just the test.
- Local attachment tests (`test_33`, `test_79`, `test_80`) fail on a MinIO `403 SignatureDoesNotMatch`: env drift, not code.

## References

- Plugin #477, PR #478; the other ungated-`enroll()` site is in `crdt-pull-gated-by-create-ack.md`
- engram repo: `docs/context/crdt-room-lifetime-and-drain.md`
