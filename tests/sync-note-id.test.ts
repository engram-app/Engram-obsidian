/**
 * Tests: Task 5 of the note_id-keyed CRDT rework.
 * - the pull/`changes` apply path (applySyncChange, the merged /sync/changes
 *   feed) learns a note's id into the NoteIdMap.
 * - handleRename re-keys the map (id stable, path moves).
 */
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// A compliant backend adopts the client_id sent by the plugin and echoes it
// back as the authoritative note.id (per the brief: "server adopts it"). The
// mock models that contract so pushFile's post-response noteIdMap.set (which
// always trusts resp.note.id, since a NON-adopting backend must still be able
// to correct a locally-minted id) doesn't clobber the id under test.
function pushNoteResponse(
	_path: string,
	_content: string,
	_mtime: number,
	_version?: number,
	clientId?: string,
) {
	return Promise.resolve({ note: { id: clientId ?? "server-minted-id" }, chunks_indexed: 1 });
}

const mockApi = {
	pushNote: mock(pushNoteResponse),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "n.md",
		title: "n",
		content: "body",
		folder: "",
		tags: [],
		mtime: 1,
	}),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue({
		path: "",
		content_base64: "",
		mime_type: "",
		size_bytes: 0,
		mtime: 0,
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: mock().mockResolvedValue({
		id: "v1",
		name: "Test",
		slug: "test",
		is_default: true,
	}),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
			Promise.resolve(fn("")),
		),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
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

function flush(ms = 50): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Declare the server's authoritative {id, path} state for the destructive-op
 *  guard: moveIfIdRelocated refuses to trash a path unless the manifest either
 *  omits it (genuinely renamed away) or lists it under the SAME id. A legit
 *  server rename therefore needs the manifest to reflect the note at its NEW
 *  path — which is what a real fresh manifest says. */
function manifestWith(notes: Array<{ id: string; path: string }>) {
	(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValue({
		notes: notes.map((n) => ({ ...n, content_hash: "h" })),
		attachments: [],
		total_notes: notes.length,
		total_attachments: 0,
		change_seq: 1,
	});
}

beforeEach(() => {
	(mockApi.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
	(mockApi.pushNote as ReturnType<typeof mock>).mockReset().mockImplementation(pushNoteResponse);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
});

describe("pull/changes apply path learns note_id into the map", () => {
	test("applySyncChange captures id from a merged /sync/changes note entry", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		await engine.applySyncChange({
			type: "note",
			id: "id-9",
			seq: 1,
			path: "a.md",
			title: "a",
			content: "body",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		});

		expect(noteIdMap.get("a.md")).toBe("id-9");
	});
});

describe("handleRename re-keys the map, id unchanged", () => {
	test("moves the id from oldPath to the new path", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("a.md", "id-1");
		engine.setNoteIdMap(noteIdMap);

		const fileB = new TFile("b.md");
		await engine.handleRename(fileB, "a.md");

		expect(noteIdMap.get("a.md")).toBeNull();
		expect(noteIdMap.get("b.md")).toBe("id-1");
	});
});

describe("rename/delete drop stale sync-state (echo-suppression on recreate)", () => {
	// Uses a .canvas fixture: markdown notes no longer REST-push via pushFile
	// (CRDT-sole), so a .md edit records no sync-state entry to assert against.
	// The sync-state cleanup on rename/delete is transport-agnostic — the kept
	// LWW REST path for .canvas exercises the exact same syncState bookkeeping.
	test("handleRename removes the old path's sync-state entry", async () => {
		const engine = createEngine();
		engine.setNoteIdMap(new NoteIdMap());

		// Push a.canvas so it gets a sync-state entry (recorded content hash).
		engine.handleModify(new TFile("a.canvas"));
		await flush();
		expect(engine.exportSyncState()["a.canvas"]).toBeDefined();

		// Rename a.canvas -> b.canvas. The old path no longer holds a note, so its
		// stale sync-state must be dropped (else a later create at a.canvas with
		// the same content echo-suppresses and never syncs).
		await engine.handleRename(new TFile("b.canvas"), "a.canvas");

		expect(engine.exportSyncState()["a.canvas"]).toBeUndefined();
	});

	test("handleDelete removes the deleted path's sync-state entry", async () => {
		const engine = createEngine();
		engine.setNoteIdMap(new NoteIdMap());

		engine.handleModify(new TFile("a.canvas"));
		await flush();
		expect(engine.exportSyncState()["a.canvas"]).toBeDefined();

		await engine.handleDelete(new TFile("a.canvas"));

		expect(engine.exportSyncState()["a.canvas"]).toBeUndefined();
	});
});

describe("id-keyed move: pull upsert at a new path for a known id trashes the old file", () => {
	test("applySyncChange moves the note instead of leaving a duplicate", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-move");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-move", path: "New.md" }]);

		// The old path exists on disk; the new path does not yet.
		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();

		// The server MOVED the row (same id, new path). The pull feed carries only
		// the upsert at the new path — no separate delete for the old path.
		await engine.applySyncChange({
			type: "note",
			id: "id-move",
			seq: 2,
			path: "New.md",
			title: "New",
			content: "body",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		} as any);

		// Old file trashed, id re-keyed to the new path, no lingering old mapping.
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		expect(noteIdMap.pathForId("id-move")).toBe("New.md");
		expect(noteIdMap.get("Old.md")).toBeNull();
	});

	test("handleStreamEvent moves on a realtime upsert for a known id (belt-and-suspenders)", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-ws-move");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-ws-move", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();

		// A realtime upsert arrives at the new path with the stable id — no
		// preceding delete broadcast (missed/reordered).
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-ws-move",
			path: "New.md",
			timestamp: 2,
			content: "body",
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		expect(noteIdMap.pathForId("id-ws-move")).toBe("New.md");
		expect(noteIdMap.get("Old.md")).toBeNull();
	});

	test("relocation runs even when the new path was echo-suppressed", async () => {
		// The receiver's CRDT room is bound to the old path; incoming channel
		// traffic re-materializes + re-pushes the new path, so it lands in the
		// echo-suppression set. If the realtime upsert at the new path is
		// echo-skipped BEFORE relocation, the room stays bound to the old path
		// and perpetually resurrects it (e2e test_10). Relocation must run first.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-echo-move");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-echo-move", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();
		// This device just pushed the new path -> echo-suppressed.
		(engine as unknown as { markRecentlyPushed(p: string): void }).markRecentlyPushed("New.md");

		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-echo-move",
			path: "New.md",
			timestamp: 2,
			content: "body",
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		expect(noteIdMap.pathForId("id-echo-move")).toBe("New.md");
	});
});

