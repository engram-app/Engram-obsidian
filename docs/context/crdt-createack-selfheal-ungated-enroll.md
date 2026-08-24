# create-ack self-heal was the last ungated `enroll()` call site

_Last verified: 2026-08-24_

## Status
Fixed on `fix/1409-gate-createack-selfheal-on-livebound` (`ce32663`), not yet pushed/PR'd.

## What This Is
`Engram-obsidian/Engram#1409` ("bulk first sync opens ~1 CRDT room per note
instead of staying room-free for idle notes") has two independent halves:

- **`crdt_msg` half** — fixed in a prior session: backend `Engram#1424` +
  plugin `#452`.
- **Handshake half** — fixed this session: `SyncEngine.flushHeldEditsOnCreateAck`
  in `plugin/src/sync.ts` (~line 1109) was the only `enroll()` call site in the
  whole plugin NOT gated on `isLiveBound(path)`.

`flushHeldEditsOnCreateAck` runs after every `crdt_create` ack (both the live
inline push and the durable-queue replay). On a thrown error from
`this.crdt.flushHeldState(noteId)` it unconditionally did:

```ts
this.crdtEnrollment.reset(noteId);
this.crdtEnrollment.enroll(noteId);
```

`enroll()` opens a real CRDT room via a genuine STEP1 handshake. Every other
`enroll()` call site in `sync.ts`, `wiring.ts`, `main.ts`, `live-views.ts`
(12+ sites) only fires when an editor is actually bound to the note. This one
didn't check that at all — so a bulk first sync of N brand-new, never-opened
notes could self-heal-enroll N rooms it had no business opening.

## Measured symptom
`backend/e2e/tests/test_77_bulk_first_sync.py` (1000-note bulk first sync)
measured 544 `source: :handshake` `room_start` telemetry events (see
`backend/lib/engram/notes/crdt_doc.ex`'s `@start_event`, tagged in
`backend/lib/engram_web/channels/crdt_channel.ex`'s `crdt_msg` handler /
`frame_class_b64` classifier) even though 0 notes were ever open in an editor.
The test's own `HANDSHAKE_ROOM_RATCHET = 700` constant was a stopgap, not a
target — added specifically because this defect wasn't root-caused yet.

## The fix
Gate the self-heal on `isLiveBound`, matching every other call site:

```ts
} catch (e) {
    rlog().warn("crdt", `create-ack flush failed for ${noteRef(path)}: ${errMsg(e, path)}`);
    if (!this.isLiveBound(normalizePath(path))) return;
    this.crdtEnrollment?.reset(noteId);
    this.crdtEnrollment?.enroll(noteId);
}
```

**Why it's safe:** `flushHeldState` is a PULL, not a push (per the function's
own existing docstring). The held body actually reaches the server on the
note's *next local edit*, once `hasServerNote` flips true from the create-ack
— not via this re-handshake. For a genuinely idle (non-live-bound) note there
is no pending "next edit" and no editor waiting on the flush, so nothing needs
a room-opening backstop; the content is already safe in the Y.Doc.

Also updated `plugin/tests/crdt-create-ack-gate.test.ts`
(`describe("SyncEngine.flushHeldEditsOnCreateAck")`), which previously
asserted the ungated (buggy) behavior as intentional ("Defect 2 hardening").
Split into a live-bound case (still self-heals) and a new idle case (must NOT
enroll).

## Two separate durable-retry mechanisms — don't confuse them
Both retry CRDT creates but only one was in scope here:

- **`CrdtOpQueue`** (`plugin/src/crdt-op-queue.ts`, `crdtEnqueue` /
  `kind: "create"`) already retries room-free — it rebuilds the genesis frame
  at send time via `makeCrdtOpSend` (per review H4). **Not the bug.**
- **The offline `QueueEntry` queue** (`this.queue`, via `enqueueCrdtEdit`)
  redelivers through `socketConverge` / `fireCrdtReHandshake` (sync.ts ~5655),
  which ALSO enrolls unconditionally. But that path only fires for existing
  (`hasServerNote` true) notes' held EDITS, not first-time creates — so it
  wasn't relevant to test_77's all-new-notes scenario.

`fireCrdtReHandshake` has the same missing-gate shape and could be a latent
issue for a different scenario (an existing, non-live-bound note losing
connectivity mid-edit while durably queued). **Not verified, not fixed** —
flagged as a sibling pattern for a future session. See also
`docs/context/crdt-pull-gated-by-create-ack.md`, which documents the adjacent
create-ack gate (`adoptCreateAck` / `hasServerNote` / `canSendLive`) that this
self-heal sits next to — related area, different bug.

## Open question — NOT confirmed this session
Why does `flushHeldState` throw for ~54% of 1000 brand-new notes in the first
place? The gate fix above makes the throw harmless (idle notes no longer
self-heal-enroll on it), but the throw rate itself is still unexplained — no
CI log capture or Loki access was available to confirm.

**Leading hypothesis (unverified):** `test_77_bulk_first_sync.py`'s own
polling loop calls `cdp_a.trigger_full_sync()` every 2s without waiting for
the prior `fullSync()` call to fully complete:

```python
while time.monotonic() < deadline:
    ...
    await cdp_a.trigger_full_sync()
    ...
```

`SyncEngine.fullSync()`'s `inBulkSweep()` wrapper (sync.ts ~9207) is only a
depth counter for queue-priority marking — it does **not** serialize
overlapping sweeps (per its own comment). `pushFile()`'s reentrancy guard
(`if (this.pushing.has(file.path)) return false;` at sync.ts ~3487) has a
TOCTOU gap: checked synchronously at entry but only claimed
(`this.pushing.add(pushedPath)`) after two `await`s (an echo-hash disk read,
then `acquirePushSlot()`). So two overlapping `fullSync()` calls could both
start pushing the same brand-new note concurrently, racing on the same
`ProviderRegistry` entry for that note_id — in particular
`hasAnyHistoryTransient`'s materialize-then-`destroy(id, false)` cycle in
`plugin/src/crdt/provider-registry.ts` (~line 300) — a plausible source of a
`NoteDestroyedError` surfacing in one call's later `flushHeldState`.

**Not fixed this session** (narrow "gate the enroll" fix was chosen over also
fixing this race). If a future session wants to close #1409 fully, or needs
to explain a still-nonzero handshake count after this fix, start here.

## Gotchas
- `enroll()` has 12+ call sites across `sync.ts`, `wiring.ts`, `main.ts`,
  `live-views.ts`. When adding a new one (or auditing after a room-count
  regression), grep all of them and check each is gated on `isLiveBound` —
  this bug was exactly one un-gated site hiding among many correct ones.
- The self-heal only fires on a *thrown error*, so it won't show up by reading
  the happy path — you have to trace the `catch` block specifically.

## References
- `plugin/src/sync.ts` ~1109 — `flushHeldEditsOnCreateAck`
- `plugin/tests/crdt-create-ack-gate.test.ts`
- `backend/e2e/tests/test_77_bulk_first_sync.py` — `HANDSHAKE_ROOM_RATCHET`
- `backend/lib/engram/notes/crdt_doc.ex` — `@start_event`
- `backend/lib/engram_web/channels/crdt_channel.ex` — `frame_class_b64`
- `docs/context/crdt-pull-gated-by-create-ack.md` — adjacent create-ack gate doc
- Engram-obsidian/Engram#1409, backend #1424, plugin #452 (crdt_msg half)
