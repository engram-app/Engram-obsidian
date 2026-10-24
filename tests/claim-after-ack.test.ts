/**
 * Prod incident (vault f4cd93e6, 2026-10-22): a ~7,800-file first sync claimed
 * every path in `filemeta_v0` BEFORE its `crdt_create` was acked. The creates
 * failed (DB pool exhaustion, then 500/429), the server released the orphaned
 * claims, and the next self-heal sweep re-minted a NEW id per file and sent
 * every create again with no backoff, on every rejoin. ~19k creates never
 * reached the server.
 *
 * (a) a claim is published only once its create is acked
 * (b) a server release of a still-pending id keeps the SAME id
 * (c) a vault-wide create backoff gate bounds the retry rate
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import type { GenesisOutcome } from "../src/channel";
import { FILEMETA_MAP } from "../src/crdt/index-room";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { SyncStore } from "../src/crdt/sync-store";
import {
	CREATE_BACKOFF_BASE_MS,
	CREATE_BACKOFF_MAX_MS,
	makeCrdtOpSend,
	NotesCapGate,
} from "../src/crdt-op-dispatch";
import { CrdtOpQueue } from "../src/crdt-op-queue";
import { destroyRemoteLog } from "../src/remote-log";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

afterEach(async () => {
	await destroyRemoteLog();
});

const tick = async () => {
	await new Promise<void>((r) => queueMicrotask(() => r()));
	await new Promise<void>((r) => queueMicrotask(() => r()));
};

/** Apply `fn` to the index as the SERVER would, and deliver it as a remote
 *  update (transaction.local === false on the client). */
function remote(doc: Y.Doc, fn: (m: Y.Map<any>) => void): void {
	const server = new Y.Doc();
	Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
	fn(server.getMap<any>(FILEMETA_MAP));
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)));
}

function storeWithMap() {
	const doc = new Y.Doc();
	const map = doc.getMap<any>(FILEMETA_MAP);
	const store = new SyncStore(map);
	return { doc, map, store, ids: new NoteIdMap(store) };
}

describe("(a) a claim is published only after its create is acked", () => {
	test("a minted id stays out of filemeta_v0 until confirmed, then appears exactly once", async () => {
		const { doc, map, ids } = storeWithMap();
		const writes: string[] = [];
		map.observe((e) => {
			for (const [k, c] of e.changes.keys) if (c.action !== "delete") writes.push(k);
		});
		let updates = 0;
		doc.on("update", () => updates++);

		const id = ids.getOrMint("a.md");
		await tick();
		ids.flushNow();
		expect(map.has("a.md")).toBe(false);
		expect(updates).toBe(0);
		// Still visible to this device, and to data.json persistence.
		expect(ids.get("a.md")).toBe(id);
		expect(ids.toJSON()).toEqual({ "a.md": id });

		// The ack path: adoptCreateAck sets, then confirms, synchronously.
		ids.set("a.md", id);
		ids.confirmUpload(id);
		await tick();
		expect(map.get("a.md")).toEqual({ note_id: id });
		expect(writes).toEqual(["a.md"]);

		// Nothing left staged to re-publish.
		ids.flushNow();
		await tick();
		expect(writes).toEqual(["a.md"]);
	});

	test("confirm alone (no re-set) publishes the held claim", async () => {
		const { map, ids } = storeWithMap();
		const id = ids.getOrMint("a.md");
		await tick();
		expect(map.has("a.md")).toBe(false);
		ids.confirmUpload(id);
		await tick();
		expect(map.get("a.md")).toEqual({ note_id: id });
	});

	test("a failed create publishes nothing, however many commits run", async () => {
		const { doc, map, ids } = storeWithMap();
		let updates = 0;
		doc.on("update", () => updates++);
		for (let i = 0; i < 20; i++) ids.getOrMint(`n${i}.md`);
		ids.set("other.md", "id-peer-known"); // an unrelated, non-pending claim
		await tick();
		ids.flushNow();
		expect([...map.keys()]).toEqual(["other.md"]);
		expect(updates).toBe(1);
	});

	test("a pending mint renamed before its ack publishes nothing, then publishes the NEW path on ack", async () => {
		const { map, ids } = storeWithMap();
		const id = ids.getOrMint("a.md");
		ids.rename("a.md", "b.md");
		await tick();
		expect(map.size).toBe(0);
		expect(ids.get("b.md")).toBe(id);
		ids.confirmUpload(id);
		await tick();
		expect(map.toJSON()).toEqual({ "b.md": { note_id: id } });
	});

	test("a cache-only rename does not publish a claim", async () => {
		const { map, store, ids } = storeWithMap();
		ids.seed({ "old.md": "id-cached" });
		ids.rename("old.md", "new.md");
		await tick();
		ids.flushNow();
		expect(map.has("new.md")).toBe(false);
		expect(ids.get("new.md")).toBe("id-cached");
		// Held as pending: the rename's create-at-new-path ack publishes it.
		expect(store.isPendingUpload("id-cached")).toBe(true);
		ids.set("new.md", "id-cached");
		ids.confirmUpload("id-cached");
		await tick();
		expect(map.get("new.md")).toEqual({ note_id: "id-cached" });
	});

	test("an ADOPT publishes the server's id, never the mint", async () => {
		const { map, ids } = storeWithMap();
		const mint = ids.getOrMint("a.md");
		ids.set("a.md", "id-server");
		ids.confirmUpload("id-server");
		await tick();
		expect(map.toJSON()).toEqual({ "a.md": { note_id: "id-server" } });
		expect(ids.pathForId(mint)).toBeNull();
	});
});

