# A remote rename: three bugs, one shape

Renaming a note in the web app produced three distinct failures in Obsidian.
They were fixed in this order, and only the third is really about renames — the
first two were general defects a rename happened to expose.

1. **Live sync died.** The rename landed, then typing stopped syncing until a
   reload. `fan-out skip (recent local delete)`, `op-replay skip`.
2. **The editor's doc was destroyed.** `NoteDestroyedError` on every read.
3. **The file was recreated rather than moved.** Right bytes, new file — so
   Obsidian closed the tab, backlinks re-resolved, creation date reset.

## The shape they share

A rename is broadcast as **two frames** — an upsert for the new path, a delete
for the old — and the note's identity moves *before* its file does. Every bug
here is some code treating one of those halves as the whole truth.

### 1. Ordering (`fix: apply stream events in order`)

`main.ts` fired `void handleStreamEvent(event)` per frame, so the two legs ran
as concurrent tasks. When the delete won, `pathForId` still answered the old
path, the rename read as a genuine death, and the id was tombstoned for the 60s
delete-wins window. Serialized in the engine, where the invariant lives.

### 2. Tombstone and teardown on a server-decided delete

`handleDelete`'s remote-applied branch tombstoned the id and tore down its
Y.Doc. That guard exists for delete-wins (#970) — *our* delete racing a peer's
in-flight frame. Applied to a delete the server already made, it is backwards:
a later server frame for that id is newer truth, and it was the only frame being
silenced. The branch had **no test coverage at all**.

The old-leg branch also trashes the stale file, and that trash re-enters
`handleDelete` as an ordinary delete — so it destroyed the room its own comment
says to never tear down. A `renamedAway` marker carries the intent across the
trash boundary.

### 3. Identity moves, the file does not

The real rename bug, and the one that took five attempts.

**A claim erases the old key.** `SyncStore.set` evicts any entry naming the same
id at another path — correct, and it is exactly what makes a rename
unrecoverable afterwards. Once the map answers the new path, nothing remembers
the old one, so a rename is indistinguishable from a note appearing from
nowhere. `applyChange` then finds an empty target and creates.

Several paths race to materialize the new location — the id-keyed mover, the
discovery create, the CRDT flush. Whichever loses finds the target occupied and
degrades to create-here + trash-there. **Which path won only changed the log
line; the outcome was the same**, which is why fixing any single one of them
did nothing.

Fixes, in the order they were needed:

- All materialization funnels through `createFileWithFolders`, so the
  create-vs-move decision belongs there, once.
- The origin is recorded when identity moves (`relocatedFrom`, TTL'd).
- **That record is usually empty**, because the map is also reached by the
  doc-ready announce, catch-up and discovery, which leave no record. The
  fallback is `data.json`'s cached mapping, which a claim does *not* erase —
  `SyncStore.priorPathsForId`. Treated as a hint: the candidate counts only if a
  file is really there, and the target must be empty.

Verified live: `vault rename ... from=...` with no create/delete pair.

## Why this took so long

Five wrong fixes, and the pattern is worth naming: **every one was reasoned from
code and every one was refuted by the logs.** Each time, the map had already
moved past the layer being patched — in a different way each time.

- The plugin's own `client_logs` is the ground truth (`plugin_version` column
  included, so "is my build even running?" is answerable — twice it was not).
- Second-precision, batch-flushed timestamps **cannot** establish emit order.
  Do not argue orderings from them.
- The decision that mattered — `moveIfIdRelocated`'s early return — was silent,
  so a vault where it fired every single time looked identical to one where
  renames worked. The `rename-trace 1/3..3/3` lines exist to keep that visible.

## Relay, for comparison

Relay has no delete/upsert pair to reconcile. It diffs a shared index and emits
one `rename` op when a guid exists on both sides (`SharedFolder.ts`), then
`fileManager.renameFile` + `doc.move(path)`. Crucially it keeps
`files: Map<guid, IFile>` — an **engine-owned id→file binding, separate from the
shared identity map** — so "where is this note's file" is always answerable and
none of the above can arise.

We use `vault.rename`, not `fileManager.renameFile`: our server rewrites links
for renames it originates, and renameFile would rewrite them again. Relay's does
not rewrite at all, so renameFile is right for them.

**The durable id→file registry is the real cure** and we still do not have one.
Everything above reconstructs it after the fact. See #1401 (index CRDT as the
single identity source); the index wire currently ships off.

## If you touch this again

- Do not reintroduce `void handleStreamEvent(...)` at any call site.
- `markRecentlyDeleted` takes a path for a reason. A remote-applied delete must
  not tombstone.
- No e2e test asserts move-not-recreate. Every inbound-rename test checks the
  bytes land at the new path, which passes when the file is destroyed and
  rebuilt. That gap is why this was invisible.
