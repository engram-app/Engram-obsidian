# Phase 3a: CRDT Cold Receive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Closed (cold) CRDT notes converge in the background by pulling Yjs deltas from the server, so a note edited elsewhere is no longer stale on this device until it is next opened.

**Architecture:** A best-effort `coldReceive()` routine piggybacks the existing 5-minute pull. It reads the server CRDT head-index (`GET /api/vault/heads`), diffs each note's server head against a newly-persisted per-note `crdtHead`, and for notes whose head advanced (and that are confirmed, not live-bound, and locally mapped) pulls the delta via `GET /api/notes/:id/updates?since=<local state vector>` and applies it with `applyRemoteUpdate` (which flushes to disk echo-guarded). The persisted head is the cost gate: unchanged notes are skipped without opening their Y.Doc.

**Tech Stack:** TypeScript, Yjs, Obsidian plugin, Bun test.

## Global Constraints

- **Inert against pre-Phase-1 backends.** `coldReceive()` early-returns unless `crdtOpsAvailable()` is true (Phase 2's probe gate) and `settings.enableCrdt` is true. On an old backend `getVaultHeads` 404s and ops never latch available, so cold-receive never runs.
- **Never fight the live channel.** Skip any note where `isLiveBound(path)` is true — the live `crdt:` channel and the existing re-handshake path own open notes.
- **Cost gate is mandatory.** Never call `encodeStateVector` / `getUpdates` / open a Y.Doc for a note whose server head equals the persisted `crdtHead`. Only advanced heads pay the doc-open cost.
- **Best-effort, per-note isolated.** A failure fetching or applying one note's delta is caught, logged, and does NOT abort the loop or advance that note's `crdtHead` (it retries next poll). `coldReceive` must never throw out of `pull()`.
- **Persist head only after a successful apply.** `setCrdtHead(path, head)` runs only after `applyRemoteUpdate` resolves, so a crash mid-apply re-pulls next poll (idempotent — Yjs apply is a lattice merge).
- **No new interval.** Reuse the existing pull path. No `setInterval` / `registerInterval` added.
- The head marker from `/vault/heads` and the `head` from `/updates` are the SAME opaque namespace (`sha256(state_vector)` url-b64, per backend Phase 1). They are NOT `serverHash` (the `/changes` content_hash) — keep them in a separate field.
- **CrdtManager is keyed by `noteId`, not path.** `docId(x) = x` (identity) and every manager method (`encodeStateVector`, `applyRemoteUpdate`, `applyLocalEdit`, ...) uses its argument directly as the doc key — the parameter is *named* `path` for legacy reasons but callers pass the **noteId** (this is how Phase 2 delivery works: `encodeStateAsUpdate(entry.noteId)`). So cold-receive passes **noteId** to the manager. The vault **path** (from `pathForId`) is used ONLY for `isLiveBound(path)` and `getCrdtHead`/`setCrdtHead` (which key off `syncState`, a path map). Passing the vault path to the manager would operate on a different, empty doc and silently never converge.

---

### Task 1: Persist a per-note CRDT head

**Files:**
- Modify: `src/types.ts` (FileSyncState interface, ~line 416)
- Modify: `src/sync.ts` (add `getCrdtHead` / `setCrdtHead` helpers near `syncState` accessors)
- Test: `tests/sync-cold-receive.test.ts` (new)

**Interfaces:**
- Produces: `FileSyncState.crdtHead?: string`; `private getCrdtHead(path: string): string | undefined`; `private setCrdtHead(path: string, head: string): void` (merges into the existing `syncState` entry, preserving `hash`/`version`/`serverHash`).

- [ ] **Step 1: Write the failing tests**

Create `tests/sync-cold-receive.test.ts`. Reuse the mock-engine pattern from `tests/sync-crdt-ops.test.ts` (copy its `engine(...)`, `markProbed`, `markConfirmed` helpers and the `mockApp` fixture — or import if exported; copying is consistent with the existing test files).

```typescript
import { describe, expect, test, mock } from "bun:test";
import { SyncEngine } from "../src/sync";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { DEFAULT_SETTINGS } from "../src/settings"; // match sync-crdt-ops.test.ts import
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";

// ... copy engine(), markProbed(), markConfirmed(), mockApp from sync-crdt-ops.test.ts ...

describe("crdtHead persistence", () => {
	test("setCrdtHead merges without clobbering other FileSyncState fields", () => {
		const e = engine({ enableCrdt: true });
		e.importSyncState({ "n.md": { hash: 7, version: 3, serverHash: "sh" } });
		(e as any).setCrdtHead("n.md", "H1");
		const state = e.exportSyncState()["n.md"];
		expect(state.crdtHead).toBe("H1");
		expect(state.hash).toBe(7);
		expect(state.version).toBe(3);
		expect(state.serverHash).toBe("sh");
	});

	test("setCrdtHead creates an entry for a never-seen path", () => {
		const e = engine({ enableCrdt: true });
		(e as any).setCrdtHead("new.md", "H2");
		expect((e as any).getCrdtHead("new.md")).toBe("H2");
	});

	test("crdtHead survives export/import round-trip", () => {
		const e1 = engine({ enableCrdt: true });
		(e1 as any).setCrdtHead("n.md", "H3");
		const e2 = engine({ enableCrdt: true });
		e2.importSyncState(e1.exportSyncState());
		expect((e2 as any).getCrdtHead("n.md")).toBe("H3");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/sync-cold-receive.test.ts`
Expected: FAIL (`setCrdtHead`/`getCrdtHead` not defined).

- [ ] **Step 3: Add the field**

In `src/types.ts`, add to `FileSyncState` (after `serverHash`):

```typescript
	/** Last CRDT head marker (sha256(state_vector) url-b64) synced for this
	 *  path via cold-receive. Separate namespace from serverHash (which is the
	 *  /changes content_hash). Absent = never cold-synced. */
	crdtHead?: string;
```

- [ ] **Step 4: Add the accessors**

In `src/sync.ts`, near `importSyncState`/`exportSyncState`, add:

```typescript
	private getCrdtHead(path: string): string | undefined {
		return this.syncState.get(normalizePath(path))?.crdtHead;
	}

	private setCrdtHead(path: string, head: string): void {
		const key = normalizePath(path);
		const existing = this.syncState.get(key);
		this.syncState.set(key, { ...(existing ?? { hash: 0 }), crdtHead: head });
	}
```

(`normalizePath` is already imported in sync.ts. `exportSyncState` uses `Object.fromEntries(this.syncState)` so it already carries `crdtHead` with no change.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/sync-cold-receive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/sync.ts tests/sync-cold-receive.test.ts
git commit -S -m "feat(crdt): persist per-note crdtHead for cold-receive diffing"
```

---

### Task 2: The `coldReceive()` routine

**Files:**
- Modify: `src/sync.ts` (add `coldReceive` method)
- Test: `tests/sync-cold-receive.test.ts` (extend)

**Interfaces:**
- Consumes: `EngramApi.getVaultHeads(): Promise<{heads: Record<string,string>}>`, `EngramApi.getUpdates(noteId, since?): Promise<{update: Uint8Array; head: string}>`, `CrdtManager.encodeStateVector(path): Promise<Uint8Array>`, `CrdtManager.applyRemoteUpdate(path, update): Promise<void>`, `noteIdMap.pathForId(id)`, `isNoteConfirmed(id)`, `isLiveBound(path)`, `crdtOpsAvailable()`, `getCrdtHead`/`setCrdtHead` (Task 1). `toB64` from `src/crdt/channel.ts`.
- Produces: `async coldReceive(): Promise<number>` (returns the count of notes converged).

- [ ] **Step 1: Write the failing tests**

Add to `tests/sync-cold-receive.test.ts`. Use a crdt mock exposing `encodeStateVector` + `applyRemoteUpdate`, and an api mock exposing `getVaultHeads` + `getUpdates`. Wire `setNoteIdMap`, `markConfirmed`, `setLiveBoundCheck`, `markProbed`.

```typescript
describe("coldReceive", () => {
	function coldEngine(opts: {
		heads: Record<string, string>;
		getUpdates?: (id: string, since?: string) => Promise<{ update: Uint8Array; head: string }>;
		live?: (path: string) => boolean;
	}) {
		// The mock manager records the ARGUMENT it is called with — which is the
		// noteId (the manager is noteId-keyed), NOT the vault path.
		const applied: Array<{ id: string; update: Uint8Array }> = [];
		const svCalls: string[] = [];
		const api = {
			getVaultHeads: async () => ({ heads: opts.heads }),
			getUpdates:
				opts.getUpdates ??
				(async (_id: string, _since?: string) => ({ update: new Uint8Array([1]), head: "SRV" })),
		};
		const crdt = {
			encodeStateVector: async (id: string) => {
				svCalls.push(id);
				return new Uint8Array([9]);
			},
			applyRemoteUpdate: async (id: string, update: Uint8Array) => {
				applied.push({ id, update });
			},
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		e.setNoteIdMap(map);
		markConfirmed(e, "id-a");
		e.setLiveBoundCheck(opts.live ?? (() => false));
		return { e, applied, svCalls };
	}

	test("an advanced head pulls the delta, applies it, and persists the returned head", async () => {
		const { e, applied, svCalls } = coldEngine({ heads: { "id-a": "SRV" } });
		// local crdtHead is absent (never cold-synced) -> treated as advanced
		const n = await e.coldReceive();
		expect(n).toBe(1);
		expect(svCalls).toEqual(["id-a"]); // doc opened once (by noteId), to compute since
		expect(applied).toEqual([{ id: "id-a", update: new Uint8Array([1]) }]);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV"); // persisted under the path
	});

	test("an unchanged head is skipped WITHOUT opening the doc (cost gate)", async () => {
		const { e, applied, svCalls } = coldEngine({ heads: { "id-a": "SRV" } });
		(e as any).setCrdtHead("a.md", "SRV"); // already at server head
		const n = await e.coldReceive();
		expect(n).toBe(0);
		expect(svCalls).toEqual([]); // never opened the Y.Doc
		expect(applied).toEqual([]);
	});

	test("a live-bound note is skipped (the live channel owns it)", async () => {
		const { e, applied } = coldEngine({ heads: { "id-a": "SRV" }, live: () => true });
		expect(await e.coldReceive()).toBe(0);
		expect(applied).toEqual([]);
	});

	test("a head with no local path is skipped (first-discovery is the pull's job)", async () => {
		const { e, applied } = coldEngine({ heads: { "id-unknown": "SRV" } });
		expect(await e.coldReceive()).toBe(0);
		expect(applied).toEqual([]);
	});

	test("an unconfirmed note is skipped", async () => {
		const { e, applied } = coldEngine({ heads: { "id-a": "SRV" } });
		(e as any).unconfirmNoteId?.("id-a") ?? (e as any).clearConfirmedNoteIds?.();
		expect(await e.coldReceive()).toBe(0);
		expect(applied).toEqual([]);
	});

	test("ops unavailable => never calls getVaultHeads", async () => {
		let called = false;
		const api = {
			getVaultHeads: async () => {
				called = true;
				return { heads: {} };
			},
			getUpdates: async () => ({ update: new Uint8Array(), head: "" }),
		};
		const e = engine({ enableCrdt: true, api });
		// no markProbed => crdtOpsAvailable() is false
		expect(await e.coldReceive()).toBe(0);
		expect(called).toBe(false);
	});

	test("a per-note getUpdates failure does not abort the loop or advance that head", async () => {
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		map.set("b.md", "id-b");
		const applied: string[] = [];
		const api = {
			getVaultHeads: async () => ({ heads: { "id-a": "HA", "id-b": "HB" } }),
			getUpdates: async (id: string) => {
				if (id === "id-a") throw new Error("boom");
				return { update: new Uint8Array([2]), head: "HB" };
			},
		};
		const crdt = {
			encodeStateVector: async () => new Uint8Array([9]),
			applyRemoteUpdate: async (id: string) => {
				applied.push(id);
			},
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setNoteIdMap(map);
		markConfirmed(e, "id-a");
		markConfirmed(e, "id-b");
		e.setLiveBoundCheck(() => false);
		const n = await e.coldReceive();
		expect(applied).toEqual(["id-b"]); // b succeeded (by noteId) despite a failing
		expect(n).toBe(1);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined(); // a's head NOT advanced
		expect((e as any).getCrdtHead("b.md")).toBe("HB");
	});

	test("head is persisted only AFTER applyRemoteUpdate resolves", async () => {
		let applyResolved = false;
		const api = {
			getVaultHeads: async () => ({ heads: { "id-a": "SRV" } }),
			getUpdates: async () => ({ update: new Uint8Array([1]), head: "SRV" }),
		};
		const crdt = {
			encodeStateVector: async () => new Uint8Array([9]),
			applyRemoteUpdate: async () => {
				// head must not be set yet at this point
				applyResolved = true;
			},
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		e.setNoteIdMap(map);
		markConfirmed(e, "id-a");
		e.setLiveBoundCheck(() => false);
		await e.coldReceive();
		expect(applyResolved).toBe(true);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
	});
});
```

Confirm the exact confirmed-id and live-bound setter names against `src/sync.ts` before finalizing the test (`markConfirmed` in the existing test file sets `confirmedNoteIds` directly; `setLiveBoundCheck` is the `isLiveBound` setter at ~sync.ts:774). If `unconfirmNoteId` is not public, drop that one line and instead build the "unconfirmed" test by simply NOT calling `markConfirmed`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/sync-cold-receive.test.ts`
Expected: FAIL (`coldReceive` not defined).

- [ ] **Step 3: Implement `coldReceive()`**

Add to `src/sync.ts` (place near `pull()`; import `toB64` from `./crdt/channel` if not already imported):

```typescript
	/** Background convergence for COLD (confirmed, not live-bound) CRDT notes.
	 *  Diffs the server head-index against the persisted per-note crdtHead and,
	 *  for advanced notes, pulls the Yjs delta and applies it (echo-guarded disk
	 *  flush via applyRemoteUpdate). Best-effort: inert on pre-Phase-1 backends,
	 *  isolates per-note failures, and never throws. Returns notes converged. */
	async coldReceive(): Promise<number> {
		if (!this.settings.enableCrdt || !this.crdt || !this.crdtOpsAvailable()) return 0;
		let heads: Record<string, string>;
		try {
			({ heads } = await this.api.getVaultHeads());
		} catch (e) {
			devLog().log("crdt", `coldReceive: getVaultHeads failed — ${errMsg(e)}`);
			return 0;
		}
		let converged = 0;
		for (const [noteId, serverHead] of Object.entries(heads)) {
			const path = this.noteIdMap?.pathForId(noteId) ?? null;
			if (!path) continue; // not locally known — first-discovery is pull()'s job
			if (!this.isNoteConfirmed(noteId)) continue;
			if (this.isLiveBound(path)) continue; // live channel owns open notes
			if (this.getCrdtHead(path) === serverHead) continue; // cost gate: unchanged
			try {
				// Manager is keyed by noteId (docId identity) — pass noteId, NOT path.
				const since = toB64(await this.crdt.encodeStateVector(noteId));
				const { update, head } = await this.api.getUpdates(noteId, since);
				await this.crdt.applyRemoteUpdate(noteId, update);
				this.setCrdtHead(path, head); // crdtHead persists under the vault path
				converged++;
			} catch (e) {
				// Isolated: log, leave crdtHead unadvanced, retry next poll.
				devLog().log("crdt", `coldReceive: ${path} failed — ${errMsg(e)}`);
				rlog().warn("crdt", `Cold-receive failed for ${path}: ${errMsg(e)}`);
			}
		}
		if (converged > 0) {
			devLog().log("crdt", `coldReceive: converged ${converged} cold note(s)`);
			this.emitStatus();
		}
		return converged;
	}
```

(`errMsg`, `devLog`, `rlog`, `emitStatus` are all already used in sync.ts.)

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/sync-cold-receive.test.ts`
Expected: PASS (all coldReceive tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-cold-receive.test.ts
git commit -S -m "feat(crdt): coldReceive — background head-index pull for cold notes"
```

---

### Task 3: Wire `coldReceive()` into the pull path

**Files:**
- Modify: `src/sync.ts` (`pull()`, before `return applied` at ~line 2551)
- Test: `tests/sync-cold-receive.test.ts` (extend)

**Interfaces:**
- Consumes: `coldReceive()` (Task 2), `pull()`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("pull() drives coldReceive", () => {
	test("pull() invokes coldReceive when ops are available", async () => {
		const e = engine({ enableCrdt: true, api: { getVaultHeads: async () => ({ heads: {} }) } });
		markProbed(e);
		const spy = mock(async () => 0);
		(e as any).coldReceive = spy;
		await e.pull();
		expect(spy).toHaveBeenCalled();
	});

	test("a coldReceive rejection does not fail pull()", async () => {
		const e = engine({ enableCrdt: true });
		markProbed(e);
		(e as any).coldReceive = mock(async () => {
			throw new Error("cold boom");
		});
		// pull() must resolve (not reject) despite coldReceive throwing.
		await expect(e.pull()).resolves.toBeDefined();
	});
});
```

(The `pull()` mock-engine may need `getChanges`/cursor mocks to run to completion — reuse whatever `tests/sync*.test.ts` already stubs for a bare `pull()`. If `pull()` requires more api surface than the cold-receive mock provides, extend the `api` stub minimally; do NOT weaken assertions.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/sync-cold-receive.test.ts -t "drives coldReceive"`
Expected: FAIL (coldReceive not called from pull).

- [ ] **Step 3: Wire it in**

In `src/sync.ts` `pull()`, immediately before `return applied;` (~line 2551), add a best-effort call:

```typescript
			// Phase 3a: piggyback cold-receive on the completed pull so closed
			// CRDT notes converge in the background. Best-effort — a failure here
			// must never fail the pull.
			await this.coldReceive().catch((e) => {
				devLog().log("crdt", `coldReceive threw (ignored) — ${errMsg(e)}`);
			});
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/sync-cold-receive.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Full gauntlet**

```bash
bun test
bun run lint:obsidian
bun run lint:css
./node_modules/.bin/biome ci src tests
bun run build
```

Fix anything red. Do NOT bump the version here (bump once, when the PR opens). Do NOT stage `main.js`.

- [ ] **Step 6: Commit**

```bash
git add src/sync.ts tests/sync-cold-receive.test.ts
git commit -S -m "feat(crdt): drive coldReceive from the pull interval (best-effort)"
```

---

## Self-Review

**Spec coverage (§4.4 cold receive):**
- Consult head-index via `GET /vault/heads` → Task 2 ✓
- For advanced heads, `GET /updates?since=<local SV>` → Task 2 ✓
- Apply delta to persisted Y.Doc → Task 2 (`applyRemoteUpdate`) ✓
- Flush to disk echo-guarded → reused (`applyRemoteUpdate` → REMOTE_ORIGIN → onFlushToDisk) ✓
- Closed notes converge in background → Task 3 (pull piggyback) ✓
- Cost gate (don't rehydrate unchanged notes) → Task 1 persisted `crdtHead` ✓
- Don't fight live channel → skip `isLiveBound` ✓
- Inert on old backends → `crdtOpsAvailable()` gate ✓

**Out of scope for 3a (later phases / follow-ups):**
- Connection pool + retiring lazy-enrollment → Phase 3c.
- External-disk diff3 vs Yjs-snapshot base → Phase 3b.
- `note_changed` edge-trigger (poll-only chosen).
- First-discovery of a server note with no local path (whole-vault pull owns it).
- Backend `/vault/heads` scaling (persisted crdt_head column / ETag) — the current per-doc compute is correct; scaling is a separate backend optimization.

**Type consistency:** `crdtHead: string` in FileSyncState (Task 1) is read by `getCrdtHead` and compared to `serverHead: string` from `getVaultHeads` (Task 2). `getUpdates` returns `{update: Uint8Array; head: string}`; `head` feeds `setCrdtHead`. `since` is `toB64(Uint8Array)` = string.

**Testing discipline:** every task is TDD (failing test first). No assertion is loosened. The cost-gate test (unchanged head => `encodeStateVector` never called) is the one that pins the scale property.
