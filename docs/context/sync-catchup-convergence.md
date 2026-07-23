# Context Doc: Catch-up convergence (missed-delivery healing)

_Last verified: 2026-07-22 (Phase E3 update)_

## Status
Working — shipped in plugin PRs #197 (v1.11.22) + #198 (v1.11.23), backend v0.5.642; hardened by #207/#209/#211 (v1.11.31-33) after reruns=0 unmasked three holes in the original design (see "The four guards").

**Superseded (2026-07, Plan B1 CRDT-authoritative rewire, Task 6):** the per-open handshake `verifyConvergenceOnOpen` described in (c) below was REMOVED. File-open is now a pure local bind (`this.crdtLiveViews?.refresh()`, no hash comparison, no REST round-trip). Convergence on missed deliveries is now owned entirely by socket vault-catchup (`SyncEngine.catchupViaSocket()`) run at connect/reconnect (`main.ts` `onStatusChange`) and at `onLayoutReady`, over `crdt_catchup_heads`/`crdt_catchup_delta`.

**Superseded again (2026-07-22, Phase E3 REST-converge purge):** every REST leg this doc's mechanisms leaned on is now DELETED — `api.getUpdates`/`api.postUpdate` and the whole restConverge family are gone. Mechanism (b)'s "backfill the pull body" is now a stage-then-fire socket re-handshake (`pendingConvergence` + `socketConverge` + content-verified `commitCrdtConvergence`) for BOTH the live-bound and cold legs; the offline-queue "REST-fallback push (channel down)" in guard 1's narrative no longer exists (a channel-down crdt entry stays durably queued and settles only when an inbound frame proves the socket round-trip). The id-adoption story, `base_hash` CAS gate, dirty-guard conflict routing, and the guards' *reasoning* remain accurate — only the transport under them changed. Current mechanism detail: `docs/context/` Phase E3 notes + `src/sync.ts` docstrings around `socketConverge`.

