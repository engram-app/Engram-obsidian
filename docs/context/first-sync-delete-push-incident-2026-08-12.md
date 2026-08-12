# Context Doc: First-sync delete-push incident — one-click download trashed and pushed deletions

_Last verified: 2026-08-12_

## Status
**Fenced, root cause OPEN.** Plugin PR #417 (merged `8a4b0750`) ships a two-layer fence in `SyncEngine` that makes the incident class harmless. The underlying replay bug (why the first seq-replay leaves rows consumed-but-unrecorded) is still unexplained — hunt tracked in engram-app/Engram-obsidian#416 (P0). All lost data was restored by hand.

## Symptom
User linked a NEW empty local vault to a populated prod server vault (`9d881502`), clicked the one-click "Download everything" (smart-merge fullSync) from the screens shipped in PR #415. Within ~2 minutes the plugin locally trashed ~40 freshly-pulled files and **pushed their deletions to the server**: 20 notes tombstoned via `crdt_delete`, 19 attachments REST-DELETEd (rows soft-deleted + S3 blobs deleted), 1 folder delete.

Sentry/Grafana lit up with 5xx — but the only reason the attachment deletes returned 500 was an **unrelated** backend crash (`Base.encode64(nil)` in `RebindNoteLinks`, fixed in engram#1370), which fired AFTER each delete had already committed. The 5xx was the smoke alarm, not the fire.

## Root cause (chain — each hop confirmed from prod Loki + DB)

1. **13:37:55 vault switch** (`invalidateIfVaultChanged`) — `wipePerVaultState` RAN and state was clean. This was NOT a stale-state bug.
2. **First seq-replay consumed 1444 rows but left 299 "consumed-but-unrecorded"** (no `syncState` seq entry). The manifest validator caught it at 13:40:37 and rewound 1444→1 — 35 seconds AFTER the damage.
3. **With bookkeeping holes, the engine trashed freshly-pulled files as orphans/strays** (orphan sweep and/or `recently_deleted` branch — exact branch unconfirmed; info-level lines don't ship to Loki).
4. **Obsidian's async vault delete events landed after the 5s `remotelyDeleted` echo TTL and outside the `suppressDeletes` window** → `handleDelete` saw them as USER deletions → pushed to server.

**ROOT CAUSE STILL OPEN:** why the first replay leaves rows consumed-but-unrecorded. Hunt recipe in issue #416 comments (repro: local CRDT stack + ~400-note vault with delete/rename history + fresh device + vault switch).

## Recovery
All data restored by hand: S3 versioning delete-marker removal (19 blobs) + un-tombstoning with a fresh per-row seq via `vaults.change_seq` so clients re-serve the rows. See engram-infra `docs/context/prod-db-readonly-access.md` for the bastion; the restore needed breakglass (write access).

## Fix (plugin PR #417, merged `8a4b0750`)
Two layers in `SyncEngine`:

- **`engineTrashedPaths`** — durable record of every `trashRemotelyDeleted` target. Consumed by `handleDelete`'s echo-skip; cleared by `handleModify` when the path reappears; **never timer-expired**.
- **Evidence rule** — `handleDelete` refuses to push any delete for a path with no recorded `syncState` entry. Tripwire log: `Delete push REFUSED (no sync evidence)` (rlog WARN — ships to Loki). If this fires, the incident class is recurring but now harmless.

## Gotchas
- **The 5s echo TTL (`ECHO_COOLDOWN_MS`) is NOT a safety boundary for mass operations.** Any "engine did X locally, suppress the echo" design must be consumption-based, not time-based.
- **`toDeleteRemote` is always `[]` at PLAN time.** Delete intents materialize at EXECUTION time, so plan-time guards (`simplifiedFirstSync`'s dirty-plan checks) cannot see them.
- **A `crdtHead` in `syncState` IS server-knows-this-note evidence** (only ever set from server-delivered state) — the evidence rule deliberately lets those deletes through.
- **Client info-level rlog lines never reach Loki (only warn+).** The forensic breakthrough was the DB tombstone timestamps + the validator warn line, not client logs.

## Cross-links
- engram-app/Engram-obsidian#416 — P0 + open root-cause hunt
- engram-app/Engram#1369 / #1370 — unrelated backend crash that surfaced the 5xx
- Plugin PR #417 — the fence
- Plugin PR #415 — one-click first-sync screens that exposed it
