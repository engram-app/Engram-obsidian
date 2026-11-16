# Context Doc: folder ops (one op per folder rename)

_Last verified: 2026-11-15 (PR #689 after its round-5 adversarial review, Engram#2523 S4)_

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
  (`RateLimitPause`, shared with the note-op queue); `OP_TTL_MS` of time the
  SYNC channel was joined ends it too, sent or not, so a crdt topic that stays
  down or a features reply that never comes cannot pin it (round 4 R4-4).
  Offline time is not age (`HeldClock`, the note-op queue's): fully offline
  nothing is sent and no delete pass runs, so the hold costs nothing, and an
  offline rename stays ONE op on reconnect instead of N per-file renames. The
  limits are the note-op queue's, imported; restart replays it with its spent
  attempts and a fresh age clock; vault switch drops it. NEVER by a hold expiry. Its
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
- Per-note rename fences a folder op sets (`rekeyMoved`): their clock is held
  while the op is pending, and the op leaving the queue (ack, or the per-file
  fallback after a refusal or give-up) starts the `PENDING_MOVE_TTL_MS`
  backstop (`onFolderOpLeft`). They are not persisted; across a restart
  `isStalePathClaim` re-derives them from the persisted op
  (`FolderOps.movedFrom`: a claim under the op's `from` for a note under its
  `to` is stale). Before this, a peer's row at the old path moved the note
  back after 120 s (round 5 MEDIUM-4). On the ACK the op also counts as
  each moved note's echo (`echoed = true`): otherwise the unechoed fence
  rejected every other path, including a peer's real post-op rename of a
  child, which then never reached this device (delta MEDIUM-1). Not on the
  fallback: its per-file renames set fresh fences that wait for their echo.
- Queued path-addressed replays (REST upserts, deletes) under a pending op's
  `to`: held until `onFolderOpLeft`, which flushes the queue. The server still
  has the file at `from`, so sending at the new path got a 409 and dropped the
  edit. Bounded by `HOLD_MAX_MS` from the first held replay
  (`FolderOps.holdReplay`): with the socket down and REST up the op can
  neither be sent nor age, so past the bound it is abandoned to the per-file
  fallback (warn logs `Replay held` and `Folder op unanswered`; delta
  MEDIUM-2). Attachments are held too (3 minutes at most).
- Queued `crdt_create`s under the moved folder are re-keyed to the new path by
  `rekeyMoved` (one op per docId), and on reconnect folder ops are sent BEFORE
  the note-op queue: a create at the target first made the server mint a
  second folder row there and refuse the op as `conflict` (round 5 HIGH-1,
  MEDIUM-3). Each reconnect step is caught separately, so a failing fallback
  cannot skip the note-op queue. Known gap: the order holds only if
  `features.folder_ops` arrived before the crdt join; a later flag sends
  creates first and the op falls back per file (converges, not O(1)).

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
