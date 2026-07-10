# CRDT-Ops Phase 2b Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the silent-data-loss defects a code review found in the Phase-2 channel-down CRDT delivery path (PR engram-obsidian#226, now draft), by rebuilding that delivery on a **durable, noteId-keyed, `/updates`-ops** footing that reuses the existing `OfflineQueue` for unload-survival + retry, and correcting capability detection.

**Architecture:** Retire the fragile in-memory debounce (`scheduleCrdtFlush`/`crdtFlushTimers`/`flushCrdtState`). A channel-down edit on a CRDT-managed note (a) seeds the note's Y.Doc from disk (via `routeModify`, keyed by noteId, as `pushFile` already does), then (b) enqueues a **durable** content-free queue entry tagged `crdt:true` + `noteId`. `runFlushQueue` — which already persists across unload, retries, and single-flights — delivers a `crdt` entry by encoding the note's Y.Doc **by noteId** and POSTing it to `/api/notes/:id/updates` when ops are available, falling back to the legacy whole-doc push (with the stale `serverHash` cleared) when they are not. Capability is determined **solely by the `getVaultHeads` probe**, gated on the probe having completed (`crdtOpsProbed`); a per-note 404 from `postUpdate` means "that note is gone," never "endpoint missing."

**Tech Stack:** TypeScript, Yjs, Bun test runner (`bun test`; import from `bun:test`). Backend Phase 1 endpoints live. Branch `feat/crdt-ops-single-authority` (continues PR #226).

## Global Constraints

- **Single-authority preserved offline:** a CRDT-managed note with ops available is delivered via `/updates` ops, never the whole-doc `base_hash` push. Legacy is the fallback ONLY when ops are unavailable (old backend) or the note is non-CRDT/oversized.
- **Durable, no silent loss:** every channel-down CRDT edit is persisted (survives plugin unload) and retried until delivered or explicitly resolved. No path may report "done/complete" for an edit that is only scheduled and not yet delivered.
- **Encode by noteId, always.** The manager keys docs by noteId (`docId(noteId){return noteId}`). Any `encodeStateAsUpdate` for delivery MUST pass `noteId`, never `path`. Tests for delivery MUST exercise a **real** `CrdtManager` round-trip (seed → encode → apply on a second doc → assert content), never a mocked `encodeStateAsUpdate`.
- **Capability = probe only.** `crdtOpsAvailable()` is `enableCrdt && crdtOpsProbed && !crdtOpsUnsupported`. `crdtOpsUnsupported` latches ONLY from `probeCrdtOps` (a `getVaultHeads` 404/405). A per-note `postUpdate` 404 is handled as "note gone" (drop the entry), not a capability signal.
- **Reconnect is NOT a delivery backstop** for seeded-but-closed notes (verified: reconnect only re-enrolls open editor leaves). Durability must come from the persisted queue, not from assuming reconnect redelivers.
- Bun test; plugin version already bumped this PR (1.12.7) — do NOT bump again. Signed commits (`git commit -S`). Before finalize: `bun test`, `bun run lint:obsidian`, `bun run lint:css`, `./node_modules/.bin/biome ci src tests`, `bun run build`. No em dashes.

---

### Task 1: `QueueEntry` gains `noteId` + `crdt` tag

**Files:**
- Modify: `src/types.ts:245` (`QueueEntry`)
- Test: `tests/offline-queue.test.ts`

**Interfaces:**
- Produces: `QueueEntry` with two optional fields: `noteId?: string`, `crdt?: boolean`.

- [ ] **Step 1: Write the failing test**

In `tests/offline-queue.test.ts`, add a test that enqueues an entry carrying `noteId` + `crdt: true` and asserts they round-trip through persist/load:

```typescript
test("QueueEntry preserves noteId + crdt tag through persist/load", async () => {
  const q = new OfflineQueue(0);
  let saved: QueueEntry[] = [];
  q.onPersist(async (e) => { saved = e; });
  await q.enqueue({ path: "A.md", action: "upsert", noteId: "id-1", crdt: true, timestamp: 1, vaultId: "v" });
  const q2 = new OfflineQueue(0);
  q2.load(saved);
  const [e] = q2.all();
  expect(e.noteId).toBe("id-1");
  expect(e.crdt).toBe(true);
});
```

Match the file's real `OfflineQueue` construction/import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/offline-queue.test.ts`
Expected: FAIL — `noteId`/`crdt` not on `QueueEntry` (TS won't gate at runtime, but the assertion on `e.crdt` fails because the field is stripped/undefined only if load drops unknown keys; if it passes trivially, tighten the test to assert the type — see Step 3 note).

- [ ] **Step 3: Write minimal implementation**

In `src/types.ts` `QueueEntry`:

```typescript
export interface QueueEntry {
	path: string;
	action: "upsert" | "delete";
	content?: string;
	contentBase64?: string;
	mimeType?: string;
	mtime?: number;
	timestamp: number;
	kind?: "note" | "attachment";
	vaultId?: string;
	/** Set on a channel-down CRDT edit: deliver via /updates ops (encode the
	 *  note's Y.Doc by noteId), falling back to the legacy push only when ops
	 *  are unavailable. */
	noteId?: string;
	crdt?: boolean;
}
```

(If `OfflineQueue.load`/persist deep-copies via a field allowlist rather than the whole object, extend it to carry `noteId`/`crdt`; confirm by reading `src/offline-queue.ts` persist/load.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/offline-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/offline-queue.ts tests/offline-queue.test.ts
git commit -S -m "feat(crdt): QueueEntry carries noteId + crdt tag for durable ops flush"
```

---

### Task 2: `runFlushQueue` delivers a `crdt` entry via noteId-keyed `/updates` ops (fixes the key bug, per-note 404, ops-to-legacy 409)

**Files:**
- Modify: `src/sync.ts` — `runFlushQueue` note-upsert branch (~`5464-5643`)
- Test: `tests/sync-crdt-ops.test.ts` (real-manager round-trip)

**Interfaces:**
- Consumes: `CrdtManager.encodeStateAsUpdate(noteId, sv?) :: Promise<Uint8Array>` (`src/crdt/manager.ts:273`); `EngramApi.postUpdate(noteId, update)` (`src/api.ts:397`); `crdtOpsAvailable()` (Task 4); `this.syncState`.
- Produces: within `runFlushQueue`, a per-entry branch: when `entry.crdt && entry.noteId && this.crdtOpsAvailable()` → encode the Y.Doc **by `entry.noteId`** and `postUpdate`; on success dequeue + record syncState. On a `postUpdate` per-note 404/410 → the note is gone: dequeue and drop (do NOT latch capability). When `!crdtOpsAvailable()` (ops unavailable) → clear the stale `serverHash` for the path (`this.syncState.set(normalizePath(entry.path), {...existing, serverHash: undefined})`) then fall through to the existing legacy note-upsert push (avoids the ops-to-legacy 409).

- [ ] **Step 1: Write the failing test**

In `tests/sync-crdt-ops.test.ts`, add a REAL-manager round-trip (do NOT mock `encodeStateAsUpdate`):

```typescript
test("durable crdt queue entry delivers the SEEDED note content via postUpdate (noteId-keyed)", async () => {
  // Build a real CrdtManager, seed a note's Y.Doc by noteId, enqueue a crdt entry,
  // and assert postUpdate receives an update that, applied to a fresh doc, reproduces the edit.
  const posted: { noteId: string; update: Uint8Array }[] = [];
  const api = { postUpdate: async (noteId: string, update: Uint8Array) => { posted.push({ noteId, update }); return { head: "h" }; }, pushNote: async () => { throw new Error("must not legacy-push a crdt entry when ops available"); } };
  const engine = engineWithRealManager({ enableCrdt: true, api }); // helper: constructs SyncEngine with a real CrdtManager (see tests/crdt-cm-yjs-bridge.test.ts for real-manager setup)
  engine.markCrdtOpsProbedForTest(); // ops probed+available
  await engine.crdtManagerForTest().applyLocalEdit("id-1", "# T\n\nseeded body");
  await engine.enqueueChange({ path: "T.md", action: "upsert", noteId: "id-1", crdt: true, timestamp: 1, vaultId: "v" });
  await engine.flushQueue();
  expect(posted.length).toBe(1);
  expect(posted[0].noteId).toBe("id-1");
  const reader = new Y.Doc(); // apply the delivered update; body must reproduce
  Y.applyUpdate(reader, posted[0].update);
  expect(reader.getText("content").toString()).toContain("seeded body");
});
```

Adapt the real-manager construction to how `tests/crdt-cm-yjs-bridge.test.ts` / `tests/channel-crdt.test.ts` build a `CrdtManager`. If `SyncEngine` needs small test seams (`crdtManagerForTest()`, `markCrdtOpsProbedForTest()`), add them narrowly. The load-bearing assertion is that the delivered update reproduces the SEEDED content — this is exactly what a path/noteId key bug or an unseeded doc would fail.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — no crdt-entry branch in `runFlushQueue` yet (entry delivered via legacy `pushNote`, which throws in the mock; or `postUpdate` never called).

- [ ] **Step 3: Write minimal implementation**

In `runFlushQueue`'s note-upsert branch (`src/sync.ts` ~`5507`), before the existing legacy `pushNote` path, add:

```typescript
// Durable CRDT delivery: a channel-down CRDT edit persisted a crdt-tagged
// entry. Deliver via noteId-keyed /updates ops when available; the Y.Doc is
// durable in IndexedDB so re-encoding on retry is lossless.
if (entry.crdt && entry.noteId && this.crdt && this.crdtOpsAvailable()) {
	try {
		const update = await this.crdt.encodeStateAsUpdate(entry.noteId);
		await this.api.postUpdate(entry.noteId, update);
		await this.queue.dequeue(entry.path, entry.vaultId);
		flushed++;
		continue;
	} catch (e) {
		const status = (e as { status?: number })?.status;
		if (status === 404 || status === 410) {
			// Per-note: the note is gone server-side. Drop the entry; this is
			// NOT a capability signal (capability comes only from the probe).
			await this.queue.dequeue(entry.path, entry.vaultId);
			this.issues.clear(entry.path);
			flushed++;
			continue;
		}
		this.maybeGoOffline(e); // transient: retry next flush
		break;
	}
}

if (entry.crdt && !this.crdtOpsAvailable()) {
	// Ops unavailable (old backend / probe latched off): fall back to the
	// legacy whole-doc push. Clear the stale serverHash first — prior CRDT-ops
	// flushes advanced the server body without recording a new serverHash, so
	// the old CAS base would 409. A no-base push overwrites deliberately.
	const key = normalizePath(entry.path);
	const existing = this.syncState.get(key);
	if (existing?.serverHash !== undefined) {
		this.syncState.set(key, { ...existing, serverHash: undefined });
	}
	// fall through to the existing legacy note-upsert push below
}
```

Confirm the surrounding loop variable names (`entry`, `flushed`, `this.issues`, `dequeue` signature) against the real `runFlushQueue`; match them exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts tests/sync.test.ts`
Expected: PASS (the round-trip reproduces the seeded body; existing flush-queue tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts
git commit -S -m "feat(crdt): durable /updates delivery in flush queue (noteId-keyed, per-note-404 safe)"
```

---

### Task 3: Route channel-down CRDT edits to the durable queue; retire the in-memory flush (fixes batch-unseeded, batch false-done, no-retry, unload-loss)

**Files:**
- Modify: `src/sync.ts` — `pushFile` channel-down branch (`~1777-1824`), `pushNotesViaBatch` branch (`~4562-4572`), remove `scheduleCrdtFlush`/`flushCrdtState`/`crdtFlushTimers` (`~4262`, `~4300`, `~4301`) and their `destroy()` sweep (`~5662`)
- Test: `tests/sync-crdt-ops.test.ts`

**Interfaces:**
- Consumes: `routeModify` (seed), `enqueueChange` (durable), `flushQueue` (deliver), `isCrdtManagedOffline`, `crdtOpsAvailable`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/sync-crdt-ops.test.ts`:

```typescript
test("channel-down CRDT edit (pushFile) SEEDS then enqueues a durable crdt entry (no in-memory-only timer)", async () => {
  const enq: QueueEntry[] = [];
  const engine = engineWithRealManager({ enableCrdt: true, api: { postUpdate: async () => ({ head: "h" }) } });
  engine.markCrdtOpsProbedForTest();
  engine.setCrdtLiveCheck(() => false); // channel down
  engine.confirmNoteId("T.md", "id-1");
  engine.onEnqueueForTest((e) => enq.push(e)); // narrow test hook, or assert via queue.all()
  await engine.pushFile(makeTFile("T.md"));
  const e = enq.find((x) => x.path === "T.md");
  expect(e?.crdt).toBe(true);
  expect(e?.noteId).toBe("id-1");
  // and the manager was seeded (encode reproduces content) — reuse Task 2's round-trip on queue flush
});

test("batch channel-down CRDT note is SEEDED + enqueued durably, NOT logged as a completed skip", async () => {
  // Drive pushNotesViaBatch with a channel-down CRDT note; assert a durable crdt
  // entry exists for it and it is not counted as an in-band 'done/skipped' success.
});
```

Adapt to the batch harness in `tests/sync-crdt-route.test.ts`. The batch test's load-bearing point: the note is seeded (so a subsequent flush delivers real content) AND persisted (a queue entry exists), NOT merely marked skipped.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — current code schedules an in-memory flush (no queue entry) and the batch logs a skip without seeding.

- [ ] **Step 3: Write the implementation**

- In `pushFile`'s channel-down branch: after `routeModify` seeds (`~1784`), replace `this.scheduleCrdtFlush(file.path, noteId); return true;` (`~1814`) with a durable enqueue + a triggered flush:

```typescript
if (!crdtLiveNow) {
	await this.enqueueChange({
		path: file.path, action: "upsert", noteId, crdt: true,
		mtime: file.stat.mtime / 1000, timestamp: Date.now(),
		kind: "note", vaultId: this.settings.vaultId ?? undefined,
	});
	void this.flushQueue(); // deliver now if REST is up; durable + retried otherwise
	return true;
}
```

(`crdtLiveNow` comes from Task 5's post-await re-check.)

- In `pushNotesViaBatch`'s channel-down branch (`~4562`): SEED first (mirror pushFile), then enqueue durably instead of logging a completed skip:

```typescript
if (file.stat.size <= MAX_CRDT_NOTE_BYTES && noteId && this.crdtOpsAvailable() && this.isCrdtManagedOffline(file.path, noteId)) {
	const content = await this.app.vault.cachedRead(file);
	await routeModify({ isMarkdown: file.extension === "md", noteId, readContent: async () => content }, this.crdt, MAX_CRDT_NOTE_BYTES);
	await this.enqueueChange({ path: file.path, action: "upsert", noteId, crdt: true, mtime: file.stat.mtime / 1000, timestamp: Date.now(), kind: "note", vaultId: this.settings.vaultId ?? undefined });
	this.logEntry("queue", file.path, "queued", undefined, "crdt-offline");
	continue; // durably queued, not falsely 'done'
}
```

Confirm `logEntry`'s signature + the outcome vocabulary (use a non-success outcome like "queued" if the enum supports it; else keep "skip" but ensure the Sync Center does not report it as delivered — check how the batch tallies `done`/`skipped`). Do NOT increment a "delivered" counter for a queued entry.

- Remove `scheduleCrdtFlush` (`~4262`), `flushCrdtState` (`~4300`), the `crdtFlushTimers` field (`~4301`), and their `destroy()` sweep (`~5662`). Grep for any remaining callers and remove/redirect them. (The Task-4/6 tests that referenced `flushCrdtState`/`scheduleCrdtFlush` directly must be updated to the queue-based flow, asserting the durable entry + delivery — not deleted.)

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/sync-crdt-ops.test.ts tests/sync-crdt-route.test.ts tests/sync-crdt-gate.test.ts tests/offline-queue.test.ts`
Expected: PASS. Any test that asserted the old in-memory-timer behavior is rewritten to the durable-queue behavior (a real assertion of delivery/persistence, never loosened to pass).

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts
git commit -S -m "feat(crdt): route channel-down CRDT edits through the durable queue; retire in-memory flush"
```

---

### Task 4: Capability = probe-only + `crdtOpsProbed` gate

**Files:**
- Modify: `src/sync.ts` — `crdtOpsAvailable` (`~4290`), `probeCrdtOps` (`~1030`), add `crdtOpsProbed`
- Test: `tests/sync-crdt-ops.test.ts`

**Interfaces:**
- Produces: `private crdtOpsProbed = false`; `crdtOpsAvailable()` returns `enableCrdt === true && this.crdtOpsProbed && !this.crdtOpsUnsupported`; `probeCrdtOps` sets `crdtOpsProbed = true` in a `finally`.

- [ ] **Step 1: Write the failing test**

```typescript
test("ops are unavailable until the probe completes, then available on success", async () => {
  let resolveHeads: (v: unknown) => void;
  const api = { getVaultHeads: () => new Promise((r) => { resolveHeads = r; }) };
  const engine = engineWithRealManager({ enableCrdt: true, api });
  expect((engine as any).crdtOpsAvailable()).toBe(false); // not probed yet
  const p = engine.probeCrdtOps();
  resolveHeads!({ heads: {} });
  await p;
  expect((engine as any).crdtOpsAvailable()).toBe(true);
});

test("a getVaultHeads 404 leaves ops unavailable after probe", async () => {
  const api = { getVaultHeads: async () => { const e: any = new Error(); e.status = 404; throw e; } };
  const engine = engineWithRealManager({ enableCrdt: true, api });
  await engine.probeCrdtOps();
  expect((engine as any).crdtOpsAvailable()).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — `crdtOpsAvailable()` currently returns true before the probe (optimistic).

- [ ] **Step 3: Write the implementation**

```typescript
private crdtOpsProbed = false;

private crdtOpsAvailable(): boolean {
	return this.settings.enableCrdt === true && this.crdtOpsProbed && !this.crdtOpsUnsupported;
}

async probeCrdtOps(): Promise<void> {
	if (!this.settings.enableCrdt) return;
	try {
		await this.api.getVaultHeads();
	} catch (e) {
		const status = (e as { status?: number })?.status;
		if (status !== undefined) this.markCrdtOpsUnsupported(status);
	} finally {
		this.crdtOpsProbed = true;
	}
}
```

`markCrdtOpsUnsupported` is unchanged (still latches on 404/405) but is now called ONLY from `probeCrdtOps` (Task 2 removed the per-note-postUpdate latch). Confirm no other caller remains (grep).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: PASS. Note: pre-probe channel-down edits now take the legacy durable path (ops unavailable) — a Task-3 test should confirm an edit before the probe completes still delivers via the legacy queue path, never stranded.

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts
git commit -S -m "fix(crdt): gate ops on probe completion; capability comes only from the probe"
```

---

### Task 5: Re-check `crdtLive` after the awaited `routeModify` (fixes TOCTOU)

**Files:**
- Modify: `src/sync.ts` — `pushFile` (`~1777`, `~1811`)
- Test: `tests/sync-crdt-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("a channel drop DURING routeModify routes the edit to the durable queue, not the dead live path", async () => {
  let live = true;
  const engine = engineWithRealManager({ enableCrdt: true, api: { postUpdate: async () => ({ head: "h" }) } });
  engine.markCrdtOpsProbedForTest();
  engine.confirmNoteId("T.md", "id-1");
  engine.setCrdtLiveCheck(() => live);
  engine.onRouteModifyForTest(() => { live = false; }); // channel drops mid-seed
  await engine.pushFile(makeTFile("T.md"));
  // Because crdtLive is re-checked AFTER the await, the edit is enqueued durably.
  expect(engine.queueHasCrdtEntry("T.md")).toBe(true);
});
```

Adapt the "drop mid-seed" hook to the harness; if no seam exists, drive it by flipping the live-check between the `crdtLive` snapshot and the branch (a spy on `routeModify`).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — the stale `crdtLive=true` snapshot keeps the edit on the live path, no queue entry.

- [ ] **Step 3: Write the implementation**

In `pushFile`, keep the pre-await `crdtLive` snapshot ONLY for the branch-entry gate (`~1782` `(crdtLive || crdtOpsAvailable())`), but re-read liveness AFTER the seed to decide live-vs-flush:

```typescript
// (~1811) re-check liveness AFTER the awaited routeModify — the channel can
// drop during the seed; a stale 'live' snapshot would leave the edit on a dead
// socket with no durable delivery.
const crdtLiveNow = this.crdtLive?.() ?? true;
if (!crdtLiveNow) {
	// ... durable enqueue + flushQueue (Task 3)
	return true;
}
// else: live channel already carried the op via manager.onUpdate; return.
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts
git commit -S -m "fix(crdt): re-check crdtLive after seed to avoid a dead-socket TOCTOU strand"
```

---

### Task 6: Cleanups + finalize (predicate dedup, getUpdates, gauntlet, re-review, un-draft)

**Files:**
- Modify: `src/sync.ts` (`isCrdtManaged`), `src/api.ts` (`getUpdates` comment)

- [ ] **Step 1: Dedup the predicate**

Redefine `isCrdtManaged` (`src/sync.ts:661`) in terms of `isCrdtManagedOffline` so the shared clauses can't drift:

```typescript
private isCrdtManaged(path: string, noteId: string | null): boolean {
	return this.isCrdtManagedOffline(path, noteId) && (this.crdtLive?.() ?? true);
}
```

Keep the lazy-enrollment rationale comment. Run `bun test tests/sync-crdt-route.test.ts tests/sync-crdt-gate.test.ts` — must stay green (behavior-identical).

- [ ] **Step 2: Annotate `getUpdates` as intentional Phase-3 surface**

At `src/api.ts:406`, add a one-line doc comment: `// Phase 3 (cold-note head-index pull). Intentionally unconsumed in Phase 2/2b.` — resolves the "dead code / misleading" finding without deleting a method Phase 3 needs.

- [ ] **Step 3: Full gauntlet**

```bash
bun test            # 0 fail
bun run lint:obsidian
bun run lint:css
./node_modules/.bin/biome ci src tests
bun run build       # tsc + esbuild
```

Fix anything red. Do NOT bump the version (already 1.12.7 this PR). Do NOT stage `main.js`.

- [ ] **Step 4: Commit**

```bash
git add src/sync.ts src/api.ts
git commit -S -m "refactor(crdt): dedup isCrdtManaged; mark getUpdates as Phase-3 surface"
```

- [ ] **Step 5: Hand back for re-review**

Do NOT un-draft the PR. The controller runs a fresh workflow-backed code review of the full remediation range, then converts #226 out of draft only after it is clean and the user approves.

---

## Self-Review

**Spec coverage (the review's findings):**
- Key noteId/path bug (cross-cutting) → Task 2 (encode by noteId) + real-manager round-trip test. ✓
- [1] batch never seeds → Task 3 (batch calls routeModify before enqueue). ✓
- [2] per-note 404 latches vault-wide → Task 2 (404 = note-gone dequeue) + Task 4 (capability only from probe). ✓
- [3] probe-race strand → Task 4 (`crdtOpsProbed` gate; pre-probe edits take durable legacy path). ✓
- [4] batch false "done" → Task 3 (enqueue durably, log "queued" not delivered). ✓
- [5] no-retry + unload-loss → Task 3 (durable queue: persists across unload, retries; in-memory timer retired). ✓
- [6] crdtLive TOCTOU → Task 5 (re-check after await). ✓
- [7] legacy re-drive 409 → Task 2 (clear stale serverHash on ops-unavailable fallback). ✓
- [8] getUpdates dead → Task 6 (Phase-3 comment). ✓
- [9] isCrdtManaged dup → Task 6 (defined via isCrdtManagedOffline). ✓
- [10] N-POST burst → mitigated: delivery now flows through the single-flight `flushQueue` (one drain, sequential), not N independent debounce timers. Acceptable; if a true bulk `/updates` endpoint is wanted, that's a backend follow-up (noted, not built).

**Placeholder scan:** Test harness references (`engineWithRealManager`, `markCrdtOpsProbedForTest`, `crdtManagerForTest`, `onEnqueueForTest`, `queueHasCrdtEntry`) are named narrow test seams the implementer must add against the real `SyncEngine`/`CrdtManager` (patterns in `tests/crdt-cm-yjs-bridge.test.ts`, `tests/channel-crdt.test.ts`) — each is a "build this seam" instruction, not a placeholder. Every production code step shows the code.

**Type consistency:** `QueueEntry.noteId?/crdt?` (Task 1) consumed in `runFlushQueue` (Task 2) and set by the enqueues (Task 3). `crdtOpsAvailable()`/`crdtOpsProbed`/`crdtOpsUnsupported` consistent across Tasks 2/4. `encodeStateAsUpdate(noteId)` (not path) everywhere delivery encodes. `crdtLiveNow` (Task 5) feeds Task 3's enqueue branch.

**Testing discipline flag for the reviewer:** the original defects were hidden because delivery tests **mocked** `encodeStateAsUpdate`. Task 2's round-trip against a **real** `CrdtManager` (seed → encode → apply-on-fresh-doc → assert content) is the guard that would have caught the path/noteId bug and the unseeded-batch bug; it must not be weakened back to a mock.
