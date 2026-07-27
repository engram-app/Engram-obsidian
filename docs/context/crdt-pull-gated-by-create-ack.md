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

Blast radius is bounded: a later LOCAL edit unsticks it. `pushFile` sees
`hasServerNote` false and takes the socket-native genesis branch
(`sync.ts:2663-2678`) rather than the live-CRDT branch, so it sends a
`crdt_create`; the server's idempotent same-path arm (`engram`
`lib/engram/notes.ex:687-689`) returns the existing row, and the ack sets
`CRDT_HEAD_CREATED` (`sync.ts:2770`). Head flipped, gate open. (There is NO REST
route here any more — `sync.ts:2845-2851`, "CRDT-sole … the only REST note path
kept is for notes OUTSIDE the CRDT domain". An earlier draft of this doc said
REST; same conclusion, wrong path.) So the symptom is "this note stopped
receiving remote updates until I typed in it", not silent loss.

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

**Handshake traffic must never be subject to a gate that exists to protect
writes.** The client's `FrameKind` (`src/crdt/note-provider.ts`) deliberately
mirrors the backend's own lanes in `crdt_channel.ex` `frame_class_b64`, which
buckets syncStep1 and a small syncStep2 as `:handshake` and everything else as
`:edit`:

- syncStep1 is a bare state vector, no content.
- The syncStep2 written in reply is only ever produced in response to an
  inbound syncStep1, and the server sends one only for a `doc_id` it already
  resolved through `note_in_vault?` (`crdt_channel.ex` `resolve_note_id`, which
  runs BEFORE `ensure_observed` — so an unknown id also starts no room, pins no
  `SharedDoc`, and persists nothing).

Gating the pull cost the note. Gating the reply cost the doc's evictability:
the reply sits in the provider buffer forever, so `isFullySynced()` is never
true and `closeDoc` can never free the Y.Doc or its IndexedDB connection for the
rest of the session. Buffered frames therefore carry their own kind — re-offering
a held handshake as an `"op"` on flush re-gates it into the same trap.

**Not free, though:** an un-acked handshake costs one `note_not_found` reply AND
a server-side `Logger.warning(category: :sync)` (`crdt_channel.ex` `log_dropped`).
A brand-new note open in the editor emits one step1 before its create-ack lands,
so expect one `sync` warn per new note per reconnect. Bounded and low, but if
you are triaging a `sync` warn burst, this is a known contributor.