describe("CRDT-managed rename materializes the new path when enroll() no-ops (#189)", () => {
	test("handleStreamEvent writes New.md from the already-synced CRDT doc", async () => {
		// e2e test_10: B already received Old.md live (this session) before A
		// renames it. moveIfIdRelocated trashes Old.md and re-keys the map, but
		// a rename changes no doc content, so no Y.Doc update ever fires
		// onFlushToDisk — and crdtEnrollment.enroll() is a documented
		// per-session no-op for an id already enrolled. Without a direct
		// materialize, New.md is never written: received=yes materialized=no.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-relocate");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-relocate", path: "New.md" }]);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockImplementation(
			(p: string) => (p === "Old.md" ? oldFile : null),
		);
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);

		const projectedText = mock().mockResolvedValue("# Rename Test\nunchanged body");
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText,
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		// Realtime rename broadcast — no content/content_hash on the wire, same
		// shape as the server's real "Event: upsert" for a pure path move.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-relocate",
			path: "New.md",
			timestamp: 2,
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		expect(projectedText).toHaveBeenCalledWith("id-relocate");
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"New.md",
			"# Rename Test\nunchanged body",
		);
	});

	test("a LIVE-BOUND note whose CRDT handshake hasn't completed does NOT materialize (avoids premature-empty writes)", async () => {
		// A live-bound (open in the editor) note enrolls a room and isSynced() is
		// still false until its STEP2 lands. Its editor/room owns the body, so the
		// upsert must not write — materializing here would risk an empty/partial
		// file (#547 class); it stays on the STEP2->onFlushToDisk path. (An IDLE
		// first delivery is different: it joins no room and may have missed the
		// fan-out, so it materializes from AUTHORITATIVE fetched content — covered
		// in sync-crdt-gate / sync-c1-serverhash.)
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		engine.setLiveBoundCheck(() => true);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();

		const projectedText = mock().mockResolvedValue("");
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(false),
			projectedText,
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-fresh",
			path: "Fresh.md",
			timestamp: 1,
			title: "Fresh",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(projectedText).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});
});

