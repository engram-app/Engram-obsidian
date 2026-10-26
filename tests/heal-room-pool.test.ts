/**
 * Engram#2242: one iPhone opened ~800 heal rooms in 3 minutes on session
 * start. Every diverged IDLE note whose room-free read was blocked (or switched
 * off for the session after two timeouts from a resuming socket) took its own
 * room, all at once, and so did every queued delivery whose room-free write
 * failed.
 *
 * The fake server here is a real round trip, not a stub that says yes: an
 * enroll() opens a room and the server's STEP2 arrives on a LATER macrotask
 * (that is what drives commitCrdtConvergence), and a release closes it. The
 * room-free ports really fail. So "rooms open at once" is measured, not
 * asserted from call counts.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { rlog } from "../src/remote-log";
import { IDLE_HEAL_ROOMS, SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS, type SyncNoteChange } from "../src/types";

const N = 500;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		getName: mock().mockReturnValue("Test Vault"),
	},
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

const path = (i: number) => `Notes/n${i}.md`;
const id = (i: number) => `id-${i}`;

/** A server that answers handshakes on a later macrotask and counts the rooms
 *  this device holds open at once, and when each one started. `dropStep2`
 *  loses the reply for a given (note, attempt). The clock is manual so the
 *  start budget can be measured in minutes without spending them. */
function harness(
	opts: {
		time?: ManualTimeProvider;
		liveBound?: Set<string>;
		dropStep2?: (noteId: string, attempt: number) => boolean;
	} = {},
) {
	const time = opts.time ?? new ManualTimeProvider(1_000_000);
	const engine = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		time,
	);
	engine.setCrdtManager({
		hasUndeliveredOps: () => false,
		hasCurrentDeliveryReceipt: () => false,
		applyRemoteUpdate: async () => true,
		markSynced: (noteId: string) => void engine.commitCrdtConvergence(noteId),
		closeDoc: () => {},
		encodeDeliveryReceipt: async () => new Uint8Array([1]),
		encodeStateAsUpdate: async () => new Uint8Array([1, 2, 3]),
		markDelivered: () => {},
	} as unknown as CrdtManager);
	engine.setReady();
	const map = new NoteIdMap();
	const state: Record<string, { hash: number; serverHash: string }> = {};
	for (let i = 0; i < N; i++) {
		map.set(path(i), id(i));
		state[path(i)] = { hash: 1, serverHash: "H1" };
	}
	engine.setNoteIdMap(map);
	engine.importSyncState(state);

	const rooms = {
		open: new Set<string>(),
		max: 0,
		starts: 0,
		startedAt: [] as number[],
		attempts: new Map<string, number>(),
		released: 0,
	};
	const liveBound = opts.liveBound ?? new Set<string>();
	const pendingStep2 = new Map<string, ReturnType<typeof setTimeout>>();
	engine.setCrdtEnrollment({
		enroll: (noteId: string) => {
			rooms.open.add(noteId);
			rooms.starts++;
			rooms.startedAt.push(time.now());
			rooms.max = Math.max(rooms.max, rooms.open.size);
			const attempt = (rooms.attempts.get(noteId) ?? 0) + 1;
			rooms.attempts.set(noteId, attempt);
			if (opts.dropStep2?.(noteId, attempt)) return;
			// The server's STEP2, one macrotask later, unless the room is closed
			// first: a released room (and a closed doc) never gets its reply.
			pendingStep2.set(
				noteId,
				setTimeout(() => {
					pendingStep2.delete(noteId);
					void engine.commitCrdtConvergence(noteId);
				}, 1),
			);
		},
		reset: () => {},
	} as any);
	engine.setCrdtPorts({
		release: (noteId: string) => {
			clearTimeout(pendingStep2.get(noteId));
			pendingStep2.delete(noteId);
			if (rooms.open.delete(noteId)) rooms.released++;
		},
		liveBound: (p: string) => liveBound.has(p),
	});
	const settle = async (
		done: () => boolean,
		stepMs = 4_000,
		maxSteps = 20_000,
	): Promise<void> => {
		for (let n = 0; n < maxSteps && !done(); n++) {
			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 1));
			if (!done()) time.advance(stepMs);
		}
	};
	return { engine, rooms, time, settle };
}

