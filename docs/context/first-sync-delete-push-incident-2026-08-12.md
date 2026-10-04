# First-sync delete push: the engine must not push deletes it cannot prove the user made

_Last verified: 2026-10-03_

Incident 2026-08-12 (plugin #416, closed 2026-08-13; fence in PR #417): a new empty local vault linked to a populated server vault, one-click "Download everything", and within ~2 minutes the plugin locally trashed ~40 freshly pulled files and pushed their deletions (20 notes tombstoned via `crdt_delete`, 19 attachments REST-deleted with S3 blobs, 1 folder). Data was restored by hand (S3 delete-marker removal plus un-tombstoning with a fresh per-row seq via `vaults.change_seq`; needs write access, see engram-infra `docs/context/prod-db-readonly-access.md`).

## Cause chain

1. The vault switch ran `wipePerVaultState` correctly; this was NOT a stale-state bug.
2. The first seq-replay consumed 1444 rows but left 299 "consumed-but-unrecorded" (no `syncState` seq entry). The manifest validator caught it 35 seconds AFTER the damage and rewound the cursor.
3. With bookkeeping holes the engine trashed freshly pulled files as orphans/strays.
4. Obsidian's async delete events landed after the 5s `remotelyDeleted` echo TTL and outside the `suppressDeletes` window, so `handleDelete` read them as USER deletions and pushed them.

Why the first replay left rows unrecorded was never found; #416 was closed with the fence as the mitigation. If `Delete push REFUSED (no sync evidence)` (rlog WARN, ships to Loki) shows up, the class is recurring but harmless: that line is the tripwire.

## The fence (two layers in `SyncEngine`)

- `engineTrashedPaths`: durable record of every `trashRemotelyDeleted` target. Consumed by `handleDelete`'s echo-skip, cleared by `handleModify` when the path reappears, **never timer-expired**.
- Evidence rule: `handleDelete` refuses to push a delete for a path with no recorded `syncState` entry. A `crdtHead` in `syncState` counts as evidence (only ever set from server-delivered state).

## Gotchas

- The 5s echo TTL (`ECHO_COOLDOWN_MS`) is not a safety boundary for mass operations. Any "engine did X locally, suppress the echo" design must be consumption-based, not time-based.
- `toDeleteRemote` is always `[]` at PLAN time; delete intents materialize at EXECUTION time, so plan-time guards (`simplifiedFirstSync`'s dirty-plan checks) cannot see them.
- Client info-level rlog lines never reach Loki (warn and above only). The forensic breakthrough was DB tombstone timestamps plus the validator warn line.
- The evidence rule is path-keyed, so anything that moves a path must carry the evidence: `rename-drops-sync-evidence.md`.
- The 5xx that raised the alarm was an unrelated backend crash (`Base.encode64(nil)` in `RebindNoteLinks`, engram#1370) firing AFTER each delete had committed: the smoke alarm, not the fire.