describe("moveIfIdRelocated materializes the new path from ON-DISK content directly (round 2, e2e test_10 mechanism a)", () => {
	test("writes New.md from the old file's disk content even when isSynced is still false (fresh-boot receiver race)", async () => {
		// CI evidence (backend PR #950): test_10 STILL showed
		// "received=yes materialized=no" on the renamed NEW path even with the
		// #189 materializeRelocated fix present. Root cause: materializeRelocated
		// is correctly gated on `crdt.isSynced(noteId)` (declining avoids the
		// #547 premature-empty-write class), but on a fresh-boot receiver the
		// rename event can arrive before this device's own STEP2 handshake for
		// the note_id has landed THIS session — isSynced() reads false, the gate
		// declines, and nothing ever retries (no timer, no later hook). Relying
		// SOLELY on the CRDT handshake to backfill the new path is unnecessary:
		// the OLD file's on-disk content is already real, trustworthy content
		// (this device received it live before the rename). moveIfIdRelocated
		// should read it and flush it to the new path directly — independent of
		// CRDT session state — closing the race for good.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-fresh-race");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-fresh-race", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# Rename Test\nreal content already on disk",
		);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();

		// isSynced is FALSE — this device's STEP2 handshake for this note_id has
		// not landed this session (the fresh-boot race). The old materialize
		// path (gated on isSynced) must decline; the fix must not need it.
		const projectedText = mock().mockResolvedValue("");
		engine.setCrdtManager({ isSynced: mock().mockReturnValue(false), projectedText } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-fresh-race",
			path: "New.md",
			timestamp: 2,
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"New.md",
			"# Rename Test\nreal content already on disk",
		);
		// The isSynced-gated CRDT backstop must not have been needed at all —
		// the disk-content path materialized New.md first.
		expect(projectedText).not.toHaveBeenCalled();
	});

	test("does NOT materialize (no source content) when the old file never existed locally — leaves the isSynced-gated backstop in charge", async () => {
		// If this device never had the note on disk at all (only ever knew it
		// via CRDT), there is no on-disk content to read — moveIfIdRelocated's
		// disk-content path must no-op (oldFile null) and defer entirely to the
		// existing isSynced-gated materializeRelocated backstop, unchanged.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-no-disk");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-no-disk", path: "New.md" }]);

		// No file at Old.md locally.
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReturnValue(null);
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();

		const projectedText = mock().mockResolvedValue("# from CRDT doc");
		engine.setCrdtManager({ isSynced: mock().mockReturnValue(true), projectedText } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-no-disk",
			path: "New.md",
			timestamp: 2,
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		// No file to trash, but the isSynced-gated backstop still materializes
		// New.md from the CRDT doc.
		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
		expect(projectedText).toHaveBeenCalledWith("id-no-disk");
		expect(mockApp.vault.create).toHaveBeenCalledWith("New.md", "# from CRDT doc");
	});
});

