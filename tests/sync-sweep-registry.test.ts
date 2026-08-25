/**
 * The guard that makes #1409's bug class impossible to reintroduce.
 *
 * BACKGROUND. `SyncEngine` carried two hand-written teardown enumerations that
 * had been drifting apart since March 2026:
 *
 *   destroy()           — swept the transient per-note maps, deliberately
 *                         sparing the persisted `syncState`.
 *   wipePerVaultState() — swept `syncState` + cursors + identity, and left the
 *                         per-note maps alone.
 *
 * Each was correct for its own job. Nothing owned their INTERSECTION — state
 * that is both vault-scoped AND transient — so eleven note_id- and path-keyed
 * maps survived a vault switch and went on addressing the NEW vault with the
 * OLD vault's ids. Measured consequence on a real 423-item import: 225 CRDT
 * rooms for 317 notes, plus 16 duplicate rows created BY the switch itself.
 *
 * Six separate bug fixes (2026-03-15 through 2026-08-18) each added a Map to
 * one list and not the other. None of the authors were careless: a declaration
 * three thousand lines from either list carries no hint that a decision is
 * owed, and forgetting was silent.
 *
 * THE GUARD. Scope now lives at the declaration (`this.track([...], new Map())`)
 * and both teardowns derive from that registry. This test closes the last hole
 * — an author writing a bare `new Map()` and skipping `track()` entirely — by
 * reflecting over a live engine and failing on any collection the registry does
 * not know about. The failure names the field, so the fix is obvious.
 *
 * Adding a collection to `SyncEngine` therefore forces exactly one decision:
 * does it die with the vault, with the engine, or both. That is the decision
 * the six fixes above were never prompted to make.
 */
