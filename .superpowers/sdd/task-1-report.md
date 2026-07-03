# Task 1 Report: Handshake-gated seeding (audit P0-1)

## Status: DONE

**Commit:** d6d4492  
**Branch:** fix/crdt-client-hardening  
**Test summary:** 1402 pass, 1 skip (pre-existing), 0 fail across 1403 tests

---

## What was done

### New file: tests/crdt/seed-gate.test.ts (8 tests)

Failing tests written first (Step 1), verified failure against the old implementation (Step 2), then made green by the implementation (Step 3).

Tests cover:
1. `decline before markSynced` — applyLocalEdit returns false; Y.Text stays empty
2. `seed after markSynced when doc is still empty` — returns true; text seeded
3. `diff into populated doc without markSynced` — non-empty doc bypasses gate; returns true
4. `markSynced / isSynced round-trip` — public API symmetry
5. `closeDoc clears the synced mark` — lifecycle cleanup
6. `destroy clears all synced marks` — lifecycle cleanup
7. `hasLca=true bypasses gate` — explicit LCA flag skips the empty-doc gate, diff path runs
8. `declining is side-effect-free` — no onUpdate calls, no Y.Text mutation, no frontmatter write

---

## Implementation changes

### src/crdt/manager.ts

- Added `private readonly synced = new Set<string>()` keyed by docId
- Added `markSynced(path): void` — public, idempotent
- Added `isSynced(path): boolean` — public
- Changed `applyLocalEdit` return type: `Promise<void>` → `Promise<boolean>`
- Added handshake gate at the top of `applyLocalEdit`: if `e.text.length === 0 && !lca && !this.isSynced(path)`, return `false` without touching doc (side-effect-free)
- `closeDoc` now calls `this.synced.delete(id)` before returning
- `destroy` now calls `this.synced.clear()` after all docs are torn down

### src/crdt/channel.ts

- `handleFrame` calls `this.mgr.markSynced(path)` after `readSyncMessage` returns
- Rationale documented in JSDoc: marking on ANY inbound sync frame (not just STEP2) is correct — each proves the server room is live; y-protocols doesn't expose sub-type externally without re-decoding

### src/sync.ts

- `routeModify`: updated crdt type from `Promise<void>` to `Promise<boolean>`; replaced `await crdt.applyLocalEdit(...); return true` with `return await crdt.applyLocalEdit(...)`
- `reconcileColdStart`: updated crdt type for `applyLocalEdit` to `Promise<boolean | void>` so callers passing a real `CrdtManager` compile correctly; return value is intentionally ignored
- `pushFile`: added enroll on DECLINED markdown path (after the `if (consumed)` early-return block) so the STEP1 handshake kicks off even when seeding was declined; guarded by `file.extension === "md"` (mirrors existing md gate in CrdtEnrollment.enroll)

---

## Sanctioned test updates

All of these change the old unconditional-seed behavior, which IS the bug. Justified case-by-case:

### tests/crdt/manager.test.ts (12 calls)

| Test | Change | Justification |
|------|--------|---------------|
| "applyLocalEdit seeds a fresh doc once then diffs subsequent edits" | `markSynced("note.md")` before first call | Tests seed→diff path; markSynced reflects new invariant without changing what's verified |
| "local edits emit a v1 update via onUpdate" | `markSynced("note.md")` before seed | Without it, applyLocalEdit declines and emits no update; test would fail on `captured.length > 0` |
| "applyRemoteUpdate flushes merged text to disk" | `markSynced("note.md")` before seed | Seeds local base before building remote update; declining would leave doc empty |
| "state persists to IndexedDB across a manager restart" | `markSynced("note.md")` before seed | Tests IDB rehydration; needs content to persist |
| "persist errors surface via onPersistError" | `markSynced("n.md")` before seed | Verifies in-memory state intact despite IDB error |
| "flattenIfBloated does NOT flatten large single-author doc" | `markSynced("n.md")` before seed | Tests flatten AND gate — needs content to measure |
| "applyLocalEdit splits frontmatter into Y.Map, body into Y.Text" | `markSynced("N.md")` | Tests frontmatter codec routing |
| "malformed frontmatter keeps whole text as body" | `markSynced("N.md")` | Tests malformed-fm fallback |
| "flush reconstructs full file from Y.Map + body" (Task 8) | `markSynced("N.md")` | Seeds local state to build remote delta |
| "flattenIfBloated preserves frontmatter across flatten reset" | `markSynced("n.md")` | Seeds frontmatter before building bloat |
| "projectedText returns full file for a frontmatter note" | `markSynced("fm.md")` | Tests projectedText output |
| "projectedText returns body-only for a plain note" | `markSynced("plain.md")` | Tests projectedText body-only case |

