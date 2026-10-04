# Catch-up convergence (missed-delivery healing)

_Last verified: 2026-10-03_

Why a missed CRDT delivery used to be missed forever, and the rules the healing path must keep. The transport has been rewritten twice since the original fix (2026-07: CRDT-authoritative rewire, which removed the per-open `verifyConvergenceOnOpen`; then the REST-converge purge, which deleted `api.getUpdates`/`postUpdate`). The reasoning below survived; for current mechanism read the docstrings around `catchupViaSocket`, `socketConverge` and `commitCrdtConvergence` in `src/sync.ts`.

## Current shape

File-open is a pure local bind. Missed deliveries are healed by socket vault-catchup (`SyncEngine.catchupViaSocket()`, run on connect/reconnect and at `onLayoutReady`) over `crdt_catchup_heads` / `crdt_catchup_delta`. A diverged note is converged by a staged socket re-handshake (`pendingConvergence` + `socketConverge`, committed content-verified by `commitCrdtConvergence`), for live-bound and cold notes alike. `CrdtEnrollment.reset(id)` + `enroll(id)` is the forced STEP1 re-handshake primitive that lifts the once-per-session guard.

## The three failure classes

1. **Create-race:** another writer (MCP/web) creates the path first and the server keeps its id; a client that does not adopt the response id keys its CRDT receive path to a dead local id. Loki tell: `crdt_channel: dropped crdt_msg -> not_found`.
2. **Missed announce black hole:** `crdt_doc_ready` is edge-triggered and enrollment is once per session, so a missed announce never healed until reload unless something re-handshakes.
3. **Ignorant-push deletion:** a client that missed a delivery pushes full content, and the server's three-way merge against its stored snapshot "convergently" deletes content the client never saw. The `base_hash` CAS gate (`pushNote` sends `base_hash = syncState.serverHash`, the server's last-seen `content_hash`, NEVER computed locally) turns that into a 409 that rides the conflict flow (keep-both copy, no silent deletion). Conflict-flow re-pushes deliberately send no base.

## Rules the healing writes must keep

A healing write is itself a write and needs the same staleness and dirtiness discipline as a push. Each rule shipped after a real failure:

1. **Seed-only CAS base.** A note received only over CRDT has no `base_hash`, so a later fallback push bypasses the CAS gate and erases server edits. Seed `serverHash`/`version` from the event gated on `prior?.serverHash === undefined` (no base yet, NOT "file exists", because the room delivery races the file onto disk). Never advance a real base: stamping the announced hash over it marks the note converged before the body lands and defeats every recovery path.
2. **Dirty guard before backfill.** "Server moved" is not enough. If the LOCAL file also diverged from the last-synced hash it is a genuine conflict, and a backfill silently erases the unpushed local edit. Both diverged falls through to the conflict flow.
3. **Re-check identity after every await before writing.** `materializeRelocated` is unawaited and races the pull's id-keyed move; a stale old-path upsert re-created a tombstoned file, whose modify event re-pushed it under a FRESH mint (server-side path resurrection). Re-check id to path after the `projectedText` await, immediately before the write. `flushFromCrdt` has no identity guard and fails open.
4. **A bound editor is the sole writer.** Never write disk under a live-bound note; divergence there forces a reset+enroll re-handshake.
5. **Never record a hash or seq for bytes you did not apply.** See `crdt-empty-placeholder-cold-rooms.md`.

## Gotchas

- `pushNote` call shapes are pinned by tests with `toHaveBeenCalledWith`; never pass trailing `undefined` (it changes `arguments.length`). `base_hash` is the 6th positional.
- Two defaults in two resolvers: the push-409 path under "auto" writes a conflict copy and force re-pushes; the no-handler fallback keeps remote.
- `flushFromCrdt` resolves via `getAbstractFileByPath`, writes with `vault.modify`, and skips when disk already equals content.
- Breadcrumbs: plugin rlog warns `CRDT catch-up:` and `bind-time divergence:` mark the healing paths firing.

## References

- Pinning e2e (engram repo): `e2e/tests/test_84_create_race.py`, `test_85_missed_delivery_no_deletion.py`
- `crdt-editor-bind-race-pollution.md`, `crdt-pull-gated-by-create-ack.md`
- Architecture it serves: `../engram-workspace/docs/context/identity-as-crdt-decision.md`; seq-fence data-loss class: `../engram-workspace/docs/context/crdt-catchup-backfill-revert-and-seq-fence.md`
- Open: plugin #203 (CRDT-frame leg: serverHash lags checkpoint, errs toward false conflict), #206 (flush-loop dequeue clobber)
