/** wipeRemote self-echo suppression (2026-07-08 vault-wipe incident).
 *
 *  "Delete all on remote, then upload local files" (pushAll replaceRemote)
 *  REST-deletes every remote note while the WS channel stays connected. The
 *  server fans each delete back to the deleting device (no origin
 *  attribution), and the stream handler deliberately exempts deletes from
 *  push-echo suppression — so the plugin trashed its own local vault before
 *  the upload phase enumerated files. Both sides ended up empty.
 *
 *  Contract pinned here:
 *   1. a WS delete for a path wipeRemote itself just deleted is SKIPPED
 *      (never trashFile) — it is our own echo, not a remote intent;
 *   2. the suppression is scoped: deletes for other paths still apply;
 *   3. wipeRemote clears the path's server bindings (syncState, noteIdMap,
 *      CRDT doc + enrollment) so the follow-up pushAll re-mints every file
 *      as new instead of hash-skipping "unchanged" notes into remote loss.
 */

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	ping: mock().mockResolvedValue({ ok: true }),
	health: mock().mockResolvedValue(true),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getManifest: mock().mockResolvedValue(null),
	getNote: mock().mockResolvedValue(null),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getRateLimit: mock().mockResolvedValue(0),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("# Test"),
		cachedRead: mock().mockResolvedValue("# Test"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null) as jest.Mock,
		modify: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockReturnValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: {
		trashFile: mock().mockResolvedValue(undefined),
	},
	workspace: {
		getActiveViewOfType: mock().mockReturnValue(null),
	},
} as any;

type EnginePrivates = {
	wipeRemote(): Promise<void>;
	syncState: Map<string, unknown>;
};

function createEngine(noteIdMap: NoteIdMap = new NoteIdMap()): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setNoteIdMap(noteIdMap);
	return engine;
}

function priv(engine: SyncEngine): EnginePrivates {
	return engine as unknown as EnginePrivates;
}

function identityNoteIdMap(...paths: string[]): NoteIdMap {
	const m = new NoteIdMap();
	for (const p of paths) m.set(p, p);
	return m;
}

beforeEach(() => {
	jest.clearAllMocks();
	mockApp.vault.getFileByPath.mockReset().mockReturnValue(null);
	(mockApi.getManifest as jest.Mock).mockReset().mockResolvedValue(null);
	(mockApi.deleteNote as jest.Mock).mockReset().mockResolvedValue({ deleted: true, path: "" });
});

function manifestWith(notePaths: string[], attachmentPaths: string[] = []) {
	(mockApi.getManifest as jest.Mock).mockResolvedValue({
		notes: notePaths.map((path) => ({ path, content_hash: "h" })),
		attachments: attachmentPaths.map((path) => ({ path, content_hash: "h" })),
	});
}

describe("wipeRemote self-echo suppression", () => {
	test("WS delete echo for a wiped path is skipped — local file survives", async () => {
		const engine = createEngine();
		manifestWith(["Notes/Keep.md"]);

		await priv(engine).wipeRemote();
		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/Keep.md");

		// The server's fanout of OUR delete comes back on the stream.
		mockApp.vault.getFileByPath.mockReturnValueOnce(new TFile("Notes/Keep.md"));
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Keep.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("attachment delete echo for a wiped path is skipped too", async () => {
		const engine = createEngine();
		manifestWith([], ["Assets/pic.png"]);

		await priv(engine).wipeRemote();
		expect(mockApi.deleteAttachment).toHaveBeenCalledWith("Assets/pic.png");

		mockApp.vault.getFileByPath.mockReturnValueOnce(new TFile("Assets/pic.png"));
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Assets/pic.png",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("scoped: a delete for a path we did NOT wipe still applies", async () => {
		const engine = createEngine();
		manifestWith(["Notes/Keep.md"]);
		await priv(engine).wipeRemote();

		// A genuine remote delete (another device) for an unrelated path.
		const other = new TFile("Notes/Other.md");
		mockApp.vault.getFileByPath.mockReturnValueOnce(other);
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Other.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(other);
	});

	test("wipeRemote clears server bindings so the re-push mints fresh", async () => {
		const noteIdMap = identityNoteIdMap("Notes/Keep.md");
		const engine = createEngine(noteIdMap);
		const crdt = { removeDoc: mock(async () => {}), applyLocalEdit: mock(async () => true) };
		const enrollment = { enroll: mock(), reset: mock() };
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// Simulate an in-sync note: stored serverHash would let the follow-up
		// pushAll skip the file as "unchanged" — after a wipe that means the
		// note silently stays deleted on the server.
		priv(engine).syncState.set("Notes/Keep.md", {
			hash: 1,
			mtime: 1,
			serverHash: "h",
			version: 1,
		});

		manifestWith(["Notes/Keep.md"]);
		await priv(engine).wipeRemote();

		expect(priv(engine).syncState.get("Notes/Keep.md")).toBeUndefined();
		expect(noteIdMap.get("Notes/Keep.md")).toBeNull();
		expect(crdt.removeDoc).toHaveBeenCalledWith("Notes/Keep.md");
		expect(enrollment.reset).toHaveBeenCalledWith("Notes/Keep.md");
	});
});
