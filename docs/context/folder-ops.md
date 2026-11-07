# Context Doc: folder ops (one op per folder rename)

_Last verified: 2026-11-07 (PR #689 after its first adversarial review, Engram#2523 S4)_

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
- Pending folder op: ack; refusal, `unknown_event` or `bad_frame` (then
  per-file fallback); feature off (per-file fallback); timeout keeps it (same
  `op_id`, with backoff); no answer `MAX_ATTEMPTS` times ends it in the
  per-file fallback; `rate_limited` pauses the whole queue and spends nothing
  (`RateLimitPause`, shared with the note-op queue); `OP_TTL_MS` since ENQUEUE
  ends it too, sent or not, so a crdt topic that stays down or a features
  reply that never comes cannot pin it (round 4 R4-4); the limits are the
  note-op queue's, imported; restart replays it with its spent budget; vault
  switch drops it. NEVER by a hold expiry. Its
  delete-pass skip and held changes clear with it. Unbounded, it hid a
  server-deleted note forever (round 3 R3-1 on #689).
- Held inbound change (a folder with a pending local op): ack (only changes
  newer than the ack's seq apply), refusal (newest applies), reconnect
  (dropped; the join's manifest re-teaches), max age `HOLD_MAX_MS` (newest
  applies; the op stays, and its ack moves the disk back to the server).
  Manifest rows for a folder with our op pending never enter the hold: they
  are the server's state from BEFORE our op, not another writer, and their
  expiry undid the user's own move (delta review N1 on #689).
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
- **The per-file fallback reads the op's own persisted `from`/`to`**, never
  the in-memory index: a restart empties the index, and a fallback that walked
  it silently undid the user's move (review H1/H2 on #689).
- **Only ops whose folder AND target parent have server ids are sent.** No
  client-minted `create`: an op naming an id the server never issued can only
  be refused after the local re-key. Ids come from the manifest `folders`
  list, `folder_changed`, and the `crdt_create` reply's `folder_id`.
- **`crdt_create` sends main's frame**: no `folder_id`/`name`. #2533 places a
  note by path and reads neither; send them when a server stage reads them.
- **Manifest folder moves are not gated on `features.folder_ops`**: the list
  is the capability signal, and the user-topic features reply can land after
  a restart's first catch-up. `folder_changed` IS gated, and the echo rule
  runs only with the flag or a manifest `folders` list THIS session (never
  from the persisted index alone), so a flag-off server behaves as main.
- **The manifest delete pass skips unconfirmed local moves**: files under a
  pending folder op's `to`, and a note's pending rename (the rename fence).
  The `rowWrittenAt` fence alone only covers a manifest fetched before the
  re-key. This was a hole on main for single renames too.
- Folder ids also come from the root-first ancestor chain `folders` that
  `POST /folders` and the `crdt_create` reply return on a folder-ops server.
  Every server row source goes through ONE rule (`FolderOps.learnServerRows`,
  with `learnServerLeaf` for the create reply's `folder_id`, and
  `isFolderRow` on `folder_changed` and manifest moves): malformed rows
  dropped, a chain learned up to its first broken parent link, and a folder
  with our op pending keeps our row.
- The folder index is persisted (`folderIndex` in data.json) so a restart
  knows where its folders were before the first manifest.
- An inbound move updates the index BEFORE `vault.rename`: Obsidian fires the
  folder's rename event inside it, and the echo rule must already see `to`
  or the device sends the move back as its own op. A failed rename restores it.
- Server wire (Engram#2533): `folder_op` on the vault `crdt:` channel, acked
  `{folder_id, seq}`; `folder_changed` plus a `note_changed` nudge (no id, path
  = the folder's new path, a trailing `/` if it ends in `.md`) on `sync:`
  (this plugin answers the nudge with one seq catch-up and nothing else);
  `features.folder_ops` on the USER join reply, from the ServiceConfig
  `folder_ops` switch (default off). `not_found` (a move racing a move before
  S5) and `failed` are retried inside the op's attempt budget; `conflict`,
  `cycle`, `invalid_name` fall back at once. Folder delete stays per file.
- An older crdt channel answers an unknown event with `bad_frame`, not
  `unknown_event`; both turn folder ops off for the session.
- `filemeta_v1` (`notes_v1`, `folders_v1`) is written only while the vault's
  sync join reply says `index_v1`; before S5 a plugin-written v1 would be
  stale and projecting it reverts renames.

## Related
- `crdt-sync-store-hiding-layers.md`: the clearing-event rule.
- `remote-rename-identity-vs-file.md`: per-note inbound relocation.
