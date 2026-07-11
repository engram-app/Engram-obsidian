# Bounded CRDT Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the vault-connect "room storm" WITHOUT sacrificing CRDT merge, by bounding enrollment concurrency instead of routing cold notes to whole-doc REST.

**Architecture:** Every note stays CRDT-managed (edits always merge). The connect storm was `CrdtEnrollment.enroll()` firing `startSync` (STEP1 handshake) for every note at once. Replace that with a bounded-concurrency drain queue inside `CrdtEnrollment` — enroll all notes, but only ~4 handshakes in flight at a time. This is Relay's model (`BackgroundSync` `concurrency = 3`, `/home/open-claw/documents/code-projects/relay/Relay/src/BackgroundSync.ts:178`): keep everything CRDT, throttle the fan-out. The backend half (bounded checkpoint fan-out, engram #984) and resident-set trim (plugin #228 free-Y.Docs-on-close) already shipped and stay.

**Tech Stack:** TypeScript, Obsidian plugin, Yjs CRDT, Phoenix channels, esbuild, Bun test.

## Background (why this supersedes PR #230)

PR #230 ("lazy enrollment = only path") made "note not open in editor" mean "does not sync via CRDT" — cold edits fell back to whole-doc REST base_hash (last-write-wins). That broke `tests/crdt/test_crdt_sync.py::test_concurrent_edits_both_survive` and `::test_no_conflict_modal_on_divergence` in e2e, because concurrent edits to a closed note stopped merging. Relay proves the correct fix decouples the two axes: "open in editor" controls whether a note holds its OWN live socket + editor binding, NOT whether it converges. Idle notes still CRDT-merge. So: **do not gate CRDT routing on `isLiveBound`. Bound the enrollment fan-out instead.** Close PR #230; start this fresh from `main`.

## Global Constraints

