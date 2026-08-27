# A 0-byte placeholder makes a first sync converge notes it already holds

_Last verified: 2026-08-27_

## Status
Fixed on `fix/477-empty-placeholder-cold-rooms` — `Engram-obsidian#477`.
Measured on a 150-note bulk first sync against `origin/main`: **2 handshake
rooms → 0**, and ~20 notes/150 stop paying a `crdt_doc_state` round-trip for a
body the feed row already carried.

## What This Is
`#477` was filed off a prod first sync that opened **833 rooms for ~1,000
notes**. The room was never the defect — it was a **correct heal of a hole the
client dug itself one pass earlier.**

## The chain

1. Device A pushes. The op-log feed emits a `v=1` create row whose `content` is
   EMPTY (its `content_hash` is the empty-content hash — every such row shares
   one hash, which is how you spot them in a log).
2. Device B's catch-up hits the **discovery** leg (`applyChange`, "CRDT
   discovery: enrolling new note"), which materializes the row's body — so it
   writes a **0-byte file** and records that empty as the baseline.
3. The real body lands server-side; a later row carries it with a fresh
   `content_hash`.
4. B's catch-up: hash differs → diverged, not live-bound. Disk (0b) ≠ row (39b),
   so the quiet-record guard's `localNow === content` condition fails and the
   note takes the cold-converge leg — a `crdt_doc_state` read, or a full room
   handshake whenever that read falls back — to fetch a body **this very row
   already carries.**

Measured (150-note bulk first sync): 20 notes materialized empty; on the
pre-`#474` tree 13-16 of them each bought a room, on `main` 2 did.

## The fix
Route an empty local file that this row can fill into the snapshot backfill
instead of the cold converge:

```ts
} else if (noteId && !(localNow === "" && content !== "")) {   // cold converge
} else {                                                       // backfill
```

An empty file has no content a converge could protect, so it falls through to the
existing snapshot backfill (`flushFromCrdt` + `stampSyncedRow` +
`markServerKnown`) — the same write the discovery leg performs one pass earlier,
for the same reason.

