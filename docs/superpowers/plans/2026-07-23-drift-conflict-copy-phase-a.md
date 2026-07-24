# Drift-Conflict-Copy (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace md double-divergence's route into the legacy conflict tail with a single modal-free drift-conflict-copy: keep local untouched, write the authoritative version as a `(conflict <stamp>)` sibling, fire a Notice.

**Architecture:** Reroute the `localDiverged` branch in the CRDT catch-up path (`applyChange`) to the *existing* `writeDriftConflictCopy` helper + `socketConverge`, instead of setting `crdtConflictFallthrough` and falling into the legacy tail. Remove the now-dead flag + its guard. Canvas is untouched; nothing is deleted.

> **AS-BUILT (deviation from the sketch below):** A `writeDriftConflictCopy` helper ALREADY existed (`sync.ts:1375`, used at 3 drift sites) with the opposite orientation to the original spec — it preserves the **local** edit as the `(conflict <date>).md` copy and the main file converges to the server. Per user decision, Phase A REUSES it (consistency across 4 sites, no new method) and converges the main file via `socketConverge` (Yjs), not a raw snapshot write. The RED test and the `test_14` regression test in `sync-catchup.test.ts` were updated to the new modal-free contract (local preserved as copy + re-handshake fired, `onConflict` never called). Steps below describe the original sketch; the shipped change is smaller.

**Tech Stack:** TypeScript, Bun test runner (Jest-compatible), Obsidian API (mocked in `tests/__mocks__/obsidian.ts`).

## Global Constraints

- Plugin version bumps are owned by release-please — do NOT bump `manifest.json`/`package.json`/`versions.json` in this PR.
- Conventional commits; no em dashes in prose/commits.
- Lint before push: `bun run build` (tsc) + `bun test` + `./node_modules/.bin/biome ci` + `bun run lint:obsidian` + `bun run lint:css`.
- Branch prefix must not be `ci/`; use `feat/` or `fix/`.
- No suppression (no `// @ts-ignore`, no skipped tests) — fix root cause.

---

### Task 1: Add `writeDriftConflictCopy` and reroute md double-divergence to it

**Files:**
- Modify: `src/sync.ts` (add method near the existing copy helper ~`1361-1370`; edit the catch-up branch `5513-5523`; edit flag decl `5301` + guard `5600`)
- Test: `tests/sync.test.ts` (new test in the CRDT catch-up describe block)

**Interfaces:**
- Consumes (existing on `SyncEngine`): `createFileWithFolders(path: string, content: string): Promise<void>`, `syncState: Map<string, {hash:number; version?:number; serverHash?:string; seq?:number}>`, `baseStore?.set(path: string, content: string, version: number)`, `fnv1a(s: string): number`, `normalizePath` (from obsidian), `Notice` (from obsidian, already imported at `sync.ts:4`), `rlog()`.
- Produces: `private async writeDriftConflictCopy(localPath: string, authoritativeContent: string, change: NoteChange): Promise<void>` — writes `<base> (conflict <stamp>).<ext>`, records syncState+baseStore for the copy, fires a Notice. Never touches `localPath` on disk.

- [ ] **Step 1: Write the failing test**

Add to `tests/sync.test.ts`, inside the describe block that exercises the CRDT catch-up path (mirror the drift setup from the existing test "preserves genuine drift as a keep-both copy…" at ~line 601, but for the non-deleted catch-up branch that reaches `sync.ts:5460` else → `5513` `localDiverged`). Uses `createEngine()` (line 115), `NoteIdMap`, `__noticeCapture` (from the obsidian mock), `fnv1a`, `makeChange`.

