/**
 * Repro: sustained POST /api/notes re-push loop (prod 2026-11-18, plugin 1.39.3).
 *
 * A queue entry persisted WITHOUT vaultId is stored under dedupKey "path" (load()
 * and enqueue() key on entry.vaultId), but runFlushQueue dequeues with
 * entryVaultId(entry) = entry.vaultId ?? settings.vaultId -> "v1:path". The
 * delete misses, the entry survives a successful 200 replay, flushed++ keeps
 * drainUntilStable looping, and the whole vault is re-POSTed forever.
 * Expected: each queued note is replayed once. Fails before the fix.
 */
import { afterEach, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { destroyRemoteLog } from "../src/remote-log";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const N = 20;
afterEach(async () => {
	await destroyRemoteLog();
});

test("a vaultId-less legacy note entry is replayed once, not forever", async () => {
	const paths = Array.from({ length: N }, (_, i) => `Notes/n${i}.md`);
	const files = new Map(paths.map((p) => [p, new TFile(p, 1000)]));
	let posts = 0;
	const api = {
		pushNote: mock(async (path: string) => {
			posts++;
			if (posts > N * 5) throw new Error("loop guard: replayed >5x"); // stops the runaway
			return {
				note: { id: `id-${path}`, path, version: 1, content_hash: "h", parse_status: "ok" },
			};
		}),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		getRateLimit: mock().mockResolvedValue(0),
	} as unknown as EngramApi;
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead: mock(async () => "body"),
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
		new ManualTimeProvider(0),
	);
	engine.setReady();
	// As loaded from an old data.json: no vaultId, no crdt flag, content-free.
	engine.queue.load(
		paths.map((path, i) => ({
			path,
			action: "upsert" as const,
			kind: "note" as const,
			mtime: 1,
			timestamp: i + 1,
		})),
	);

	await engine.flushQueue();

	expect(posts).toBe(N); // fails: grows to the guard (N*5+1)
	expect(engine.queue.size).toBe(0);
});

// Edge cases: same harness shape, smaller.
function build(paths: string[], pushImpl: (p: string) => Promise<unknown>) {
	const files = new Map(paths.map((p) => [p, new TFile(p, 1000)]));
	const api = {
		pushNote: mock(pushImpl),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		getRateLimit: mock().mockResolvedValue(0),
	} as unknown as EngramApi;
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead: mock(async () => "body"),
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
		new ManualTimeProvider(0),
	);
	engine.setReady();
	return { engine, api };
}
const ok = (path: string) => async () => ({
	note: { id: `id-${path}`, path, version: 1, content_hash: "h", parse_status: "ok" },
});
const entry = (path: string, vaultId?: string) => ({
	path,
	action: "upsert" as const,
	kind: "note" as const,
	mtime: 1,
	timestamp: 1,
	...(vaultId ? { vaultId } : {}),
});

test("empty queue: flush is a no-op", async () => {
	const { engine, api } = build([], async () => ({}));
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(0);
});

test("stamped and vault-less entries both drain once", async () => {
	const { engine, api } = build(["a.md", "b.md"], async (p: string) => ok(p)());
	engine.queue.load([entry("a.md", "v1"), entry("b.md")]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(2);
	expect(engine.queue.size).toBe(0);
});

test("a failing push stays queued and is not retried in a tight loop", async () => {
	const { engine, api } = build(["a.md"], async () => {
		throw new Error("boom");
	});
	engine.queue.load([entry("a.md")]);
	await engine.flushQueue();
	expect(engine.queue.size).toBe(1);
	expect((api.pushNote as any).mock.calls.length).toBeLessThanOrEqual(2);
});

test("persistence round trip of a vault-less entry still drains", async () => {
	const { engine } = build(["a.md"], async (p: string) => ok(p)());
	engine.queue.load([entry("a.md")]);
	const saved = JSON.parse(JSON.stringify(engine.queue.persistable()));
	engine.queue.load(saved);
	await engine.flushQueue();
	expect(engine.queue.size).toBe(0);
});