- Base branch off current `origin/main` (was `d06e73f` or later — re-fetch). Do NOT build on the `feat/lazy-enrollment-only` branch; that approach is abandoned.
- Plugin version: bump `manifest.json` + `package.json` + add a `versions.json` entry ONCE when opening the PR (one above main's current version). Never re-bump on follow-ups.
- Run before push: `bun test`, `bun run build` (tsc), `./node_modules/.bin/biome ci src/ tests/`, `bun run lint:obsidian`, `bun run lint:css`. All must pass.
- Commits signed (`commit.gpgsign true` is already set). Conventional-commit subjects, <50 chars.
- No em dashes in committed docs (pre-commit `no-em-dash-docs` hook blocks them).

## File Structure

- `src/crdt/enrollment.ts` — MODIFY. Add a bounded-concurrency drain queue to `enroll()`. This is the entire behavioral fix.
- `src/types.ts` — MODIFY. Remove the dead `lazyEnrollment` setting (lazy is abandoned).
- `src/sync.ts`, `src/main.ts` — MODIFY only if a `lazyEnrollment` reference remains after starting from main (it should NOT on main, since main never wired lazy on; verify with grep).
- `tests/crdt/enrollment.test.ts` — CREATE (or extend if it exists). Unit-test the throttle.
- Backend repo `engram/e2e/tests/crdt/test_crdt_sync.py` — NO CHANGE NEEDED. These tests pass once cold notes merge again; do not migrate them to open-editor.

---

### Task 1: Bounded-concurrency drain queue in CrdtEnrollment

**Files:**
- Modify: `src/crdt/enrollment.ts:28-85`
- Test: `tests/crdt/enrollment.test.ts` (create)

**Interfaces:**
- Consumes: existing constructor `opts.startSync: (noteId: string) => Promise<void>`, `opts.resetSync`, `opts.onAfterEnroll?`.
- Produces: same public API — `enroll(noteId: string): void`, `reset(noteId): void`, `resetAll(): void` — behavior change only (enroll now queues). Add optional constructor field `concurrency?: number` (default `4`).

- [ ] **Step 1: Write the failing test — enroll fans out at most `concurrency` startSyncs at once**

```typescript
import { describe, expect, test } from "bun:test";
import { CrdtEnrollment } from "../../src/crdt/enrollment";

describe("CrdtEnrollment bounded concurrency", () => {
  test("never runs more than `concurrency` startSyncs in flight at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];
    const startSync = (_id: string) =>
      new Promise<void>((resolve) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        release.push(() => { inFlight--; resolve(); });
      });
    const e = new CrdtEnrollment({ startSync, resetSync: () => {}, concurrency: 4 });

    for (let i = 0; i < 50; i++) e.enroll(`id-${i}`);
    // Only `concurrency` should have started; the rest are queued.
    expect(release.length).toBe(4);
    expect(maxInFlight).toBe(4);

    // Drain: releasing one starts exactly one more, never exceeding the cap.
    while (release.length > 0) {
      release.shift()!();
      await Promise.resolve(); // let the drain microtask run
      await Promise.resolve();
      expect(inFlight).toBeLessThanOrEqual(4);
    }
    expect(maxInFlight).toBe(4);
  });

  test("all 50 notes eventually enroll (none dropped)", async () => {
    const seen = new Set<string>();
    const startSync = async (id: string) => { seen.add(id); };
    const e = new CrdtEnrollment({ startSync, resetSync: () => {}, concurrency: 4 });
    for (let i = 0; i < 50; i++) e.enroll(`id-${i}`);
    // flush all queued microtasks
    for (let i = 0; i < 200; i++) await Promise.resolve();
    expect(seen.size).toBe(50);
  });

  test("enroll is still idempotent per note_id", async () => {
    let calls = 0;
    const e = new CrdtEnrollment({ startSync: async () => { calls++; }, resetSync: () => {}, concurrency: 4 });
    e.enroll("id-1");
    e.enroll("id-1");
    e.enroll("id-1");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/crdt/enrollment.test.ts`
Expected: FAIL — current `enroll()` fires all 50 `startSync`s immediately, so `release.length` is 50 / `maxInFlight` is 50, not 4.

- [ ] **Step 3: Implement the bounded drain queue**

Replace the fields, `enroll`, `reset`, `resetAll` in `src/crdt/enrollment.ts`. Add `concurrency` to the constructor opts and a queue + active counter + drain loop:

```typescript
export class CrdtEnrollment {
	/** note_ids that have already received (or been queued for) a startSync this session. */
	private readonly enrolled = new Set<string>();
	/** FIFO of note_ids awaiting their startSync handshake (bounded fan-out). */
	private readonly queue: string[] = [];
	/** startSync handshakes currently in flight. */
	private active = 0;
	private readonly concurrency: number;

	private readonly startSync: (noteId: string) => Promise<void>;
	private readonly resetSync: (noteId: string) => void;
	private readonly onAfterEnroll?: (noteId: string) => Promise<void>;

	constructor(opts: {
		startSync: (noteId: string) => Promise<void>;
		resetSync: (noteId: string) => void;
		onAfterEnroll?: (noteId: string) => Promise<void>;
		/** Max concurrent STEP1 handshakes. Bounds the connect fan-out so a large
		 *  vault does not storm the backend with N simultaneous room joins. */
		concurrency?: number;
	}) {
		this.startSync = opts.startSync;
		this.resetSync = opts.resetSync;
		this.onAfterEnroll = opts.onAfterEnroll;
		this.concurrency = opts.concurrency ?? 4;
	}

	enroll(noteId: string): void {
		if (this.enrolled.has(noteId)) return;
		this.enrolled.add(noteId);
		this.queue.push(noteId);
		this.drain();
	}

	private drain(): void {
		while (this.active < this.concurrency && this.queue.length > 0) {
			const noteId = this.queue.shift() as string;
			this.active++;
			void this.startSync(noteId)
				.then(() => this.onAfterEnroll?.(noteId))
				.finally(() => {
					this.active--;
					this.drain();
				});
		}
	}

	reset(noteId: string): void {
		this.enrolled.delete(noteId);
		// Drop it from the queue too, so a reset-before-handshake note is not
		// later handshaked against stale server state.
		const i = this.queue.indexOf(noteId);
		if (i !== -1) this.queue.splice(i, 1);
		this.resetSync(noteId);
	}

	resetAll(): void {
		this.queue.length = 0;
		for (const noteId of this.enrolled) {
			this.resetSync(noteId);
		}
		this.enrolled.clear();
	}
}
```

Keep the class-level JSDoc block (lines 1-27) unchanged; only update the class body.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/crdt/enrollment.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `bun test`
Expected: PASS. The existing enrollment-consumer tests (sync-crdt-*, sync-note-id, sync-catchup) still pass because `enroll()` keeps the same signature and idempotency; only the fan-out timing changed. If any test asserted synchronous `startSync` firing, adjust it to await microtasks (the throttle defers the call by one turn).

- [ ] **Step 6: Commit**

```bash
git add src/crdt/enrollment.ts tests/crdt/enrollment.test.ts
git commit -m "feat(crdt): bound enrollment fan-out (fix connect storm)"
```

---

### Task 2: Remove the dead `lazyEnrollment` setting  — DEFERRED (follow-up)

**Status: not part of this execution.** `main` (d06e73f) wires `lazyEnrollment` in `sync.ts:682` (the `isCrdtManagedOffline` clause), `sync.ts:2512` (coldReceive free), `sync.ts:3699`/`3729` (pull-discovery enroll), and `main.ts` (cold-start reconcile gate), plus the `types.ts` field. The flag defaults **false**, so eager is already the active path; removing it means hardcoding the eager branch at each site — a behavioral no-op but a real edit across delicate sync routing. Do it as a separate cleanup PR (take the eager branch: `sync.ts:682` clause → `true` (drop it); `2512` block → remove (no free under eager); `3699`/`3729` → `if (noteId) enroll`; `main.ts` gate → drop `&& !lazyEnrollment`; `types.ts` → delete field + default). Not needed for the storm fix.

---

### Task 3: Verify convergence + no storm end-to-end

No new plugin code. This task pins the outcome and drives the e2e run.

- [ ] **Step 1: Open the PR (paired e2e)**

Push the branch. In the plugin repo the e2e trigger fans out to the backend suite against backend `main`. Because every note stays CRDT-managed, `tests/crdt/test_crdt_sync.py::test_concurrent_edits_both_survive` and `::test_no_conflict_modal_on_divergence` should PASS unchanged (they exercise cold-note merge, which is now preserved).

- [ ] **Step 2: Confirm the e2e-crdt job is green**

Run: `gh pr checks <pr#>` then `gh run view <e2e-run-id> --repo engram-app/engram --log-failed`
Expected: no `tests/crdt/` failures. If `test_83`/`test_86` (e2e-clerk) flake, rerun — those are unrelated (test_86 was fixed by #231, already on main).

- [ ] **Step 3: (Optional, follow-up) Add a throttle oracle test**

If desired, add an e2e or integration assertion that connecting an N-note vault produces at most `concurrency` concurrent STEP1 handshakes (e.g. count `sync broadcast`/`startSync` client-log lines in a window). This guards against a future regression re-introducing the all-at-once fan-out. Defer if it needs new client-log instrumentation.

---

## Decisions locked (do not relitigate)

- **Keep all notes CRDT.** No `isLiveBound` gate on send routing. Cold notes merge via the existing CRDT-ops `/updates` transport (engram #990) + cold-receive (#227). Confirmed correct by the Relay reference (`relay/Relay/src/BackgroundSync.ts`, `SharedFolder.ts:626-660`): idle notes converge, only the connection count is bounded.
- **Throttle, don't skip.** The storm is a fan-out onto a fixed resource; the fix is bounded concurrency (Relay `concurrency = 3`; we use `4`), matching the pool-exhaustion post-incident doc's lever #2.
- **Concurrency = 4.** Small enough to protect the backend 10-conn pool with headroom, large enough to drain a big vault in reasonable time. Tunable via the constructor if needed.
- **Not in scope (future roadmap):** replacing per-note Phoenix `crdt:` topics with a single per-vault channel that fans out per-note Yjs update bytes (Relay's primary transport). That is the bigger architectural win but is not needed to fix the storm or preserve merge; bounded enrollment + cold-receive is sufficient today.
