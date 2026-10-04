# Obsidian mtime quirk

_Last verified: 2026-10-03_

`vault.modify()` sets the file's mtime to "now", not the mtime of the content source. So never use mtime to decide whether a remote change is already applied, and never re-check mtime after writing: the write itself makes every later mtime comparison read "already up to date". Decide with content hashes instead (`syncState.hash` / `serverHash`, see `needsColdReconcile` in `src/sync.ts`); the `syncState` docstring in `src/sync.ts` records the same rule.

Found 2026-03 when remote changes were silently skipped after a `vault.modify()` bumped mtime.
