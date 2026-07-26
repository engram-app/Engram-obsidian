# A note that never heals: the create-ack gate swallowing syncStep1

**Trigger:** a note's disk content is stale, the client logs
`CRDT catch-up: diverged cold note, socket re-handshake` followed by
`socket converge: re-handshake fired`, and then **nothing** — no STEP2, no
flush, no retry. The server log has no inbound frame for that note_id at all.

Found via e2e `test_48_oauth_reconnect_catchup.py::test_oauth_reconnect_receives_update`
(`engram#1130`), fixed in plugin #335.

## The mechanism

`socketConverge` → `fireCrdtReHandshake` → `ProviderRegistry.reset` + `enroll`
→ `startSync` → `NoteProvider.sendSyncStep1`. That send goes through the SAME
transport closure as ops, and that closure is wrapped by the create-before-edit
gate:

```
wiring.ts        send: (docId, frame, kind) => { if (kind === "op" && !canSendLive(docId)) hold }
main.ts          canSendLive: (id) => syncEngine.hasServerNote(id)
sync.ts          hasServerNote(id) === (getCrdtHead(pathForId(id)) != null)
```

Before #335 the gate had no `kind`, so it held the pull too. Worse:
`sendSyncStep1` calls `send` **directly** rather than `broadcast`, so a refused
pull is not buffered — it is dropped outright, and no later flush replays it.

`crdtHead` is set ONLY by:

- `applyPushedNoteUpdate` / `adoptHistoryLessNote` — a `note_yjs_update`
  vault-channel fan-out actually landing, or
- a local create-ack (`CRDT_HEAD_CREATED` sentinel) from `pushFile` / the
  durable create queue.

**Neither happens for a note created over REST by another writer and discovered
here via `note_changed`.** `note_changed` materializes the body to disk and sets
`serverHash`, never a head. If that note's `note_yjs_update` fan-out lands while
the socket is down, this device holds the note with no head forever, and the one
recovery path (re-handshake) is gated off. Permanently deaf.

Blast radius is bounded: a later LOCAL edit routes REST (precisely because
`hasServerNote` is false), which flips the head and unsticks it. So the symptom
is "this note stopped receiving remote updates until I typed in it", not silent
loss.

## Reading the evidence (the trap that cost the first two sessions)

`e2e-clerk` uploads `ci-debug-<head-sha>` (e2e-crdt uses `ci-crdt-debug-<sha>`).
The plugin's own logs ship to the backend, so they live in `docker-compose.log`,
not `pytest-e2e.log`:

```bash
export GH_REPO=engram-app/engram
gh run download <run-id> -n "ci-debug-<head-sha>"

# client trail for one user, in file order
grep '"category":"client"' docker-compose.log \
  | grep '<hashed-user-id>' | sed 's/^engram-1 *| *//' \
  | jq -r '"\(.time) \(.metadata.conn_id // "-" | .[0:8]) \(.message)"'

# server-side truth for the same vault
grep -v '"category":"client"' docker-compose.log | grep '<vault-id>' \
  | sed 's/^engram-1 *| *//' | jq -r '"\(.time) \(.severity) \(.message)"'
```

**Do not order client lines by their `time` field.** It is the timestamp of the
remote logger's batching POST, so a whole batch shares one millisecond and
`sort` scrambles causality. Order by file position, and take real timing from
the SERVER lines (`sync broadcast emit`, `crdt join` / `crdt leave`, `ws connect`).
Two prior sessions on this bug misattributed cause from batch timestamps — one
chased an auth flip that was actually teardown 92s later, one attributed a
diverged-row line to the wrong version of the note.

`conn_id` (in client metadata, and in the socket `Parameters` on the server
side) is what separates the pre-disconnect connection from the reconnect.

## Ruled out — do not re-walk

- **`crdt_catchup_since` / cursor selection.** The feed served the diverged row
  correctly; the `diverged cold note` line IS that row.
- **Unadvertised-resident-doc reconnect.** Headless GREEN 6 covers it, passes.
- **REST write vs live room split-brain.** `do_rewrite_note` → `maybe_merge_crdt`
  persists the merged `crdt_state_ciphertext`, so a room hydrated after a REST
  update projects the new content. Headless repro passes.
- **`setAdvertised` transition guard.** `reset()` flips it false, `enroll()`
  true — the edge fires.
- **OAuth identity drift.** Verified intact at re-handshake time; the api-key
  flip in the logs is the test's own `finally`.

## Invariant to keep

A **pull** (syncStep1 — a bare state vector, no content) must never be subject
to a gate that exists to protect **writes**. The server answers an unknown
`doc_id` with `note_not_found`, so an un-acked pull costs one error reply. A
held pull costs the note.