### tests/crdt/channel.test.ts (2 locations)

- "step1 handshake transfers state to a fresh peer": `mgrA.markSynced("note.md")` before seeding A — A is the originator with known content; the test verifies B pulls it via STEP2
- "concurrent edits on both peers converge": `mgrA.markSynced("note.md")` and `mgrB.markSynced("note.md")` — both sides seed a shared base independently before making concurrent edits

### tests/crdt/integration.test.ts (1 location)

- Assertion 1 seed: `mgrA.markSynced("n.md")` before `applyLocalEdit("n.md", "genesis", false)` — A is the origin device; in a real flow its markSynced fires from its own STEP2; here we mark directly. B gets marked naturally via `handleFrame` → `markSynced`

### tests/sync-crdt-route.test.ts (4 locations)

- `routeModify` "markdown routes to CRDT": `mock(async () => {})` → `mock(async () => true)` — routeModify now forwards applyLocalEdit's boolean; void/undefined is falsy → result would be false
- SyncEngine "markdown modify calls applyLocalEdit, NOT pushNote": same fix
- SyncEngine ".md modify still routes through CRDT": same fix
- SyncEngine "binary modify" and "oversized" tests: unchanged (applyLocalEdit not called)

### tests/sync-crdt-gate.test.ts (3 locations)

- I1 re-setup test `newApplyLocalEdit`: `mock(async () => {})` → `mock(async () => true)` — test asserts `pushNote` not called when new CRDT manager is wired
- I2 "CRDT manager set, markdown pushNote is skipped": same fix
- Graceful degradation "after onCrdtJoined, CRDT path active": same fix

---

## Design choices

