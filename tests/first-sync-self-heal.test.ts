/**
 * First sync must self-heal: no local note is ever silently left unsynced.
 *
 * Prod 2026-10-09: a ~680-note vault connected from Android over mobile data.
 * The server got 77 notes, then nothing. The CRDT op queue dropped the rest
 * (overflow at 500, attempts burned while disconnected, TTL), nothing ever
 * re-pushed a dropped create, and no client log said so.
 *
 * These drive the REAL SyncEngine push path and the REAL CrdtOpQueue +
 * makeCrdtOpSend against a fake server that flaps, and assert the property
 * (every note is created server-side, without user action), not the route.
 */
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import type { GenesisOutcome } from "../src/channel";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { makeCrdtOpSend } from "../src/crdt-op-dispatch";
import { type CrdtOp, CrdtOpQueue, type DropReason } from "../src/crdt-op-queue";
import { destroyRemoteLog, initRemoteLog } from "../src/remote-log";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

/** A fake server behind a flapping socket. */
function fakeServer() {
	const created = new Map<string, string>(); // docId -> path
	const state = { up: false, createCalls: 0 };
	const channel = {
		crdtCreate: async (
			docId: string,
			path: string,
			_b64?: string,
		): Promise<{ docId: string; seeded: boolean; genesisOutcome: GenesisOutcome }> => {
			state.createCalls++;
			if (!state.up) throw new Error("crdt topic not joined");
			created.set(docId, path);
			return { docId, seeded: false, genesisOutcome: null };
		},
		crdtDeleteAcked: async (docId: string) => ({ doc_id: docId }),
	};
	return { created, state, channel, paths: () => new Set(created.values()) };
}

