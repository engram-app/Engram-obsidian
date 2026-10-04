# A note that never heals: the create-ack gate swallowing syncStep1

**Trigger:** a note's disk content is stale, the client logs
`CRDT catch-up: diverged cold note, socket re-handshake` followed by
`socket converge: re-handshake fired`, and then **nothing** — no STEP2, no
flush, no retry. The server log has no inbound frame for that note_id at all.

Found via e2e `test_48_oauth_reconnect_catchup.py::test_oauth_reconnect_receives_update`
(`engram#1130`), fixed in plugin #335.

_Last verified: 2026-10-03_

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
`hasServerNote` false and takes the socket-native genesis branch rather than the
live-CRDT branch, so it sends a `crdt_create`; the server's idempotent same-path
arm returns the existing row, and the ack sets `CRDT_HEAD_CREATED`. Head
flipped, gate open. (There is no REST route for CRDT-domain notes.) So the symptom is "this note stopped
receiving remote updates until I typed in it", not silent loss.

## Reading client logs from CI artifacts

The plugin's own logs ship to the backend, so they live in the e2e job's `docker-compose.log` (artifact `ci-debug-<head-sha>`, or `ci-crdt-debug-<sha>` for e2e-crdt), not in `pytest-e2e.log`. Filter `"category":"client"` per user and order by FILE POSITION: the `time` field is the remote logger's batch-POST timestamp, so a whole batch shares one millisecond and sorting by it scrambles causality. Take real timing from the SERVER lines (`sync broadcast emit`, `crdt join`/`crdt leave`, `ws connect`); `conn_id` separates the pre-disconnect connection from the reconnect. Two earlier sessions misattributed cause from batch timestamps.

Already ruled out for this bug, do not re-walk: `crdt_catchup_since` cursor selection, unadvertised-resident-doc reconnect, REST-write vs live-room split-brain, the `setAdvertised` transition guard, OAuth identity drift.

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

# The write side of the same gate: `adoptCreateAck`

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
`adoptCreateAck(effectiveId, path, consumed)` in PR #382 (closes #377; the batch path has since been retired):

| caller | context |
|---|---|
| `pushFile`'s genesis branch | live (two call sites), may transfer an editor's mint buffer, retires the mint doc |
| `applyCrdtCreateAck` | durable queued — seeds from disk |

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

A `null` `consumed` means nothing was transmitted, so no baseline is stamped —
the seed-declined and post-create-throw exits. The post-create-throw exit leaves
the echo-cooldown window closed conservatively; an unsuppressed self-echo there
is absorbed by the hash-skip dedupe.

## Every `enroll()` call site must be gated on `isLiveBound`

`enroll()` opens a real CRDT room via a genuine STEP1 handshake. There are 12+ call sites across `sync.ts`, `wiring.ts`, `main.ts` and `live-views.ts`, and each must fire only when an editor is bound to the note. `flushHeldEditsOnCreateAck`'s catch-block self-heal was the one ungated site: on a thrown `flushHeldState` it reset and enrolled unconditionally, so a bulk first sync of N never-opened notes could open N rooms (#1409, handshake half; fixed by gating on `isLiveBound`). That is safe because `flushHeldState` is a PULL: held edits reach the server on the note's next local edit once the create-ack flips `hasServerNote`, not through the re-handshake. The self-heal only fires on a thrown error, so it is invisible on the happy path; when auditing a room-count regression, grep every `enroll(` and trace the `catch` blocks. `fireCrdtReHandshake` (the `socketConverge` funnel) has the same shape for a non-live-bound note losing connectivity mid-edit while durably queued; not verified. The room count was never a RAM proxy (#1409 closed: the cost was the embedding model, not rooms).
