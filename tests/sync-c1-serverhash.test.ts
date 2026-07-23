/**
 * C1 WS-event branch must record the CAS base (issue #203, e2e test_83).
 *
 * A note received while CRDT-managed takes handleStreamEvent's C1 branch:
 * body apply is delegated to the CRDT room (flushFromCrdt) and the legacy
 * apply is skipped — but the branch never recorded syncState.serverHash.
 * A device whose ONLY knowledge of a note came via C1 therefore had no CAS
 * base: its later REST-fallback push (channel down — exactly the
 * missed-delivery scenario) declared no base_hash, sailed past the v0.5.642
 * CAS gate, and silently erased server content it never saw. Proven live by
 * e2e test_83_missed_delivery_no_deletion.
 *
 * The WS event carries the REST-level content_hash + version: record them.
 */
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	getRateLimit: mock().mockResolvedValue(0),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getManifest: mock().mockResolvedValue(null),
	getNote: mock().mockResolvedValue({ path: "", content: "" }),
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

beforeEach(() => {
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
	(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
	(mockApi.getNote as ReturnType<typeof mock>).mockClear().mockResolvedValue({
		path: "",
		content: "",
	});
});

describe("C1 branch records the CAS base from the WS event", () => {
	test("upsert event for a CRDT-managed note stores serverHash + version", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
		} as any);
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "received.md",
			id: "note-id-1",
			content_hash: "srv-h-1",
			version: 5,
		} as any);

		// The C1 branch delegated the body to CRDT delivery — but the CAS base
		// must be recorded NOW, from the event, or this device pushes blind
		// after a disconnect (e2e test_83's silent server-edit deletion).
		const stored = engine.exportSyncState()["received.md"];
		expect(stored?.serverHash).toBe("srv-h-1");
		expect(stored?.version).toBe(5);
	});

	test("an existing CONVERGED base is never clobbered by an announcement", async () => {
		// serverHash means "server content this device actually converged to".
		// Stamping the ANNOUNCED hash over a real converged base would mark a
		// note converged before the CRDT body lands — if that delivery is then
		// missed, every recovery path (hash-skip, resolveChangeBody,
		// verifyConvergenceOnOpen) reads "converged" and the stale body sticks
		// silently. Seed a base only when none exists.
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
		} as any);
		const map = new NoteIdMap();
		map.set("received.md", "note-id-1");
		engine.setNoteIdMap(map);
		engine.importSyncState({
			"received.md": { hash: 777, version: 5, serverHash: "srv-h-1" },
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "received.md",
			id: "note-id-1",
			content_hash: "srv-h-2",
			version: 6,
		} as any);

		const stored = engine.exportSyncState()["received.md"];
		expect(stored?.serverHash).toBe("srv-h-1");
		expect(stored?.version).toBe(5);
		expect(stored?.hash).toBe(777);
	});

	test("baseless entry (file raced onto disk first) still gets the seed", async () => {
		// The CRDT room delivery and the WS event race: flushFromCrdt may write
		// the file (recording only a local hash, never serverHash) before the
		// event processes. The gate must key on "no CAS base yet", not on file
		// existence — otherwise the raced ordering re-opens the blind-push hole.
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
		} as any);
		const map = new NoteIdMap();
		map.set("received.md", "note-id-1");
		engine.setNoteIdMap(map);
		engine.importSyncState({
			"received.md": { hash: 777 },
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "received.md",
			id: "note-id-1",
			content_hash: "srv-h-1",
			version: 3,
		} as any);

		const stored = engine.exportSyncState()["received.md"];
		expect(stored?.serverHash).toBe("srv-h-1");
		expect(stored?.version).toBe(3);
		expect(stored?.hash).toBe(777);
	});
});

describe("C1 branch enrolls a CRDT room ONLY for a live-bound note", () => {
	// Vault-channel fan-out: an IDLE note received via note_changed converges
	// room-free over the note_yjs_update broadcast (applyPushedNoteUpdate) or the
	// pull backstop. Enrolling a room for it defeats the fan-out isolation and
	// re-opens the connect-storm (a room per note that ever received a live edit).
	// The pull path already gates its discovery enroll on isLiveBound
	// (sync.ts:4023/4053) — the live-stream path must match.
	function fakeEnrollment() {
		return { enroll: mock((_id: string) => {}), reset: mock((_id: string) => {}) };
	}

	test("idle (not live-bound) upsert does NOT enroll a room", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		const enrollment = fakeEnrollment();
		engine.setCrdtEnrollment(enrollment as any);
		engine.setLiveBoundCheck(() => false);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "idle.md",
			id: "note-id-idle",
			content_hash: "srv-h",
			version: 1,
		} as any);

		expect(enrollment.enroll).not.toHaveBeenCalled();
	});

	test("live-bound upsert DOES enroll the room", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		const enrollment = fakeEnrollment();
		engine.setCrdtEnrollment(enrollment as any);
		engine.setLiveBoundCheck(() => true);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "open.md",
			id: "note-id-open",
			content_hash: "srv-h",
			version: 1,
		} as any);

		expect(enrollment.enroll).toHaveBeenCalledWith("note-id-open");
	});
});

describe("C1 branch routes a first-delivery idle note to the op-log (Phase E3)", () => {
	// A never-seen IDLE note materialized only via the CRDT room needs its doc
	// SYNCED to write (materializeRelocated bails otherwise), and an idle note is
	// deliberately NOT enrolled (fan-out isolation). The broadcast is hash-only
	// and getNote-for-sync is deleted (Phase E3): the event routes to the op-log
	// seq-replay, whose rows carry the real content.
	function fakeEnrollment() {
		return { enroll: mock((_id: string) => {}), reset: mock((_id: string) => {}) };
	}

	test("idle hash-only upsert with no local file routes to the seq-replay — never fetches", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			isSynced: mock().mockReturnValue(false),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		engine.setCrdtEnrollment(fakeEnrollment() as any);
		engine.setLiveBoundCheck(() => false);
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "new.md",
			id: "note-id-new",
			content_hash: "srv-h",
			version: 1,
		} as any);

		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(replay).toHaveBeenCalled();
	});

	test("an idle note ALREADY on disk is not re-fetched (the backstop path owns it)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			isSynced: mock().mockReturnValue(false),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		engine.setCrdtEnrollment(fakeEnrollment() as any);
		engine.setLiveBoundCheck(() => false);
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue({
			path: "exists.md",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "exists.md",
			id: "note-id-exists",
			content_hash: "srv-h",
			version: 1,
		} as any);

		expect(mockApi.getNote).not.toHaveBeenCalled();
	});

	test("a live-bound first delivery is left to its room (no eager write)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			isSynced: mock().mockReturnValue(false),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		engine.setCrdtEnrollment(fakeEnrollment() as any);
		engine.setLiveBoundCheck(() => true);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "open.md",
			id: "note-id-open2",
			content_hash: "srv-h",
			version: 1,
		} as any);

		expect(mockApi.getNote).not.toHaveBeenCalled();
	});
});