## What This Is
Why a missed CRDT delivery used to be missed forever, and the healing system (PRs #197 + #198, 2026-07-07/08) that makes the plugin converge instead of silently diverging or deleting content.

## The failure chain (live-tested against prod v0.5.642)

1. **Create-race:** another writer (MCP/web) creates a path first; server keeps its id; batch push + offline-queue replay never adopted the response id (`pushFile` did) → CRDT receive path keyed to a dead local id. The tell in Loki: `crdt_channel: dropped crdt_msg → not_found`.
2. **Missed announce black hole:** `crdt_doc_ready` is edge-triggered; enrollment is once-per-session; the `/changes` pull path for CRDT-owned local notes only re-enrolled (a no-op) and never compared hashes → a missed announce NEVER healed until Obsidian reload.
3. **Ignorant-push deletion:** a client that missed a delivery pushes full content; the server's three-way merge diffs against the stored snapshot → "convergently" deletes content the client never saw.

## The fixes

- **#197 (v1.11.22):** batch (`recordBatchPushOk`) + offline replay (`flushQueue`) mint-and-send the client id and adopt `result.id` / `resp.note.id` + `confirmNoteId` (`pushFile` parity); `SyncEngine.ensureNoteIdMapped` runs the manifest reconcile live (single-flight + one trailing rerun) when an announce names an unmappable id — wired in `main.ts` `onCrdtDocReady`.
- **#198 (v1.11.23):**
  - (a) `pushFile` declares `base_hash = syncState.serverHash` (the server `content_hash` last synced — NEVER computed locally); backend v0.5.642 CAS gate 409s stale pushes; the 409 rides the existing conflict flow (auto default = conflict-copy file, no silent deletion). Conflict-flow re-pushes deliberately send no base (intentional overwrites).
  - (b) `applyChange` for a CRDT-owned local note backfills the pull body when `change.content_hash` diverges from stored `serverHash` — or forces enrollment reset+enroll re-handshake when the note is live-bound (`setLiveBoundCheck`; the editor owns the file, never write disk under it).
  - (c) ~~`verifyConvergenceOnOpen` on file-open~~ — REMOVED in the B1 rewire (Task 6). Was: compared the manifest snapshot's `content_hash` (30s-TTL cache from PR #193 — `cacheManifestOwners` now keeps hashes in `manifestPathHashes` instead of dropping them) vs stored `serverHash`; divergence → reset+enroll. Replaced by socket vault-catchup on connect/reconnect (`catchupViaSocket()`) — see Status note above.

## Gotchas

- **pushNote positional-arg discipline:** tests pin exact call shapes via `toHaveBeenCalledWith`; never pass trailing `undefined` (changes `arguments.length`). `base_hash` is the 6th positional.
- **Two different defaults in two resolvers:** `conflictResolution` "auto" (default) on push-409 = conflict-copy + keep-local force re-push; "no handler" modal fallback = keep-remote.
- **flushFromCrdt** resolves via `getAbstractFileByPath` (not `getFileByPath`) and writes via `vault.modify` for existing files; idempotent-skip when disk already equals content.
- **`CrdtEnrollment.reset(id)` + `enroll(id)`** = forced STEP1 re-handshake (lifts the once-per-session guard) — the universal "re-deliver whatever I missed" primitive.
- **Diagnosis breadcrumbs:** `crdt_channel: dropped crdt_msg → not_found` in prod Loki = id cross-wire; plugin rlog warns `CRDT catch-up:` and `bind-time divergence:` mark the healing paths firing.

## The four guards (added 2026-07-08, after reruns=0 unmasked the gaps)

The catch-up system's healing writes all needed guarding — each shipped after a
real failure, three of them caught by e2e within one night:

1. **C1 seed-only CAS base (#207, v1.11.32).** The WS-event C1 branch recorded
   NO syncState, so a device that received a note only over CRDT had no
   `base_hash` — its REST-fallback push (channel down) bypassed the CAS gate
   and erased server edits (e2e test_85 caught it live). The branch now SEEDS
   `serverHash`+`version` from the event, gated on `prior?.serverHash ===
   undefined`: seed-only, never advance. Stamping the announced hash over a
   real converged base would mark the note converged before the body lands,
   defeating every recovery path if the room delivery is then missed. Gate on
   "no base yet", NOT file existence — the room delivery races the file onto
   disk.
2. **Backfill dirty-guard (#209, v1.11.31).** "Server moved" is not enough to
   backfill: when the LOCAL file also diverged from the last-synced hash it is
   a genuine three-way conflict, and the backfill silently erased the unpushed
   local edit (e2e test_14). Local+remote both diverged now falls through to
   the legacy conflict flow (3-way merge → modal/auto).
3. **Materialize identity re-check (#211, v1.11.33).** `materializeRelocated`
   is unawaited and races the pull's id-keyed move: a stale old-path upsert
   re-created the tombstoned file, whose modify event re-pushed it under a
   FRESH mint — server-side path resurrection (e2e test_34, CI artifacts show
   the second id). The id→path identity is re-checked AFTER the
   `projectedText` await (the relocation can land during its IDB suspend;
   `flushFromCrdt` has no identity guard and fails open), immediately before
   the write. Defends the MOVE case; the tombstone-delete case is backstopped
   by the doc-teardown `isSynced` gate.
4. **Live-bound split (#198, original).** A bound editor is the sole CRDT
   writer — divergence there forces a reset+enroll re-handshake instead of a
   disk write.

The lesson repeating across all three new guards: a healing write is itself a
write, and every write needs the same staleness/dirtiness discipline as a
push. e2e test_84/test_85 (backend #962) pin the incident chain permanently.

## References

- `docs/context/crdt-editor-bind-race-pollution.md` (PR #194)
- `../engram-workspace/docs/context/identity-as-crdt-decision.md` (the architecture this serves)
- `../engram-workspace/docs/context/testing-surface-audit-2026-07-07.md` (pull-masking was finding #1)
- Plugin issues #203 (CRDT-frame leg: serverHash lags checkpoint — errs toward false conflict, open), #206 (flush-loop dequeue clobber, open), #210 (resurrection forensics)
- Backend e2e `test_84_create_race.py` / `test_85_missed_delivery_no_deletion.py` (backend #962)
