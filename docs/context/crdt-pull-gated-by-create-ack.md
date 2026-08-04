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

---

# The write side of the same gate: `adoptCreateAck` (2026-08-03)

Everything above is the PULL side — a handshake wrongly held by the gate. This
section is the WRITE side: what opens the gate, and the ordering the create-ack
paths must keep. Added here rather than in a new doc on purpose — see the trap.

## Which call opens the gate

**`setCrdtHead`, not `confirmNoteId`.** The wiring at the top of this doc is the
authority:

```
main.ts    canSendLive: (id) => syncEngine.hasServerNote(id)
sync.ts    hasServerNote(id) === (getCrdtHead(pathForId(id)) != null)
```

`confirmNoteId` populates `confirmedNoteIds`, which is **session-scoped** —
`clearConfirmedNoteIds` fires from `channel.onStatusChange`'s connected branch,
i.e. on every reconnect. `canSendLive` needs a signal that SURVIVES reconnect,
which is why it was deliberately moved OFF `confirmedNoteIds` onto the
`crdtHead` oracle. `isNoteConfirmed`'s own doc comment in `sync.ts` says this.

`confirmedNoteIds` still has two readers, neither of which is the live-send
gate: `refireEnrollmentOnFirstConfirm` (re-fire STEP1 once the row exists) and
`healNoteOnOpen` (catch-up-vs-heal branching).

**Two conditions, not one.** `hasServerNote` resolves the id through the
noteIdMap FIRST and returns false if that lookup misses:

```ts
const path = this.noteIdMap?.pathForId(noteId);
if (!path) return false;
return this.getCrdtHead(path) != null;
```

So the gate needs BOTH a noteIdMap entry AND a head on that path — an id absent
from the map is gated just as hard as one with no head. That is why
`adoptCreateAck` does `noteIdMap.set` as its first statement, before the oracle
flip: flipping the head for a path whose id is not yet mapped leaves the gate
shut anyway.

## The trap this cost us

The inline comments at all three create-ack call sites said the gate was opened
by "confirm it, then flush" — attributing it to `confirmNoteId`. The CODE was
always correct (`setCrdtHead` ran first), but the comments pointed a reader at
the wrong load-bearing line. Someone preserving "confirm before flush" while
moving `setCrdtHead` after the flush would ship into a still-closed gate.

That wording then got consolidated into one authoritative doc comment on
`adoptCreateAck`, which is what made it worth fixing rather than tolerating.
Caught in review of PR #382, fixed in `22b756d`.

**When you touch this, trust the wiring (`main.ts` `canSendLive:`) over any
prose — including this doc.**

## The three create-ack paths, and why they are one function now

"The server acked our `crdt_create`" bookkeeping existed three times, and one
copy had already leaked a step historically (the queued path missed the
mint-retire the live path did). They also disagreed on ordering. Merged into one
`adoptCreateAck(effectiveId, path, consumed, opts?)` in PR #382 (closes #377):

| caller | context |
|---|---|
| `pushFile`'s genesis branch | live — may transfer an editor's mint buffer, retires the mint doc |
| `applyCrdtCreateAck` | durable queued — seeds from disk |
| `recordCrdtGenesisPushed` | batch — content shipped inline in the batch frame |

The ADOPT half (mint-buffer transfer, mint retire) deliberately stays with each
caller: it legitimately differs per path. Only the shared tail merged.

**Ordering, load-bearing:**

1. `setCrdtHead` before the flush — the sentinel flips `hasServerNote`, which IS
   the gate (above). Flush before it and the held edits ship into a closed gate.
2. Echo baseline before the AWAITED flush. `flushHeldEditsOnCreateAck` is
   awaited; stamping the baseline after it leaves a window where the create's
   own broadcast returns before the baseline that suppresses it exists. The
   queued path already had this order; the live path did not, and #382 aligned
   them. This is a behavior change, not just a refactor.

`opts.flushHeld: false` is the batch path only — it seeds no local doc, so it
has no gated updates to flush. That is the one honest difference of the three,
and it is a named argument specifically so it cannot go missing silently again.

A `null` `consumed` means nothing was transmitted, so no baseline is stamped —
the seed-declined and post-create-throw exits. The post-create-throw exit leaves
the echo-cooldown window closed conservatively; an unsuppressed self-echo there
is absorbed by the hash-skip dedupe.

## Line numbers above are pre-refactor

The `sync.ts:NNNN` references earlier in this doc predate PR #380/#382, which
inserted ~130 lines. Several were already stale before that. Grep for the symbol,
not the line. (The same rot affects the `sync.ts:NNNN` self-references inside
`src/sync.ts` — 4 of 5 pointed at blank or unrelated lines as of 2026-08-03.)
