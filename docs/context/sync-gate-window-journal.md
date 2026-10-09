# Context Doc: Sync gate-window journal (#247)

_Last verified: 2026-10-08_

## Status
Working (branch `fix/247-gate-window-journal`).

## What This Is
Vault events that fire while `syncBlocked` is set, or before `setReady`, used to be dropped: a delete never reached the server, and a rename left the old path live while `pushModifiedFiles` uploaded the new path as a second note. Renames, deletes and folder ops are now journaled in order in `SyncEngine.gateJournal` and replayed by `replayGateJournal()` through the path-keyed cores `deleteSyncedPath` / `renameSyncedPath`.

## Where the exposure actually is
Most gate closures (sign-out, re-link, account/vault switch, heal-dead-vault) call `discardVaultScopedState` → `resetForVaultChange`, which wipes syncState and the note-id map. Nothing is replayable there, so the journal is discarded. The real windows are:

1. Startup, before `setReady`.
2. A same-fingerprint reopen via `applySyncGate` (for example an API key cleared then re-entered).
3. A same-vault fingerprint change (API key rotated, API key → OAuth on the same account) that the user resolves with smart-merge.
4. Any of these spanning a plugin restart: the journal persists in data.json (`gateJournal` + `gateJournalVaultId`, restored only into the same vault, writes throttled to 1/s).

## Gotchas
- **Replay must be in EVENT ORDER.** A collapsed path set gets two cases wrong: "delete x, then rename y→x", and "rename a→b, then a new a is created and deleted", which DELETES the moved note.
- **Echo guards run at event time, not replay time.** The reoccupied-path check, `remotelyRenamed` and `renamedAway` markers expire before a replay would run. Every engine-made delete (rename old-leg, remote delete, engine trash) is settled at event time too (`isEngineDeleteEcho`): journaling it and then discarding the journal would strand its `engineTrashedPaths` counter, which later swallows a real user delete at that path.
- **A gate that closes mid-drain halts the replay.** The remaining events go back to the head of the journal, plus `push` events for renames whose bookkeeping already applied. A closed gate sends nothing, even from a drain that started while it was open.
- **Edits made while gated are NOT journaled.** `pushModifiedFiles` runs on every reopen path and covers them. Re-firing a gated bulk import per note is exactly the request storm e2e test_77/97/98/100 avoid. Only edits racing a draining backlog are deferred (`gateModified`); a deferred edit that throws is logged, and the next mtime sweep retries it.
- **Replay ordering vs the id map.** Event-driven replay kicks are disarmed until the first explicit replay (`gateKicksArmed`), so startup replays AFTER `reconcileNoteIdMapFromManifest`. `fullSync` and `pushModifiedFiles` drain the journal before they start.
- **Only smart-merge replays at the modal.** `runSyncFromChoice("smart-merge")` calls `markSyncGateAccepted({ replayGateJournal: true })`, which replays BEFORE the catch-up (a pull over a pending rename writes the note back at its old path). Every other direction says which side wins, so it discards; replaying local deletes after "replace local with server" would delete notes the user chose to keep. Re-picking a direction on an already-open gate never discards.
- **A replayed delete wins over remote edits made since.** Deliberate: it matches backend delete-wins (#970) and the offline queue. A "did the server move since my last sync" check was rejected: `serverHash` is not refreshed on every own-edit path and the catch-up cursor lags own writes, so it would skip real deletes, which is the bug #247 fixed.

## e2e harness trap
A test that does `setSyncBlocked(true)`, deletes locally, then `setSyncBlocked(false)` directly will now REPLAY those deletes. Call `syncEngine.discardGateJournal?.()` first (done in backend `test_77` teardown, backend branch `fix/247-gate-window-journal`).

## Known gaps
- Remote applies are gated on `syncBlocked` but NOT on `ready` (pre-existing, not changed by #247).

## References
- `src/sync.ts`: `gateJournal`, `gateModified`, `gateKicksArmed`, `replayGateJournal`, `discardGateJournal`, `deleteSyncedPath`, `renameSyncedPath`
- `src/main.ts`: `applySyncGate`, `markSyncGateAccepted`, `runSyncFromChoice`, `reconcileThenReplayGateJournal`, `hydrateGateJournal`
- Tests: `tests/sync.test.ts`, `tests/main-auth-ux.test.ts`
- Related: `docs/context/sync-engine-sweep-registry.md`, `docs/context/crdt-sync-store-hiding-layers.md`