describe("(b) a server release of a still-pending id keeps the same id", () => {
	test("re-staged locally, never published, and getOrMint returns the SAME id", async () => {
		const { doc, map, store, ids } = storeWithMap();
		// A claim a pre-fix build published before its create was acked: the
		// server still holds it, and the id is still unacked here.
		map.set("a.md", { note_id: "id-x" });
		store.markPendingUpload("id-x");

		remote(doc, (m) => m.delete("a.md")); // the server releases the claim
		expect(map.has("a.md")).toBe(false);

		expect(ids.get("a.md")).toBe("id-x");
		expect(ids.getOrMint("a.md")).toBe("id-x");
		await tick();
		ids.flushNow();
		expect(map.has("a.md")).toBe(false); // still not re-published
		ids.confirmUpload("id-x");
		await tick();
		expect(map.get("a.md")).toEqual({ note_id: "id-x" });
	});

	test("a remote delete of an ACKED id is a real delete, not re-staged", () => {
		const { doc, map, store } = storeWithMap();
		map.set("a.md", { note_id: "id-x" });
		remote(doc, (m) => m.delete("a.md"));
		expect(store.get("a.md")).toBeNull();
		expect(store.isPendingUpload("id-x")).toBe(false);
	});

	test("a LOCAL delete of a pending id's key is not undone", async () => {
		const { map, store, ids } = storeWithMap();
		map.set("a.md", { note_id: "id-x" });
		store.markPendingUpload("id-x");
		ids.release("a.md");
		await tick();
		expect(map.has("a.md")).toBe(false);
		expect(store.get("a.md")).toBeNull();
	});
});

