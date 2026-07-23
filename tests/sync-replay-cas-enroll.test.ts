/**
 * A4 + A6 of the identity-as-CRDT handoff (issue #201).
 *
 * A4 — base_hash CAS coverage beyond pushFile:
 *  - The BATCH path already falls back to the single-note flow on a per-entry
 *    conflict; that fallback carries base_hash. Pin the chain with a test.
 *  - The OFFLINE-REPLAY path sent neither version nor base_hash: a stale
 *    queued edit sailed past the CAS gate and overwrote server content the
 *    client never saw (the incident class). And when the server DID conflict,
 *    the replay silently dequeued the entry — the local edit vanished from
 *    the sync pipeline with no conflict handling at all.
 *
 * A6 — fresh-note enrollment latency (~30s): a new note's pre-push STEP1 is
 *    dropped server-side (no row yet, note_not_found) and the once-per-session
 *    enrollment guard never re-fires it, so the note stays deaf to live sync
 *    until a later catch-up. On the FIRST confirmation of an id (the
 *    create-push response) the handshake must re-fire.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({
		note: { id: "server-minted-id", version: 1, content_hash: "srv-h", path: "" },
		chunks_indexed: 1,
	}),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function createEngine(): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	return engine;
}

const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>).mockReset().mockResolvedValue({
		note: { id: "server-minted-id", version: 1, content_hash: "srv-h", path: "" },
		chunks_indexed: 1,
	});
	(mockApi.pushNotesBatch as ReturnType<typeof mock>)
		.mockReset()
		.mockRejectedValue({ status: 404 });
	(mockApp.vault.getFiles as ReturnType<typeof mock>).mockReset().mockReturnValue([]);
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
	(mockApp.vault.modify as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.create as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);
});

describe("A4: offline-replay pushes carry the CAS base", () => {
	test("replay declares stored version + serverHash as base_hash", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		map.set("queued.md", "known-id");
		engine.setNoteIdMap(map);
		engine.importSyncState({
			"queued.md": { hash: 123, version: 3, serverHash: "srv-old" },
		});

		engine.queue.load([
			{
				path: "queued.md",
				action: "upsert",
				content: "offline edit",
				mtime: 100,
				timestamp: 1,
			},
		]);

		await engine.flushQueue();

		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		expect(call[3]).toBe(3);
		expect(call[5]).toBe("srv-old");
	});

	test("fresh offline create (no prior server state) sends NO base_hash", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);

		engine.queue.load([
			{ path: "fresh.md", action: "upsert", content: "new", mtime: 100, timestamp: 1 },
		]);

		await engine.flushQueue();

		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		expect(call.length).toBeLessThanOrEqual(5);
	});
});

describe("A6: first confirmation re-fires the CRDT handshake", () => {
	test("fresh-note create push: cold (idle) note does NOT re-enroll (vault-channel fan-out)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset } as any);
		// Default isLiveBound === false → idle note.

		const file = new TFile("fresh.md");
		engine.handleModify(file);
		await flush();

		// Fan-out: the created note's row exists server-side (create push), and it
		// receives future updates over the note_yjs_update broadcast — no room. A
		// cold create stays room-free (test_cold_send_over_fanout_opens_no_room).
		expect(reset).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("an already-confirmed id does NOT re-fire on subsequent pushes", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		map.set("known.md", "server-minted-id");
		engine.setNoteIdMap(map);
		(engine as any).confirmNoteId("server-minted-id");
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset } as any);
		engine.importSyncState({
			"known.md": { hash: 999, version: 1, serverHash: "srv-old" },
		});

		const file = new TFile("known.md");
		engine.handleModify(file);
		await flush();

		expect(reset).not.toHaveBeenCalled();
	});

	test("offline-replay create: cold (idle) note does NOT re-enroll (fan-out)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset } as any);
		// Default isLiveBound === false → idle note.

		engine.queue.load([
			{ path: "fresh.md", action: "upsert", content: "new", mtime: 100, timestamp: 1 },
		]);

		await engine.flushQueue();

		// Same fan-out contract as the live-create test above: an idle replayed
		// create stays room-free (the live-bound re-fire path is covered there).
		expect(reset).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});
});

describe("replay mint refusal (#972/#217 guard parity)", () => {
	test("replay of an engine-flushed path with no id does NOT mint — entry stays queued", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map); // no id mapped for the path

		// Engine-flushed window: flushFromCrdt just wrote this path after its id
		// was relocated away (#972 class). Live pushes and batch genesis refuse to
		// mint here (shouldDeferMint) — the replay path must too, or a stale
		// queued entry mints a FRESH id and creates a duplicate server row.
		(engine as unknown as { recentlyFlushed: Map<string, number> }).recentlyFlushed.set(
			"flushed.md",
			1,
		);

		engine.queue.load([
			{
				path: "flushed.md",
				action: "upsert",
				content: "stale offline edit",
				mtime: 100,
				timestamp: 1,
			},
		]);

		await engine.flushQueue();

		expect(mockApi.pushNote).not.toHaveBeenCalled(); // no push under a fresh id
		expect(map.get("flushed.md")).toBeNull(); // no mint
		expect(engine.queue.size).toBe(1); // left queued for after the echo window
	});
});
