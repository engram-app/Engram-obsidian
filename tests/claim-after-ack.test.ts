/**
 * Prod incident (vault f4cd93e6, 2026-10-22): a ~7,800-file first sync claimed
 * every path in `filemeta_v0` BEFORE its `crdt_create` was acked. The creates
 * failed (DB pool exhaustion, then 500/429), the server released the orphaned
 * claims, and the next self-heal sweep re-minted a NEW id per file and sent
 * every create again with no backoff, on every rejoin. ~19k creates never
 * reached the server.
 *
 * (a) a claim is published only once its create is acked. A pending id is
 *     held in the overlay, so a server release cannot take it away and the
 *     retry goes out under the SAME id (round 1 deleted the separate re-stage
 *     path, which production could never reach).
 * (c) a vault-wide create backoff gate bounds BULK resends (sweep + queue);
 *     a single user push always goes out and is the probe.
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

describe("held pending entries survive what used to remove a published claim", () => {
	// M3: commit() used to clear `evicted` wholesale. A held entry is not
	// published, so the displaced id is still committed at the same path, and
	// clearing its eviction made `pathForId` answer it with the held note's
	// file: a tombstoned lineage resurrected at a live path.
	test("an id evicted by a held pending entry stays evicted across an unrelated commit", () => {
		const tomb = new Set<string>();
		const { map, store, ids } = storeWithMap();
		store.setTombstoneCheck((id) => tomb.has(id));
		map.set("a.md", { note_id: "id-e" }); // an acked, published claim
		store.forget("a.md"); // remote delete: forget + room teardown
		tomb.add("id-e");
		const fresh = store.getOrMint("a.md"); // tombstoned: fresh mint, held
		expect(fresh).not.toBe("id-e");
		expect(store.pathForId("id-e")).toBeNull();

		ids.set("other.md", "id-other"); // an unrelated publish
		ids.flushNow();
		expect(map.get("other.md")).toEqual({ note_id: "id-other" });
		expect(store.pathForId("id-e")).toBeNull();
		expect(store.get("a.md")).toBe(fresh);

		// Once the held entry is acked and published, it really replaces id-e.
		ids.confirmUpload(fresh);
		ids.flushNow();
		expect(map.get("a.md")).toEqual({ note_id: fresh });
		expect(store.pathForId("id-e")).toBeNull();
	});

	// M5: a remote delete under ANOTHER id (or no id) is not about a note the
	// server has never seen. Forgetting the held entry re-minted it.
	test("a remote delete under another id keeps the held id", () => {
		const { ids } = storeWithMap();
		const held = ids.getOrMint("a.md");
		ids.forgetRemoteDelete("a.md", "id-dead");
		expect(ids.get("a.md")).toBe(held);
		expect(ids.getOrMint("a.md")).toBe(held);
	});

	test("a remote delete with no id (legacy feed) keeps the held id", () => {
		const { ids } = storeWithMap();
		const held = ids.getOrMint("a.md");
		ids.forgetRemoteDelete("a.md", null);
		expect(ids.getOrMint("a.md")).toBe(held);
	});

	test("a remote delete under the held id itself still forgets it", () => {
		const { ids } = storeWithMap();
		const held = ids.getOrMint("a.md");
		ids.forgetRemoteDelete("a.md", held);
		expect(ids.get("a.md")).toBeNull();
	});

	test("an acked, published entry is forgotten exactly as before", () => {
		const { store, ids } = storeWithMap();
		ids.set("a.md", "id-a");
		ids.flushNow();
		ids.forgetRemoteDelete("a.md", "id-b");
		expect(store.get("a.md")).toBeNull();
	});
});

describe("(c) vault-wide create backoff gate", () => {
	const holdFor = (gate: NotesCapGate, clock: { now: number }) => {
		const start = clock.now;
		while (gate.isClosed()) clock.now += 1000;
		return clock.now - start;
	};

	test("one note failing over and over holds 30s each time and never escalates", () => {
		const c = { now: 0 };
		const gate = new NotesCapGate(() => c.now);
		expect(CREATE_BACKOFF_BASE_MS).toBe(30_000);
		const holds: number[] = [];
		for (let i = 0; i < 6; i++) {
			gate.backoff("id-bad");
			gate.backoff("id-bad"); // a repeat inside the window does not count
			holds.push(holdFor(gate, c));
		}
		expect(holds).toEqual(Array(6).fill(30_000));
	});

	test("failures of 2+ distinct ids in one window double the hold, capped at 10 min", () => {
		const c = { now: 0 };
		const gate = new NotesCapGate(() => c.now);
		expect(CREATE_BACKOFF_MAX_MS).toBe(10 * 60_000);
		const holds: number[] = [];
		for (let i = 0; i < 8; i++) {
			gate.backoff(`a${i}`);
			c.now += 1000;
			gate.backoff(`b${i}`);
			gate.backoff(`c${i}`); // a third distinct id: still one doubling per window
			holds.push(holdFor(gate, c) + 1000);
		}
		expect(holds).toEqual([60, 120, 240, 480, 600, 600, 600, 600].map((s) => s * 1000));

		// A single-id window after that keeps the level, it does not double.
		gate.backoff("solo");
		expect(holdFor(gate, c)).toBe(600_000);

		gate.createAcked();
		expect(gate.isClosed()).toBe(false);
		gate.backoff("x");
		expect(holdFor(gate, c)).toBe(30_000);
	});

	test("a cap trip is independent of the backoff, and an ack does not open the cap", () => {
		const now = 0;
		const gate = new NotesCapGate(() => now);
		gate.trip("notes_cap_reached");
		gate.createAcked();
		expect(gate.isClosed()).toBe(true);
		gate.open();
		expect(gate.isClosed()).toBe(false);
		gate.backoff("x");
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

describe("(c) only a create the SERVER refused trips the gate", () => {
	test("queue: a local genesis-frame exception does not trip it", async () => {
		const gate = new NotesCapGate(() => 0);
		let sent = 0;
		const send = makeCrdtOpSend({
			channel: () => ({
				crdtCreate: async (docId: string) => {
					sent++;
					return { docId, seeded: false, genesisOutcome: null as GenesisOutcome };
				},
				crdtDeleteAcked: async (docId: string) => ({ doc_id: docId }),
			}),
			buildGenesisFrame: async () => {
				throw new Error("disk read failed");
			},
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
		expect(sent).toBe(0);
		expect(gate.isClosed()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Engine-level: the real SyncEngine push path + the real queue, against a
// fake server whose creates fail, then recover.
// ---------------------------------------------------------------------------

function makeVault(paths: string[], files = new Map(paths.map((p) => [p, new TFile(p, 1000)]))) {
	return {
		vault: {
			configDir: ".obsidian",
			read: mock(async (f: TFile) => `body of ${f.path}`),
			// A file created with a large size reads back that large (oversized md).
			cachedRead: mock(async (f: TFile) =>
				f.stat.size > 100 ? "x".repeat(f.stat.size) : `body of ${f.path}`,
			),
			readBinary: mock(async () => new ArrayBuffer(3)),
			getMarkdownFiles: () => [...files.values()].filter((f) => f.extension === "md"),
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
	const files = new Map(paths.map((p) => [p, new TFile(p, 1000)]));
	const api = makeApi();
	const engine = new SyncEngine(
		makeVault(paths, files),
		api,
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
		poison: new Set<string>(),
		created: new Map<string, string>(), // docId -> path
		sent: [] as Array<{ at: number; docId: string; path: string }>,
		createsPerId: new Map<string, number>(),
	};
	const crdtCreate = async (docId: string, path: string) => {
		server.sent.push({ at: clock, docId, path });
		if (server.fail || server.poison.has(path)) {
			throw new Error(`request failed: {"reason":"create_failed"}`);
		}
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
		api,
		addFile: (p: string, size?: number) => files.set(p, new TFile(p, 1000, size)),
		file: (p: string) => files.get(p),
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

describe("(c) engine: one bad note never holds the user's own new note", () => {
	test("a permanently failing note; the user's new note goes out immediately and its ack reopens bulk", async () => {
		const h = harness(["Notes/bad.md"]);
		h.server.fail = false;
		h.server.poison.add("Notes/bad.md");
		await h.engine.pushModifiedFiles();
		for (let c = 0; c < 12; c++) {
			h.advance(5 * 60_000);
			await h.queue.onJoined();
			await h.engine.selfHealSweep();
			await h.queue.tick();
		}
		// Same note every time: the hold never escalated past the base.
		h.advance(CREATE_BACKOFF_MAX_MS);
		// bad.md is retried by the queue or the sweep, whichever holds it.
		const retryBad = async () => {
			await h.queue.tick();
			await h.engine.selfHealSweep();
		};
		await retryBad(); // bad.md fails again, arming a hold
		expect(h.gate.isClosed()).toBe(true);
		h.advance(CREATE_BACKOFF_BASE_MS + 1000);
		expect(h.gate.isClosed()).toBe(false);
		await retryBad(); // and again: the hold is live right now
		expect(h.gate.isClosed()).toBe(true);

		h.addFile("Notes/new.md");
		const sentBefore = h.server.sent.length;
		await (h.engine as any).pushFile(h.file("Notes/new.md"));
		expect(h.server.sent.length).toBe(sentBefore + 1);
		expect([...h.server.created.values()]).toContain("Notes/new.md");
		// Its ack was the probe: bulk resends are open again.
		expect(h.gate.isClosed()).toBe(false);
	});
});

describe("(c) engine: a local failure before the request leaves does not trip the gate", () => {
	test("pushFile: genesisUpdateFor throwing is not the server refusing creates", async () => {
		const h = harness(["Notes/a.md"]);
		h.server.fail = false;
		(h.engine as any).genesisUpdateFor = async () => {
			throw new Error("local encode failed");
		};
		await (h.engine as any).pushFile(h.file("Notes/a.md"));
		expect(h.server.sent.length).toBe(0);
		expect(h.gate.isClosed()).toBe(false);
	});
});

describe("(c) engine: a recovery delivered by the QUEUE resets the hold", () => {
	test("queued create acks reset the backoff to 30s", async () => {
		const paths = Array.from({ length: 20 }, (_, i) => `Notes/n${i}.md`);
		const h = harness(paths);
		await h.engine.pushModifiedFiles(); // 10 distinct in flight fail: escalated
		expect(h.queue.size()).toBeGreaterThan(1);
		h.advance(40_000);
		expect(h.gate.isClosed()).toBe(true); // 60s, not 30s

		h.server.fail = false;
		h.advance(CREATE_BACKOFF_MAX_MS);
		await h.queue.onJoined(); // queue only, no sweep
		expect(h.queue.size()).toBe(0);
		expect(h.gate.isClosed()).toBe(false);

		h.gate.backoff("later");
		h.advance(29_000);
		expect(h.gate.isClosed()).toBe(true);
		h.advance(2_000);
		expect(h.gate.isClosed()).toBe(false);
	});
});

describe("(c) engine: the gate holds only creates (M2)", () => {
	test("attachments and REST-routed notes still go out while the gate holds", async () => {
		const h = harness(["Notes/n.md", "img/a.png"]);
		h.addFile("Notes/big.md", 5 * 1024 * 1024); // over the CRDT cap: REST
		h.gate.backoff("x");
		await h.engine.pushModifiedFiles();
		expect(h.server.sent.length).toBe(0); // the md create is held
		expect((h.api.pushAttachment as any).mock.calls.length).toBe(1);
		expect((h.api.pushNote as any).mock.calls.length).toBe(1); // oversized md over REST
	});
});

describe("(c) engine: every BULK caller of pushFile is held; single events are not", () => {
	const closedGateHarness = (n: number) => {
		const paths = Array.from({ length: n }, (_, i) => `Notes/n${i}.md`);
		const h = harness(paths);
		return { h, paths };
	};
	const settle = async () => {
		for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
	};

	// Review round 2: pushAll's post-push reconcile re-pushed every missing
	// file one by one (pushFile(file, true)), unheld: 210 creates for 200
	// files against a failing server. "Push entire vault" and the onboarding
	// push-all choices reach it: a first sync into a failing server.
	test("pushAll + its reconcile pass: 200 files, failing creates, sends at most the push window", async () => {
		const { h } = closedGateHarness(200);
		(h.api as any).getManifest = mock().mockResolvedValue({ notes: [], attachments: [] });
		await h.engine.pushAll();
		expect(h.server.sent.length).toBeGreaterThan(0);
		expect(h.server.sent.length).toBeLessThanOrEqual(10);
		expect(h.gate.isClosed()).toBe(true);
	});

	test("gate-journal replay is held", async () => {
		const { h, paths } = closedGateHarness(50);
		h.gate.backoff("x");
		for (const path of paths) (h.engine as any).journalGateEvent({ op: "push", path });
		await (h.engine as any).drainGateJournal();
		expect(h.server.sent.length).toBe(0);
	});

	test("the post-pull flush is held", async () => {
		const { h, paths } = closedGateHarness(50);
		h.gate.backoff("x");
		for (const p of paths) (h.engine as any).pendingPostPullPushes.add(p);
		await (h.engine as any).flushPostPullPushes();
		expect(h.server.sent.length).toBe(0);
	});

	test("the sweep worker is held", async () => {
		const { h } = closedGateHarness(50);
		h.gate.backoff("x");
		await h.engine.pushModifiedFiles();
		expect(h.server.sent.length).toBe(0);
	});

	test("a single debounced edit still goes out while the gate holds", async () => {
		const { h } = closedGateHarness(0);
		h.server.fail = false;
		h.gate.backoff("x");
		h.addFile("Notes/new.md");
		h.engine.handleModify(h.file("Notes/new.md"));
		h.advance(10); // fire the debounce
		await settle();
		expect(h.server.sent.map((x) => x.path)).toEqual(["Notes/new.md"]);
		expect(h.gate.isClosed()).toBe(false); // its ack was the probe
	});
});

describe("(c) engine: the distinct-id rule, through the real sweep and queue", () => {
	test("one note failing repeatedly never escalates past 30s", async () => {
		const h = harness(["Notes/bad.md"]);
		h.server.fail = false;
		h.server.poison.add("Notes/bad.md");
		await h.engine.pushModifiedFiles();
		let failures = 0;
		for (let c = 0; c < 10; c++) {
			const before = h.server.sent.length;
			await h.queue.onJoined();
			await h.engine.selfHealSweep();
			if (h.server.sent.length > before) {
				failures++;
				expect(h.gate.isClosed()).toBe(true);
			}
			h.advance(CREATE_BACKOFF_BASE_MS + 1000);
			expect(h.gate.isClosed()).toBe(false); // never more than 30s
		}
		expect(failures).toBeGreaterThan(3);
		expect(new Set(h.server.sent.map((x) => x.docId)).size).toBe(1);
	});

	test("two distinct notes failing in one window double the hold", async () => {
		const h = harness(["Notes/a.md", "Notes/b.md"]);
		await h.engine.pushModifiedFiles(); // both in flight, both fail
		expect(new Set(h.server.sent.map((x) => x.docId)).size).toBe(2);
		h.advance(CREATE_BACKOFF_BASE_MS + 1000);
		expect(h.gate.isClosed()).toBe(true);
		h.advance(CREATE_BACKOFF_BASE_MS);
		expect(h.gate.isClosed()).toBe(false);
	});
});

describe("upgrade: reload with data.json ids and pre-fix claims the server still holds", () => {
	test("no new ids, no pre-ack claims, every note created once, no path with two ids", async () => {
		const N = 200;
		const paths = Array.from({ length: N }, (_, i) => `Notes/n${i}.md`);
		const h = harness(paths);
		const cacheIds: Record<string, string> = {};
		const legacy: Record<string, string> = {};
		const pad = (i: number) => String(i).padStart(4, "0");
		for (const [i, p] of paths.entries()) {
			cacheIds[p] = `0190${pad(i)}-0000-7000-8000-000000000001`;
			// Half the vault has a pre-fix claim; a quarter under a DIFFERENT id.
			if (i % 2 === 0) {
				legacy[p] = i % 4 === 0 ? cacheIds[p] : `0190${pad(i)}-0000-7000-8000-000000000002`;
			}
		}
		h.ids.seed(cacheIds);
		remote(h.doc, (m) => {
			for (const [p, id] of Object.entries(legacy)) m.set(p, { note_id: id });
		});
		const known = new Set([...Object.values(cacheIds), ...Object.values(legacy)]);

		await h.engine.pushModifiedFiles(); // failing
		remote(h.doc, (m) => {
			for (const p of Object.keys(legacy)) m.delete(p); // grace expired
		});
		for (let c = 0; c < 6; c++) {
			h.advance(5 * 60_000);
			await h.queue.onJoined();
			await h.engine.selfHealSweep();
			await h.queue.tick();
		}
		h.server.fail = false;
		for (let c = 0; c < 6 && h.server.created.size < N; c++) {
			h.advance(CREATE_BACKOFF_MAX_MS);
			await h.queue.onJoined();
			await h.engine.selfHealSweep();
		}
		await tick();
		h.ids.flushNow();

		expect(
			[...new Set(h.server.sent.map((x) => x.docId))].filter((id) => !known.has(id)),
		).toEqual([]);
		expect(h.published.filter((x) => !x.acked)).toEqual([]);
		expect(h.server.created.size).toBe(N);
		expect([...h.server.createsPerId.values()].every((n) => n === 1)).toBe(true);
		const perPath = new Map<string, Set<string>>();
		for (const [id, p] of h.server.created)
			perPath.set(p, (perPath.get(p) ?? new Set()).add(id));
		expect([...perPath.values()].every((ids) => ids.size === 1)).toBe(true);
		expect(perPath.size).toBe(N);
	}, 120_000);
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
		h.advance(CREATE_BACKOFF_MAX_MS);
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

		// The id each path FIRST went out under. Every later send, and the
		// created row, must reuse it: ids minted == file count, not files x waves.
		const firstId = new Map<string, string>();
		const sameIdEverySend = () => {
			for (const x of h.server.sent) {
				const first = firstId.get(x.path) ?? x.docId;
				firstId.set(x.path, first);
				expect(x.docId).toBe(first);
			}
		};

		// Wave 1: the startup push. Creates fail.
		await h.engine.pushModifiedFiles();
		const sentBefore = h.server.sent.length;
		// Bounded: only the pushes already in flight (the 10-slot push window)
		// when the first failure closed the gate; the rest were held unread.
		expect(sentBefore).toBeGreaterThan(0);
		expect(sentBefore).toBeLessThanOrEqual(10);

		// The server releases whatever it holds for these paths (the pre-fix
		// shape: claims for unacked ids, released after the 1h grace).
		const minted = paths.filter((p) => h.ids.get(p) !== null);
		remote(h.doc, (m) => {
			for (const p of minted) m.set(p, { note_id: h.ids.get(p) });
		});
		remote(h.doc, (m) => {
			for (const p of minted) m.delete(p);
		});

		// Several sweep + rejoin cycles over ~2h, 5 min apart, server still down.
		const WINDOW = 5 * 60_000;
		for (let cycle = 0; cycle < 24; cycle++) {
			h.advance(WINDOW);
			await h.queue.onJoined(); // rejoin flushes the queue
			await h.engine.selfHealSweep(); // then the join's sweep
			await h.queue.tick();
		}
		const failingSends = h.server.sent.slice(sentBefore);
		// Bounded by the backoff: one probe burst (at most the push window plus
		// a queue probe) per hold, never the vault.
		const perWindow = new Map<number, number>();
		for (const x of failingSends) {
			const w = Math.floor(x.at / WINDOW);
			perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
		}
		expect(Math.max(0, ...perWindow.values())).toBeLessThanOrEqual(11);
		expect(failingSends.length).toBeLessThan(24 * 11);

		sameIdEverySend();
		// The ids held locally are the ones that went out: nothing re-minted.
		for (const [p, id] of firstId) expect(h.ids.get(p)).toBe(id);
		// Zero claims published before an ack.
		expect(h.published).toEqual([]);
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

		sameIdEverySend();
		expect(h.server.created.size).toBe(N);
		// Total ids minted == file count.
		expect(new Set(h.server.sent.map((x) => x.docId)).size).toBe(N);
		// Every note created once, under the id it first went out with.
		expect(new Map([...h.server.created].map(([id, p]) => [p, id]))).toEqual(firstId);
		expect([...h.server.createsPerId.values()].every((n) => n === 1)).toBe(true);
		// ...and claimed once, after its ack.
		expect(h.published.length).toBe(N);
		expect(h.published.every((x) => x.acked)).toBe(true);
		expect(new Set(h.published.map((x) => x.path)).size).toBe(N);
		for (const p of paths) expect(h.map.get(p)).toEqual({ note_id: firstId.get(p) });
	}, 120_000);
});