```ts
test("md double-divergence writes a modal-free drift-conflict-copy of remote, keeps local", async () => {
	const engine = createEngine(); // ready:true → this.crdt set
	const path = "Notes/Drift.md";

	const map = new NoteIdMap();
	map.set(path, "id-drift");
	engine.setNoteIdMap(map);

	const baseline = "# Base\n";
	const localDrift = "# Base\nlocal unsynced edit\n";
	const remote = "# Base\nremote edit\n";

	// Recorded baseline (serverHash defined so this is a CRDT-managed cold row,
	// hash disagrees with disk == local drift) — routes to sync.ts:5460 else,
	// and fnv1a(remote) !== stored.hash so it is NOT the echo/lagged branch (5488).
	(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(path, {
		hash: fnv1a(baseline),
		serverHash: "old-server-hash",
	});

	const existingFile = new TFile(path);
	(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
	mockApp.vault.cachedRead.mockResolvedValue(localDrift);

	let onConflictCalled = false;
	engine.onConflict = async () => {
		onConflictCalled = true;
		return { choice: "skip" };
	};
	__noticeCapture.notices.length = 0;

	await engine.applyChange(
		makeChange({ path, content: remote, content_hash: "new-server-hash", version: 2 }),
	);

	// Remote written as a (conflict …) sibling; local NOT modified; modal never shown.
	const createCall = (mockApp.vault.create as jest.Mock).mock.calls[0];
	expect(createCall[0]).toMatch(/\(conflict .*\)\.md$/);
	expect(createCall[1]).toBe(remote);
	expect(mockApp.vault.modify).not.toHaveBeenCalledWith(existingFile, remote);
	expect(onConflictCalled).toBe(false);
	expect(__noticeCapture.notices.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && bun test tests/sync.test.ts -t "drift-conflict-copy"`
Expected: FAIL — currently the branch sets `crdtConflictFallthrough=true` and falls into the legacy tail, which (with `onConflict` returning `skip`) calls the modal (`onConflictCalled=true`) and creates no `(conflict …)` copy. If the RED does not fail on these assertions, the setup did not reach `sync.ts:5513` — adjust the preconditions (verify `crdtOwnsBody` is true and the row bypasses the `5488` echo branch) until it fails for the right reason.

- [ ] **Step 3: Add the `writeDriftConflictCopy` method**

Add near the existing conflict-copy helper (~`sync.ts:1361`):

```ts
/** Modal-free drift resolution: the on-disk file AND the authoritative doc
 *  both moved off the last-synced baseline. Keep local untouched; save the
 *  authoritative version as a sibling "(conflict <stamp>)" copy the user can
 *  reconcile by hand. Replaces the legacy three-way-merge/modal tail for the
 *  CRDT double-divergence case (#306 Phase A). */
private async writeDriftConflictCopy(
	localPath: string,
	authoritativeContent: string,
	change: NoteChange,
): Promise<void> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const dot = localPath.lastIndexOf(".");
	const base = dot > 0 ? localPath.slice(0, dot) : localPath;
	const ext = dot > 0 ? localPath.slice(dot + 1) : "md";
	const conflictPath = normalizePath(`${base} (conflict ${stamp}).${ext}`);
	await this.createFileWithFolders(conflictPath, authoritativeContent);
	this.syncState.set(conflictPath, {
		hash: fnv1a(authoritativeContent),
		version: change.version,
	});
	if (change.version != null) {
		this.baseStore?.set(conflictPath, authoritativeContent, change.version);
	}
	new Notice(
		`Engram: sync conflict on ${localPath} — saved remote copy as ${conflictPath}`,
	);
	rlog().warn("conflict", `drift-copy: ${localPath} -> ${conflictPath}`);
}
```

- [ ] **Step 4: Reroute the `localDiverged` branch**

At `sync.ts:5513-5523`, replace the flag assignment with a direct call + early return:

```ts
			const localDiverged =
				localNow !== null &&
				stored?.hash !== undefined &&
				fnv1a(localNow) !== stored.hash &&
				localNow !== content;
			if (localDiverged) {
				rlog().warn(
					"pull",
					`CRDT catch-up: local+remote both diverged, writing drift-conflict-copy ${change.path}`,
				);
				await this.writeDriftConflictCopy(normalized, content, change);
				return false;
			} else if (
```