describe("(c) vault-wide create backoff gate", () => {
	test("holds 30s, doubles per failed probe, caps at 10 min, and the first ack resets it", () => {
		let now = 0;
		const gate = new NotesCapGate(() => now);
		expect(CREATE_BACKOFF_BASE_MS).toBe(30_000);
		expect(CREATE_BACKOFF_MAX_MS).toBe(10 * 60_000);

		const holds: number[] = [];
		for (let i = 0; i < 8; i++) {
			gate.backoff();
			const start = now;
			while (gate.isClosed()) now += 1000;
			holds.push(now - start);
		}
		expect(holds).toEqual([30, 60, 120, 240, 480, 600, 600, 600].map((s) => s * 1000));

		// Failures while already holding do not escalate (concurrent pushes).
		gate.backoff();
		gate.backoff();
		gate.backoff();
		const start = now;
		while (gate.isClosed()) now += 1000;
		expect(now - start).toBe(600_000);

		gate.createAcked();
		expect(gate.isClosed()).toBe(false);
		gate.backoff();
		const s2 = now;
		while (gate.isClosed()) now += 1000;
		expect(now - s2).toBe(30_000);
	});

	test("a cap trip is independent of the backoff, and an ack does not open the cap", () => {
		const now = 0;
		const gate = new NotesCapGate(() => now);
		gate.trip("notes_cap_reached");
		gate.createAcked();
		expect(gate.isClosed()).toBe(true);
		gate.open();
		expect(gate.isClosed()).toBe(false);
		gate.backoff();
		gate.open(); // a delete ack frees a note; it says nothing about server health
		expect(gate.isClosed()).toBe(true);
		gate.reset();
		expect(gate.isClosed()).toBe(false);
	});

	for (const [label, err] of [
		["create_failed", new Error(`request failed: {"reason":"create_failed"}`)],
		["rate_limited", new Error(`request failed: {"reason":"rate_limited"}`)],
		["timeout", new Error("timeout")],
		["transport", new Error("socket closed")],
	] as const) {
		test(`queue: ${label} trips the gate, and queued creates are held uncharged until it expires`, async () => {
			let clock = 0;
			const gate = new NotesCapGate(() => clock);
			let calls = 0;
			let fail = true;
			const channel = {
				crdtCreate: async (docId: string) => {
					calls++;
					if (fail) throw err;
					return { docId, seeded: false, genesisOutcome: null as GenesisOutcome };
				},
				crdtDeleteAcked: async (docId: string) => ({ doc_id: docId }),
			};
			const queue = new CrdtOpQueue({
				send: makeCrdtOpSend({
					channel: () => channel,
					onCreated: () => {},
					onTerminal: () => {},
					capGate: gate,
					capBlocksCreate: () => gate.isClosed(),
				}),
				now: () => clock,
			});
			for (let i = 0; i < 50; i++) {
				queue.enqueue({
					id: `op${i}`,
					kind: "create",
					docId: `d${i}`,
					payload: { path: `n${i}.md` },
					enqueuedAt: 0,
					attempts: 0,
				});
			}
			await queue.onJoined();
			expect(calls).toBe(1); // one probe, then the gate held the rest
			for (let t = 0; t < 29; t++) {
				clock += 1000;
				await queue.tick();
			}
			expect(calls).toBe(1);
			expect(queue.all().every((op) => op.attempts <= 1)).toBe(true);

			// Hold over: one probe, it fails, the hold doubles.
			clock += 31_000;
			await queue.tick();
			expect(calls).toBe(2);

			// The server recovers; after the hold the probe acks and the gate opens.
			fail = false;
			for (let t = 0; t < 40 && queue.size() > 0; t++) {
				clock += 31_000;
				await queue.tick();
			}
			expect(queue.size()).toBe(0);
			expect(gate.isClosed()).toBe(false);
			expect(calls).toBe(2 + 50);
		});
	}

	test("a TERMINAL reject does not trip the gate", async () => {
		const clock = 0;
		const gate = new NotesCapGate(() => clock);
		const send = makeCrdtOpSend({
			channel: () => ({
				crdtCreate: async () => {
					throw new Error(`request failed: {"reason":"id_conflict"}`);
				},
				crdtDeleteAcked: async (docId: string) => ({ doc_id: docId }),
			}),
			onCreated: () => {},
			onTerminal: () => {},
			capGate: gate,
		});
		await send({
			id: "o",
			kind: "create",
			docId: "d",
			payload: { path: "a.md" },
			enqueuedAt: 0,
			attempts: 0,
		});
		expect(gate.isClosed()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Engine-level: the real SyncEngine push path + the real queue, against a
// fake server whose creates fail, then recover.
// ---------------------------------------------------------------------------

function makeVault(paths: string[]) {
	const files = new Map(paths.map((p) => [p, new TFile(p, 1000)]));
	return {
		vault: {
			configDir: ".obsidian",
			read: mock(async (f: TFile) => `body of ${f.path}`),
			cachedRead: mock(async (f: TFile) => `body of ${f.path}`),
			readBinary: mock(async () => new ArrayBuffer(3)),
			getMarkdownFiles: () => [...files.values()],
			getFiles: () => [...files.values()],
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			getFileByPath: (p: string) => files.get(p) ?? null,
			modify: mock(async () => {}),
			process: mock(async (_f: unknown, fn: (d: string) => string) => fn("")),
			modifyBinary: mock(async () => {}),
			create: mock(async () => {}),
			createBinary: mock(async () => {}),
			createFolder: mock(async () => {}),
			trash: mock(async () => {}),
			rename: mock(async () => {}),
			getName: () => "Test Vault",
		},
		fileManager: { trashFile: mock(async () => {}) },
		workspace: { getActiveViewOfType: () => null },
	} as any;
}

const makeApi = () =>
	({
		pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		pushAttachment: mock().mockResolvedValue({ attachment: {} }),
		deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
		getRateLimit: mock().mockResolvedValue(0),
		getManifest: mock().mockResolvedValue({ unchanged: true }),
	}) as unknown as EngramApi;

const crdtStub = (): Partial<CrdtManager> => ({
	hasHistory: () => Promise.resolve(false),
	applyLocalEdit: async (_id: string, content: string) => content,
	applyRemoteUpdate: () => Promise.resolve(),
	encodeStateVector: () => Promise.resolve(new Uint8Array([0])),
	encodeGenesisUpdate: () => new Uint8Array([1, 2]),
	projectedText: () => Promise.resolve(""),
	closeDoc: () => {},
	removeDoc: async () => {},
});

function harness(paths: string[]) {
	let clock = 0;
	const time = new ManualTimeProvider(5000);
	const engine = new SyncEngine(
		makeVault(paths),
		makeApi(),
		{ ...DEFAULT_SETTINGS, debounceMs: 1, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
		time,
	);
	engine.setCrdtManager(crdtStub() as unknown as CrdtManager);
	engine.setReady();
	const { doc, map, ids } = storeWithMap();
	engine.setNoteIdMap(ids);
	engine.setCrdtEnrollment({ enroll: () => {}, reset: () => {} });

	const gate = new NotesCapGate(() => clock);
	const server = {
		fail: true,
		created: new Map<string, string>(), // docId -> path
		sent: [] as Array<{ at: number; docId: string; path: string }>,
		createsPerId: new Map<string, number>(),
	};
	const crdtCreate = async (docId: string, path: string) => {
		server.sent.push({ at: clock, docId, path });
		if (server.fail) throw new Error(`request failed: {"reason":"create_failed"}`);
		server.createsPerId.set(docId, (server.createsPerId.get(docId) ?? 0) + 1);
		server.created.set(docId, path);
		return { docId, seeded: false, genesisOutcome: null as GenesisOutcome };
	};
	const channel = {
		crdtCreate,
		crdtDeleteAcked: async (docId: string) => ({ doc_id: docId }),
	};
	const queue = new CrdtOpQueue({
		send: makeCrdtOpSend({
			channel: () => channel,
			onCreated: (localId, serverId, path, seeded, genesis, outcome) =>
				engine.applyCrdtCreateAck(localId, serverId, path, seeded, genesis, outcome),
			onTerminal: () => {},
			capGate: gate,
			capBlocksCreate: (path) => engine.capBlocksCreate(path),
		}),
		now: () => clock,
		currentVaultId: () => "v1",
	});
	engine.setCrdtHasPendingOp((docId) =>
		queue.all().some((op) => op.docId === docId && op.kind === "create"),
	);
	engine.setCrdtPorts({
		create: (id, path) => crdtCreate(id, path),
		capGate: gate,
		live: () => true,
		enqueue: (op) =>
			queue.enqueue({
				id: crypto.randomUUID(),
				kind: op.kind,
				docId: op.docId,
				payload: { path: op.path },
				enqueuedAt: clock,
				attempts: 0,
				vaultId: "v1",
			}),
	});

	// Every claim THIS device publishes, with whether the server had acked
	// that id at the moment it went out.
	const published: Array<{ path: string; id: string; acked: boolean }> = [];
	map.observe((e) => {
		if (!e.transaction.local) return;
		for (const [k, c] of e.changes.keys) {
			if (c.action === "delete") continue;
			const id = map.get(k)?.note_id as string;
			published.push({ path: k, id, acked: server.created.has(id) });
		}
	});

	return {
		engine,
		queue,
		server,
		gate,
		doc,
		map,
		ids,
		published,
		get clock() {
			return clock;
		},
		advance: (ms: number) => {
			clock += ms;
			time.advance(ms);
		},
	};
}

describe("(b) engine: the sweep retries a released pending claim under the SAME id", () => {
	test("server deletes the key of a pending id; the next sweep re-sends crdt_create with that id and mints nothing", async () => {
		const h = harness(["Notes/a.md"]);
		await h.engine.pushModifiedFiles(); // create fails
		const id = h.ids.get("Notes/a.md")!;
		expect(id).toBeTruthy();
		expect(h.map.size).toBe(0);

		// The pre-fix shape: the server holds a claim for the unacked id, then
		// releases it.
		remote(h.doc, (m) => m.set("Notes/a.md", { note_id: id }));
		remote(h.doc, (m) => m.delete("Notes/a.md"));

		h.server.fail = false;
		h.advance(CREATE_BACKOFF_MAX_MS);
		await h.queue.onJoined();
		await h.engine.selfHealSweep();
		await tick();
		// Same id, no second mint: the only id the server ever saw is the original.
		expect(h.ids.get("Notes/a.md")).toBe(id);
		expect(new Set(h.server.sent.map((s) => s.docId))).toEqual(new Set([id]));
		expect([...h.server.created.keys()]).toEqual([id]);
		expect(h.map.get("Notes/a.md")).toEqual({ note_id: id });
	});
});

describe("(c) engine: the sweep sends zero creates while the gate holds", () => {
	test("a failed create holds the sweep and the rejoin flush until the hold expires", async () => {
		const paths = Array.from({ length: 50 }, (_, i) => `Notes/n${i}.md`);
		const h = harness(paths);
		await h.engine.pushModifiedFiles(); // failing: closes the gate
		const first = h.server.sent.length;
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThanOrEqual(10); // only what was already in flight
		expect(h.gate.isClosed()).toBe(true);

		for (let s = 0; s < 25; s += 5) {
			h.advance(5000);
			await h.queue.onJoined();
			await h.engine.selfHealSweep();
		}
		expect(h.server.sent.length).toBe(first);

		h.server.fail = false;
		h.advance(10_000);
		await h.queue.onJoined();
		await h.engine.selfHealSweep();
		expect(h.server.created.size).toBe(50);
		expect(h.gate.isClosed()).toBe(false);
	});
});

describe("incident replay: 7,800-file first sync, failing creates, released claims, sweeps and rejoins", () => {
	test("no re-mints, same-id retries, bounded create rate, no pre-ack claims; then every note created and claimed once", async () => {
		const N = 7800;
		const paths = Array.from({ length: N }, (_, i) => `Notes/n${i}.md`);
		const h = harness(paths);

		// Wave 1: the startup push. Creates fail.
		await h.engine.pushModifiedFiles();
		const original = new Map(paths.map((p) => [p, h.ids.get(p)]));
		expect([...original.values()].every((id) => typeof id === "string")).toBe(true);
		expect(new Set(original.values()).size).toBe(N);

		// The server echoes what a pre-fix build would have claimed, then
		// releases every claim (its 1h grace expired).
		remote(h.doc, (m) => {
			for (const [p, id] of original) m.set(p, { note_id: id });
		});
		remote(h.doc, (m) => {
			for (const p of paths) m.delete(p);
		});

		// Several sweep + rejoin cycles over ~2h, 5 min apart, server still down.
		const WINDOW = 5 * 60_000;
		const sentBefore = h.server.sent.length;
		for (let cycle = 0; cycle < 24; cycle++) {
			h.advance(WINDOW);
			await h.queue.onJoined(); // rejoin flushes the queue
			await h.engine.selfHealSweep(); // then the join's sweep
			await h.queue.tick();
		}
		const failingSends = h.server.sent.slice(sentBefore);
		// Bounded by the backoff: at most one probe per hold (>= 30s), so a
		// 5 min window carries a handful, never thousands.
		const perWindow = new Map<number, number>();
		for (const s of failingSends) {
			const w = Math.floor(s.at / WINDOW);
			perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
		}
		expect(Math.max(0, ...perWindow.values())).toBeLessThanOrEqual(
			WINDOW / CREATE_BACKOFF_BASE_MS,
		);
		// Wave 1 itself is bounded too: only the pushes already in flight (the
		// 10-slot push window) when the first failure closed the gate.
		expect(sentBefore).toBeLessThanOrEqual(10);

		// Every create ever sent went out under its file's ORIGINAL id.
		for (const s of h.server.sent) expect(s.docId).toBe(original.get(s.path)!);
		// Zero new ids: still exactly one per file.
		for (const p of paths) expect(h.ids.get(p)).toBe(original.get(p));
		// Zero claims published before an ack.
		expect(h.published.filter((x) => !x.acked)).toEqual([]);
		expect(h.map.size).toBe(0);

		// Creates recover.
		h.server.fail = false;
		for (let cycle = 0; cycle < 6 && h.server.created.size < N; cycle++) {
			h.advance(CREATE_BACKOFF_MAX_MS);
			await h.queue.onJoined();
			await h.engine.selfHealSweep();
		}
		await tick();
		h.ids.flushNow();

		expect(h.server.created.size).toBe(N);
		// Total ids minted == file count: every note created once, under its original id.
		expect(new Map([...h.server.created].map(([id, p]) => [p, id]))).toEqual(original);
		expect([...h.server.createsPerId.values()].every((n) => n === 1)).toBe(true);
		// ...and claimed once, after its ack.
		expect(h.published.length).toBe(N);
		expect(h.published.every((x) => x.acked)).toBe(true);
		expect(new Set(h.published.map((x) => x.path)).size).toBe(N);
		for (const p of paths) expect(h.map.get(p)).toEqual({ note_id: original.get(p) });
	}, 120_000);
});
