# Task 1 report: channel request/reply plumbing

## What was added

`src/channel.ts` (`NoteChannel`):
- `private readonly pendingReplies` — `Map<string, { resolve, reject, timer }>`, added right after `private ref = 0;`.
- `sendRequest(event: string, payload: unknown, timeoutMs = 10000): Promise<unknown>` — added right after `sendCrdt`. Refuses (rejects) if the crdt topic isn't joined; otherwise mints a ref, registers a timeout + pending entry, sends `[crdtJoinRef, ref, crdtTopic, event, payload]`.
- Ref-match block inserted at the very top of the `event === "phx_reply"` branch in `handleMessage`, before the heartbeat-clear / topic cascade. Guards `ref !== null` before the `Map.get` (destructured `ref` is `string | null`, `pendingReplies` is keyed `string`) — that guard wasn't in the brief's snippet but is required for TS strictness. Resolves with `response` on `status: "ok"`, rejects with `Error("request failed: " + JSON.stringify(response))` on anything else, and always returns early so a matched reply never falls through to the join-ack/join-error logging beneath it.
- `disconnect()` now clears + rejects every pending entry with `Error("channel disconnected")` before clearing the map, inserted right after the `ws.close()` block.

`tests/channel-crdt.test.ts`:
- Added `joinedCrdtChannel()` helper (didn't exist yet) — news up a `NoteChannel`, `connect()`s, `simulateOpen`s, and acks all three joins (`sync:u1:v1`, `user:u1`, `crdt:u1:v1`) with `status: "ok"` replies keyed on refs `"1"`/`"2"`/`"3"`. Returns `{ channel, ws }`.
- Added `describe("NoteChannel.sendRequest", ...)` with the two tests exactly as specified in the brief (resolve-on-ok-reply, reject-on-error-reply with `/not_found/` message match).

## Real structure vs. the brief's assumptions

Everything the brief cited matched the real file closely — no material drift:
- `private ref = 0;` at line 104 (brief said ~104) — pendingReplies inserted right after, as directed.
- `sendCrdt` body ends at line 323 (brief said ~323) — `sendRequest` inserted right after it, before `connect()`.
- `disconnect()` starts at line 332 (brief said ~332).
- `event === "phx_reply"` branch starts at line 693 (brief said ~693).
- `crdtJoined`, `crdtTopic`, `crdtJoinRef` all exist under those exact names, as assumed.

One addition beyond the brief's snippet: the `ref !== null` null-guard before `this.pendingReplies.get(ref)`, needed because `ref` (destructured from the incoming frame) is typed `string | null` while `pendingReplies` is `Map<string, ...>` — `tsc --noEmit` would otherwise flag the `Map.get` call. Behaviorally inert (a `null` ref never matches a map key anyway).

No helper existed for joining all three topics with acks (`joinedCrdtChannel`), so it was added per the brief's fallback instruction, mirroring the ack shape used elsewhere in the file (`{status:"ok", response:{}}` on the three topics).

## TDD evidence

RED (before implementation):
```
TypeError: channel.sendRequest is not a function. (In 'channel.sendRequest("crdt_catchup_heads", {})', 'channel.sendRequest' is undefined)
(fail) NoteChannel.sendRequest > sendRequest resolves on the matching phx_reply ref [2.00ms]
(fail) NoteChannel.sendRequest > sendRequest rejects on an error reply [1.00ms]
 37 pass
 2 fail
```

GREEN (after implementation):
```
 39 pass
 0 fail
 71 expect() calls
Ran 39 tests across 1 file. [162.00ms]
```

Also ran `npx tsc --noEmit -p .` and confirmed zero errors attributed to `src/channel.ts` or `tests/channel-crdt.test.ts` (full-repo typecheck, filtered to those two files — deferred full lint/build to Task 7 per instructions).

## Files changed

- `src/channel.ts` — `pendingReplies` field, `sendRequest` method, phx_reply ref-match block, disconnect() rejection loop.
- `tests/channel-crdt.test.ts` — `joinedCrdtChannel()` helper + `NoteChannel.sendRequest` describe block (2 tests).

## Self-review

- `sendRequest` reuses the existing `crdtJoinRef`/`crdtTopic`/`crdtJoined` gate identically to `sendCrdt` — consistent refusal semantics (rejects rather than `sendCrdt`'s `return false`, since callers need a promise to await either way).
- Timer is always cleared on both the reply path and the disconnect path — no leaked `setTimeout` handles.
- The ref-match check returns unconditionally on a match, so a `sendRequest` reply can never be misinterpreted as a join ack even if a caller somehow reused a topic-adjacent ref shape (Phoenix refs are a monotonic counter shared across sync/user/crdt/request frames, so no collision is possible in practice).
- Did not touch `sendCrdt`, join logic, or any other reply-handling branch — purely additive per the task's "no existing behavior changes" scope.

## Concerns

None blocking. One note for Task 2 implementers: `sendRequest`'s refusal path (`crdt topic not joined`) matches `sendCrdt`'s gate exactly, so any caller wiring the four socket-frame senders can rely on identical join-state semantics between fire-and-forget (`sendCrdt`) and await-reply (`sendRequest`) sends.

---

**Note:** this file previously contained a report for an unrelated Task 1 (a different plan revision, "Handshake-gated seeding (audit P0-1)", commit d6d4492). Overwritten here per this task's explicit instruction to write the Task 1 (channel request/reply plumbing) report to this path.