**Both halves of the condition are load-bearing** (adversarial review found this,
not the first draft). With an EMPTY row, `flushFromCrdt` short-circuits on "disk
already holds this content" and writes nothing, so the leg would stamp
`serverHash` + `seq` for a note whose disk stayed empty. If such a row were a
checkpoint-lagged projection (fresh hash, stale bytes — the test_82 "went deaf on
the stale bytes" class), the note is recorded in sync while empty and every later
catch-up compares equal and skips it. Permanently. An empty row keeps the
converge, whose commit records only on proof.

This does **not** reopen the D2 stomp class the cold leg guards against: that
guard protects *content on disk* from a checkpoint-lagged projection, and an
empty file has none. A genuine local blanking never reaches the line — it trips
`localDiverged` above and takes the drift-copy branch, which preserves the local
edit.

## Don't re-derive: the prod 833 is not main's number
`origin/main` (plugin 1.24.3 + a backend that answers `crdt_doc_state`) allocates
**2** handshake rooms per 150 notes — nowhere near 833/1,000. `#474`'s room-free
cold-note path already removed the bulk of it. The prod observation must have run
a client/server pair where that path fell back to rooms; treat 833 as a
pre-`#474`-shaped number, not a main baseline. Re-measure before quoting it.

Related: room count was never a RAM proxy (a room is ~85 KB; 52 draining
released 4 MB) — see `project_1409_closed_premise_invalidated`.

## How it was found (the method that worked)
`enrollSites` buckets by **stack frame**, so it can only ever name
`fireCrdtReHandshake`, the funnel every caller collapses into. Weeks of that
named nothing. Two cheap instruments cracked it in one session:

1. **`convergeSites`** — an explicit label string passed at each
   `socketConverge` call site. That granularity names code to change; it
   identified `catchup-diverged-cold`.
2. **A per-condition miss counter** at the quiet-record guard, bucketing which
   of its three conditions failed. Answer: **`disk-differs`, 100%** — killing
   the standing hypothesis that a recorded `serverHash` was skipping the guard.

Then `adapter.read` alongside `cachedRead` proved the file was *genuinely* 0
bytes rather than a stale Obsidian cache. Don't skip that step — a `cachedRead`
right after a create is exactly where you'd expect the cache to lie.

Both instruments live on `chore/diag-enroll-all-devices` (commits marked "not
for merge") if this class needs re-opening.

## Repro loop
~90 s per iteration, reproduces every run. Stack + env per
`../../docs/context/local-crdt-e2e-repro.md`:

```bash
cd backend/e2e && env ENGRAM_API_URL=http://localhost:8100/api \
  ENGRAM_PLUGIN_SRC=<plugin checkout> AUTH_PROVIDER=local E2E_ENABLE_CRDT=true \
  E2E_WORKERS=1 CI_POSTGRES_CONTAINER=engram-crdt-postgres-1 \
  CI_MINIO_CONTAINER=engram-crdt-minio-1 CI_ENGRAM_CONTAINER=engram-crdt-engram-1 \
  E2E_BULK_NOTE_COUNT=150 \
  python3 -m pytest tests/test_77_bulk_first_sync.py -s --reruns 0
```

`E2E_BULK_NOTE_COUNT` is a LOCAL override only (on the diag branch) — CI runs the
full 1,000 and the default must never be lowered; the room bounds are calibrated
to that size. Client `rlog()` lines land in `docker logs engram-crdt-engram-1` as
`[client:*]`; their timestamps are ship-time, so never order by them.

## `markServerKnown` before `stampSyncedRow` is a no-op
Same backfill leg, found by the same review. The order was:

```ts
this.markServerKnown(normalized);   // setCrdtHead -> patchSyncedRow (merge)
this.stampSyncedRow(normalized, {…}); // REPLACES the row — head gone
```

`stampSyncedRow`'s contract is an explicit wholesale REPLACE ("prior bookkeeping
(crdtHead, seq, version…) is deliberately dropped"), and `crdtHead` lives in that
same `syncState` row — so the head was erased by the very next line. It went
unnoticed because only the legacy no-`note_id` leg reached here, and
`hasServerNote` is keyed by note_id, which a legacy note doesn't have.

For a CRDT note it bites: no head → `pushFile` takes the genesis branch and
re-uploads a note it just downloaded (prod 2026-08-13, "122 files to upload" from
an empty local vault), and `canSendLive` holds its live `crdt_msg` sends. Fixed by
moving `markServerKnown` AFTER the stamp; `hasServerNote` is now asserted in the
unit test. **If you add a field to a `stampSyncedRow` call site, check what the
replace drops.**

## Gotchas
- **Judge a fix by room STARTS and peak RSS during the sync**, not steady-state
  RSS — it does not return to baseline regardless (allocator carriers stay held),
  and peak residency here stayed at 1-3 with zero errors either way.
- **`tests/test_34_folder_rename_propagation.py` fails when it runs after
  `tests/crdt/`** — the 4 Playwright specs that always time out on this box leave
  the browser/Obsidian state that starves it. Identical 6/24 failure set with and
  without a sync-path change; test_34 passes solo in ~31 s. Control the batch, not
  just the test, before believing a delivery regression.
- Local attachment tests (`test_33`, `test_79`, `test_80`) fail with a server-side
  `403 SignatureDoesNotMatch` — the stack's MinIO credentials have drifted. Env,
  not code.

## References
- Issue: `engram-app/Engram-obsidian#477`
- The other ungated site: `crdt-createack-selfheal-ungated-enroll.md` (`#1409`, plugin `#474`)
- `backend/docs/context/crdt-room-lifetime-and-drain.md` — drain phases, idle exit
- `docs/context/local-crdt-e2e-repro.md` — stack bring-up, env vars, dead ends