describe("moveIfIdRelocated survives the old file vanishing MID-FLIGHT (round 4, e2e test_10 CI run 28915097812)", () => {
	// Artifact trace (backend run 28915097812, B = device c151add9): the WS
	// delete for the OLD path arrives first and is deferred to a pull; the WS
	// upsert for the NEW path then enters moveIfIdRelocated and suspends on
	// `await manifestOwnerOf` (network). While suspended, the pull applies the
	// delete tombstone and trashes the OLD file. moveIfIdRelocated resumes,
	// cachedRead/trashFile hit the now-gone file and REJECT — and because
	// handleStreamEvent's hoisted call sits OUTSIDE its try/catch, the whole
	// upsert dies as an unhandled rejection: no relocation, no CRDT-branch
	// materialize, no file. received=yes materialized=no, 30s timeout.
	test("trashFile rejecting (concurrent tombstone won the race) must not drop the materialize", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-race-trash");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-race-trash", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# Rename Test\ndisk content read before the race",
		);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockRejectedValue(
			new Error("File does not exist"),
		);

		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock().mockResolvedValue(""),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		try {
			// Must resolve (not reject) AND still write New.md from the content
			// already read off disk — the trash failing means the concurrent
			// tombstone already removed the old file, which is the outcome the
			// trash wanted anyway.
			await engine.handleStreamEvent({
				event_type: "upsert",
				kind: "note",
				id: "id-race-trash",
				path: "New.md",
				timestamp: 2,
				title: "New",
				folder: "",
				tags: [],
				mtime: 2,
				updated_at: "2026-01-01T00:00:00Z",
			} as any);
		} finally {
			(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockReset();
			(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockResolvedValue(undefined);
		}

		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"New.md",
			"# Rename Test\ndisk content read before the race",
		);
	});

	test("cachedRead rejecting (file gone before the read) falls through to the isSynced backstop", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-race-read");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-race-read", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		// Lookup still returns the TFile (stale handle), but the read rejects —
		// the pull's tombstone deleted the file between lookup and read.
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockRejectedValue(
			new Error("ENOENT: no such file"),
		);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();

		const projectedText = mock().mockResolvedValue("# from CRDT doc");
		engine.setCrdtManager({ isSynced: mock().mockReturnValue(true), projectedText } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		// Must resolve; with no readable disk content the CRDT-branch backstop
		// (materializeRelocated, isSynced=true — STEP2 landed when the old path
		// materialized earlier this session) writes New.md from the doc.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-race-read",
			path: "New.md",
			timestamp: 2,
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(projectedText).toHaveBeenCalledWith("id-race-read");
		expect(mockApp.vault.create).toHaveBeenCalledWith("New.md", "# from CRDT doc");
	});

	test("cachedRead rejecting AND the isSynced backstop declining triggers an immediate catch-up (final review MINOR-7)", async () => {
		// Neither materialize path can land the note: no disk content to flush
		// (cachedRead rejected) and the CRDT handshake for this note_id hasn't
		// completed yet this session (isSynced=false), so materializeRelocated's
		// backstop also declines. Left alone, the note stays invisible on this
		// device until the next scheduled poll (up to 5 min). The catch block
		// must kick an immediate op-log catch-up to close that window to one
		// replay instead — the missed op carries the relocated content.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-stall-face");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-stall-face", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockRejectedValue(
			new Error("ENOENT: no such file"),
		);

		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(false),
			projectedText: mock().mockResolvedValue(""),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		const catchupSpy = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue(0);

		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-stall-face",
			path: "New.md",
			timestamp: 2,
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(catchupSpy).toHaveBeenCalled();
	});
});

