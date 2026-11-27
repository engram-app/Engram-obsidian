# Context Doc: a name conflict is terminal, never a retry

_Last verified: 2026-11-27_

## Status
Fixed in plugin branch `fix/name-conflict-terminal`, paired with the backend
branch of the same name.

## The failure class
The server refuses a note create or rename when another note already holds
the name. Plugins 1.36.0 to 1.40.0 treated that as something a retry could
fix:

- When the refusal arrived as `create_failed`, the durable op queue retried it
  8 times over about 5 min, and every refusal opened the vault-wide create
  backoff (`NotesCapGate.backoff`), which holds every BULK create for 30 s,
  doubling to 10 min.
- After the queue dropped the op (a log line only), the file was still
  untracked, so the next sync or self-heal sweep sent it again. The loop
  never ended and the user was never told.

## Where the reasons come from (backend `crdt_create`)
A brand-new id at a taken path is not refused: the server ADOPTS the note
already there. A refusal needs a KNOWN id moving onto a taken name:

| wire reason | genesis leg |
|---|---|
| `id_conflict` | live id relocating onto a path a different live note holds (`genesis_relocate_live` occupant check), or a resurrect onto a path a moved folder shows (`shown_check`) |
| `create_failed` (before the backend fix) | the identity index already records the collision (`Identity.claim` -> `{:error, :conflict}`), or a tombstoned id resurrects onto a keyed-occupied path (Note changeset unique constraint on `path_hmac`) |
| `conflict` (`folder_op`) | a different live folder holds the target folder name |

`create_failed` also carries transient errors (rotation in progress, stale
snapshot, crypto), so the plugin cannot treat it as terminal. The backend PR
replies `id_conflict` for its two name-conflict cases instead. Every plugin
since 1.36 already treats `id_conflict` as terminal, so old plugins stop the
8 retries and the pause the day the backend ships.

## The fix (plugin)
- ONE classifier, `isNameTaken(reason)` in `src/crdt-op-dispatch.ts`
  (`id_conflict`, `conflict`). The direct push (`pushFile` catch), the queue's
  terminal hook (`main.ts onTerminal` -> `SyncEngine.onCrdtOpTerminal`) and
  the folder-op fallback (`folderOpFallback`) all ask it.
- A name conflict never trips the create backoff and is never enqueued.
- `SyncEngine.parkNameTaken(file)` records a `name_taken` Sync Center issue
  stamped with `parkStamp(file)`, shows one Notice ("A note with that name
  already exists: <path>"), and leaves the file on disk untouched.
  `isParked` (the attachment park that already existed) now also covers
  `name_taken`, so every push path skips the file while it is unchanged.
- A folder op refused `conflict` shows "A folder with that name already
  exists: <path>". The per-file fallback still runs (the notes move into the
  server's folder); any note whose name is taken there is parked on its own.

## Clearing events (hiding layers must expire)
The park hides a file from every push, so per
`crdt-sync-store-hiding-layers.md` it names what clears it:

1. An edit: size or mtime moves, the park stamp no longer matches, the file is
   sent again (a success clears the issue).
2. A rename or delete of the file: `clearNameTaken(oldPath)` in
   `handleRenameNow` / `handleDelete`.
3. The user dismisses the issue in the Sync Center.
4. A vault switch (issues are cleared with the vault).

If none fires, the note stays unsynced and listed in the Sync Center. That is
intended: only the user can pick another name. It does not auto-retry when
the server's holder of the name goes away; an edit or rename does.

## Product note
The web app REFUSES a rename onto a taken name with a toast ("A note with
that name already exists."). It only auto-bumps names (`collideBump`,
"Untitled 1") for brand-new blank notes it creates itself. The plugin does
not bump: picking a new name for the user's file is a product decision.

## Tests
`tests/name-taken-terminal.test.ts`. Backend: the crdt channel test for the
resurrect-onto-taken-path reply, and the e2e on the paired backend branch.
