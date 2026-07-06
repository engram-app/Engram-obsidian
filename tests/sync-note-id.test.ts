/**
 * Tests: Task 5 of the note_id-keyed CRDT rework.
 * - pushFile mints a UUIDv7 note_id for a brand-new note and sends it as
 *   client_id on the REST pushNote call.
 * - the pull/`changes` apply path (applySyncChange, the merged /sync/changes
 *   feed) learns a note's id into the NoteIdMap.
 * - handleRename re-keys the map (id stable, path moves).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { BaseStore } from "../src/base-store";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

// "modal" (not "auto") conflictResolution so resolveConflict() defers to the
// onConflict callback instead of short-circuiting to the auto keep-local path.
function createModalEngine(): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, conflictResolution: "modal" },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	return engine;
}

function flush(ms = 50): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>).mockReset().mockImplementation(pushNoteResponse);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
});

describe("pushFile mints and sends client_id for a brand-new note", () => {
	test("mints a UUIDv7 and passes it as client_id on pushNote", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		const file = new TFile("brand-new.md");
		engine.handleModify(file);
		await flush();

		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		// pushNote(path, content, mtime, version?, clientId?)
		const clientId = call[call.length - 1];
		expect(clientId).toMatch(UUID_RE);
		expect(noteIdMap.get("brand-new.md")).toBe(clientId);
	});

	test("a note whose id is already known reuses it instead of minting a new one", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("known.md", "id-already-known");
		engine.setNoteIdMap(noteIdMap);

		const file = new TFile("known.md");
		engine.handleModify(file);
		await flush();

		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		const clientId = call[call.length - 1];
		expect(clientId).toBe("id-already-known");
	});
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

describe("409 conflict resolution writes back the authoritative server id", () => {
	test("keep-local (auto conflict-copy) force-push learns the server id, not the locally-minted one", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		(mockApi.pushNote as ReturnType<typeof mock>)
			.mockReset()
			.mockImplementationOnce(() =>
				Promise.resolve({
					conflict: true,
					server_note: {
						id: "server-real-id",
						path: "conflicted.md",
						title: "conflicted",
						content: "remote body",
						folder: "",
						tags: [],
						mtime: 2,
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
						version: 2,
					},
				}),
			)
			.mockImplementationOnce(() =>
				Promise.resolve({
					note: { id: "server-real-id", version: 3, content_hash: "h" },
					chunks_indexed: 1,
				}),
			);

		const file = new TFile("conflicted.md");
		engine.handleModify(file);
		await flush();

		// The locally-minted client_id (sent as clientId on the first pushNote
		// call) must NOT survive in the map — the force-push response's id
		// (the server's real persisted id) must win.
		const firstCall = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		const mintedId = firstCall[firstCall.length - 1];
		expect(mintedId).toMatch(UUID_RE);
		expect(noteIdMap.get("conflicted.md")).toBe("server-real-id");
		expect(noteIdMap.get("conflicted.md")).not.toBe(mintedId);
	});

	test("keep-remote (modal resolution) learns the server note id", async () => {
		const engine = createModalEngine();
		engine.onConflict = mock().mockResolvedValue({ choice: "keep-remote" });
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		// keep-remote's noteIdMap.set is gated on the local file still existing
		// (see sync.ts's `if (localFile) { ...; this.noteIdMap?.set(...) }`).
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>)
			.mockReset()
			.mockReturnValue(new TFile("keep-remote.md"));

		(mockApi.pushNote as ReturnType<typeof mock>).mockReset().mockImplementationOnce(() =>
			Promise.resolve({
				conflict: true,
				server_note: {
					id: "keep-remote-server-id",
					path: "keep-remote.md",
					title: "keep-remote",
					content: "remote body",
					folder: "",
					tags: [],
					mtime: 2,
					created_at: "2026-01-01T00:00:00Z",
					updated_at: "2026-01-01T00:00:00Z",
					version: 2,
				},
			}),
		);

		const file = new TFile("keep-remote.md");
		engine.handleModify(file);
		await flush();

		const firstCall = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		const mintedId = firstCall[firstCall.length - 1];
		expect(mintedId).toMatch(UUID_RE);
		expect(noteIdMap.get("keep-remote.md")).toBe("keep-remote-server-id");
		expect(noteIdMap.get("keep-remote.md")).not.toBe(mintedId);
	});

	test("manual merge (modal resolution) learns the merge push response id", async () => {
		const engine = createModalEngine();
		engine.onConflict = mock().mockResolvedValue({
			choice: "merge",
			mergedContent: "manually merged body",
		});
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		// manual-merge's noteIdMap.set is likewise gated on the local file
		// still existing when writing the merged content back to disk.
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>)
			.mockReset()
			.mockReturnValue(new TFile("manual-merge.md"));

		(mockApi.pushNote as ReturnType<typeof mock>)
			.mockReset()
			.mockImplementationOnce(() =>
				Promise.resolve({
					conflict: true,
					server_note: {
						id: "manual-merge-conflict-id",
						path: "manual-merge.md",
						title: "manual-merge",
						content: "remote body",
						folder: "",
						tags: [],
						mtime: 2,
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
						version: 2,
					},
				}),
			)
			.mockImplementationOnce(() =>
				Promise.resolve({
					note: { id: "manual-merge-server-id", version: 3, content_hash: "h" },
					chunks_indexed: 1,
				}),
			);

		const file = new TFile("manual-merge.md");
		engine.handleModify(file);
		await flush();

		const firstCall = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		const mintedId = firstCall[firstCall.length - 1];
		expect(mintedId).toMatch(UUID_RE);
		expect(noteIdMap.get("manual-merge.md")).toBe("manual-merge-server-id");
		expect(noteIdMap.get("manual-merge.md")).not.toBe(mintedId);
	});

	test("auto-merge (clean 3-way merge, distinct from keep-local) learns the merge push response id", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		const path = "auto-merge.md";
		const base = "line1\nline2\nline3\n";
		const local = "line1-local\nline2\nline3\n";
		const remote = "line1\nline2\nline3-remote\n";

		// A real BaseStore (not a mock) seeded with the common ancestor — this is
		// what makes sync.ts attempt the auto-merge branch BEFORE ever calling
		// resolveConflict, so this path is reached even though the engine's
		// conflictResolution is still the default "auto".
		const baseStore = new BaseStore({ read: mock(), write: mock() } as any, "sync-bases.json");
		baseStore.set(path, base, 1);
		engine.baseStore = baseStore;

		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue(local);

		(mockApi.pushNote as ReturnType<typeof mock>)
			.mockReset()
			.mockImplementationOnce(() =>
				Promise.resolve({
					conflict: true,
					server_note: {
						id: "auto-merge-conflict-id",
						path,
						title: "auto-merge",
						content: remote,
						folder: "",
						tags: [],
						mtime: 2,
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
						version: 2,
					},
				}),
			)
			.mockImplementationOnce(() =>
				Promise.resolve({
					note: { id: "auto-merge-server-id", version: 3, content_hash: "h" },
					chunks_indexed: 1,
				}),
			);

		const file = new TFile(path);
		engine.handleModify(file);
		await flush();

		const firstCall = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		const mintedId = firstCall[firstCall.length - 1];
		expect(mintedId).toMatch(UUID_RE);
		// Confirms the merge was clean (auto-merge branch actually taken, not a
		// fall-through to keep-local): pushNote called exactly twice — the
		// initial 409 and the merge re-push — with no interactive resolution.
		expect(mockApi.pushNote).toHaveBeenCalledTimes(2);
		expect(noteIdMap.get(path)).toBe("auto-merge-server-id");
		expect(noteIdMap.get(path)).not.toBe(mintedId);
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

	test("un-confirms the id so the new-path push takes REST (row move), not CRDT", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}) } as any);
		engine.setCrdtLiveCheck(() => true);

		// Confirm id-1 for a.md via a pull (applySyncChange learns + confirms the
		// id). With id-1 confirmed + CRDT live, a normal edit to a.md would route
		// through CRDT.
		await engine.applySyncChange({
			id: "id-1",
			path: "a.md",
			title: "a",
			content: "# A\nbody",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		} as any);

		applyLocalEdit.mockClear();
		(mockApi.pushNote as ReturnType<typeof mock>).mockClear();

		// Rename a.md -> b.md. handleRename tombstones the old row then pushes the
		// new path. The delete un-confirms id-1, so the new-path push MUST go REST
		// (which moves/resurrects the row server-side), not CRDT — the server
		// drops crdt frames for a note it sees as deleted, silently losing the
		// rename. Without the un-confirm, id-1 stays confirmed and the push routes
		// CRDT (applyLocalEdit), which this asserts against.
		await engine.handleRename(new TFile("b.md"), "a.md");

		expect(noteIdMap.get("b.md")).toBe("id-1");
		expect(mockApi.pushNote).toHaveBeenCalled();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});
});

describe("clearConfirmedNoteIds biases the next write back to REST", () => {
	test("a previously-confirmed note routes REST after clear (reconnect invalidation)", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}) } as any);
		engine.setCrdtLiveCheck(() => true);

		// Confirm id-conf for known.md via a pull.
		await engine.applySyncChange({
			id: "id-conf",
			path: "known.md",
			title: "k",
			content: "# K\nbody",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		} as any);

		// Control: while confirmed + CRDT live, an edit routes through CRDT.
		applyLocalEdit.mockClear();
		(mockApi.pushNote as ReturnType<typeof mock>).mockClear();
		engine.handleModify(new TFile("known.md"));
		await flush();
		expect(applyLocalEdit).toHaveBeenCalled();
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		// Clear confirmations (as on a WS reconnect) — the next write must go REST,
		// which re-creates/re-verifies the row server-side rather than routing to a
		// CRDT room the server may no longer have (silent-drop → data loss).
		engine.clearConfirmedNoteIds();
		applyLocalEdit.mockClear();
		(mockApi.pushNote as ReturnType<typeof mock>).mockClear();
		engine.handleModify(new TFile("known.md"));
		await flush();
		expect(mockApi.pushNote).toHaveBeenCalled();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});
});

describe("rename/delete drop stale sync-state (echo-suppression on recreate)", () => {
	test("handleRename removes the old path's sync-state entry", async () => {
		const engine = createEngine();
		engine.setNoteIdMap(new NoteIdMap());

		// Push a.md so it gets a sync-state entry (recorded content hash).
		engine.handleModify(new TFile("a.md"));
		await flush();
		expect(engine.exportSyncState()["a.md"]).toBeDefined();

		// Rename a.md -> b.md. The old path no longer holds a note, so its stale
		// sync-state must be dropped (else a later create at a.md with the same
		// content echo-suppresses and never syncs).
		await engine.handleRename(new TFile("b.md"), "a.md");

		expect(engine.exportSyncState()["a.md"]).toBeUndefined();
	});

	test("handleDelete removes the deleted path's sync-state entry", async () => {
		const engine = createEngine();
		engine.setNoteIdMap(new NoteIdMap());

		engine.handleModify(new TFile("a.md"));
		await flush();
		expect(engine.exportSyncState()["a.md"]).toBeDefined();

		await engine.handleDelete(new TFile("a.md"));

		expect(engine.exportSyncState()["a.md"]).toBeUndefined();
	});
});

describe("id-keyed move: pull upsert at a new path for a known id trashes the old file", () => {
	test("applySyncChange moves the note instead of leaving a duplicate", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Old.md", "id-move");
		engine.setNoteIdMap(noteIdMap);

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
