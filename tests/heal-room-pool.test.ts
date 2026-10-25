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
import { ManualTimeProvider, type TimeProvider } from "../src/time-provider";
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
 *  this device holds open at once. */
function harness(opts: { time?: TimeProvider; liveBound?: Set<string> } = {}) {
	const engine = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		opts.time,
	);
	engine.setCrdtManager({
		hasUndeliveredOps: () => false,
		hasCurrentDeliveryReceipt: () => false,
		applyRemoteUpdate: async () => true,
		markSynced: (noteId: string) => void engine.commitCrdtConvergence(noteId),
		closeDoc: () => {},
		encodeDeliveryReceipt: async () => new Uint8Array([1]),
		encodeStateAsUpdate: async () => new Uint8Array([1, 2, 3]),
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

	const rooms = { open: new Set<string>(), max: 0, starts: 0 };
	const liveBound = opts.liveBound ?? new Set<string>();
	engine.setCrdtEnrollment({
		enroll: (noteId: string) => {
			rooms.open.add(noteId);
			rooms.starts++;
			rooms.max = Math.max(rooms.max, rooms.open.size);
			// The server's STEP2, one macrotask later.
			setTimeout(() => void engine.commitCrdtConvergence(noteId), 1);
		},
		reset: () => {},
	} as any);
	engine.setCrdtPorts({
		release: (noteId: string) => rooms.open.delete(noteId),
		liveBound: (p: string) => liveBound.has(p),
	});
	return { engine, rooms };
}

const change = (i: number) =>
	({ id: id(i), path: path(i), content_hash: "H2", version: 2, seq: i + 1 }) as SyncNoteChange;

function coldConverge(engine: SyncEngine, i: number): Promise<void> {
	return (engine as any).convergeColdNoteRoomFree(id(i), path(i), change(i), "body", "H2");
}

async function settle(done: () => boolean): Promise<void> {
	for (let n = 0; n < 5000 && !done(); n++) await new Promise((r) => setTimeout(r, 1));
}

const converged = (engine: SyncEngine) =>
	Object.values(engine.exportSyncState()).filter((s) => s.serverHash === "H2").length;

describe("idle heal rooms are pooled (Engram#2242)", () => {
	test(`${N} idle notes with TIMED-OUT room-free reads: all converge, at most ${IDLE_HEAL_ROOMS} rooms open at once`, async () => {
		const { engine, rooms } = harness();
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < N; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === N && rooms.open.size === 0);

		expect(converged(engine)).toBe(N);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
		expect(rooms.open.size).toBe(0);
	});

	test(`${N} idle notes with UNDELIVERED ops (the read is not legal): same bound`, async () => {
		const { engine, rooms } = harness();
		(engine as any).crdt.hasUndeliveredOps = () => true;
		engine.setCrdtPorts({ docState: mock().mockResolvedValue({ b64: "AQID", head: "h" }) });

		for (let i = 0; i < N; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === N && rooms.open.size === 0);

		expect(converged(engine)).toBe(N);
		expect(rooms.max).toBeLessThanOrEqual(IDLE_HEAL_ROOMS);
	});

	test(`queue flush: ${N} idle entries whose room-free write fails all deliver, at most ${IDLE_HEAL_ROOMS} rooms at once`, async () => {
		const { engine, rooms } = harness();
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

	test("a LIVE-BOUND note keeps its normal path: it handshakes at once even with the pool full", async () => {
		const live = path(N - 1);
		const { engine, rooms } = harness({ liveBound: new Set([live]) });
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < IDLE_HEAL_ROOMS * 3; i++) await coldConverge(engine, i);
		(engine as any).socketConverge(live, id(N - 1));

		expect(rooms.open.has(id(N - 1))).toBe(true);
	});

	test("the fallback reasons ship as one counts-only anomaly per burst", async () => {
		const anomaly = spyOn(rlog(), "anomaly");
		const { engine, rooms } = harness();
		engine.setCrdtPorts({ docState: mock().mockRejectedValue(new Error("timeout")) });

		for (let i = 0; i < 10; i++) await coldConverge(engine, i);
		await settle(() => converged(engine) === 10 && rooms.open.size === 0);

		const calls = anomaly.mock.calls.filter((c) => c[1] === "heal_room_fallback");
		anomaly.mockRestore();
		expect(calls.length).toBe(1);
		// Two timeouts, then the latch: the other eight never ask.
		expect(calls[0]?.[2]).toMatchObject({ doc_state_failed: 2, doc_state_latched: 8 });
	});
});

describe("room-free reads recover after timeouts (Engram#2242)", () => {
	test("two timeouts from a resuming socket do NOT switch room-free reads off for the session", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const { engine, rooms } = harness({ time });
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
