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
import { MAX_DRAIN_PASSES, SyncEngine } from "../src/sync";
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

// ---- delta check: link AFTER load, same-ms edit ----
test("queue loaded while unlinked, then linked: exactly one POST per note, queue empties", async () => {
	const paths = Array.from({ length: 5 }, (_, i) => `n${i}.md`);
	let posts = 0;
	const { engine } = build(paths, async (p: string) => {
		if (++posts > 50) throw new Error("loop guard");
		return ok(p)();
	});
	(engine as any).settings.vaultId = null; // unlinked at load
	engine.queue.load(paths.map((p, i) => ({ ...entry(p), timestamp: i + 1 })));
	(engine as any).settings.vaultId = "v1"; // user links
	await engine.flushQueue();
	expect(posts).toBe(paths.length);
	expect(engine.queue.size).toBe(0);
});

test("bare entries are re-keyed when a vault becomes active; a stamped newer one wins", () => {
	let active: string | undefined;
	const q = new OfflineQueue();
	q.setActiveVault(() => active);
	q.load([
		{ path: "a.md", action: "upsert", mtime: 1, timestamp: 1 },
		{ path: "b.md", action: "upsert", mtime: 1, timestamp: 1 },
		{ path: "b.md", action: "delete", mtime: 1, timestamp: 9, vaultId: "v1" },
	]);
	expect(q.get("a.md")).toBeDefined(); // unlinked: bare key
	active = "v1";
	expect(q.get("a.md", "v1")?.vaultId).toBe("v1");
	expect(q.get("b.md", "v1")?.action).toBe("delete");
	expect(q.size).toBe(2);
});

test("a same-timestamp, same-action newer edit survives the old replay's dequeue", async () => {
	const q = new OfflineQueue();
	q.setActiveVault(() => "v1");
	await q.enqueue({ path: "a.md", action: "upsert", mtime: 1, timestamp: 7 });
	const replayed = q.all()[0];
	await q.enqueue({ path: "a.md", action: "upsert", mtime: 1, timestamp: 7 });
	await q.dequeue(replayed);
	expect(q.size).toBe(1);
});

test("a backoff re-enqueue keeps its generation, so the replay's dequeue still removes it", async () => {
	const q = new OfflineQueue();
	q.setActiveVault(() => "v1");
	await q.enqueue({ path: "a.md", action: "upsert", mtime: 1, timestamp: 7 });
	const replayed = q.all()[0];
	await q.enqueue({ ...replayed, nextAttemptAt: 99 });
	await q.dequeue(replayed);
	expect(q.size).toBe(0);
});

// ---- spam minimisation: identical-push skip, retry-after, pass cap ----
test("identical content is not POSTed twice; changed content is", async () => {
	let body = "same";
	const { engine, api } = build(["a.md"], async (p: string) => ok(p)());
	(engine as any).app.vault.cachedRead = mock(async () => body);
	engine.queue.load([entry("a.md")]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(1);
	engine.queue.load([{ ...entry("a.md"), timestamp: 2 }]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(1); // identical: zero POSTs
	expect(engine.queue.size).toBe(0);
	body = "changed";
	engine.queue.load([{ ...entry("a.md"), timestamp: 3 }]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(2);
});

test("a failed push is not recorded: the retry still POSTs", async () => {
	let fail = true;
	const { engine, api } = build(["a.md"], async (p: string) => {
		if (fail) throw new Error("boom");
		return ok(p)();
	});
	engine.queue.load([entry("a.md")]);
	await engine.flushQueue();
	fail = false;
	engine.queue.load([{ ...entry("a.md"), timestamp: 2 }]);
	await engine.flushQueue();
	expect(engine.queue.size).toBe(0);
	expect((api.pushNote as any).mock.calls.length).toBe(2);
});

test("a stuck entry is bounded by the drain pass cap", async () => {
	const { engine, api } = build(["a.md"], async (p: string) => ok(p)());
	// Simulate an unforeseen dequeue miss: the entry never leaves the queue.
	(engine.queue as any).dequeue = async () => {};
	(engine.queue as any).has = () => false; // and the progress check is fooled too
	engine.queue.load([entry("a.md")]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBeLessThanOrEqual(MAX_DRAIN_PASSES);
});

test("a forced entry replays even when disk equals the synced hash; a non-forced one does not", async () => {
	const { engine, api } = build(["a.md"], async (p: string) => ok(p)());
	engine.queue.load([entry("a.md")]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(1);
	engine.queue.load([{ ...entry("a.md"), timestamp: 2 }]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(1); // non-forced: zero POSTs
	engine.queue.load([{ ...entry("a.md"), timestamp: 3, forced: true }]);
	await engine.flushQueue();
	expect((api.pushNote as any).mock.calls.length).toBe(2); // forced repair POSTs once
	expect(engine.queue.size).toBe(0);
});
