/**
 * OfflineQueue head-of-line blocking (2026-10-09 first-sync incident).
 *
 * The drain runs priority-then-oldest, one entry at a time, and a transient
 * failure used to re-queue the entry with its original timestamp and `break`
 * the pass. One attachment the server kept timing out on (408 after a 15s
 * body read on a slow uplink) sat at the front and blocked every entry behind
 * it until RETRY_CAP, and with no backoff timer the retries only fired when
 * something else happened to flush.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { RETRY_CAP } from "../src/issue-store";
import { destroyRemoteLog, initRemoteLog } from "../src/remote-log";
import { OFFLINE_RETRY_BASE_MS, SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const BAD = "Assets/Holiday photo.png";

function harness(paths: string[], failWith: (path: string) => unknown | null) {
	const files = new Map(paths.map((p) => [p, new TFile(p, 1000)]));
	const calls: Array<{ path: string; at: number }> = [];
	const time = new ManualTimeProvider(0);
	const api = {
		pushAttachment: mock(async (path: string) => {
			calls.push({ path, at: time.now() });
			const err = failWith(path);
			if (err) throw err;
			return { attachment: { content_hash: `h-${path}` } };
		}),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		getRateLimit: mock().mockResolvedValue(0),
	} as unknown as EngramApi;
	const app = {
		vault: {
			configDir: ".obsidian",
			readBinary: mock(async () => new ArrayBuffer(3)),
			cachedRead: mock(async () => ""),
			getFiles: () => [...files.values()],
			getFileByPath: (p: string) => files.get(p) ?? null,
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			getName: () => "Test Vault",
		},
		fileManager: { trashFile: mock(async () => {}) },
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const engine = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
		time,
	);
	engine.setReady();
	return { engine, calls, time, callsFor: (p: string) => calls.filter((c) => c.path === p) };
}

async function enqueueAll(engine: SyncEngine, paths: string[]) {
	let ts = 1;
	for (const path of paths) {
		await engine.queue.enqueue({
			path,
			action: "upsert",
			kind: "attachment",
			mtime: 1,
			timestamp: ts++,
			vaultId: "v1",
		});
	}
}

/** Let the retry timer's fire-and-forget flush settle. */
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
};

afterEach(async () => {
	await destroyRemoteLog();
});

describe("(c) a failing entry at the front does not block the rest", () => {
	test("later entries flush in the same pass", async () => {
		const paths = [BAD, "Assets/b.png", "Assets/c.png"];
		const h = harness(paths, (p) => (p === BAD ? { status: 408 } : null));
		await enqueueAll(h.engine, paths);

		await h.engine.flushQueue();

		expect(h.calls.map((c) => c.path)).toEqual(paths);
		expect(h.engine.queue.all().map((e) => e.path)).toEqual([BAD]);
	});

	test("the failed entry backs off exponentially, and a timer fires the retries", async () => {
		const h = harness([BAD], () => ({ status: 408 }));
		await enqueueAll(h.engine, [BAD]);

		await h.engine.flushQueue(); // attempt 1 at t=0
		// An unrelated flush before the backoff elapses must not retry it.
		await h.engine.flushQueue();
		expect(h.callsFor(BAD).length).toBe(1);

		// Nobody calls flushQueue from here on: only the backoff timer can.
		for (let i = 0; i < 40; i++) {
			h.time.advance(OFFLINE_RETRY_BASE_MS);
			await settle();
		}

		const at = h.callsFor(BAD).map((c) => c.at);
		expect(at.length).toBe(RETRY_CAP);
		const gaps = at.slice(1).map((t, i) => t - (at[i] ?? 0));
		// base, 2x, 4x, ... each gap at least the scheduled delay.
		gaps.forEach((gap, i) => {
			expect(gap).toBeGreaterThanOrEqual(OFFLINE_RETRY_BASE_MS * 2 ** i);
		});
		// Parked after RETRY_CAP: out of the queue, into the Sync Center.
		expect(h.engine.queue.size).toBe(0);
	});

	test("a network-class failure still stops the pass (the client is offline)", async () => {
		const paths = [BAD, "Assets/b.png"];
		const h = harness(paths, (p) => (p === BAD ? new Error("net::ERR_CONNECTION_RESET") : null));
		await enqueueAll(h.engine, paths);

		await h.engine.flushQueue();

		expect(h.calls.map((c) => c.path)).toEqual([BAD]);
		expect(h.engine.queue.size).toBe(2);
	});

	test("after going back online, the backed-off entry no longer blocks the rest", async () => {
		const paths = [BAD, "Assets/b.png"];
		let down = true;
		const h = harness(paths, (p) =>
			p === BAD ? new Error("socket hang up") : down ? new Error("offline") : null,
		);
		await enqueueAll(h.engine, paths);
		await h.engine.flushQueue(); // BAD fails (network), pass stops
		down = false;
		(h.engine as unknown as { offline: boolean }).offline = false;

		await h.engine.flushQueue();

		expect(h.callsFor("Assets/b.png").length).toBe(1);
		expect(h.engine.queue.all().map((e) => e.path)).toEqual([BAD]);
	});
});

describe("(e) give-up telemetry", () => {
	test("reaching the retry cap is reported with counts, never the path", async () => {
		const sent: Array<{ level: string; message: string }> = [];
		const logger = initRemoteLog();
		logger.configure(
			async (batch: any[]) => {
				sent.push(...batch);
			},
			"test",
			"test",
		);
		logger.setEnabled(false);
		const h = harness([BAD], () => ({ status: 408 }));
		await h.engine.queue.enqueue({
			path: BAD,
			action: "upsert",
			kind: "attachment",
			mtime: 1,
			timestamp: 1,
			vaultId: "v1",
			attempts: RETRY_CAP - 1,
		});

		await h.engine.flushQueue();
		await logger.flush();

		const line = sent.find((e) => e.message.startsWith("offline_queue_gave_up"));
		expect(line?.level).toBe("warn");
		expect(line?.message).toContain(`attempts=${RETRY_CAP}`);
		for (const e of sent) {
			expect(e.message).not.toContain("Holiday");
			expect(e.message).not.toContain("Assets");
		}
	});
});

describe("(e) push give-up telemetry", () => {
	test("a direct push past the retry cap reports itself, without the path", async () => {
		const sent: Array<{ level: string; message: string }> = [];
		const logger = initRemoteLog();
		logger.configure(
			async (batch: any[]) => {
				sent.push(...batch);
			},
			"test",
			"test",
		);
		logger.setEnabled(false);
		const h = harness([BAD], () => ({ status: 408 }));
		const file = new TFile(BAD, 1000);

		for (let i = 0; i < RETRY_CAP; i++) {
			await (h.engine as unknown as { pushFile(f: TFile): Promise<boolean> }).pushFile(file);
		}
		await logger.flush();

		const lines = sent.filter((e) => e.message.startsWith("push_gave_up"));
		expect(lines.length).toBe(1);
		expect(lines[0]?.message).toContain("attachment=true");
		for (const e of sent) {
			expect(e.message).not.toContain("Holiday");
		}
	});
});
