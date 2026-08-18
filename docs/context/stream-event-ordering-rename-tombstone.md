# A remote rename kills the note's live sync

**Symptom.** Rename a note in the web app. The rename propagates to Obsidian
correctly — right filename, right content. Then typing stops syncing in both
directions for that note. Reloading Obsidian fixes it; so does waiting ~60s.
Sometimes a conflict file appears.

**Plugin log (diagnostics on):**

```
ws     Event: delete note: n41
ws     Event: upsert note: n426
vault  create .../mommy v5.md
vault  delete .../mommy v4.md
crdt   fan-out skip (recent local delete): 01a011f9-...
crdt   op-replay skip (recent/pending local delete): 01a011f9-...
error  getYText failed: NoteDestroyedError: Note was destroyed
```

Those last three lines are the whole bug: the note's id is tombstoned and its
Y.Doc is gone, so both convergence paths refuse it by id.

## Root cause: the client discarded the server's frame ordering

A rename is broadcast as **two frames** — an upsert for the new path and a
delete for the old one. The backend orders them deliberately at every rename
seam (`Notes.rename_note`, `do_rewrite_note`, the folder-rename fan-out): the
**upsert goes first**, so a receiver relocates the note's id before the delete
arrives, and the delete then reads as a relocation leg rather than a death.
The delete branch's guards in `sync.ts` are written on exactly that premise —
its own comment says "the backend now emits the upsert for the NEW path BEFORE
this delete."

`main.ts` threw that ordering away:

```ts
channel.onEvent = (event) => {
    void this.syncEngine.handleStreamEvent(event);   // fire-and-forget
};
```

Each frame ran as its own un-awaited async task, so the two legs raced. When
the delete won, `pathForId` still answered the OLD path, `relocated` came out
false, and the rename was applied as a genuine delete:
`markRecentlyDeleted(id)` (60s delete-wins window, backend #970) plus
`teardownCrdtDoc(id)`. The upsert then materialized the new file, but against
an id that was muted and whose doc had been destroyed.

That is why a reload fixed it (fresh process, no tombstone) and why waiting
also fixed it (the TTL lapsed).

**Fix:** serialize event application inside `SyncEngine.handleStreamEvent` —
each event's application completes before the next begins. It lives in the
engine, not the call site, so the guarantee sits with the invariant that
depends on it and every caller and test inherits it. Head-of-line blocking is
the accepted cost; these handlers already await disk and network, and
unordered application is the defect.

**Backstop:** the pull feed and the socket are still separate concurrent
sources, so the reverse order remains reachable. `recentlyDeleted` now records
the *path* each tombstone was for, and an inbound upsert naming a **different**
path proves the id is alive and lifts it. A **same-path** upsert is precisely
the stale echo #970 exists to block and still is — the existing delete-wins
suite fails if that distinction is dropped.

## Failed approaches — do not repeat these

Three fixes shipped before this one, all in the wrong function, all leaving the
user's behavior identical:

1. `514e400` — remote rename deleted the merge base (`dropPath` defaults
   `dropBase: true`). Real bug, wrong bug.
2. `92f946b` — editor leaf orphaned when a remote rename trashed the open file.
   Real bug, wrong bug.
3. `379abe2` — reworked `moveIfIdRelocated` to use `vault.rename()` instead of
   trash+create. Genuinely better (it keeps the file's identity in Obsidian and
   avoids a duplicate), and worth keeping — but it is **not** on the path that
   fires when the delete leg wins the race.

All three came from reading code and inferring which branch ran. The plugin's
own log proved `moveIfIdRelocated` was never reached: the new file came from
*CRDT discovery* and the old one was trashed by the *delete* handler.

**The lesson that actually saved it:** reproduce at the event level, black-box,
feeding the real frames in the real order, and read the log the engine emits.
An inferred code path is a guess. A test that logs which branch fired is
evidence — and here it took two orderings to find the one that breaks.

## Reproducing it

`tests/sync-note-id.test.ts` → "a remote rename must not kill the renamed
note's live sync". Two cases: server order (must be a true move, room never
torn down) and delete-first (must not leave the id tombstoned). The
delete-first test asserts on the *literal log lines from the report* rather
than an internal branch, so it stays tied to the reported failure.

`rlog` is a process singleton, so a spy sees every line the engine emits.
Assert "no line anywhere matches X" — never "the last line was X", which
silently drifts as unrelated logging changes.

## If you touch this again

- Anything that reasons about a rename's two legs depends on ordered
  application. Do not reintroduce a `void handleStreamEvent(...)` at any call
  site.
- Before concluding a delete is genuine, remember the engine cannot tell a
  rename's old leg from a death using local state alone in the racing case.
  The ordering is what makes the distinction knowable.
- `markRecentlyDeleted` takes a path for a reason. Dropping it makes the
  tombstone unliftable and reintroduces this bug in the reverse order.
