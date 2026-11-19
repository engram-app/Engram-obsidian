# Context Doc: remote index re-keys are silent unless SyncStore records them

_Last verified: 2026-11-19_

## Status
Fixed in Engram-obsidian#715 (head e1b2775b). Found through backend e2e test_108
(`test_attachment_in_moved_folder_lists_downloads_and_renames`) once plugin
1.40.0 stopped getting the moved-folder feed.

## Symptom
A folder moved over REST, MCP or the web app. Every device keeps the notes at the
OLD path (`src/n.md`) for good. The id map says `dst/n.md`, the server manifest
says `dst/n.md`, the unknown-folder resolver logs that it could not place the
folder, and no id-map write or `vault.rename` was ever attempted for the note.

## Root cause
The server writes the move into the shared index (`filemeta_v0`) BEFORE it
broadcasts `folder_changed`: `rename_folder_uncascaded` re-claims every note under
the folder at its new path (`Identity.claim`, folder-op condition C5). Each device
receives that as a REMOTE Yjs update: add `dst/n.md -> id`, delete `src/n.md`.

`SyncStore`'s map observer only invalidated caches. Only a LOCAL `set()` reported a
moved id (`onRelocate`). So the map moved, nothing recorded where the file still
was, and by the time `folder_changed` ran the resolver (`localFolderPaths`) saw
map == manifest and had no way to find the folder on disk. With no moved-folder
feed, nothing ever corrected it.

## The fix (and the shape it must keep)
- `SyncStore.reportRemoteMoves`: on a remote transaction, a DELETE of key `from`
  whose id the committed map now holds at `to` is reported as
  `onRelocate(from, to, id, remote = true)`. Keyed on the delete because that is
  the one moment both paths are known without a scan. O(keys in the update).
- The engine RECORDS a remote move (`rememberRelocation`) but does NOT move the
  file. Moving per file turned one folder rename into N moves, left files with no
  id (attachments) in the old folder, and made the folder's own rename find its
  target taken (test_107 one-folder-op case, run 44538182139).
- The resolver asks where the note's FILE is (`fileOfNote`): the relocation
  record, else `staleOriginFor` (disk + sync evidence + no other claimant). Then
  the folder follows as ONE `vault.rename`.
- A followed folder rename that fails or finds its target taken must NOT put
  the bookkeeping back: the id-map leg is a claim in the index the server
  projects from, so it undid the server's move on every device (test_107
  offline edit, feed off: the sibling note was repathed back to the old folder).
  The bookkeeping stays at the new paths and each file follows on its own.

## Gotchas
- `noteRef` labels (`n1`, `n2`) are numbered PER DEVICE. Comparing labels across
  the two vaults' log lines hides events; the first investigation read "no remote
  write" because of this. Compare ids, not labels.
- Client `info` lines never reach the backend log in CI. Use `rlog().diag` or
  warn for traces, and never interpolate raw paths (privacy test).
- The index room is not persisted locally: after a restart the first sync is all
  ADDS, so no move is reported. Anything that needs the old location must fall
  back to disk evidence (`staleOriginFor`), not the relocation record.
- Accepted risk: a remote delete landing BEFORE its add, or held behind a Yjs gap
  (`parked`), is not reported. The folder case is covered by the disk fallback.

## Related
- `crdt-sync-store-hiding-layers.md` (the other SyncStore read-side traps)
- `folder-ops.md`, `remote-rename-identity-vs-file.md`
- Backend: `lib/engram/notes.ex` `move_folder_row` (C5), `lib/engram/folders/write_stop.ex` (`s4_plugin`)