describe("moveIfIdRelocated ignores a stale/out-of-order WS event that would relocate BACKWARD (round 2, e2e test_34 mechanism)", () => {
	test("a late-arriving upsert with an OLDER timestamp and the note's OLD path does not undo an already-applied relocation", async () => {
		// Live-repro evidence (local, 2026-07-08): a folder rename delivered a
		// genuine forward relocation (Old.md -> New.md) that this device applied
		// correctly, immediately followed by a duplicate/reordered upsert
		// broadcast still carrying the OLD path for the SAME note_id (a late
		// echo of the pre-rename create, or the tombstone's own broadcast).
		// moveIfIdRelocated's only precondition was "noteIdMap says id is at a
		// DIFFERENT path than event.path" — true in EITHER direction — so it
		// treated the stale event as a second, backward relocation: re-keyed the
		// map back to Old.md, trashed the just-created New.md, and (with the
		// on-disk materialize fix) recreated Old.md from New.md's content. The
		// old path was then perpetually resurrected (e2e test_34
		// old_paths_cleaned: "File .../Cleanup.md still exists after 30s").
		// Fix: track the timestamp of the last applied relocation per note_id
		// and ignore a relocation instruction whose event is OLDER — it cannot
		// be more current than what this device already applied.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-stale-echo");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-stale-echo", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		const newFile = new TFile("New.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) => {
			if (p === "Old.md") return oldFile;
			if (p === "New.md") return newFile;
			return null;
		});
		// Same content at both paths — only the ORDERING/routing matters here,
		// not a content diff (final review MINOR-8: was a dead per-path ternary).
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# original content",
		);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock(),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		// 1) Genuine forward relocation. The staleness guard now keys off the
		// WS payload's `updated_at` (server clock) — NOT `timestamp` (client
		// receipt time, set in channel.ts) — so it's `updated_at` that must be
		// later here, not `timestamp`.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-stale-echo",
			path: "New.md",
			timestamp: 100,
			title: "New",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:10Z",
		} as any);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(noteIdMap.pathForId("id-stale-echo")).toBe("New.md");

		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();

		// 2) A STALE echo arrives with the OLD path and an OLDER `updated_at`
		// (00:00:00Z < 00:00:10Z) — must be ignored, not treated as a second
		// relocation. `timestamp` is deliberately set NEWER than event 1's (the
		// realistic geometry: client receipt time is always ~now) to prove the
		// guard ignores it and compares `updated_at` instead.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-stale-echo",
			path: "Old.md",
			timestamp: 200,
			title: "Old",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		// The already-applied forward relocation must stand: New.md is not
		// trashed, and the map is not re-keyed backward.
		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
		expect(noteIdMap.pathForId("id-stale-echo")).toBe("New.md");
	});
});

describe("pull-applied relocations record lastRelocationTs too (final review IMPORTANT-2)", () => {
	test("a stale WS echo after a PULL-applied relocation does not relocate backward", async () => {
		// applySyncChange (the pull/`/sync/changes` path) called moveIfIdRelocated
		// with no eventTs at all, so a relocation applied via pull never recorded
		// lastRelocationTs for that id. A later stale/reordered WS broadcast
		// carrying the pre-rename path then found no recorded timestamp to compare
		// against — the staleness guard silently no-ops (`lastTs !== undefined`
		// is false) — and re-keyed the map BACKWARD to the old path, cross-channel
		// ping-pong.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-pull-then-ws");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-pull-then-ws", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# original content",
		);
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock(),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		// 1) Pull delivers the forward relocation, `updated_at` far in the future
		// relative to any WS `timestamp` used below.
		await engine.applySyncChange({
			type: "note",
			id: "id-pull-then-ws",
			seq: 2,
			path: "New.md",
			title: "New",
			content: "# original content",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:10Z",
			deleted: false,
		} as any);
		expect(noteIdMap.pathForId("id-pull-then-ws")).toBe("New.md");

		// 2) A stale/reordered WS echo arrives with the OLD path and a `timestamp`
		// that predates the pull's `updated_at` (converted to the same epoch-ms
		// basis) — must be ignored, not re-key the map backward.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-pull-then-ws",
			path: "Old.md",
			timestamp: 1,
			title: "Old",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(noteIdMap.pathForId("id-pull-then-ws")).toBe("New.md");
	});

	test("an event whose ts TIES the last-applied ts is treated as stale, not newer (review finding 5)", async () => {
		// updated_at is only seconds-precision on the wire, so two genuinely
		// different relocations for the same id within one second can produce
		// the exact same normalized eventTs. A tie can't be proven newer than
		// what's already applied, so it must not win — strict `<` alone would
		// let it through.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-tie");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-tie", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# original content",
		);
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock(),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		const tieTs = Date.parse("2026-01-01T00:00:10Z");
		await engine.applySyncChange({
			type: "note",
			id: "id-tie",
			seq: 2,
			path: "New.md",
			title: "New",
			content: "# original content",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:10Z",
			deleted: false,
		} as any);
		expect(noteIdMap.pathForId("id-tie")).toBe("New.md");

		// A second, different relocation event whose `updated_at` normalizes to
		// the exact same epoch-ms value as the pull's — must not be treated as
		// newer. `timestamp` (client receipt) is irrelevant to the guard now;
		// set it to something else entirely to prove that.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-tie",
			path: "Old.md",
			timestamp: tieTs + 999,
			title: "Old",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:10Z",
		} as any);

		expect(noteIdMap.pathForId("id-tie")).toBe("New.md");
	});
});