- [ ] **Step 5: Remove the now-dead `crdtConflictFallthrough` flag**

The flag is now never set to `true` (only site was `5523`). Remove the declaration at `sync.ts:5301` (`let crdtConflictFallthrough = false;`) and change the guard at `sync.ts:5600` from `if (!crdtConflictFallthrough) return false;` to `return false;`. Verify with `grep -n crdtConflictFallthrough src/sync.ts` → no matches.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd plugin && bun test tests/sync.test.ts -t "drift-conflict-copy"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd plugin && git add src/sync.ts tests/sync.test.ts
git commit -m "feat: modal-free drift-conflict-copy for md double-divergence (refs #306)"
```

---

### Task 2: Guard test (non-drift does not copy) + full gauntlet

**Files:**
- Test: `tests/sync.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.

- [ ] **Step 1: Write the guard test**

```ts
test("md catch-up with clean local (no drift) does NOT write a conflict copy", async () => {
	const engine = createEngine();
	const path = "Notes/Clean.md";
	const map = new NoteIdMap();
	map.set(path, "id-clean");
	engine.setNoteIdMap(map);

	const baseline = "# Base\n";
	const remote = "# Base\nremote edit\n";
	// Disk still equals the last-synced baseline == NOT drifted.
	(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(path, {
		hash: fnv1a(baseline),
		serverHash: "old-server-hash",
	});
	const existingFile = new TFile(path);
	(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
	mockApp.vault.cachedRead.mockResolvedValue(baseline);
	__noticeCapture.notices.length = 0;

	await engine.applyChange(
		makeChange({ path, content: remote, content_hash: "new-server-hash", version: 2 }),
	);

	// No (conflict …) copy: clean local converges via the room, not a drift-copy.
	const created = (mockApp.vault.create as jest.Mock).mock.calls.map((c) => c[0]);
	expect(created.some((p: string) => /\(conflict .*\)/.test(p))).toBe(false);
});
```

- [ ] **Step 2: Run it (RED then GREEN)**

Run: `cd plugin && bun test tests/sync.test.ts -t "does NOT write a conflict copy"`
Expected: PASS immediately (the clean-local path was never rerouted). If it FAILS (a copy was written), the Task 1 reroute is over-firing — the `localDiverged` guard must require `fnv1a(localNow) !== stored.hash`; fix before proceeding.

- [ ] **Step 3: Full plugin gauntlet**

Run and confirm all green:
```bash
cd plugin
bun run build
bun test
./node_modules/.bin/biome ci
bun run lint:obsidian
bun run lint:css
```

- [ ] **Step 4: Commit**

```bash
cd plugin && git add tests/sync.test.ts
git commit -m "test: guard that clean-local md catch-up writes no drift-copy (refs #306)"
```

---

## Self-Review

- **Spec coverage:** Phase A of the spec = drift-conflict-copy function (Task 1 method) + reroute md `crdtConflictFallthrough` (Task 1 steps 4-5) + modal-free + Notice (Task 1 test) + delete nothing (canvas/onCorruption tail untouched — confirmed: canvas never enters the `crdtOwnsBody` block, so it still reaches the legacy tail at `5603`). The threeWayMerge tradeoff is realized because md no longer reaches `threeWayMerge` (only the tail called it, and md no longer falls through) — but the file is NOT deleted here (canvas still uses it) per Phase A scope. Covered.
- **Placeholder scan:** none.
- **Type consistency:** `writeDriftConflictCopy(localPath, authoritativeContent, change)` used consistently; `NoteChange` is the existing type passed to `applyChange`; `change.version` is `number | null | undefined` as used at the existing keep-both site.
- **Known risk:** the RED test setup must actually reach `sync.ts:5513`. Step 2 explicitly gates on the RED failing for the right reason; if it doesn't, adjust preconditions (this is why it is TDD, not a guess).
