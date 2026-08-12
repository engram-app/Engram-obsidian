# Sync progress units: files, not op-log rows

**Trigger:** the progress modal / recap shows a different number than the
sync-options (preview) modal promised, a progress bar freezes at `0/N`
during a pull, or "All synced" appears despite real failures.

## The invariant

Every user-facing sync number is in **file units** — the same unit
`computeSyncPlan` / `optionBreakdown` count. The op-log replay applies
**rows**, which is a different unit: tombstones, superseded rename rows, and
folder-marker leaks are rows but not files. Any progress/recap number derived
from `applied` (row count) will disagree with the plan on a vault with
delete history. PR #412 fixed three instances of this class:

- `runSeqReplayOnce` counts `files` (non-deleted rows applied without
  throwing) and `failed` (rows whose apply threw) alongside `applied`, and
  fires `onFileApplied(path)` per file. `applied` still exists for
  logs/cursor semantics — do not surface it in UI.
- The pull legs (`pullAll`, `fullSync` → `catchUp({reportProgress: true})`)
  forward `onFileApplied` as `pulling {current, total: 0}` events. `total: 0`
  is deliberate: the modal's `rowCounts` keeps the *plan's* denominator for a
  planned row and treats 0 as indeterminate otherwise — never fabricate an
  engine-side total here (the engine's examine-count is the original
  "Uploading 5 → 50" balloon bug, see `rowCounts` in
  `src/sync-progress-modal.ts`).
- Completion events carry real `failed` tallies: `pushModifiedFiles` returns
  `{pushed, failed}` (genesis-batch failures used to be dropped), and
  `pullAll` adds wipe-delete failures.

## Traps

- **Background catch-ups stay silent.** The poll/reconnect callers of
  `catchUp()` pass no `reportProgress` — they have no progress surface and
  never emit a terminal `complete`, so events from them would strand the
  settings-pane bar mid-flight. Keep progress opt-in.
- **Test stubs of `catchupViaSeqReplay` must return the full shape**
  (`applied, files, failed, serverIds, serverAttachmentPaths, ran,
  complete`) — a stub missing `files`/`failed` makes `_pullAll` return
  `undefined`/NaN counts.
- The pinning tests live in `tests/sync-progress-firstsync.test.ts`.

## Update (per-file genesis rewrite, follow-up PR)

`crdt_create_batch` was retired client-side right after PR #412: genesis notes
now ride the same bounded per-file `pushFile` loop as everything else
(Relay's BackgroundSync shape: per-file work units, per-file progress events,
per-file failure isolation, PUSH_BATCH_SIZE concurrent). The server handler
stays for older plugin versions. The chunk-size/chunk-timeout notes above are
historical context for why the batch kept failing; the batch no longer exists
in the plugin.
