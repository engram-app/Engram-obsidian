# Context Doc: Catch-up convergence (missed-delivery healing)

_Last verified: 2026-07-07_

## Status
Working — shipped in plugin PRs #197 (v1.11.22) + #198 (v1.11.23), backend v0.5.642.

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
  - (c) `verifyConvergenceOnOpen` on file-open: compares the manifest snapshot's `content_hash` (30s-TTL cache from PR #193 — `cacheManifestOwners` now keeps hashes in `manifestPathHashes` instead of dropping them) vs stored `serverHash`; divergence → reset+enroll.

## Gotchas

- **pushNote positional-arg discipline:** tests pin exact call shapes via `toHaveBeenCalledWith`; never pass trailing `undefined` (changes `arguments.length`). `base_hash` is the 6th positional.
- **Two different defaults in two resolvers:** `conflictResolution` "auto" (default) on push-409 = conflict-copy + keep-local force re-push; "no handler" modal fallback = keep-remote.
- **flushFromCrdt** resolves via `getAbstractFileByPath` (not `getFileByPath`) and writes via `vault.modify` for existing files; idempotent-skip when disk already equals content.
- **`CrdtEnrollment.reset(id)` + `enroll(id)`** = forced STEP1 re-handshake (lifts the once-per-session guard) — the universal "re-deliver whatever I missed" primitive.
- **Diagnosis breadcrumbs:** `crdt_channel: dropped crdt_msg → not_found` in prod Loki = id cross-wire; plugin rlog warns `CRDT catch-up:` and `bind-time divergence:` mark the healing paths firing.

## References

- `docs/context/crdt-editor-bind-race-pollution.md` (PR #194)
- engram-workspace `docs/context/identity-as-crdt-decision.md` (the architecture this serves)
- engram-workspace `docs/context/testing-surface-audit-2026-07-07.md` (pull-masking was finding #1)
