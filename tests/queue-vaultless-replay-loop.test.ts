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

// ---- stored key == resolved key everywhere (review of #712) ----
import { OfflineQueue } from "../src/offline-queue";

const kinds = [
	{ kind: "note" as const, action: "upsert" as const },
	{ kind: "note" as const, action: "delete" as const },
	{ kind: "attachment" as const, action: "upsert" as const },
	{ kind: "attachment" as const, action: "delete" as const },
	{ kind: "note" as const, action: "upsert" as const, crdt: true },
];

for (const k of kinds) {
	test(`vault-less ${k.kind}/${k.action}${"crdt" in k ? "/crdt" : ""} is stamped and removable by entry or by resolved vault`, async () => {
		const q = new OfflineQueue();
		q.setActiveVault(() => "v1");
		const e = { path: "a.md", mtime: 1, timestamp: 5, ...k };
		q.load([e]);
		expect(q.get("a.md", "v1")?.vaultId).toBe("v1");
		expect(q.get("a.md")).toBeDefined();
		await q.dequeue(q.all()[0]);
		expect(q.size).toBe(0);
		await q.enqueue(e);
		await q.dequeue("a.md", "v1"); // the resolved-vault form misses nothing
		expect(q.size).toBe(0);
	});
}

test("vault switch: a vault-less entry is stamped with the vault it was loaded under", () => {
	let active = "v1";
	const q = new OfflineQueue();
	q.setActiveVault(() => active);
	q.load([{ path: "a.md", action: "upsert", mtime: 1, timestamp: 1 }]);
	active = "v2";
	expect(q.all()[0].vaultId).toBe("v1");
	expect(q.get("a.md", "v1")).toBeDefined();
	expect(q.get("a.md", "v2")).toBeUndefined();
});

test("a newer edit queued during an in-flight replay survives the old replay's dequeue", async () => {
	const q = new OfflineQueue();
	q.setActiveVault(() => "v1");
	await q.enqueue({ path: "a.md", action: "upsert", mtime: 1, timestamp: 1 });
	const replayed = q.all()[0];
	await q.enqueue({ path: "a.md", action: "upsert", mtime: 2, timestamp: 2 }); // edit mid-flight
	await q.dequeue(replayed);
	expect(q.size).toBe(1);
	expect(q.get("a.md")?.timestamp).toBe(2);
});

test("M2: requeue lookup with the entry's resolved vault finds the entry at the moved path", async () => {
	const q = new OfflineQueue();
	q.setActiveVault(() => "v1");
	q.load([
		{ path: "old.md", action: "upsert", mtime: 1, timestamp: 1 },
		{ path: "new.md", action: "delete", mtime: 1, timestamp: 9 },
	]);
	// requeueAtCurrentPath looks up q.get(cur, entryVaultId(entry)) = (new.md, "v1")
	expect(q.get("new.md", "v1")?.action).toBe("delete");
});

test("M1: a settled CRDT delivery leaves the queue, so it is not re-nudged", async () => {
	const { engine } = build(["a.md"], async (p: string) => ok(p)());
	engine.queue.load([{ ...entry("a.md"), crdt: true, noteId: "n1" } as any]);
	// The flush parks the entry itself (needs a live CRDT channel, not stubbed here).
	(engine as any).pendingQueueDeliveries.set("n1", engine.queue.all()[0]);
	await engine.commitCrdtConvergence("n1");
	expect(engine.queue.size).toBe(0);
});

test("legacy vault-less data.json round trip keeps one entry per path and drains", async () => {
	const { engine, api } = build(["a.md"], async (p: string) => ok(p)());
	const legacy = JSON.parse(JSON.stringify([entry("a.md")]));
	engine.queue.load(legacy);
	const saved = JSON.parse(JSON.stringify(engine.queue.persistable()));
	expect(saved[0].vaultId).toBe("v1");
	engine.queue.load(saved);
	expect(engine.queue.size).toBe(1);
	await engine.flushQueue();
	expect(engine.queue.size).toBe(0);
	expect((api.pushNote as any).mock.calls.length).toBe(1);
});