describe("WS staleness guard uses server-clock `updated_at`, not client-receipt `timestamp` (re-review clock-base fix)", () => {
	test("a stale WS backward event with a NOW `timestamp` but an older `updated_at` is refused after a forward pull", async () => {
		// Realistic geometry that the bug missed: `timestamp` is Date.now() at
		// client receipt (channel.ts), so a WS event delivered AFTER a pull is
		// applied almost always carries a LATER `timestamp` than the pull's
		// server-clock relocation — even when the WS event itself is stale
		// (its `updated_at` predates the pull's). Comparing `timestamp` against
		// the pull's `updated_at`-derived baseline therefore fails open: the
		// stale event reads as newer and re-keys the map backward, trashing the
		// just-applied forward relocation and permanently refusing the
		// corrective pull (its `updated_at` never exceeds the wrongly-recorded
		// receipt-time baseline). Fixed by keying the WS side off
		// `event.updated_at` too (src/sync.ts moveIfIdRelocated call site).
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-pingpong");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-pingpong", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# original content",
		);
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock(),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		// 1) Pull applies the forward relocation at server ts T2.
		await engine.applySyncChange({
			type: "note",
			id: "id-pingpong",
			seq: 2,
			path: "New.md",
			title: "New",
			content: "# original content",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:10Z", // T2
			deleted: false,
		} as any);
		expect(noteIdMap.pathForId("id-pingpong")).toBe("New.md");

		// 2) A stale WS backward event arrives: `updated_at` = T1 < T2, but
		// `timestamp` (client receipt) is NOW — always later than any past
		// server ts. Must be refused.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-pingpong",
			path: "Old.md",
			timestamp: Date.now(), // T1
			title: "Old",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z", // T1 < T2
		} as any);

		expect(noteIdMap.pathForId("id-pingpong")).toBe("New.md");
	});
});

