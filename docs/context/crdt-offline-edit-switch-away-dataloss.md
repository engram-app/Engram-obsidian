# Context Doc: CRDT offline edit lost after switching away from the note

_Last verified: 2026-07-24_

## Status
Fixed (branch `fix/crdt-offline-edit-lost-on-rejoin`, commit `ed9dfb5`)

## Symptom
In Obsidian, moving between files and making edits - only *some* edits reach the server. Prod Loki tripwire (`metadata_category=client`):

```
[client:channel] sendCrdt refused (crdt topic not joined): joined=false
```

Always preceded by `heartbeat unanswered - closing dead socket` or `net::ERR_NETWORK_CHANGED` - i.e. the socket died, an edit was typed during the dead window, then dropped.

## Root Cause
An edit typed while the CRDT socket is down is refused by `channel.sendCrdt` (`src/channel.ts:351`, gates on the vault-wide `crdtJoined` flag, which is `false` whenever the socket is closed) and dropped. `crdtJoined` is a SINGLE vault-wide flag (topic `crdt:{user}:{vault}`), not per-doc.

The rejoin recovery `reEnrollOpenCrdtNotes` (`src/main.ts:1625`) only re-enrolls notes still open in an editor leaf. So an edit made to a note, then SWITCHED AWAY FROM (editor closed) before the socket reconnects, is never re-solicited by the mutual STEP1 handshake - it is stranded on local disk, never reaching the server.

#299's recovery only covered still-OPEN notes; this is the **switch-away gap**.

## Recovery mechanism (why re-enroll is what matters)
Offline-edit recovery rides the mutual handshake. On rejoin: re-enroll → `startSync` (`src/crdt/channel.ts:68`, does `mgr.getDoc` which reopens the doc from IndexedDB) → STEP1 → the faithful backend answers with its OWN STEP1 (`[step2, step1]`) → client replies STEP2 carrying the held struct → converges. The **re-enroll is the trigger**; a note with no open leaf never gets re-enrolled, so its held struct is never solicited.

## False-diagnosis trap (the important lesson)
An earlier repro ran against a checkout **9 commits behind origin/main** and "reproduced" the bug even for STILL-OPEN notes. That was a SIM-INFIDELITY artifact: the model server was pull-only and never solicited the held struct - the same infidelity that had originally mis-filed #299 as a real *backend* bug. The real backend was never pull-only; only the test double was.

**Lesson:** verify repros against CURRENT `origin/main`, not a stale shared checkout. The plugin's shared checkout at `code-projects/engram-obsidian-sync` is often parked in detached HEAD behind `origin/main` - do real work in a worktree off `origin/main`.

## The Fix
- Track docIds whose `sendCrdt` was refused while unjoined - a `Set` in the shared send wrapper (`src/crdt/wiring.ts:302`).
- Expose `reEnrollUnsent()` (`src/crdt/wiring.ts:444`).
- Call it on the `crdt:` rejoin (`src/main.ts` `onCrdtTopicJoined` at 1653, after `reEnrollOpenCrdtNotes`; the call is at `src/main.ts:1693`). Mirrored in the sim at `tests/sim/replica.ts:608` (`onCrdtTopicJoined`).
- Differential sim gate: `tests/sim/scenarios.ts:255` `offlineEditSwitchAwayRecovers` + `tests/sim/regressions.test.ts:121` "#299b". Asserts the edit reaches the **SERVER** (server row content), NOT `assertConverged` - a revert-on-reconnect would false-green a convergence check.

## Secondary findings (follow-ups, NOT fixed here)
- **Lag on file switch:** `crdtLiveViews.refresh()` (`src/crdt/live/live-views.ts:201`) fires 2–3× per open (active-leaf-change + file-open + layout-change handlers in `main.ts`), and re-binds ALL open leaves each time (O(open-leaves)); plus `healNoteOnOpen` (`src/main.ts:1382`) runs per open. This PR only coalesced the same-microtask duplicate refresh. Scoping the rebind to the focused leaf + healNoteOnOpen-per-open are deferred (need real-app profiling).
- **Log noise:** the biggest Loki bloat is the full mTLS client cert (~5KB) attached to every shipped client log by the backend `Engram.Logs` re-emit - a BACKEND (engram repo) fix, not the plugin.

## References
- `src/channel.ts:351` - `sendCrdt` gate on `crdtJoined`
- `src/crdt/wiring.ts:302,444` - refused-doc Set + `reEnrollUnsent`
- `src/main.ts:1625,1653,1693` - `reEnrollOpenCrdtNotes`, `onCrdtTopicJoined`, `reEnrollUnsent` call
- `src/crdt/channel.ts:68` - `startSync` (reopens doc from IndexedDB, sends STEP1)
- `tests/sim/scenarios.ts:255`, `tests/sim/regressions.test.ts:121`, `tests/sim/replica.ts:608` - #299b gate