/** Most room starts in any 60 s window. */
function maxPerMinute(startedAt: number[]): number {
	let best = 0;
	for (let i = 0; i < startedAt.length; i++) {
		let n = 0;
		for (let j = i; j < startedAt.length && startedAt[j]! < startedAt[i]! + 60_000; j++) n++;
		best = Math.max(best, n);
	}
	return best;
}

const change = (i: number) =>
	({ id: id(i), path: path(i), content_hash: "H2", version: 2, seq: i + 1 }) as SyncNoteChange;

function coldConverge(engine: SyncEngine, i: number): Promise<void> {
	return (engine as any).convergeColdNoteRoomFree(id(i), path(i), change(i), "body", "H2");
}

const converged = (engine: SyncEngine) =>
	Object.values(engine.exportSyncState()).filter((s) => s.serverHash === "H2").length;

describe("idle heal rooms are pooled (Engram#2242)", () => {
	test(`${N} idle notes with TIMED-OUT room-free reads: all converge, at most ${IDLE_HEAL_ROOMS} rooms open at once`, async () => {
		const { engine, rooms, settle } = harness();
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < N; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === N && rooms.open.size === 0);

		expect(converged(engine)).toBe(N);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
		expect(rooms.open.size).toBe(0);
	});

	test(`${N} idle notes with UNDELIVERED ops (the read is not legal): same bound`, async () => {
		const { engine, rooms, settle } = harness();
		(engine as any).crdt.hasUndeliveredOps = () => true;
		engine.setCrdtPorts({ docState: mock().mockResolvedValue({ b64: "AQID", head: "h" }) });

		for (let i = 0; i < N; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === N && rooms.open.size === 0);

		expect(converged(engine)).toBe(N);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
	});

	test(`queue flush: ${N} idle entries whose room-free write fails all deliver, at most ${IDLE_HEAL_ROOMS} rooms at once`, async () => {
		const { engine, rooms, settle } = harness();
		engine.setCrdtLiveCheck(() => true);
		engine.setCrdtPorts({ docUpdate: mock().mockRejectedValue(new Error("timeout")) });
		for (let i = 0; i < N; i++) {
			await engine.queue.enqueue({
				path: path(i),
				action: "upsert",
				noteId: id(i),
				crdt: true,
				timestamp: i,
				vaultId: "v",
			});
		}

		await engine.flushQueue();
		await settle(() => engine.queue.size === 0 && rooms.open.size === 0);

		expect(engine.queue.size).toBe(0);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
	});

	test("with the crdt topic down, idle heals park (no room, no backoff spin) and run on the next join", async () => {
		const { engine, rooms, settle, time } = harness();
		let live = false;
		engine.setCrdtLiveCheck(() => live);
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < 20; i++) await coldConverge(engine, i);
		time.advance(60 * 60_000); // an hour offline
		await new Promise((r) => setTimeout(r, 5));

		expect(rooms.starts).toBe(0);

		live = true;
		await engine.selfHealSweep();
		await settle(() => converged(engine) === 20 && rooms.open.size === 0);

		expect(converged(engine)).toBe(20);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
	});

	test("a LIVE-BOUND note keeps its normal path: it handshakes at once even with the pool full", async () => {
		const live = path(N - 1);
		const { engine, rooms, settle } = harness({ liveBound: new Set([live]) });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < IDLE_HEAL_ROOMS * 3; i++) await coldConverge(engine, i);
		(engine as any).socketConverge(live, id(N - 1));

		expect(rooms.open.has(id(N - 1))).toBe(true);
		// Drain, so this engine's pool does not report into the next test.
		await settle(() => rooms.open.size === 1 && converged(engine) === IDLE_HEAL_ROOMS * 3);
	});

	test("the fallback reasons ship as counts-only anomalies, not a line per note", async () => {
		const anomaly = spyOn(rlog(), "anomaly");
		const { engine, rooms, settle } = harness();
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < 10; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === 10 && rooms.open.size === 0);

		const calls = anomaly.mock.calls.filter((c) => c[1] === "heal_room_fallback");
		anomaly.mockRestore();
		// Counts-only, one line per pool drain, never one per note.
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.length).toBeLessThan(10);
		const total = (key: string) =>
			calls.reduce((n, c) => n + Number((c[2] as Record<string, number>)[key] ?? 0), 0);
		// Two timeouts, then the latch: the other eight never ask.
		expect(total("doc_state_failed")).toBe(2);
		expect(total("doc_state_latched")).toBe(8);
	});
});

