# The engine's own CRDT flush must never be read back as a local edit

_Last verified: 2026-10-12_

Plugin #578, PR #580 (merged as `e82cc1a3`). A disk write by `flushFromCrdt` was ingested as a client edit and corrupted rapid remote edits.

## Fingerprint

Five rapid REST or MCP edits to one note (`Version 1..5 of 5`) end as `Version 35 of 5` (or `53`, `Iteration 227`). The server and every device hold the same wrong text with the same hash. It is not a merge conflict. The client minted its own copy of an intermediate edit, and later server merges deleted only their own copy.

It showed up as intermittent failures in the backend e2e `test_49_cross_auth_sync` rapid-edit tests: 3 failures in about 38 runs on 2026-10-12. The client log shows one extra `note_yjs_update` with no request id, right after `CRDT discovery: enrolling new note`.

## Mechanism

Two defects combine. Both need a note whose Y.Doc already holds edits 1..j when discovery runs. Those edits came from fan-outs applied while the note id was still unmapped. They leave a head-only sync-state row with `hash: 0` (`setCrdtHead` then `patchSyncedRow`).

1. **The `vault.modify` window.** `vault.modify` caches the new text right after the write, before its stat. So `cachedRead` already returns it. `flushFromCrdt` records the baseline only after `modify` resolves. A fan-out landing inside that window ran `captureDiskDriftBeforeRemote`, compared the new disk against the old baseline (often the `hash: 0` row), and diffed the engine's own write into the doc as a client edit. Discovery reaches `modify` through `createFileWithFolders`' "already exists" fallback, when a fan-out's flush created the file first.
2. **Discovery wrote the REST row over a doc with history.** The row was edit k, the doc was at edit j. Discovery recorded k as the baseline. Disk now held text the doc did not have. The next disk event made `applyLocalEdit` diff k into j, producing this client's own copy of edit k (or a revert if the row lagged). With no later fan-out, disk stayed at k.

A third wrinkle: the registry starts one unqueued flush per remote update, so several flushes overlap on one path. An older flush that finished last overwrote the newer flush's baseline.

## Fix (`src/sync.ts`)

- **`flushingHash`**: per path, a count per in-flight write hash. `needsColdReconcile` ignores disk that equals any of them. Each flush clears its own count in `finally`, success or failure. On success the baseline takes over.
- **`flushGen`** (`started` / `recorded`): newest successful write wins. A flush records its baseline only if its start order is newer than the last one recorded. An older flush finishing last does not overwrite a newer baseline. If a newer flush throws, the older successful write still records. The early "disk already equals content" return also bumps `recorded`.
- **Discovery writes `projectedText`** when the doc has history (the #570 strand-heal rule: disk follows the doc, not the row). If that text differs from the row, it calls `stageAndConverge` to re-handshake. Otherwise an idle note whose fan-out was lost stays behind the server forever.
- **`syncState.has(normalized)` gates the history check.** A fresh first sync has no row, so it opens no Y.Doc per note. The row is the cheap tell that a fan-out already touched the doc.
- A write that never resolves leaves its guard in place. That only hides content byte-identical to what the engine wrote.

## Failed first diagnosis

The first theory was a `vault.create` window: the file appears before its baseline is recorded. That window does not exist in Obsidian 1.12.7. `create` caches nothing and adds the file to the vault only after the post-write stat. Only `modify` caches early. Probe the real API before building a fix on a window.

## Known gap

Rename mid-write. `flushingHash` is keyed by the path at flush start. A rename landing during the write leaves the new path unguarded for that one write, which is the pre-#578 behaviour. There is a `ponytail:` comment on the field. Re-key on rename if it ever shows up in logs.

## Testing lesson

The first tests spied on calls and stayed green with the guards removed. They proved nothing. `tests/sync-crdt-discovery-echo.test.ts` now uses a real `ProviderRegistry` and asserts the final text (exactly `Version 5 of 5`) and that nothing is sent. Every guard has a test that fails when it is removed (mutation-checked 2026-10-13; tests named by title, not by position):

- removing the `flushingHash` check: "a fan-out landing in discovery's modify window", "a doc that moved on while discovery's write is cached", "overlapping flushes to one path"
- removing the gen gate (always record): "a fan-out landing in discovery's modify window", "an older flush finishing LAST", "an already-matching flush is newer"
- recording only the latest-STARTED flush (an intermediate design that never shipped): "a newer flush that THROWS", "an already-matching flush is newer"
- dropping the early-return `recorded` bump: "an already-matching flush is newer"
- dropping the converge: "discovery behind the REST row re-handshakes"
- writing the REST body on discovery: "discovery over a doc with history", "discovery behind the REST row re-handshakes", "a doc that moved on while discovery's write is cached"
- dropping the `syncState.has` gate: "first-sync discovery with no syncState row"

Rule: for any echo or guard fix, mutate the guard away and confirm a test goes red before calling it covered.
