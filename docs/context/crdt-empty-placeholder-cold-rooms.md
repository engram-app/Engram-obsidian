# An empty file lies three ways (and the first-sync placeholder it hides)

_Last verified: 2026-08-27 (UTC)_

## Status
Fixed on `fix/477-empty-placeholder-cold-rooms` (`Engram-obsidian#477`, PR #478).
**Read "What this does NOT buy" before quoting any number off this.** Both
benefits this started out claiming — fewer rooms, and a visible empty-note
window — were measured and did not survive.

## What This Is
`#477` was filed as "cold-note catch-up opens a room per note", off a prod first
sync that showed **833 rooms for ~1,000 notes**. Chasing it turned up a different,
realer defect underneath, and killed the perf premise on the way.

## The chain

1. Device A pushes. The op-log feed emits a `v=1` create row whose `content` is
   EMPTY (its `content_hash` is the empty-content hash — every such row shares
   one, which is how you spot them in a log).
2. Device B's catch-up hits the **discovery** leg, which materializes the row's
   body — so it writes a **0-byte file** and records that empty as its baseline.
   Measured: **20 of 150 notes** on a bulk first sync.
3. The real body lands server-side; a later row carries it with a fresh hash.
4. Disk (0b) ≠ row (39b) → the quiet-record guard's `localNow === content`
   condition fails → the note takes the cold-converge leg to fetch a body **this
   very row already carries.**

The room was a correct heal of a hole the client dug itself. What the fix is
actually worth is narrower than that sounds — see "What this does NOT buy".

## An empty file is not a license to write

The first fix was "disk is empty, so there's nothing a converge could protect —
just write the row's body." Review killed it. `isUnconvergedEmptyPlaceholder`
exists because an empty file lies in three different ways:

1. **The emptiness IS the converged state.** A remote clear applied through
   `flushFromCrdt` calls `recordCrdtBaseline("")`, so `stored.hash === fnv1a("")`
   and `localDiverged` reads FALSE — the drift-copy escape hatch never fires. A
   later checkpoint-lagged row carrying the PRE-clear body would resurrect
   deleted content. **`crdtHead` separates them:** a converged note carries a
   REAL head; a discovery placeholder carries only the `CRDT_HEAD_CREATED`
   sentinel ("the server has this note, we have never applied its ops").
2. **The doc holds local work.** `hasUndeliveredOps` is the precondition
   `convergeColdNoteRoomFree` already enforces, for the same reason: a snapshot
   write, like a `crdt_doc_state` read, cannot carry anything upward.
3. **The cache invented it.** `localNow` is a `cachedRead`, and a `cachedRead`
   right after a create is exactly where Obsidian's cache lies — proving the 0
   bytes took `adapter.read` during the investigation, so the overwrite demands
   the same proof. A read failure answers false; the converge is always correct.

## And never record what you cannot verify

The leg writes the body and then records **exactly what the discovery leg
records** — `hash` via `recordCrdtBaseline`, plus `markServerKnown`. No
`serverHash`, no `seq`. A row can lag its own `content_hash` (fresh hash, stale
bytes — the test_82 "went deaf on the stale bytes" class), so recording that hash
marks the note in sync at bytes we cannot verify, after which every later row
carrying it compares equal and is skipped. Permanently.

It also drops any staged `pendingConvergence` episode for the note: an in-flight
room's STEP2 would otherwise commit an OLDER `serverHash`/`version`/`seq` over
what this row just materialized, walking `seq` backward and re-serving consumed
rows. `commitCrdtConvergence` records unconditionally once a stage exists — there
is no text-verify gate to save you.

## What this does NOT buy: room count, or a visible empty-note window

**Tested and disproved.** A first-sync e2e asserting "B holds no 0-byte notes
after its catch-up" passes on plain `main` too, twice — the cold converge fills
the placeholder inside the same `trigger_full_sync()`. So the empty window is
sub-pass, not a settled state a user sits looking at, and there is no e2e oracle
at this granularity that can tell the two builds apart. The test was written,
run against both, and deleted rather than shipped: a test that cannot fail is
worse than no test, because it reads as coverage.

What that leaves as the real benefit: **~13% of a first sync's notes stop paying
a `crdt_doc_state` round-trip** for a body the row already carried. That is the
whole of it.

Room count, measured over a 150-note bulk first sync, n=3 each:

| build | rooms |
|---|---|
| plain `main` | 1, 3, 1 |
| first (unsafe) fix — recorded `serverHash` | 0, 0, 0 |
| final fix — records nothing | 0, 3, 4, 3 |

**The consistent 0 came entirely from recording a hash we could not verify** —
i.e. from suppressing all future convergence for those notes, which was the
defect. Once that stops, the room count is indistinguishable from `main`. The
leg still fires (7-20 notes per 150, confirmed with a probe log); it just moves
the body one pass earlier instead of removing the converge.

Also do not quote the issue's 833/1,000: `main` allocates ~1-3 per 150 because
#474's room-free path already removed the bulk. That figure is pre-#474-shaped.
And room count was never a RAM proxy — a room is ~85 KB, 52 draining released
4 MB (`project_1409_closed_premise_invalidated`).

## How it was found (the method that worked)
`enrollSites` buckets by **stack frame**, so it can only ever name
`fireCrdtReHandshake`, the funnel every caller collapses into — weeks of it named
nothing. Two cheap instruments cracked it in one session:

1. **`convergeSites`** — an explicit label passed at each `socketConverge` call
   site. That granularity names code to change; it identified
   `catchup-diverged-cold`.
2. **A per-condition miss counter** at the quiet-record guard, bucketing which of
   its three conditions failed. Answer: **`disk-differs`, 100%**, killing the
   standing hypothesis that a recorded `serverHash` was skipping the guard.

Then `adapter.read` alongside `cachedRead` proved the 0 bytes were real. Both
instruments live on `chore/diag-enroll-all-devices` ("not for merge").

**Confirm the leg you added actually fires.** A one-line probe log plus
`docker logs | grep -c` is the difference between "0 rooms" meaning "it worked"
and "0 rooms" meaning "it never ran."

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

**Room count needs n≥3.** Single runs range 0-4 on identical code; one run "proving"
a win is noise.

## Gotchas
- `stampSyncedRow` REPLACES the row by contract — `crdtHead` lives in that same
  row, so a `markServerKnown` before it is erased by the very next line, and
  `markServerKnown` afterwards writes the CREATED sentinel over a hole where a
  real head used to be. Use `patchSyncedRow` when the row must survive.
- **`test_34_folder_rename_propagation` fails whenever it runs after
  `tests/crdt/`** — the 4 Playwright specs that always time out on this box leave
  the state that starves it. Identical failure set with and without a sync-path
  change; it passes solo in ~31 s. Control the batch, not just the test.
- Local attachment tests (`test_33`, `test_79`, `test_80`) fail on a server-side
  MinIO `403 SignatureDoesNotMatch`. Env drift, not code.

## References
- Issue `engram-app/Engram-obsidian#477`, PR #478
- The other ungated site: `crdt-createack-selfheal-ungated-enroll.md` (`#1409`, plugin `#474`)
- `backend/docs/context/crdt-room-lifetime-and-drain.md` — drain phases, idle exit
- `docs/context/local-crdt-e2e-repro.md` — stack bring-up, env vars, dead ends