describe("idle heal rooms: the start budget and the lost-reply paths (Engram#2242)", () => {
	test("805 idle heals start at most 20 rooms in any minute, and all converge", async () => {
		const { engine, rooms, settle } = harness();
		const many = 805;
		const map = (engine as any).noteIdMap as NoteIdMap;
		const state: Record<string, { hash: number; serverHash: string }> = {};
		for (let i = N; i < many; i++) {
			map.set(path(i), id(i));
			state[path(i)] = { hash: 1, serverHash: "H1" };
		}
		engine.importSyncState({ ...engine.exportSyncState(), ...state });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < many; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === many && rooms.open.size === 0);

		expect(converged(engine)).toBe(many);
		expect(rooms.starts).toBe(many);
		expect(maxPerMinute(rooms.startedAt)).toBeLessThanOrEqual(20);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
	}, 30_000); // ~54 simulated minutes of pacing: slow on a loaded box

	test("a LOST reply plus a second poke inside the cooldown still converges (never dropped)", async () => {
		// The deaf-note class: the first STEP2 is lost on a dropping socket, and
		// the recovery poke lands while the room is still open.
		const { engine, rooms, time, settle } = harness({
			dropStep2: (noteId, attempt) => noteId === id(0) && attempt === 1,
		});
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });
		await coldConverge(engine, 0);
		expect(rooms.open.has(id(0))).toBe(true);
		time.advance(5_000);
		(engine as any).socketConverge(path(0), id(0), "other");

		await settle(() => converged(engine) === 1 && rooms.open.size === 0, 1_000);

		expect(converged(engine)).toBe(1);
		expect(rooms.attempts.get(id(0))).toBeGreaterThanOrEqual(2);
		expect(rooms.open.size).toBe(0);
	});

	test("a note the server never answers backs off, and cannot starve the other heals", async () => {
		const stuck = 8;
		const { engine, rooms, time, settle } = harness({
			dropStep2: (noteId) => Number(noteId.slice(3)) < stuck,
		});
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });
		for (let i = 0; i < stuck; i++) await coldConverge(engine, i);
		const t0 = time.now();
		await settle(() => time.now() - t0 >= 10 * 60_000, 5_000);

		// 30 s, doubling: about five tries in ten minutes, not two a minute.
		for (let i = 0; i < stuck; i++) expect(rooms.attempts.get(id(i))).toBeLessThanOrEqual(6);

		// A healthy note still heals promptly.
		await coldConverge(engine, stuck);
		const t1 = time.now();
		await settle(() => converged(engine) === 1, 1_000, 120);
		expect(converged(engine)).toBe(1);
		expect(time.now() - t1).toBeLessThan(60_000);
	});

	test("a note that later converges ROOM-FREE drops its retry backoff", async () => {
		const { engine, rooms, settle } = harness({ dropStep2: (noteId) => noteId === id(0) });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });
		await coldConverge(engine, 0);
		// The room times out: the note is now on its retry backoff.
		await settle(() => rooms.released >= 1, 1_000, 40);
		const before = rooms.starts;

		// Its queued edit then goes out room-free and is acked.
		engine.setCrdtLiveCheck(() => true);
		engine.setCrdtPorts({ docUpdate: mock(async () => ({ head: "h" })) });
		await engine.queue.enqueue({
			path: path(0),
			action: "upsert",
			noteId: id(0),
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		await engine.flushQueue();
		expect(engine.queue.size).toBe(0);

		// A later heal for it opens at once, not after the backoff.
		(engine as any).poolIdleHeal(path(0), id(0), "other");
		expect(rooms.starts).toBe(before + 1);
	});

	test("a room-free QUEUE delivery while the note's pull is still owed: it converges with no manual retrigger", async () => {
		// The queue leg delivers this device's ops, not the server's change, so
		// the pending heal is still owed and must run on its own.
		const { engine, rooms, settle } = harness({
			dropStep2: (noteId, attempt) => noteId === id(0) && attempt === 1,
		});
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });
		await coldConverge(engine, 0);
		await settle(() => rooms.released >= 1, 1_000, 40); // timed out, retry owed

		engine.setCrdtLiveCheck(() => true);
		engine.setCrdtPorts({ docUpdate: mock(async () => ({ head: "h" })) });
		await engine.queue.enqueue({
			path: path(0),
			action: "upsert",
			noteId: id(0),
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		await engine.flushQueue();

		await settle(() => converged(engine) === 1, 1_000, 15 * 60);
		expect(converged(engine)).toBe(1);
	});

	test("a room whose STEP2 never comes is CLOSED before its slot is reused", async () => {
		const { engine, rooms, settle } = harness({ dropStep2: (_id, attempt) => attempt === 1 });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < IDLE_HEAL_ROOMS * 2; i++) await coldConverge(engine, i);
		await settle(
			() => converged(engine) === IDLE_HEAL_ROOMS * 2 && rooms.open.size === 0,
			1_000,
		);

		expect(converged(engine)).toBe(IDLE_HEAL_ROOMS * 2);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
		expect(rooms.released).toBeGreaterThanOrEqual(IDLE_HEAL_ROOMS * 2);
	});

	test("a heal with NOTHING staged (gap heal) closes its room when the STEP2 lands", async () => {
		const { engine, rooms, settle } = harness();
		for (let i = 0; i < 10; i++) (engine as any).socketConverge(path(i), id(i), "other");

		await settle(() => rooms.starts === 10 && rooms.open.size === 0);

		expect(rooms.starts).toBe(10);
		expect(rooms.open.size).toBe(0);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
	});

	test("a vault switch with heals still waiting opens none of them and leaks no slot", async () => {
		const { engine, rooms, settle } = harness({ dropStep2: () => true });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });
		for (let i = 0; i < 20; i++) await coldConverge(engine, i);
		const before = rooms.starts;
		expect(before).toBe(IDLE_HEAL_ROOMS);

		await (engine as any).wipePerVaultState();
		await settle(() => false, 60_000, 5);

		expect(rooms.starts).toBe(before);
		expect((engine as any).idleHealRooms.active).toBe(0);
	});

	test("reason counts are rooms OPENED, not requests, and ship before the pool drains", async () => {
		const anomaly = spyOn(rlog(), "anomaly");
		const { engine, settle } = harness({ dropStep2: () => true });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });
		for (let i = 0; i < 3; i++) await coldConverge(engine, i);
		// Coalesced repeats of a waiting or open note are not new rooms.
		for (let i = 0; i < 3; i++) (engine as any).poolIdleHeal(path(i), id(i), "other");
		await settle(() => false, 1_000, 10);

		engine.flushHealRoomCounts(); // what main.ts does when the app is hidden
		const calls = anomaly.mock.calls.filter((c) => c[1] === "heal_room_fallback");
		anomaly.mockRestore();
		const total = (key: string) =>
			calls.reduce((n, c) => n + Number((c[2] as Record<string, number>)[key] ?? 0), 0);
		expect(total("doc_state_failed") + total("doc_state_latched")).toBeGreaterThanOrEqual(3);
		expect(total("other")).toBe(0);
	});
});

describe("room-free reads recover after timeouts (Engram#2242)", () => {
	test("two timeouts from a resuming socket do NOT switch room-free reads off for the session", async () => {
		const { engine, rooms, time } = harness();
		const docState = mock().mockRejectedValue(new Error("timeout"));
		engine.setCrdtPorts({ docState });

		// The phone resumes: two reads time out, which latches the frame.
		await coldConverge(engine, 0);
		await coldConverge(engine, 1);
		expect(docState).toHaveBeenCalledTimes(2);

		// The socket is healthy again a few minutes later.
		docState.mockResolvedValue({ b64: "AQID", head: "h" });
		time.advance(10 * 60_000);
		const startsBefore = rooms.starts;
		for (let i = 2; i < 50; i++) await coldConverge(engine, i);

		// The probe went through and every later note converged room-free.
		expect(docState.mock.calls.length).toBeGreaterThan(2);
		expect(rooms.starts).toBe(startsBefore);
	});
});
