# Context Doc: Sync gate-window journal (#247)

_Last verified: 2026-10-08_

## Status
Working (branch `fix/247-gate-window-journal`, commits 8e2fca7 + 5760af6).

## What This Is
Vault events that fire while `syncBlocked` is set, or before `setReady`, used to be dropped: a delete never reached the server, and a rename left the old path live while `pushModifiedFiles` uploaded the new path as a second note. Renames, deletes and folder ops are now journaled in order in `SyncEngine.gateJournal` and replayed by `replayGateJournal()` through the path-keyed cores `deleteSyncedPath` / `renameSyncedPath`.

## Where the exposure actually is
Most gate closures (sign-out, re-link, account/vault switch, heal-dead-vault) call `discardVaultScopedState` → `resetForVaultChange`, which wipes syncState and the note-id map. Nothing is replayable there, so the journal is discarded. The real windows are:

1. Startup, before `setReady`.
2. A same-fingerprint reopen via `applySyncGate` (for example an API key cleared then re-entered).

## Gotchas
- **Replay must be in EVENT ORDER.** A collapsed path set gets two cases wrong: "delete x, then rename y→x", and "rename a→b, then a new a is created and deleted", which DELETES the moved note.
- **Echo guards run at event time, not replay time.** The reoccupied-path check, `remotelyRenamed` and `renamedAway` markers expire before a replay would run. Every engine-made delete (rename old-leg, remote delete, engine trash) is settled at event time too (`isEngineDeleteEcho`): journaling it and then discarding the journal would strand its `engineTrashedPaths` counter, which later swallows a real user delete at that path.
- **A gate that closes mid-drain halts the replay.** The remaining events go back to the head of the journal, plus `push` events for renames whose bookkeeping already applied. A closed gate sends nothing, even from a drain that started while it was open.
- **Edits made while gated are NOT journaled.** `pushModifiedFiles` runs on every reopen path and covers them. Re-firing a gated bulk import per note is exactly the request storm e2e test_77/97/98/100 avoid. Only edits racing a draining backlog are deferred (`gateModified`); a deferred edit that throws is logged, and the next mtime sweep retries it.
- **Replay ordering vs the id map.** Event-driven replay kicks are disarmed until the first explicit replay (`gateKicksArmed`), so startup replays AFTER `reconcileNoteIdMapFromManifest`. `fullSync` and `pushModifiedFiles` drain the journal before they start.
- **`markSyncGateAccepted` discards the journal only when it is the call opening the gate.** A user-picked sync direction supersedes replay. Re-picking a direction on an already-open gate keeps the journal.

## e2e harness trap
A test that does `setSyncBlocked(true)`, deletes locally, then `setSyncBlocked(false)` directly will now REPLAY those deletes. Call `syncEngine.discardGateJournal?.()` first (done in backend `test_77` teardown, backend branch `fix/247-gate-window-journal`).

## Known gaps
- The journal is in memory only. A gated window that spans a plugin restart still loses its renames/deletes.
- Remote applies are gated on `syncBlocked` but NOT on `ready` (pre-existing, not changed by #247).

## References
- `src/sync.ts`: `gateJournal`, `gateModified`, `gateKicksArmed`, `replayGateJournal`, `discardGateJournal`, `deleteSyncedPath`, `renameSyncedPath`
- `src/main.ts`: `applySyncGate`, `markSyncGateAccepted`
- Tests: `tests/sync.test.ts`, `tests/main-auth-ux.test.ts`
- Related: `docs/context/sync-engine-sweep-registry.md`, `docs/context/crdt-sync-store-hiding-layers.md`