**Why mark on ANY inbound frame, not just STEP2?**  
`y-protocols/sync.readSyncMessage` applies the frame to the doc and writes a reply if the inbound was a STEP1 (i.e., our reply STEP2 to the remote's STEP1). It does not expose the sub-type. Re-decoding would require peeking a second varint, which is fragile. The semantics are correct: any inbound sync frame proves the server room is active and has started delivering its state; an empty doc after this is a genuine server-empty note.

**Why `boolean | void` in reconcileColdStart?**  
The mock-based reconcileColdStart tests predate this task and pass `applyLocalEdit: async () => {}` (returns void). Widening to `boolean | void` keeps backward compat for all callers that pass a real `CrdtManager` (returns `boolean`) or a legacy mock (returns `void`).

**Declined = enroll anyway (pushFile)**  
The brief specifies: "DECLINED md → ALSO enroll (kick off the handshake) then fall through to legacy push." This is the correct convergence path: the legacy push sends the content via REST; the backend (PR #846) merges it into the server CRDT doc; the resulting lineage arrives via the eventual STEP2, which marks the path synced and enables future CRDT routing.

---

## Review Findings Fixed (follow-up pass)

**Commit:** cb98094  
**Test summary:** 1406 pass, 1 skip (pre-existing), 0 fail across 1407 tests

### Finding 1+2: stale-marks-across-reconnect + new-note dual-write race

**Root cause:** `handleFrame` marked a path synced after ANY applied inbound frame, including an empty STEP2. This opened two races:
- (i) A stale mark surviving reconnect while another device filled the note — the next `applyLocalEdit` believed the handshake had completed and seeded a second local lineage.
- (ii) The decline→legacy-POST flow racing its own empty STEP2 — the empty mark caused the next save to route through CRDT on top of the REST-merged server doc.

**Fix (channel.ts — handleFrame):** Changed the marking rule: mark synced ONLY when `(await this.mgr.getText(path)).length > 0` after applying the frame. An empty STEP2 integrates zero ops, text stays length 0, and the guard declines to mark. The JSDoc now explains the full rationale including why an empty STEP2 IS delivered but harmlessly integrates nothing.

**Fix (manager.ts — clearSynced):** Added `clearSynced(): void` that clears the entire synced set. Called from `src/main.ts` in the disconnect `else` branch (next to `setCrdtManager(null)`). Comment: a mark means "doc reflected server state at some past connection" — a disconnect invalidates that.

**Reviewer's model verified in code:** An empty STEP2 fires `readSyncMessage` which applies zero ops to the doc. No `doc.on("update")` fires (the yjs update observer only fires when the doc state actually changes). Therefore no `onFlushToDisk` call and no file creation — the text stays at length 0, confirming the guard fires correctly.

**Existing test behavior:** The old test in `tests/crdt/channel.test.ts` that called `mgrA.markSynced("note.md")` before seeding A still correctly models the production flow (the originator device gets its synced mark from its OWN STEP2 reply, which has content). No test previously asserted the racy empty-STEP2 marking behavior, so no existing tests required updating for findings 1+2.

### Finding 3: oversized-note enroll in declined branch

**Root cause:** The declined-branch enroll (line ~1099) fired unconditionally for all `.md` files regardless of size. Enrolling a >4 MB note elicits a STEP2 encoding the full doc history (~+33% base64), which can exceed Bandit's 8 MB WebSocket frame limit (1009 close) and — because the bloated IDB doc persists — re-crashes on every reconnect.

**Fix (sync.ts — pushFile declined branch):** Wrapped the enroll call in a size gate: `new TextEncoder().encode(content).length <= MAX_CRDT_NOTE_BYTES`. Only small notes enroll on decline; oversized notes fall through to legacy push with no enrollment.

### Finding 4: new tests

**4a (tests/sync-crdt-route.test.ts — new describe block "SyncEngine declined CRDT path"):**
- `"declined md fires legacy pushNote AND enroll for a small file"` — `applyLocalEdit` returns false, `cachedRead` returns "body" (small); asserts `api.pushNote` called once AND `enroll` called with "note.md".
- `"declined md does NOT enroll for a >MAX_CRDT_NOTE_BYTES file"` — `cachedRead` returns 5 MB string; asserts `api.pushNote` called once AND `enroll` NOT called. Includes an inline `expect(...).toBeGreaterThan(MAX_CRDT_NOTE_BYTES)` to prove the fixture actually exceeds the cap.

**4b (tests/crdt/channel.test.ts — two new tests before the concurrent-edits test):**
- `"handleFrame: inbound frame that populates the doc marks isSynced true"` — A seeds content, B runs `startSync` (STEP1), A replies STEP2 with content, B's `handleFrame` fires. After flush, `mgrB.isSynced("note.md")` is true (red before fix; green after).
- `"handleFrame: inbound frame that leaves the doc empty does NOT mark isSynced"` — both peers start empty, B runs `startSync`, A's empty STEP2 applies. After flush, `mgrB.isSynced("note.md")` is false (was true before fix = the bug; false after fix = correct). This is the core regression test for finding 1+2.

### Minor cleanups applied

- **manager.ts synced-set JSDoc** — replaced `"Cleared by closeDoc, removeDoc, and destroy"` with `"Cleared by closeDoc, clearSynced, and destroy"` (removeDoc doesn't exist; added parenthetical forward-looking note).
- **channel.ts markSynced JSDoc** — rewrote entirely to describe the non-empty-only rule and the two races it closes.
- **sync.ts materializeEmptyDiscovered JSDoc** — replaced the false claim `"server suppresses zero-length STEP2 (length > 1 gate)"` with the true rationale: an empty STEP2 IS delivered, integrates no ops, fires no doc-update event, and therefore creates no file. The announce is the only evidence.