describe("moveIfIdRelocated's disk-content flush must be create-only (final review CRITICAL-1)", () => {
	test("does not overwrite content a concurrent flush already wrote to newPath during the suspend window", async () => {
		// moveIfIdRelocated suspends on cachedRead + trashFile awaits while
		// holding the OLD file's now-stale bytes. If a concurrent doc-triggered
		// flush (e.g. another applyChange racing this same upsert) writes NEWER
		// content to newPath during that window, flushFromCrdt's modify-if-
		// exists semantics would clobber it with the stale bytes on resume.
		// Fix: re-check newPath for existence right before flushing (mirrors
		// materializeRelocated's own exists check) and skip when something else
		// already landed there.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-race-overwrite");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-race-overwrite", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		const newFile = new TFile("New.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		// oldFile reads as the stale pre-rename content; newFile (once it
		// exists) reads as whatever the concurrent flush already wrote —
		// distinct content, so flushFromCrdt's idempotency check (skip when
		// disk already holds exactly `content`) can't mask a real overwrite.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockImplementation((f: TFile) =>
			Promise.resolve(
				f.path === "Old.md"
					? "# stale content read before the rename"
					: "# newer content the concurrent flush already wrote",
			),
		);
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
		(mockApp.vault.modify as ReturnType<typeof mock>).mockClear();
		// Model the race: trashFile's await is the suspend window. By the time
		// it resolves, a concurrent flush has already created New.md with newer
		// content — getAbstractFileByPath must now report it.
		(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockImplementation(async () => {
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(
				newFile,
			);
		});
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock(),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		try {
			await engine.handleStreamEvent({
				event_type: "upsert",
				kind: "note",
				id: "id-race-overwrite",
				path: "New.md",
				timestamp: 2,
				title: "New",
				folder: "",
				tags: [],
				mtime: 2,
				updated_at: "2026-01-01T00:00:00Z",
			} as any);
		} finally {
			(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockReset();
			(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockResolvedValue(undefined);
		}

		// The just-landed content at New.md must survive untouched — the
		// relocation must never write the old file's stale bytes over it.
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});
});

describe("pushFile echo suppression covers the CRDT-managed branch (e2e test_37 content-loss mechanism)", () => {
	// Root cause (CI backend PR #950, plugin e7e0e4f): a note's own
	// materialize write (e.g. applyChange's CRDT-discovery flushFromCrdt, or
	// materializeRelocated) fires Obsidian's vault create/modify event same as
	// a real edit. pushFile's echo-hash check (skip when disk content matches
	// the last-synced hash) previously ran ONLY in the legacy REST branch,
	// AFTER the CRDT branch had already returned — so a CRDT-managed note's
	// self-materialize echo unconditionally diffed unchanged content into the
	// Y.Doc via applyLocalEdit. If the Y.Doc had meanwhile advanced (a
	// concurrent remote update — e.g. a second API append landing a moment
	// later), that diff computed a stale delta and transmitted it, erasing
	// the just-arrived remote content. Hoisting the echo check above the CRDT
	// branch closes this for both paths.
	test("does not re-diff already-synced content into CRDT on a self-materialize echo", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}) } as any);
		engine.setCrdtLiveCheck(() => true);

		// Discovery via pull: applyChange's CRDT-discovery branch calls
		// flushFromCrdt, which records the written content's hash as the
		// last-synced baseline (recordCrdtBaseline) and confirms the id.
		const content = "# Append Test\nOriginal content.";
		await engine.applySyncChange({
			id: "id-echo",
			path: "Notes/Echo.md",
			title: "Echo",
			content,
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		} as any);

		// Simulate Obsidian firing vault create/modify for that exact disk
		// write (the self-materialize echo) — pushFile reads the SAME content
		// flushFromCrdt just wrote; nothing has changed since the last sync.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(content);
		applyLocalEdit.mockClear();
		(mockApi.pushNote as ReturnType<typeof mock>).mockClear();

		const file = new TFile("Notes/Echo.md", Date.now());
		await (engine as any).pushFile(file);

		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("guard-rail: a genuine local edit after the same discovery still routes through CRDT", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}) } as any);
		engine.setCrdtLiveCheck(() => true);

		await engine.applySyncChange({
			id: "id-real-edit",
			path: "Notes/RealEdit.md",
			title: "RealEdit",
			content: "# RealEdit\nOriginal.",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		} as any);
		// CRDT-sole oracle: a server-known note routes CRDT only once it has a
		// recorded crdtHead. The REST pull confirms the id but the head is delivered
		// over the CRDT channel (absent in this unit); seed it directly.
		(engine as unknown as { setCrdtHead(p: string, h: string): void }).setCrdtHead(
			"Notes/RealEdit.md",
			"server-head",
		);

		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# RealEdit\nOriginal.\nA genuine local edit.",
		);
		applyLocalEdit.mockClear();

		const file = new TFile("Notes/RealEdit.md", Date.now());
		await (engine as any).pushFile(file);

		expect(applyLocalEdit).toHaveBeenCalled();
	});
});

