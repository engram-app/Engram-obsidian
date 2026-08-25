# Adding state to SyncEngine: the sweep registry

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

`SyncEngine` used to carry two hand-written teardown enumerations:

- `destroy()` swept the transient per-note maps, deliberately sparing `syncState`
- `wipePerVaultState()` swept `syncState` + cursors + identity, and left the
  per-note maps alone

Each was correct for its own job. Nothing owned their **intersection** — state
that is both vault-scoped *and* transient — so twelve note_id- and path-keyed
collections survived a vault switch and went on addressing the NEW vault with
the OLD vault's ids.

Six unrelated bug fixes each added a field to one list and not the other:

| field | commit | date |
|---|---|---|
| `pendingPostPullPushes` | 884b38f | 2026-03-15 pushAll echo suppression |
| `manifestPathOwners`, `pendingOrphanSweep` | b93d9a4 | 2026-07-07 cross-wired note ids |
| `crdtRehandshakeAttempts` | 88649bf | 2026-07-09 catch-up loop |
| `pendingQueueDeliveries` | f78ae97 | 2026-07-22 REST transport deletion |
| `pendingConvergence`, `crdtHealCooldown` | 0007287 | 2026-07-22 socket-native converge |
| `fileForNote`, `recentlyDeleted`, `relocatedFrom` | 3ff7038 | 2026-08-18 remote rename |

None of those authors were careless. A declaration three thousand lines from
either list carries no hint that a decision is owed, and forgetting was silent.

## What the leak actually cost

Measured on a real 423-item vault import (Engram #1409):

- **225 CRDT rooms opened for 317 notes**, every one `source=edit`, with zero
  `crdt_update_log` rows — all redundant, since the roomless genesis seed had
  already stored the state
- **16 duplicate note rows created by the vault switch itself** (each of v5, v6,
  v7 held exactly 317 rows before the next switch and 333 after)

Stale ids are the mechanism: `crdt_create` proposes a foreign vault's note_id,
the server cannot reuse it (the #1318 collision class) and answers with a fresh
one, `serverId !== noteId` fails the seeded fast path, and the fallback
broadcasts a `sync_update` that opens a room per note.

## Related

- `crdt-sync-store-hiding-layers.md` — the sibling rule for local-hide Sets in
  `SyncStore`; every hiding layer needs a named clearing event. Same failure
  shape, different class.
- `path-keyed-oracle-id-keyed-wire.md` — why note_ids are unique only *within*
  a vault, which is what makes carrying one across a switch dangerous.