function makeVault(paths: string[], mtime = 1000) {
	const files = new Map(paths.map((p) => [p, new TFile(p, mtime)]));
	return {
		files,
		app: {
			vault: {
				configDir: ".obsidian",
				read: mock(async (f: TFile) => `body of ${f.path}`),
				cachedRead: mock(async (f: TFile) => `body of ${f.path}`),
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
		} as any,
	};
}

const makeApi = (over: Partial<Record<string, unknown>> = {}) =>
	({
		pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		pushAttachment: mock().mockResolvedValue({ attachment: {} }),
		deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
		getRateLimit: mock().mockResolvedValue(0),
		getManifest: mock().mockResolvedValue({ unchanged: true }),
		...over,
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

/** Engine + queue wired exactly the way main.ts wires them. */
function harness(paths: string[], opts: { mtime?: number; api?: EngramApi } = {}) {
	const server = fakeServer();
	const { app, files } = makeVault(paths, opts.mtime);
	const time = new ManualTimeProvider(5000);
	const engine = new SyncEngine(
		app,
		opts.api ?? makeApi(),
		{ ...DEFAULT_SETTINGS, debounceMs: 1, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
		time,
	);
	engine.setCrdtManager(crdtStub() as unknown as CrdtManager);
	engine.setReady();
	engine.setNoteIdMap(new NoteIdMap());
	engine.setCrdtEnrollment({ enroll: () => {}, reset: () => {} });

	let clock = 0;
	const drops: Array<{ op: CrdtOp; reason: DropReason }> = [];
	const queue = new CrdtOpQueue({
		send: makeCrdtOpSend({
			channel: () => (server.state.up ? server.channel : null),
			onCreated: (localId, serverId, path, seeded, genesis, outcome) =>
				engine.applyCrdtCreateAck(localId, serverId, path, seeded, genesis, outcome),
			onTerminal: () => {},
		}),
		now: () => clock,
		currentVaultId: () => "v1",
		onDrop: (op, reason) => drops.push({ op, reason }),
	});
	engine.setCrdtHasPendingOp((docId) =>
		queue.all().some((op) => op.docId === docId && op.kind === "create"),
	);
	let joined = false;
	engine.setCrdtPorts({
		create: (id, path, b64) => server.channel.crdtCreate(id, path, b64),
		live: () => joined && server.state.up,
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
	return {
		engine,
		queue,
		server,
		files,
		drops,
		time,
		advance: (ms: number) => {
			clock += ms;
		},
		/** The socket comes up and the crdt: topic joins (main.ts order:
		 *  queue flush first, then the join handler's sweep). */
		join: async () => {
			server.state.up = true;
			joined = true;
			await queue.onJoined();
		},
		leave: () => {
			server.state.up = false;
			joined = false;
			queue.onLeft();
		},
	};
}

const notes = (n: number) => Array.from({ length: n }, (_, i) => `Notes/n${i}.md`);

afterEach(async () => {
	await destroyRemoteLog();
});

describe("first sync over a flapping channel", () => {
	test("(a) 650 new notes, channel flaps past 8 ticks and the TTL: every note is created", async () => {
		const paths = notes(650);
		const h = harness(paths);

		// Startup while the socket is still down: every create is HELD.
		await h.engine.pushModifiedFiles();
		// 650 > MAX_QUEUE (500): the overflow is real, and recoverable.
		expect(h.drops.filter((d) => d.reason === "overflow").length).toBe(150);

		// The channel joins, delivers a few, then drops mid-flush.
		let sent = 0;
		const realCreate = h.server.channel.crdtCreate;
		h.server.channel.crdtCreate = async (...args) => {
			if (++sent === 40) h.leave();
			return realCreate(...args);
		};
		await h.join();
		h.server.channel.crdtCreate = realCreate;
		expect(h.server.created.size).toBeLessThan(paths.length);

		// Twenty ticks of outage (> MAX_ATTEMPTS) over twenty minutes (> TTL).
		for (let i = 0; i < 20; i++) {
			h.advance(60_000);
			await h.queue.tick();
		}
		expect(h.drops.filter((d) => d.reason !== "overflow")).toEqual([]);

		// Reconnect: the queue flushes, then the join's self-heal sweep runs.
		await h.join();
		await h.engine.selfHealSweep();

		expect(h.server.paths()).toEqual(new Set(paths));
		expect(h.queue.size()).toBe(0);
	});

	test("(b) a dropped create is re-pushed by the sweep", async () => {
		const h = harness(["Notes/a.md", "Notes/b.md"]);
		await h.engine.pushModifiedFiles(); // both held
		// Force a drop the way overflow / max-attempts would.
		const victim = h.queue.all()[0];
		(h.queue as unknown as { entries: Map<string, unknown> }).entries.delete(victim.docId);

		await h.join();
		expect(h.server.paths()).toEqual(new Set(["Notes/b.md"]));

		await h.engine.selfHealSweep();
		expect(h.server.paths()).toEqual(new Set(["Notes/a.md", "Notes/b.md"]));
		// Same id: the sweep reuses the minted id, it does not mint a second one.
		expect(h.server.created.has(victim.docId)).toBe(true);
	});

	test("a create still pending in the queue is left to the queue, not double-sent", async () => {
		const h = harness(["Notes/a.md"]);
		await h.engine.pushModifiedFiles(); // held
		h.server.state.up = true; // socket up, but the queue has not flushed yet
		const res = await h.engine.selfHealSweep();
		expect(res.pushed).toBe(0);
		expect(h.server.state.createCalls).toBe(0);
	});
});

describe("self-heal sweep guards", () => {
	test("(d) does nothing while the sync gate is closed", async () => {
		const h = harness(["Notes/a.md"]);
		await h.join();
		h.engine.setSyncBlocked(true);
		const res = await h.engine.selfHealSweep();
		expect(res.ran).toBe(false);
		expect(h.server.state.createCalls).toBe(0);
	});

	test("(d) does nothing while a push sweep is already running", async () => {
		const h = harness(["Notes/a.md"]);
		await h.join();
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const inner = spyOn(h.engine as any, "pushModifiedFilesInner").mockImplementation(
			async () => {
				await gate;
				return { pushed: 0, failed: 0 };
			},
		);
		const running = h.engine.pushModifiedFiles();
		const res = await h.engine.selfHealSweep();
		expect(res.ran).toBe(false);
		release();
		await running;
		// The sweep did not join the running push and schedule a rerun either.
		expect(inner).toHaveBeenCalledTimes(1);
	});

	test("(d) does nothing while a full sync is running", async () => {
		const h = harness(["Notes/a.md"]);
		await h.join();
		const spy = spyOn(h.engine, "pushModifiedFiles");
		await (h.engine as any).inBulkSweep(async () => {
			const res = await h.engine.selfHealSweep();
			expect(res.ran).toBe(false);
		});
		expect(spy).not.toHaveBeenCalled();
	});

	test("empty vault: no-op", async () => {
		const h = harness([]);
		await h.join();
		const spy = spyOn(h.engine, "pushModifiedFiles");
		const res = await h.engine.selfHealSweep();
		expect(res).toMatchObject({ ran: true, candidates: 0, pushed: 0 });
		expect(spy).not.toHaveBeenCalled();
	});

	test("already-synced vault: no push, no file reads", async () => {
		const h = harness(notes(5));
		await h.join();
		await h.engine.pushModifiedFiles(); // creates all five live
		expect(h.server.created.size).toBe(5);
		h.server.state.createCalls = 0;
		const spy = spyOn(h.engine, "pushModifiedFiles");

		const res = await h.engine.selfHealSweep();
		expect(res).toMatchObject({ ran: true, candidates: 0, pushed: 0 });
		expect(spy).not.toHaveBeenCalled();
		expect(h.server.state.createCalls).toBe(0);
	});

	test("offline the whole time: nothing sent, nothing dropped, nothing lost", async () => {
		const h = harness(notes(3));
		await h.engine.pushModifiedFiles();
		for (let i = 0; i < 20; i++) {
			h.advance(60_000);
			await h.queue.tick();
			await h.engine.selfHealSweep();
		}
		expect(h.server.created.size).toBe(0);
		expect(h.drops).toEqual([]);
		expect(h.queue.size()).toBe(3);
		// And it all lands the moment the channel comes up.
		await h.join();
		await h.engine.selfHealSweep();
		expect(h.server.created.size).toBe(3);
	});
});

describe("(e) self-heal telemetry carries counts, never paths", () => {
	test("the sweep reports what it healed without naming a file", async () => {
		const sent: Array<{ level: string; category: string; message: string }> = [];
		const logger = initRemoteLog();
		logger.configure(
			async (batch: any[]) => {
				sent.push(...batch);
			},
			"test",
			"test",
		);
		logger.setEnabled(false); // the default: diagnostics OFF

		const h = harness(["Secret/Divorce settlement draft.md"]);
		await h.engine.pushModifiedFiles();
		(h.queue as unknown as { entries: Map<string, unknown> }).entries.clear();
		await h.join();
		await h.engine.selfHealSweep();
		await logger.flush();

		const line = sent.find((e) => e.message.startsWith("self_heal_sweep"));
		expect(line?.level).toBe("warn");
		expect(line?.message).toContain("pushed=1");
		for (const e of sent) {
			expect(e.message).not.toContain("Secret");
			expect(e.message).not.toContain("Divorce");
		}
	});
});