describe("a successful CRDT push updates the echo-hash baseline (final review IMPORTANT-4)", () => {
	// Root cause: a successful `consumed` CRDT push (routeModify -> true) never
	// updated syncState's hash. The hoisted echo-hash gate at the top of
	// pushFile therefore kept comparing against the last-FLUSHED baseline
	// (from discovery/pull), not the last-TRANSMITTED content. Edit -> CRDT
	// push -> undo back to the original content hash-matches the stale
	// baseline and is echo-skipped: the revert never reaches the Y.Doc.
	test("edit, CRDT push, then revert-to-baseline must still route through CRDT (not echo-skip)", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}) } as any);
		engine.setCrdtLiveCheck(() => true);

		// Discovery establishes the last-FLUSHED baseline.
		const original = "# Revert Test\nOriginal content.";
		await engine.applySyncChange({
			id: "id-revert",
			path: "Notes/Revert.md",
			title: "Revert",
			content: original,
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		} as any);
		// CRDT-sole oracle: seed the server head so this server-known note routes
		// CRDT (the head normally arrives over the CRDT channel, absent here).
		(engine as unknown as { setCrdtHead(p: string, h: string): void }).setCrdtHead(
			"Notes/Revert.md",
			"server-head",
		);

		// User edits the note and it pushes through CRDT (consumed=true).
		const edited = "# Revert Test\nOriginal content.\nA local edit.";
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(edited);
		applyLocalEdit.mockClear();
		const file = new TFile("Notes/Revert.md", Date.now());
		await (engine as any).pushFile(file);
		expect(applyLocalEdit).toHaveBeenCalled();

		// User undoes back to the original content. Without recording the
		// transmitted hash on the prior push, syncState still holds the
		// discovery-time baseline (hash(original)) — which this revert's disk
		// content also hashes to, so it would be wrongly echo-skipped.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(original);
		applyLocalEdit.mockClear();
		await (engine as any).pushFile(file);

		expect(applyLocalEdit).toHaveBeenCalled();
	});
});

describe("resetForVaultChange clears the relocation-guard's per-vault state (final review MINOR-6)", () => {
	test("a relocation timestamp recorded under the OLD vault must not stale-gate an event after a vault switch", async () => {
		// lastRelocationTs is keyed by note_id, but note_ids are only unique
		// WITHIN a vault — resetForVaultChange (fired on a vault switch) must
		// drop it along with the rest of the per-vault bookkeeping, or a
		// timestamp recorded for "id-x" under the old vault could wrongly
		// stale-gate a genuine relocation for an unrelated "id-x" in the new
		// vault.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-vault-switch");
		engine.setNoteIdMap(noteIdMap);
		manifestWith([{ id: "id-vault-switch", path: "New.md" }]);

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"# original content",
		);
		engine.setCrdtManager({
			isSynced: mock().mockReturnValue(true),
			projectedText: mock(),
		} as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);

		// Record a relocation timestamp far in the future.
		await engine.applySyncChange({
			type: "note",
			id: "id-vault-switch",
			seq: 2,
			path: "New.md",
			title: "New",
			content: "# original content",
			folder: "",
			tags: [],
			mtime: 2,
			updated_at: "2026-01-01T00:00:10Z",
			deleted: false,
		} as any);
		expect(noteIdMap.pathForId("id-vault-switch")).toBe("New.md");

		await engine.resetForVaultChange();

		// New vault, same (coincidentally reused) id, at a path this device
		// still maps to New.md locally — a genuine relocation delivered with an
		// OLDER-looking timestamp than the stale pre-switch record must not be
		// rejected as stale; the guard's state belongs to the vault that's gone.
		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: "id-vault-switch",
			path: "Old.md",
			timestamp: 1,
			title: "Old",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		} as any);

		expect(noteIdMap.pathForId("id-vault-switch")).toBe("Old.md");
	});
});
