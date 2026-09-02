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

## The rule, and the half that is easy to miss
**Carry PRESENCE, not the row.** `renamePath` sets `{ hash: 0 }` at the new
path and nothing else. Every other field on a sync-state row is a PATH-SCOPED
CLAIM ABOUT THE SERVER, and after a rename none of them is true at the
destination yet:

| field | what carrying it breaks |
|---|---|
| `hash` | a rename changes no content, so the carried hash equals the file's own and `pushFile`'s echo filter (which sits ABOVE the push slot) skips the relocation outright |
| `crdtHead` | `hasServerNote` is PATH-keyed — `getCrdtHead(pathForId(id))` — so the engine believes the server already holds the note THERE and takes the `crdt_msg` edit branch, which carries no path and cannot move the row |
| `version` / `serverHash` | CAS facts about a row the server holds at the OLD path |

Both failures are SILENT and shaped alike: the rename's `crdt_create` at the
new path IS the server-side move (`genesis_relocate_live`), and the CRDT leg
issues no old-leg delete — so if that one push does not go out, the note stays
at its old path server-side forever and nothing heals it but a forced
`pushAll`.

This cost two review rounds and three red e2e runs. The first fix zeroed
`hash` and stopped there; `crdtHead` was the same mistake one field over. If
you are tempted to carry "just one more field", the question to answer is
whether it describes the NOTE or describes what the SERVER has AT THIS PATH.
Only the first kind may move.

The e2e that catches it is `test_93_remote_rename_moves_file`, failing as
`TimeoutError: Note E2E/MoveNew-*.md not on server after 120.0s`. The unit
suite could not: no test asserted the branch decision. `tests/sync-delete-fence.test.ts`
now pins `hasServerNote(id) === false` after a rename, which is the actual seam.

## Why it must move at all
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
- `tests/sync-delete-fence.test.ts` — the rename gates. Note the harness trap:
  `recordSyncEvidence` stamps `{ hash: 1 }` while the vault reads back
  `"body"`, so the moved row never matches the file's real hash and the echo
  filter can never fire. That is a state the product cannot produce — a
  CONVERGED note always has `row.hash === fnv1a(disk)`. Use
  `recordConvergedEvidence`, or a rename test proves nothing.
- `tests/sim/regressions.test.ts` — `#489 rename-then-delete`: the user's exact
  sequence, with the delete inside the rename's push window (no `drain()`
  between the rename and the delete). Asserts by ID, not by the renamed path:
  the model server keys notes by their ORIGINAL path and does not relocate on a
  same-id create, so `notes.has(renamedPath)` is false whether or not the
  rename ever transmitted — it reads like a check and proves nothing.
- `tests/sync-delete-fence.test.ts` — one test per rename leg, driving
  `handleRename` / `moveIfIdRelocated` then `handleDelete`.

Mutation-proven: reverting either single `renamePath` line turns exactly one
test red out of 3016.

## Related
- `../../src/sync.ts` `renamePath` / `dropPath`
- `crdt-sync-store-hiding-layers.md` — same shape one layer over: local state
  that hides a fact must expire, and here local state that DESTROYS a fact must
  instead move it
