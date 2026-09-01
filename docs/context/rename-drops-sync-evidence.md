# Context Doc: a rename must carry the note's sync evidence

_Last verified: 2026-08-31 (#489 / PR #490)_

## Status
Fixed. Both rename legs. The sim-tier blindness that hid it is fixed in the
same PR.

## Symptom that gets reported
"I made a note, renamed it, deleted it, made another note — and the second one
never gets created." The user sees the second note vanish or never appear in
the web app, and blames the plugin for deleting it on a name collision.

It is not a name collision. The **first** note was never deleted server-side,
and the second note was **adopted** onto its row.

## The chain
1. `handleRename` moves the merge base to the new path and drops the
   sync-state row. The row is only re-established when the rename's push lands.
2. A delete inside that window hits `handleDelete`'s evidence rule (#416):
   `hadSyncEvidence === false` → `Delete push REFUSED (no sync evidence)`.
3. The note stays LIVE on the server, under whatever path the server last knew.
4. The next `crdt_create` at that path finds a live row under a different id and
   takes `genesis_adopt_or_insert`'s `:adopted` branch. Its own comment:
   *"this caller's content frame was never applied to it."* The new file wears
   the dead note's id and its body is discarded.

Log signature, in order:

```
WARN push  Delete push REFUSED (no sync evidence): Foo.md
INFO crdt  crdt_create ADOPT: remapped Untitled.md <fresh id> -> <dead id>
```

`ADOPT` in a create you expected to be a create is always worth chasing — it
means a stale live row owns that path.

## The rule
**The evidence rule is path-keyed; a note's identity is not.** Anything that
moves a note's path must move its bookkeeping, not destroy it — the same
reasoning already written for the merge base at both sites (a relocation moves
a path and changes no content).

Two legs, both of which had it wrong:
- `handleRename` — local rename
- `moveIfIdRelocated` — a peer's rename, followed on this device

Use `renamePath(from, to)`. The OLD key must still go away: a stale row there
echo-suppresses a later create whose content happens to hash the same (rename a
note away, then make a new note with identical content at the old path — very
easy to hit, since every new Obsidian note is empty and named `Untitled`).

## Why no test caught it: the sim could not delete
`tests/sim`'s `trashFile` fired `onDelete` BEFORE removing the file, and
`replica.ts`'s dispatcher resolved the entity with
`getAbstractFileByPath(path)` to pick the TFile/TFolder branch. So inside every
sim delete, `handleDelete`'s reoccupied-path guard —

```ts
if (this.app.vault.getFileByPath(file.path)) { /* path was replaced, skip */ }
```

— was TRUE, and the handler returned before doing anything. **No sim run had
ever reached the delete push.** `vault-fs.test.ts` even pinned the wrong
ordering as "real Obsidian semantics".

Real Obsidian evicts the entity from its index before triggering `delete`;
backend e2e `test_05` (a delete propagates to the server) proves the guard is
false there. The shim now removes first and passes the kind through
(`onDelete(path, isFolder)`).

**The lesson worth keeping:** a shim that makes an early-return guard
universally true does not fail — it goes green while testing nothing. When a
guard exists to distinguish two cases, check that the harness can produce BOTH.

## Testing it
- `tests/sim/regressions.test.ts` — `#489 rename-then-delete`: the user's exact
  sequence, with the delete inside the rename's push window (no `drain()`
  between the rename and the delete). Asserts the note is gone server-side AND
  that the second note's id differs from the first's.
- `tests/sync-delete-fence.test.ts` — one test per rename leg, driving
  `handleRename` / `moveIfIdRelocated` then `handleDelete`.

Mutation-proven: reverting either single `renamePath` line turns exactly one
test red out of 3016.

## Related
- `../../src/sync.ts` `renamePath` / `dropPath`
- `crdt-sync-store-hiding-layers.md` — same shape one layer over: local state
  that hides a fact must expire, and here local state that DESTROYS a fact must
  instead move it
