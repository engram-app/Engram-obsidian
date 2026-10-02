# Context Doc: Opening a note wiped it to 0 bytes on every device (#538)

_Last verified: 2026-09-25_

## Status
Fixed by PR #539 (merged, `769a928`). The trigger (why the NoteIdMap lost the
id) is still open as #541. The fix makes the wrong mint harmless; it does not
prevent it.

## What This Is
A rare timing race: opening a note in Obsidian wrote 0 bytes to disk, and the
next push spread that empty body to every device. Found in backend CI run
36095746392 (e2e-crdt, job 107948432396),
`test_frontmatter_bidirectional.py::test_web_property_reaches_obsidian_with_note_open`.
It was the first occurrence in about 300 verify runs.

## The chain

1. **Trigger: wrong-mint at file-open.** Device B's NoteIdMap had lost the
   note's server id (`…3e75`). The file-open resolve called `getOrMint`, which
   minted a duplicate id (`…3f5f`). That id had an empty doc and was never acked,
   and the server dropped its STEP1 as `note_not_found`.
2. **Silent write.** `flushFromCrdt` is the only text writer that does not log
   its writes. Its empty-write guard looked up the doc for the path's *current*
   id (the empty mint). It refused an empty write only when that doc still
   projected content. An empty, unseeded doc projects `""`, so the guard let the
   blank through and 0 bytes hit disk. The log showed zero `refused empty` lines.
3. **Spread.** The map healed back to `…3e75`. The post-remap push
   (`CRDT push ok: n15`) read the empty disk body and diffed it into the real
   server doc. The server broadcast the update, and device A, which had never
   opened the note, wrote `modify bytes=0`. Every device ended at 0 bytes.

## The fix (PR #539, `src/sync.ts`)

- `flushFromCrdt` (via `emptyWriteRefusal`) refuses to write `""` over a
  non-empty file unless the id is server-confirmed and its doc is seeded (at
  least one integrated struct, `doc.store.clients.size > 0`) and converged
  empty. So it refuses when there is no id, the id is an unacked local mint, the
  doc is unseeded, or the doc can't be read. A doc cleared by a peer keeps its
  tombstones, so it counts as seeded and real remote clears (test_27) still
  write.
- `hasServerNote` returns false for an unacked mint. `crdtHead` is keyed by
  path, so without this check a duplicate id inherited the path's "server-known"
  status and routed ops the server dropped.
- `confirmNoteId` now calls `store.confirmUpload` when the server confirms a
  mint, which clears `pendingUpload`. Before this, nothing in production called
  `confirmUpload`, so `isPendingUpload` could not tell mints apart.
- A refusal that wrote nothing returns **false**. Only the "doc still has
  content" refusal returns true, because disk already holds the truth.

## Review lesson: `true` means "written"
A flush function's boolean return means "written". Callers stamp synced hashes
when it returns true. The first version of the fix returned `true` from every
refusal. The legacy no-id catch-up then stamped `hash("")` over the old body,
and the next scan pushed that body back over a peer's legitimate clear (the #265
resurrection class). If a refusal writes nothing, return false.

## How it was diagnosed
- **The e2e failure hid the bug.** It showed up only as a web property-row
  `Locator.fill` timeout, so it looked like a frontend flake. The real symptom
  was in the artifact: `E2E/Crdt/FmWebToObsidian.md` at 0 bytes in both vaults
  while every other `Fm*.md` was intact.
- **The source was the backend e2e-crdt CI artifact.** `docker-compose.log`
  holds per-device remote-log timelines. Filter it by device (B = `161eae04`)
  and note path to rebuild create, file-open, modify, push and broadcast in
  order.
- **Echo-skip hash `2166136261` means an empty string.** It is the FNV-1a
  offset basis, which is the hash of `""`. When a `modify` or echo-skip line
  carries it, something wrote 0 bytes.
- Date a minted id from its uuid7 timestamp. B's remote-log batch is flushed on
  a 30s timer, so log order is not write order.

## Failed Approaches / Dead Ends
- Treating the e2e failure as a flaky web locator. Retrying or raising the
  timeout would have hidden a data-loss bug.
- Trusting the old guard's "doc projects empty, so the clear is real" logic. An
  empty projection also means "doc not loaded" or "brand-new mint".

## Gotchas
- `hasServerNote`, `crdtHead` and the empty-write guard all key on PATH, while
  ids can be re-minted. Any "is this doc authoritative?" check must also ask
  whether the server acked the id. See `path-keyed-oracle-id-keyed-wire.md`.
- Still unproven: why the map entry vanished between discovery and file-open
  (#541), and exactly which B write produced server seq 42.

## References
- Issue #538, PR #539, follow-up #541 (engram-app/Engram-obsidian)
- Test: `tests/sync-empty-write-wipe-538.test.ts`
- Related: `docs/context/crdt-empty-placeholder-cold-rooms.md`,
  `docs/context/path-keyed-oracle-id-keyed-wire.md`, workspace
  `docs/context/crdt-wrong-mint-cross-file-overwrite.md`