import { describe, expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApp = {
	vault: {
		configDir: ".obsidian",
		cachedRead: mock().mockResolvedValue(""),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		getFiles: mock().mockReturnValue([]),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: {
		getActiveViewOfType: mock().mockReturnValue(null),
		getLeavesOfType: mock().mockReturnValue([]),
	},
} as any;

type SweepEntry = { on: readonly string[]; collection: { clear(): void } };

function createEngine(): SyncEngine {
	return new SyncEngine(
		mockApp,
		{ getManifest: mock().mockResolvedValue(null) } as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
}

function registry(engine: SyncEngine): SweepEntry[] {
	return (engine as unknown as { sweepable: SweepEntry[] }).sweepable;
}

/**
 * Own enumerable Map/Set fields on the instance. Nested collections inside
 * composed objects (`queue`, `files`, `issues`) are those objects' own problem
 * — each owns its `destroy()` — so only the engine's own fields are in scope.
 */
function ownCollections(engine: SyncEngine): Array<[string, Map<unknown, unknown> | Set<unknown>]> {
	return Object.entries(engine).filter(
		(entry): entry is [string, Map<unknown, unknown> | Set<unknown>] =>
			entry[1] instanceof Map || entry[1] instanceof Set,
	);
}

describe("sweep registry covers every engine collection", () => {
	test("no Map or Set field escapes track()", () => {
		const engine = createEngine();
		const tracked = new Set(registry(engine).map((e) => e.collection));

		// Identity, not name matching: a typo'd label in track() cannot fake
		// coverage, because the assertion compares the actual instances.
		const untracked = ownCollections(engine)
			.filter(([, value]) => !tracked.has(value))
			.map(([name]) => name);

		expect(untracked).toEqual([]);
	});

	test("every registered collection declares at least one sweep event", () => {
		// `track([], x)` would type-check and silently never sweep.
		const orphaned = registry(createEngine()).filter((e) => e.on.length === 0);
		expect(orphaned).toEqual([]);
	});

	test("registry is non-trivial — a broken track() cannot vacuously pass", () => {
		// Without this, deleting every track() call would make the first test
		// pass by finding nothing to compare.
		const entries = registry(createEngine());
		expect(entries.length).toBeGreaterThanOrEqual(16);
		expect(entries.some((e) => e.on.includes("vault"))).toBe(true);
		expect(entries.some((e) => e.on.includes("destroy"))).toBe(true);
	});
});

describe("sweep events are independent, not a severity ladder", () => {
	test("syncState is vault-scoped but survives destroy()", () => {
		// It is the persisted sync baseline. Blanking it on unload would force a
		// full re-scan of the vault on next load.
		const engine = createEngine();
		const state = (engine as unknown as { syncState: Map<string, unknown> }).syncState;
		const entry = registry(engine).find((e) => e.collection === state);

		expect(entry?.on).toEqual(["vault"]);
	});

	test("debounceTimers is the exact inverse — destroy-only", () => {
		// A debounce pending across a vault switch still describes a real local
		// edit to a file that still exists, and still deserves its push.
		const engine = createEngine();
		const timers = (engine as unknown as { debounceTimers: Map<string, unknown> })
			.debounceTimers;
		const entry = registry(engine).find((e) => e.collection === timers);

		expect(entry?.on).toEqual(["destroy"]);
	});
});

describe("the eleven collections that leaked across a vault switch (#1409)", () => {
	// Named individually and asserted vault-scoped, so a future refactor that
	// silently re-tags one of them fails here with the field name.
	const LEAKED = [
		"fileForNote",
		"manifestPathOwners",
		"pendingOrphanSweep",
		"crdtRehandshakeAttempts",
		"pendingConvergence",
		"crdtHealCooldown",
		"crdtHealTrailingTimers",
		"pendingQueueDeliveries",
		"recentlyDeleted",
		"relocatedFrom",
		"pendingPostPullPushes",
	] as const;

	for (const field of LEAKED) {
		test(`${field} is swept on a vault switch`, () => {
			const engine = createEngine();
			const value = (engine as unknown as Record<string, unknown>)[field];

			// `manifestPathOwners` is a nullable CACHE, not a live collection: it
			// is discarded by nulling the field, which no registry can express.
			// Assert that shape explicitly rather than skipping it.
			if (value === null) {
				expect(field).toBe("manifestPathOwners");
				return;
			}

			const entry = registry(engine).find((e) => e.collection === value);
			expect(entry?.on).toContain("vault");
		});
	}
});

describe("the public vault-change entry point actually reaches the sweep", () => {
	// The tests above prove the TAGS are right. This proves the wiring: that
	// `resetForVaultChange` — what main.ts calls on a switch — really empties
	// the maps that leaked, rather than the registry being correct but unused.
	test("resetForVaultChange empties the previously-leaking collections", async () => {
		const engine = createEngine();
		const e = engine as unknown as {
			fileForNote: Map<string, string>;
			pendingOrphanSweep: Set<string>;
			crdtHealCooldown: Map<string, number>;
			pendingQueueDeliveries: Map<string, unknown>;
			pendingPostPullPushes: Set<string>;
			pushing: Set<string>;
			saveData(patch: unknown): Promise<void>;
		};
		e.saveData = mock().mockResolvedValue(undefined);

		e.fileForNote.set("old-vault-id", "Notes/a.md");
		e.pendingOrphanSweep.add("old-vault-id");
		e.crdtHealCooldown.set("old-vault-id", 1);
		e.pendingQueueDeliveries.set("old-vault-id", { path: "Notes/a.md" });
		e.pendingPostPullPushes.add("Notes/a.md");
		e.pushing.add("in-flight.md");

		await engine.resetForVaultChange();

		expect(e.fileForNote.size).toBe(0);
		expect(e.pendingOrphanSweep.size).toBe(0);
		expect(e.crdtHealCooldown.size).toBe(0);
		expect(e.pendingQueueDeliveries.size).toBe(0);
		expect(e.pendingPostPullPushes.size).toBe(0);
		// ...and the destroy-only guard is untouched by a vault change.
		expect(e.pushing.has("in-flight.md")).toBe(true);
	});
});

describe("sweeping disposes timers rather than stranding them", () => {
	test("a vault sweep cancels every timer held in a tracked map", () => {
		const engine = createEngine();
		const cleared: number[] = [];
		(engine as unknown as { time: { clearTimeout(t: number): void } }).time = {
			clearTimeout: (t: number) => cleared.push(t),
		};

		// Populate the three timer-carrying vault-scoped maps directly.
		const e = engine as unknown as {
			recentlyDeleted: Map<string, { timer: number; path: string }>;
			relocatedFrom: Map<string, { from: string; timer: number }>;
			crdtHealTrailingTimers: Map<string, number>;
			sweep(event: string): void;
		};
		e.recentlyDeleted.set("id-1", { timer: 101, path: "a.md" });
		e.relocatedFrom.set("b.md", { from: "old.md", timer: 102 });
		e.crdtHealTrailingTimers.set("id-2", 103);

		e.sweep("vault");

		expect(cleared.sort()).toEqual([101, 102, 103]);
		expect(e.recentlyDeleted.size).toBe(0);
		expect(e.relocatedFrom.size).toBe(0);
		expect(e.crdtHealTrailingTimers.size).toBe(0);
	});

	test("a vault sweep leaves destroy-only collections alone", () => {
		const engine = createEngine();
		const e = engine as unknown as {
			pushing: Set<string>;
			sweep(event: string): void;
		};
		// An in-flight push guard must survive: clearing it mid-flight would
		// re-admit a second concurrent push of the same path.
		e.pushing.add("in-flight.md");

		e.sweep("vault");

		expect(e.pushing.has("in-flight.md")).toBe(true);
	});
});
