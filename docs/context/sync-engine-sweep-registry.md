# Adding state to SyncEngine: the sweep registry

_Last verified: 2026-10-03_

**Read this before adding any `Map` or `Set` field to `SyncEngine`.**

## The rule

Collections are registered at their declaration with the teardowns they die in:

```ts
private fileForNote = this.track(["vault", "destroy"], new Map<string, string>());
private syncState  = this.track(["vault"], new Map<string, FileSyncState>());
private pushing    = this.track(["destroy"], new Set<string>());
```

Maps holding timers pass a dispose hook, which runs per value before the clear:

```ts
private recentlyDeleted = this.track(
  ["vault", "destroy"],
  new Map<string, { timer: number; path: string }>(),
  ({ timer }) => this.time.clearTimeout(timer),
);
```

`destroy()` and `wipePerVaultState()` both call `sweep(event)` and enumerate
nothing. There is no list to remember to update.

`tests/sync-sweep-registry.test.ts` reflects over a live engine and fails on any
untracked `Map`/`Set` field, naming it. You cannot forget silently.

## The two events are independent, not a severity ladder

This is the part that is easy to get wrong.

| field | `vault` | `destroy` | why |
|---|---|---|---|
| `syncState` | yes | **no** | the persisted sync baseline; blanking it on unload forces a full re-scan next load |
| `debounceTimers` | **no** | yes | a debounce pending across a switch still describes a real local edit to a file that still exists, and still deserves its push |
| `pushing` | **no** | yes | clearing an in-flight push guard re-admits a second concurrent push of the same path |
| `seqReplayFileListeners` | **no** | yes | in-flight replay callbacks that already deregister in a `finally`; sweeping would drop a listener out from under a replay still unwinding |
| everything else keyed by path or note_id | yes | yes | |

If you find yourself wanting "vault implies destroy", re-read the first two rows.

## Why this exists

`SyncEngine` used to carry two hand-written teardown lists: `destroy()` swept transient per-note maps (sparing `syncState`), and `wipePerVaultState()` swept `syncState`, cursors and identity (leaving the per-note maps). Each was right for its own job and nothing owned their intersection, state that is both vault-scoped AND transient. Twelve note_id- and path-keyed collections survived a vault switch and kept addressing the NEW vault with the OLD vault's ids; six unrelated fixes each added a field to one list and not the other, because a declaration thousands of lines from either list carries no hint that a decision is owed.

Cost, measured on a 423-item vault import (Engram #1409): 225 CRDT rooms for 317 notes and 16 duplicate note rows created by the vault switch itself. Stale ids are the mechanism: `crdt_create` proposes a foreign vault's note_id, the server cannot reuse it (the #1318 collision class) and answers with a fresh one, `serverId !== noteId` fails the seeded fast path, and the fallback broadcasts a `sync_update` that opens a room per note.

## Related

- `crdt-sync-store-hiding-layers.md` — the sibling rule for local-hide Sets in
  `SyncStore`; every hiding layer needs a named clearing event. Same failure
  shape, different class.
- `path-keyed-oracle-id-keyed-wire.md` — why note_ids are unique only *within*
  a vault, which is what makes carrying one across a switch dangerous.
