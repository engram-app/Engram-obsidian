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
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
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
	const probe = engine as unknown as {
		markRecentlyDeleted(id: string): void;
		recentlyDeleted: Map<string, number>;
		markRecentlyFlushed(path: string): void;
		recentlyFlushed: Map<string, number>;
	};
	return { engine, clock, probe };
}

describe("recentlyDeleted cooldown", () => {
	test("still suppresses a resurrection one tick before the window closes", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-a");

		clock.advance(RECENT_DELETE_COOLDOWN_MS - 1);

		expect(probe.recentlyDeleted.has("id-a")).toBe(true);
	});

	test("releases the id once the window elapses", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-a");

		clock.advance(RECENT_DELETE_COOLDOWN_MS);

		expect(probe.recentlyDeleted.has("id-a")).toBe(false);
	});

	test("re-marking restarts the window rather than stacking timers", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-a");

		clock.advance(RECENT_DELETE_COOLDOWN_MS - 10);
		probe.markRecentlyDeleted("id-a");
		clock.advance(20); // past the ORIGINAL deadline, not the refreshed one

		expect(probe.recentlyDeleted.has("id-a")).toBe(true);
		expect(clock.pendingCount).toBe(1);
	});

	test("windows expire independently per id", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyDeleted("id-early");
		clock.advance(30_000);
		probe.markRecentlyDeleted("id-late");

		clock.advance(RECENT_DELETE_COOLDOWN_MS - 30_000);

		expect(probe.recentlyDeleted.has("id-early")).toBe(false);
		expect(probe.recentlyDeleted.has("id-late")).toBe(true);
	});
});

describe("recentlyFlushed echo window", () => {
	test("expires on the same injected clock", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyFlushed("a.md");
		expect(probe.recentlyFlushed.has("a.md")).toBe(true);

		clock.advance(RECENT_DELETE_COOLDOWN_MS);

		expect(probe.recentlyFlushed.has("a.md")).toBe(false);
	});

	test("leaves no timer pending after expiry", () => {
		const { clock, probe } = engineWithClock();
		probe.markRecentlyFlushed("a.md");

		clock.advance(RECENT_DELETE_COOLDOWN_MS);

		expect(clock.pendingCount).toBe(0);
	});
});
