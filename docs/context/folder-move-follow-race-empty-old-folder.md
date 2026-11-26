# Context Doc: Folder move follow race leaves an empty old folder

_Last verified: 2026-11-26_

## Status
Fixed in PR #708 (root cause plus two secondary bugs). The catch path was
reshaped by #715; the current shape is under Fix.

## Symptom
Device A renames a folder offline and reconnects. Device B sometimes keeps the
EMPTY old folder, plus its subfolder, forever. Notes land in the new folder and
nothing is lost.

It showed up only in full e2e suites (test_107), about 1 run in 3 to 5, and
passed in isolation. Diagnostics that added extra calls into B hid it, because
the timing is the trigger.

## Root cause
`followFolderMoveOnDisk` (`src/sync.ts`) checks that the target folder is
absent, then does one folder rename. A's concurrent folder create (a
`FoldersController#create` 201 about 20 ms after `folder_changed`) can make the
target exist in between, so the rename throws `Destination file already
exists!`.

The catch path restored bookkeeping but never marked the old folder as moved
away. The notes then moved one by one, and `removeEmptyFolders` keeps explicit
folders that are not in `movedAwayFolders`. So the old folder stayed.

Log signature on B:

```
[client:pull] Folder move could not follow on disk (nX -> nY): Destination file already exists!
```

## Fix
#708 made the catch path call `applyFolderChange`, the same as the "target
already exists" branch, so both ways of losing the race marked the old folder
moved away.

Since #715 the catch path keeps the bookkeeping at the server's paths (putting
it back undid the move on every device), follows each file on its own
(`renameFollowingIdentity`, else a stuck move), then calls `leaveMovedFolder`,
which adds the old folder to `movedAwayFolders` and removes what is empty. The
invariant this doc protects is unchanged: every way the folder rename can fail
must end in `leaveMovedFolder`. Why the bookkeeping is not restored is in
`remote-index-rekey-silent.md`.

## The folders.batch rename path (folder_ops off)
With `folder_ops` off, a web-app or MCP folder rename sends no
`folder_changed`. The server broadcasts `folders.batch` with
`op: "rename"` and `from: <old folder>` instead, after the notes leg. The
plugin used to ignore the payload and only re-poll `/folders/explicit`
(`resyncFolders` -> `syncExplicitFolders`). That trash pass checks each
dropped name once, so an old folder whose only content was an explicit empty
subfolder stayed on disk: the parent still had the child when it was checked,
or it was never explicit and so never listed (staging: MCP rename of AR6 to
A2R6 kept AR6/).

Fix: the channel hands the payload to `resyncFolders`, which after the
re-poll calls `leaveMovedFolder(from, null)`, the same mechanism as the
`folder_changed` path. Both paths now share it: any server folder rename ends
in `leaveMovedFolder`. It runs AFTER the re-poll, because the re-poll clears
moved-away marks for every listed name. It is skipped when:
- `from` is not a folder on disk (this device's own rename echo);
- the fresh server list still names `from` or a path under it. A batch has
  no seq and no serial lane, so a late one (renamed and back) would
  otherwise trash an explicit folder the server lists again;
- the rename is case-only (`from` and `folder` match ignoring case), since on
  a case-insensitive disk both names are one directory.

When the old folder keeps content (a local note written into it), the
moved-away mark stays, the same as on the `folder_changed` path. That is
harmless: `removeEmptyFolders` never removes a folder with children, so the
mark only lifts the explicit-folder guard once the folder is empty. It is
cleared when the folder is removed, when the user re-makes a folder there,
when the server lists the path again, and on vault switch.
Tests: `SyncEngine.resyncFolders folders.batch rename` in
`tests/sync-folder-events.test.ts`.

## Secondary bugs fixed in the same PR
- **Engine-created folders.** A folder the engine created (to hold a moved
  note) cleared the moved-away mark and was saved server-side as an explicit
  folder. Engine creates now carry the `engineCreated` marker
  (`ECHO_COOLDOWN_MS`, 5 s) and skip the server create.
- **Moved-file redirect.** The redirect for moved files matched on path only, so
  it could overwrite a different note with the same name. A later commit in the
  same PR removed the redirect. A row older than the folder move is now dropped
  by the folder-seq fence (`predatesFolderMove`, fed by `recordFolderMove`), so
  it can never move the note back into a re-made old folder.

## Failed approaches and false leads
- `CREATING n53` lines looked like a recreate of the old folder. They were
  setup delivery.
- Paths in client logs are redacted to per-device n-numbers (see
  `remote-index-rekey-silent.md`, Gotchas), so logs alone cannot tell you
  which folder is which. Use an e2e dump step that always prints B's id map
  and disk listing, with as few calls into B as possible.
- Rerun-to-green was banned. A 1-in-4 flake is a real race.

## Related
- `folder-ops.md` (receiver section: the one-rename follow and its fallback)
- `remote-index-rekey-silent.md` (#715: why a failed follow keeps the new paths)
- `crdt-sync-store-hiding-layers.md`: every hiding set (including
  `movedAwayFolders`) needs a clearing event.
