/**
 * The TTL windows that gate delete/echo correctness are now assertable without
 * sleeping through them.
 *
 * Before the TimeProvider injection these maps were driven by raw
 * `window.setTimeout`, so the only way to test "the window expired" was a real
 * 60-second wait — which is why none of them had expiry tests, and why the
 * behaviour on either side of the boundary was never pinned.
 */
import { describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import type { SyncedFileTable } from "../src/synced-file";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

/** Mirrors RECENT_DELETE_COOLDOWN_MS in sync.ts. */
const RECENT_DELETE_COOLDOWN_MS = 60_000;

function engineWithClock() {
	const clock = new ManualTimeProvider();
	const mockApp = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock().mockReturnValue(null),
			getFileByPath: mock().mockReturnValue(null),
			cachedRead: mock().mockResolvedValue(""),
			modify: mock().mockResolvedValue(undefined),
			create: mock().mockResolvedValue(undefined),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const engine = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		clock,
	);
	engine.setReady();
	const probe = engine as unknown as {
		markRecentlyDeleted(id: string, path: string): void;
		recentlyDeleted: Map<string, { timer: number; path: string }>;
		markRecentlyFlushed(path: string): void;
		markRecentlyPushed(path: string): void;
		files: SyncedFileTable;
	};
	return { engine, clock, probe };
}

describe("recentlyDeleted cooldown", () => {
	test("still suppresses a resurrection one tick before the window closes", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-a", "id-a.md");

		clock.advance(RECENT_DELETE_COOLDOWN_MS - 1);

		expect(probe.recentlyDeleted.has("id-a")).toBe(true);
	});

	test("releases the id once the window elapses", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-a", "id-a.md");

		clock.advance(RECENT_DELETE_COOLDOWN_MS);

		expect(probe.recentlyDeleted.has("id-a")).toBe(false);
	});

	test("re-marking restarts the window rather than stacking timers", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-a", "id-a.md");

		clock.advance(RECENT_DELETE_COOLDOWN_MS - 10);
		probe.markRecentlyDeleted("id-a", "id-a.md");
		clock.advance(20); // past the ORIGINAL deadline, not the refreshed one

		expect(probe.recentlyDeleted.has("id-a")).toBe(true);
		expect(clock.pendingCount).toBe(1);
	});

	test("windows expire independently per id", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-early", "id-early.md");
		clock.advance(30_000);
		probe.markRecentlyDeleted("id-late", "id-late.md");

		clock.advance(RECENT_DELETE_COOLDOWN_MS - 30_000);

		expect(probe.recentlyDeleted.has("id-early")).toBe(false);
		expect(probe.recentlyDeleted.has("id-late")).toBe(true);
	});
});

describe("recentlyFlushed echo window", () => {
	test("expires on the same injected clock", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyFlushed("a.md");
		expect(probe.files.has("a.md", "flushed")).toBe(true);

		clock.advance(RECENT_DELETE_COOLDOWN_MS);

		expect(probe.files.has("a.md", "flushed")).toBe(false);
	});

	test("leaves no timer pending after expiry", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyFlushed("a.md");

		clock.advance(RECENT_DELETE_COOLDOWN_MS);

		expect(clock.pendingCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Debounce bookkeeping (2026-07-30: status bar stuck on "1 pending")
// ---------------------------------------------------------------------------

describe("push debounce bookkeeping", () => {
	function armed(engine: SyncEngine) {
		return (engine as unknown as { debounceTimers: Map<string, number> }).debounceTimers.size;
	}

	test("a fired debounce clears its own entry", () => {
		const { engine, clock } = engineWithClock();
		const file = new TFile("a.md");

		engine.handleModify(file);
		expect(armed(engine)).toBe(1);
		clock.advance(5_000);

		expect(armed(engine)).toBe(0);
	});

	test("a rename before the debounce fires does not leak the old path", () => {
		const { engine, clock } = engineWithClock();
		const file = new TFile("a.md");

		engine.handleModify(file);
		expect(armed(engine)).toBe(1);

		// Obsidian mutates the SAME TFile in place on rename, so a closure that
		// reads file.path at FIRE time deletes the new key and strands the old —
		// leaving the status bar permanently showing a phantom pending file.
		file.path = "b.md";
		clock.advance(5_000);

		expect(armed(engine)).toBe(0);
	});
});

describe("destroy() timer sweep", () => {
	test("cancels the recentlyPushed cooldown on the injected clock", () => {
		const { engine, clock, probe } = engineWithClock();
		probe.markRecentlyPushed("a.md");
		expect(clock.pendingCount).toBe(1);

		engine.destroy();

		// markWithTtl arms every TTL map through `this.time`, so cancelling with
		// window.clearTimeout cannot reach the timer — it stays armed and fires
		// its expiry callback into a torn-down engine on the next tick.
		expect(clock.pendingCount).toBe(0);
	});
});

describe("push debounce, follow-ups from review", () => {
	function armed(engine: SyncEngine) {
		return (engine as unknown as { debounceTimers: Map<string, number> }).debounceTimers.size;
	}

	test("a fired debounce re-emits status so the bar stops painting a stale count", () => {
		const { engine, clock } = engineWithClock();
		const seen: number[] = [];
		engine.onStatusChange = (s) => seen.push(s.pending);

		engine.handleModify(new TFile("a.md"));
		clock.advance(5_000);

		// pushFile has early returns ABOVE its first emitStatus(), so delegating
		// the repaint to it leaves the bar showing the pre-fire count forever —
		// there is no poller to correct it.
		expect(seen.at(-1)).toBe(0);
	});

	test("a rename cancels the old path's pending push outright", () => {
		const { engine, clock } = engineWithClock();
		const file = new TFile("a.md");
		engine.handleModify(file);

		file.path = "b.md";
		void engine.handleRename(file, "a.md");

		// Self-clearing on fire is not enough. A still-armed old-path timer is
		// uncancellable by handleDelete (which looks up the CURRENT path) and
		// bypasses handleRename's own shouldIgnore guard on the new path.
		expect(armed(engine)).toBe(0);
		expect(clock.pendingCount).toBe(0);
	});
});
