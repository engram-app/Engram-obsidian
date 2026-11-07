# Context Doc: folder ops (one op per folder rename)

_Last verified: 2026-11-07 (PR #689, Engram#2523 S4)_

## What this is
With `features.folder_ops` on (user-topic join reply), a local folder rename or
move is ONE `folder_op {op, op_id, folder_id, parent_id, name}` on the crdt
socket instead of one `crdt_create` relocation per note plus a delete and
re-upload per attachment. Inbound, `folder_changed` and the manifest `folders`
list move a folder with ONE `vault.rename`. Code: `src/folder-ops.ts` (folder
index, pending queue, held inbound) and the folder section of
`SyncEngine.handleRename` in `src/sync.ts`.

## How the per-item events are absorbed
Obsidian fires a `rename` for the folder AND every descendant, order not
guaranteed (mobile unverified, R4 on Engram#2523).
1. Same-tick batch: events are collected to the end of the tick and folder
   events run first, outermost first. The folder op re-keys every descendant's
   LOCAL bookkeeping (id map in one publication, base, sync row, armed push,
   the rename fence) and sends nothing per file.
2. Relay echo rule (`alreadyMovedLocally`): a child whose bookkeeping is
   already at its new path, and gone from its old one, is a no-op. A state
   check, not a marker, so it needs no expiry and covers children that arrive
   on a later tick.

## Hiding layers (each with its clearing events)
- Pending folder op: ack; refusal or `unknown_event` (then per-file fallback);
  feature off (per-file fallback); timeout keeps it (same `op_id`); restart
  replays it from data.json; vault switch drops it.
- Held inbound change (a folder with a pending local op): ack (only changes
  newer than the ack's seq apply), refusal (newest applies), reconnect
  (dropped; the join's manifest re-teaches), max age `HOLD_MAX_MS` (newest
  applies).
- Same-tick batch: cleared at the end of its tick.

## Gotchas
- **Folder moves must apply BEFORE the manifest delete pass** in `catchUp`.
  That pass trashes any synced file whose path the manifest does not list, and
  after a remote folder rename every old path is unlisted. Old plugins
  (<= 1.39.2) still trash-then-redownload here when offline.
- **The sim cannot see the Relay echo rule.** Without it a late child still
  ends in an echo skip (no row at the old path, so no relocating flag), so no
  wire call changes. The rule saves a read of every child's bytes and an
  un-confirmed note id; `tests/folder-rename-echo.test.ts` pins that.
- A folder first synced this session has no server id until the next
  manifest, so its rename falls back per file.
- Note creates send `{folder_id, name}` only for a folder with a server id.
  Minting a `folder_op create` for an unknown folder races the server's own
  create-from-path and is refused `conflict`.
- `filemeta_v1` (`notes_v1`, `folders_v1`) is written only while the vault's
  sync join reply says `index_v1`; before S5 a plugin-written v1 would be
  stale and projecting it reverts renames.

## Related
- `crdt-sync-store-hiding-layers.md`: the clearing-event rule.
- `remote-rename-identity-vs-file.md`: per-note inbound relocation.
