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
