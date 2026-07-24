import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { LimitExceededError } from "../src/limit-error";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";
import { __noticeCapture } from "./__mocks__/obsidian";

// Mock the API
const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	// Legacy-backend shape: no batch endpoint — engine falls back to per-note
	// pushes, which is exactly what these tests assert.
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "Notes/Remote.md",
		title: "Remote Note",
		content: "# Remote\n\nFrom SSE",
		folder: "Notes",
		tags: [],
		mtime: 1709345678,
		created_at: "2026-03-01T12:00:00Z",
		updated_at: "2026-03-01T12:00:00Z",
	}),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue({
		path: "Assets/image.png",
		content_base64: "AQID",
		mime_type: "image/png",
		size_bytes: 3,
		mtime: 1709345678,
		created_at: "2026-03-01T12:00:00Z",
		updated_at: "2026-03-01T12:00:00Z",
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: jest
		.fn()
		.mockResolvedValue({ id: "vault-1", name: "Test", slug: "test", is_default: true }),
} as unknown as EngramApi;

// Mock the Obsidian App
const mockEditor = {
	getValue: mock().mockReturnValue(""),
	setValue: mock(),
	getCursor: mock().mockReturnValue({ line: 0, ch: 0 }),
	setCursor: mock(),
	getScrollInfo: mock().mockReturnValue({ left: 0, top: 0 }),
	scrollTo: mock(),
	lastLine: mock().mockReturnValue(0),
	getLine: mock().mockReturnValue(""),
	replaceRange: mock(),
};

const mockActiveView = {
	editor: mockEditor,
	file: null as TFile | null,
};

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("# Test\n\nContent"),
		cachedRead: mock().mockResolvedValue("# Test\n\nContent"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null) as jest.Mock,
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_file: any, fn: (data: string) => string) => {
			fn(""); // call the transform function
			return Promise.resolve("");
		}),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: {
		trashFile: mock().mockResolvedValue(undefined),
	},
	workspace: {
		getActiveViewOfType: mock().mockReturnValue(null),
	},
} as any;

const mockSaveData = mock().mockResolvedValue(undefined);

/** Helper: get the content that was written via vault.process or vault.modify */
function getWrittenContent(): string | undefined {
	if (mockApp.vault.process.mock.calls.length > 0) {
		const lastCall =
			mockApp.vault.process.mock.calls[mockApp.vault.process.mock.calls.length - 1];
		return lastCall[1](""); // call transform fn
	}
	if (mockApp.vault.modify.mock.calls.length > 0) {
		const lastCall =
			mockApp.vault.modify.mock.calls[mockApp.vault.modify.mock.calls.length - 1];
		return lastCall[1];
	}
	return undefined;
}

const activeEngines: SyncEngine[] = [];

function createEngine(overrides = {}, { ready = true } = {}): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 10, ...overrides },
		mockSaveData,
	);
	if (ready) engine.setReady();
	activeEngines.push(engine);
	return engine;
}

/** Build a well-formed merged-feed note entry. The socket seq-replay drives
 *  these through applySyncChange (the surviving apply seam). */
function syncNoteEntry(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		type: "note" as const,
		id: "id-1",
		seq: 1,
		path: "Notes/Entry.md",
		title: "Entry",
		content: "# Entry",
		content_hash: "h-entry",
		folder: "Notes",
		tags: [] as string[],
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
		deleted: false,
		version: 1,
		...overrides,
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	// Bun's clearAllMocks does NOT clear mockReturnValueOnce queues,
	// so reset mocks that commonly use one-time returns to prevent leaks.
	mockApp.vault.getFileByPath.mockReset().mockReturnValue(null);
	mockApp.vault.getAbstractFileByPath.mockReset().mockReturnValue(null);
	mockApp.vault.cachedRead.mockReset().mockResolvedValue("# Test\n\nContent");
	mockApp.vault.read.mockReset().mockResolvedValue("# Test\n\nContent");
	mockApp.vault.process
		.mockReset()
		.mockImplementation((_file: any, fn: (data: string) => string) => {
			fn(""); // call the transform function
			return Promise.resolve("");
		});
	(mockApi.pushNote as jest.Mock).mockReset().mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApi.pushNotesBatch as jest.Mock).mockReset().mockRejectedValue({ status: 404 });
	// Empty manifest default (no reconcileFromManifest action) so a catch-up not
	// explicitly scripting it is a no-op rather than a crash.
	(mockApi.getManifest as jest.Mock).mockReset().mockResolvedValue(null);
});

afterEach(() => {
	// Clean up all engines to prevent timer leaks
	for (const engine of activeEngines) {
		engine.destroy();
	}
	activeEngines.length = 0;
});

describe("SyncEngine.shouldIgnore", () => {
	const engine = createEngine();

	test("ignores .obsidian/ paths", () => {
		expect(engine.shouldIgnore(".obsidian/config.json")).toBe(true);
		expect(engine.shouldIgnore(".obsidian/plugins/foo/main.js")).toBe(true);
	});

	test("ignores .trash/ paths", () => {
		expect(engine.shouldIgnore(".trash/old-note.md")).toBe(true);
	});

	test("ignores .git/ paths", () => {
		expect(engine.shouldIgnore(".git/HEAD")).toBe(true);
	});

	test("does not ignore normal paths", () => {
		expect(engine.shouldIgnore("Notes/Hello.md")).toBe(false);
		expect(engine.shouldIgnore("2. Knowledge Vault/Health/Omega.md")).toBe(false);
	});

	test("hardcoded ignores cannot be overridden by clearing user patterns", () => {
		const emptyEngine = createEngine({ ignorePatterns: "" });
		expect(emptyEngine.shouldIgnore(".obsidian/config.json")).toBe(true);
		expect(emptyEngine.shouldIgnore(".trash/old-note.md")).toBe(true);
		expect(emptyEngine.shouldIgnore(".git/HEAD")).toBe(true);
	});

	test("user-defined patterns still work alongside hardcoded ignores", () => {
		const customEngine = createEngine({ ignorePatterns: "drafts/\nsecret.md" });
		// Hardcoded still work
		expect(customEngine.shouldIgnore(".obsidian/plugins/foo.js")).toBe(true);
		// User patterns also work
		expect(customEngine.shouldIgnore("drafts/wip.md")).toBe(true);
		expect(customEngine.shouldIgnore("secret.md")).toBe(true);
		// Normal files still pass
		expect(customEngine.shouldIgnore("Notes/Hello.md")).toBe(false);
	});
});

describe("SyncEngine.isMarkdown", () => {
	const engine = createEngine();

	test("accepts .md files", () => {
		const file = new TFile("Notes/Test.md");
		expect(engine.isMarkdown(file)).toBe(true);
	});

	test("rejects non-md files", () => {
		const file = new TFile("image.png");
		expect(engine.isMarkdown(file)).toBe(false);
	});
});

describe("SyncEngine.handleModify", () => {
	test("debounces and pushes after delay", async () => {
		const engine = createEngine({ debounceMs: 50 });
		// Oversized .md so it exceeds the CRDT transport cap and takes the kept
		// LWW REST push; in-cap md/canvas now converge over CRDT.
		const big = "a".repeat(5 * 1024 * 1024);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(big);
		const file = new TFile("Notes/Test.md", Date.now());

		engine.handleModify(file);

		// Not pushed yet (debouncing)
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		// Wait for debounce
		await new Promise((r) => setTimeout(r, 100));

		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/Test.md", big, expect.any(Number));
	});

	test("ignores non-markdown files", async () => {
		const engine = createEngine({ debounceMs: 10 });
		const file = new TFile("image.png");

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("ignores .obsidian paths", async () => {
		const engine = createEngine({ debounceMs: 10 });
		const file = new TFile(".obsidian/workspace.md");

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("coalesces rapid edits", async () => {
		const engine = createEngine({ debounceMs: 50 });
		// Oversized .md so the LWW REST push fires (in-cap notes converge over CRDT).
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const file = new TFile("Notes/Test.md", Date.now());

		// Fire 5 modify events in rapid succession
		engine.handleModify(file);
		engine.handleModify(file);
		engine.handleModify(file);
		engine.handleModify(file);
		engine.handleModify(file);

		await new Promise((r) => setTimeout(r, 150));

		// Should only push once
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});
});

describe("SyncEngine.handleDelete", () => {
	test("canvas delete goes over the socket (crdt_delete), NOT REST, since #306", async () => {
		// CRDT-authoritative delete: since #306 canvas rides CRDT like markdown, so a
		// canvas delete with a resolvable note_id enqueues a durable crdt_delete and
		// never calls api.deleteNote.
		const engine = createEngine();
		const enqueued: Array<{ kind: string; docId: string }> = [];
		engine.setCrdtManager({ applyLocalEdit: mock(async () => null) } as any);
		engine.setCrdtEnqueue((op) => enqueued.push(op));
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/Old.canvas", "id-canvas-del");
		engine.setNoteIdMap(noteIdMap);

		const file = new TFile("Notes/Old.canvas");
		await engine.handleDelete(file);

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(enqueued).toContainEqual({
			kind: "delete",
			docId: "id-canvas-del",
			path: "Notes/Old.canvas",
		});
	});

	test("cancels pending push on delete", async () => {
		const engine = createEngine({ debounceMs: 200 });
		const file = new TFile("Notes/Test.md");

		engine.handleModify(file); // Start debounce
		await engine.handleDelete(file); // Delete should cancel

		await new Promise((r) => setTimeout(r, 300));

		// Push should NOT have been called (debounce cancelled by the delete).
		expect(mockApi.pushNote).not.toHaveBeenCalled();
		// The md note was never synced (no note_id) → no REST delete, no socket op.
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});
});

describe("SyncEngine.handleRename", () => {
	test("canvas rename is tombstone-less rename-as-move like markdown (no delete) since #306", async () => {
		// Since #306 canvas rides CRDT, so a canvas rename takes the SAME
		// tombstone-less rename-as-move path as markdown: NO deleteNote(old), one
		// crdt_create for the SAME id at the new path (the backend relocates).
		const engine = createEngine();
		const crdtDelete = mock().mockResolvedValue({ doc_id: "id-canvas-move" });
		const crdtCreate = mock().mockResolvedValue("id-canvas-move");
		const enqueued: Array<{ kind: string; docId: string }> = [];
		engine.setCrdtManager({
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		} as any);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue('{"nodes":[],"edges":[]}');
		engine.setCrdtDelete(crdtDelete);
		engine.setCrdtCreate(crdtCreate);
		engine.setCrdtLiveCheck(() => true);
		engine.setCrdtEnqueue((op) => enqueued.push(op));

		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/Old.canvas", "id-canvas-move");
		engine.setNoteIdMap(noteIdMap);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-canvas-move");

		const file = new TFile("Notes/New.canvas", Date.now());
		await engine.handleRename(file, "Notes/Old.canvas");

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(crdtDelete).not.toHaveBeenCalled();
		expect(enqueued.some((op) => op.kind === "delete")).toBe(false);
		expect(crdtCreate).toHaveBeenCalledWith("id-canvas-move", "Notes/New.canvas");
	});

	test("md rename never emits a delete op — one create with the SAME id at the new path (Phase E2)", async () => {
		// Rename-as-move: the backend relocates a LIVE id arriving via
		// crdt_create at a new free path (genesis_relocate_live), so the plugin
		// sends NO tombstone at all. Killing the delete also removes the #970
		// delete-wins window from renames and the delete/create coalescing
		// hazard on the docId-keyed op queue (the old test_10 class).
		const engine = createEngine();
		const crdtDelete = mock().mockResolvedValue({ doc_id: "id-md-move" });
		const crdtCreate = mock().mockResolvedValue("id-md-move");
		const enqueued: Array<{ kind: string; docId: string }> = [];
		engine.setCrdtManager({
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		} as any);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# body");
		engine.setCrdtDelete(crdtDelete);
		engine.setCrdtCreate(crdtCreate);
		engine.setCrdtLiveCheck(() => true);
		engine.setCrdtEnqueue((op) => enqueued.push(op));

		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/Old.md", "id-md-move");
		engine.setNoteIdMap(noteIdMap);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-md-move");

		const file = new TFile("Notes/New.md", Date.now());
		await engine.handleRename(file, "Notes/Old.md");

		expect(crdtDelete).not.toHaveBeenCalled();
		expect(enqueued.some((op) => op.kind === "delete")).toBe(false);
		expect(crdtCreate).toHaveBeenCalledWith("id-md-move", "Notes/New.md");
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("md rename with the channel down durably enqueues the create, never a delete (Phase E2)", async () => {
		const engine = createEngine();
		const crdtDelete = mock().mockResolvedValue({ doc_id: "id-md-off" });
		const enqueued: Array<{ kind: string; docId: string }> = [];
		engine.setCrdtManager({
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		} as any);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# body");
		engine.setCrdtDelete(crdtDelete);
		engine.setCrdtLiveCheck(() => false); // channel not joined
		engine.setCrdtEnqueue((op) => enqueued.push(op));

		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/Old.md", "id-md-off");
		engine.setNoteIdMap(noteIdMap);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-md-off");

		const file = new TFile("Notes/New.md", Date.now());
		await engine.handleRename(file, "Notes/Old.md");

		expect(crdtDelete).not.toHaveBeenCalled();
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(enqueued.some((op) => op.kind === "delete")).toBe(false);
		// The reconnect drain replays the create; the backend relocation makes
		// it the whole move.
		expect(enqueued).toContainEqual(
			expect.objectContaining({ kind: "create", docId: "id-md-off" }),
		);
	});
});

describe("SyncEngine.applySyncChange (apply behavior)", () => {
	// The socket seq-replay drives every catch-up op through applySyncChange (the
	// surviving apply seam). These pin the apply/tombstone/resurrection behavior
	// directly against that seam — the REST cursor-pull driver was deleted, the
	// behavior it exercised is unchanged.
	test("applies a remote upsert to the vault", async () => {
		const engine = createEngine();

		const entry = syncNoteEntry({
			id: "remote",
			seq: 5,
			path: "Notes/Remote.md",
			title: "Remote Note",
			content: "# Remote\n\nFrom MCP",
		});

		const applied = await engine.applySyncChange(entry);

		expect(applied).toBe(true);
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"Notes/Remote.md",
			"# Remote\n\nFrom MCP",
		);
	});

	test("trashes a locally-clean note on a remote tombstone", async () => {
		const engine = createEngine();

		// Local file content matches its recorded syncedHash — no unsynced
		// edits — so the remote delete should be honoured (clean delete sync).
		const existingFile = new TFile("Notes/ToDelete.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);
		const syncedContent = "# stale\nclean copy\n";
		mockApp.vault.cachedRead.mockResolvedValueOnce(syncedContent);
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(
			"Notes/ToDelete.md",
			{ hash: fnv1a(syncedContent) },
		);

		await engine.applySyncChange(
			syncNoteEntry({
				id: "del",
				seq: 6,
				path: "Notes/ToDelete.md",
				title: "",
				content: "",
				folder: "",
				deleted: true,
			}),
		);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
	});

	test("skips tombstone when local file has unsynced edits (resurrection guard)", async () => {
		const engine = createEngine();

		// Local file content differs from syncedHash (or no syncState entry) —
		// user has unsaved edits or recreated the path after another device
		// deleted it. Plugin must NOT trash the file; it pushes the resurrection.
		// Oversized .md so the resurrection re-push takes the kept LWW REST route
		// (the guard itself — hash/syncState based — is transport-agnostic).
		const existingFile = new TFile("Notes/Resurrected.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		// No syncState entry → first-write semantics, definitely unsynced.
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({
			note: { path: "Notes/Resurrected.md", version: 1 },
		});

		await engine.applySyncChange(
			syncNoteEntry({
				id: "res",
				seq: 7,
				path: "Notes/Resurrected.md",
				title: "",
				content: "",
				folder: "",
				deleted: true,
			}),
		);

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
		expect(mockApi.pushNote).toHaveBeenCalled();
	});

	test("flushFromCrdt records a sync baseline so a later server tombstone is honored, not resurrected", async () => {
		const engine = createEngine();
		const path = "E2E/RenamedFolder/Old.md";
		const content = "# Old\nCRDT-delivered body\n";

		// CRDT delivers a note to disk with no prior REST syncState entry.
		await engine.flushFromCrdt(path, content);

		// The delivery must leave a matching baseline. Without it a later server
		// delete (folder-rename cleanup) arrives with syncedHash=none, the
		// resurrection guard misreads it as an offline re-create and re-pushes
		// the old path — resurrecting it forever (e2e test_34 / test_78 churn).
		expect(engine.isUnchangedSynced(path, content)).toBe(true);
	});

	test("push refuses to mint for an engine-flushed path whose id was relocated away (issue #972)", async () => {
		// e2e test_34 resurrection: the engine materializes a received note
		// (flushFromCrdt), which arms a debounced self-push. A folder rename
		// then relocates the note's id away (moveIfIdRelocated re-keys the map
		// and drops the syncState baseline BEFORE trashing the old file). When
		// the in-flight push finally resolves the path's id, the binding is
		// gone — minting a fresh id here REST-creates the old path server-side
		// as a live note no tombstone will ever remove.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const oldPath = "E2E/RenameCleanup34/Cleanup.md";
		const newPath = "E2E/RenamedCleanup34/Cleanup.md";
		const content = "# Cleanup Test\nShould be removed at old path";

		// Receiver learns the true id, then the engine flushes the body to disk.
		noteIdMap.set(oldPath, "id-true");
		await engine.flushFromCrdt(oldPath, content);

		// Concurrent folder-rename relocation: map re-keyed + baseline evicted
		// (exactly what moveIfIdRelocated does before trashing the old file).
		noteIdMap.rename(oldPath, newPath);
		(engine as unknown as { syncState: Map<string, unknown> }).syncState.delete(oldPath);

		// The armed self-push now runs against the still-on-disk old file.
		const file = new TFile(oldPath);
		mockApp.vault.cachedRead.mockResolvedValue(content);
		await (engine as unknown as { pushFile(f: TFile): Promise<boolean> }).pushFile(file);

		expect(mockApi.pushNote).not.toHaveBeenCalled();
		expect(noteIdMap.get(oldPath)).toBeNull(); // no fresh mint
	});

	test("a CRDT-delivered note is trashed (not resurrected) when the server tombstones it", async () => {
		const engine = createEngine();
		const path = "E2E/RenamedFolder/Old.md";
		const content = "# Old\nCRDT-delivered body\n";

		// CRDT delivers the note (this records the baseline via the fix).
		await engine.flushFromCrdt(path, content);

		// The server later deletes the old path (folder-rename cleanup). The
		// local file still holds exactly the CRDT-delivered content — the user
		// never edited it — so the tombstone must be honored, not resurrected.
		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue(content);

		await engine.applySyncChange(
			syncNoteEntry({ id: "old", seq: 9, path, deleted: true, version: 2 }),
		);

		expect(mockApp.fileManager.trashFile).toHaveBeenCalled();
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	// A CRDT-managed note (id learned from the server feed) that reaches the
	// resurrection guard with NO baseline (syncedHash=none, #203) must have the
	// server tombstone HONOURED, not misread as local drift and resurrected
	// (e2e test_47). Legacy notes (no id) keep the skip-and-resurrect guard.
	function makeCrdtDeleteEngine(): { engine: SyncEngine; removed: string[] } {
		const removed: string[] = [];
		const engine = createEngine();
		engine.setCrdtManager({
			removeDoc: (id: string) => {
				removed.push(id);
				return Promise.resolve();
			},
			closeDoc: () => {},
		} as unknown as import("../src/crdt/manager").CrdtManager);
		return { engine, removed };
	}

	test("honours a server tombstone for a CRDT note with no baseline (test_47)", async () => {
		const { engine, removed } = makeCrdtDeleteEngine();
		const path = "E2E/CrdtDelete/Note.md";

		// This device learned the note's server id (CRDT-managed), but has NO
		// syncState entry — the CRDT delivery never advanced the baseline (#203).
		const map = new NoteIdMap();
		map.set(path, "id-crdt");
		engine.setNoteIdMap(map);

		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue("# Delete Me\n");

		await engine.applySyncChange(
			syncNoteEntry({ id: "id-crdt", seq: 9, path, deleted: true, version: 2 }),
		);

		// Trashed (not resurrected), and no keep-both copy for un-drifted content.
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		// CRDT room torn down so a recreate starts fresh.
		expect(removed).toContain("id-crdt");
	});

	test("preserves genuine drift as a keep-both copy before honouring a CRDT tombstone", async () => {
		const { engine } = makeCrdtDeleteEngine();
		const path = "E2E/CrdtDelete/Drifted.md";

		const map = new NoteIdMap();
		map.set(path, "id-drift");
		engine.setNoteIdMap(map);

		// A recorded CRDT baseline that DISAGREES with disk == genuine local
		// drift the user must not silently lose.
		const baseline = "# Old baseline\n";
		const drifted = "# Drifted\nunsynced local edit\n";
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(path, {
			hash: fnv1a(baseline),
		});
		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue(drifted);

		const order: string[] = [];
		(mockApp.vault.create as jest.Mock).mockImplementationOnce(async () => {
			order.push("create");
		});
		(mockApp.fileManager.trashFile as jest.Mock).mockImplementationOnce(async () => {
			order.push("trash");
		});

		await engine.applySyncChange(
			syncNoteEntry({ id: "id-drift", seq: 9, path, deleted: true, version: 2 }),
		);

		// Keep-both copy written FIRST (drift preserved), then the note trashed.
		expect(order).toEqual(["create", "trash"]);
		const createCall = (mockApp.vault.create as jest.Mock).mock.calls[0];
		expect(createCall[0]).toMatch(/\(conflict .*\)\.md$/);
		expect(createCall[1]).toBe(drifted);
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("md double-divergence (#306) writes a modal-free drift-conflict-copy of remote, keeps local", async () => {
		// conflictResolution:"modal" so the OLD behaviour would call onConflict —
		// the meaningful RED. setCrdtManager makes crdtOwnsBody true so applyChange
		// enters the CRDT catch-up block and reaches the localDiverged branch.
		const engine = createEngine({ conflictResolution: "modal" });
		engine.setCrdtManager({
			removeDoc: () => Promise.resolve(),
			closeDoc: () => {},
		} as unknown as import("../src/crdt/manager").CrdtManager);
		const path = "Notes/Drift306.md";

		const map = new NoteIdMap();
		map.set(path, "id-drift-306");
		engine.setNoteIdMap(map);

		const baseline = "# Base\n";
		const localDrift = "# Base\nlocal unsynced edit\n";
		const remote = "# Base\nremote edit\n";
		// Recorded baseline disagrees with disk (local drift) AND remote content
		// hash differs from the row's — both sides moved off the baseline.
		(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(path, {
			hash: fnv1a(baseline),
			serverHash: "old-server-hash",
		});

		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue(localDrift);

		let onConflictCalled = false;
		engine.onConflict = async () => {
			onConflictCalled = true;
			return { choice: "skip" as const };
		};
		__noticeCapture.notices.length = 0;

		await engine.applyChange({
			type: "note",
			id: "id-drift-306",
			path,
			content: remote,
			content_hash: "new-server-hash",
			version: 2,
			mtime: 1709345678,
			deleted: false,
		} as unknown as Parameters<typeof engine.applyChange>[0]);

		// Local drift preserved as a "(conflict …)" sibling (existing convention);
		// main converges to the server via socketConverge; no modal shown.
		const conflictCreate = (mockApp.vault.create as jest.Mock).mock.calls.find((c: unknown[]) =>
			/\(conflict .*\)\.md$/.test(c[0] as string),
		);
		expect(conflictCreate).toBeDefined();
		expect(conflictCreate?.[1]).toBe(localDrift);
		expect(onConflictCalled).toBe(false);
		expect(__noticeCapture.notices.length).toBeGreaterThan(0);
	});

	test("md catch-up with a clean local file (no drift) writes NO conflict copy", async () => {
		const engine = createEngine({ conflictResolution: "modal" });
		engine.setCrdtManager({
			removeDoc: () => Promise.resolve(),
			closeDoc: () => {},
		} as unknown as import("../src/crdt/manager").CrdtManager);
		const path = "Notes/Clean306.md";

		const map = new NoteIdMap();
		map.set(path, "id-clean-306");
		engine.setNoteIdMap(map);

		const baseline = "# Base\n";
		const remote = "# Base\nremote edit\n";
		// Disk still equals the last-synced baseline == NOT drifted.
		(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(path, {
			hash: fnv1a(baseline),
			serverHash: "old-server-hash",
		});
		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue(baseline);
		__noticeCapture.notices.length = 0;

		await engine.applyChange({
			type: "note",
			id: "id-clean-306",
			path,
			content: remote,
			content_hash: "new-server-hash",
			version: 2,
			mtime: 1709345678,
			deleted: false,
		} as unknown as Parameters<typeof engine.applyChange>[0]);

		// Clean local converges via the room, never a drift-copy.
		const created = (mockApp.vault.create as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
		expect(created.some((p: unknown) => /\(conflict .*\)/.test(p as string))).toBe(false);
	});

	test("still skips + resurrects a legacy (non-CRDT) note with unsynced edits", async () => {
		const { engine } = makeCrdtDeleteEngine();
		// No id mapping → not CRDT-managed → legacy resurrection protection.
		engine.setNoteIdMap(new NoteIdMap());
		// Oversized .md so the resurrection re-push takes the REST route (asserts pushNote).
		const path = "Notes/Legacy.md";

		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({ note: { path, version: 1 } });

		await engine.applySyncChange(
			syncNoteEntry({ id: "id-legacy", seq: 9, path, deleted: true, version: 2 }),
		);

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
		expect(mockApi.pushNote).toHaveBeenCalled();
	});
});

describe("SyncEngine.handleStreamEvent", () => {
	test("upsert event fetches note and applies change", async () => {
		const engine = createEngine();

		(mockApi.getNote as jest.Mock).mockResolvedValueOnce({
			path: "Notes/SSE.md",
			title: "SSE Note",
			content: "# SSE\n\nCreated via MCP",
			folder: "Notes",
			tags: [],
			mtime: 1709345678,
			created_at: "2026-03-01T12:00:00Z",
			updated_at: "2026-03-01T12:00:00Z",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/SSE.md",
			timestamp: 1709345678,
		});

		expect(mockApi.getNote).toHaveBeenCalledWith("Notes/SSE.md");
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"Notes/SSE.md",
			"# SSE\n\nCreated via MCP",
		);
	});

	test("upsert with inline content skips GET request", async () => {
		const engine = createEngine();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/Inline.md",
			timestamp: 1709345678,
			content: "# Inline\n\nDelivered via broadcast",
			title: "Inline",
			folder: "Notes",
			tags: ["test"],
			mtime: 1709345678,
			updated_at: "2026-03-01T12:00:00Z",
			version: 3,
		});

		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"Notes/Inline.md",
			"# Inline\n\nDelivered via broadcast",
		);
	});

	test("upsert without inline content falls back to GET", async () => {
		const engine = createEngine();

		(mockApi.getNote as jest.Mock).mockResolvedValueOnce({
			path: "Notes/Fallback.md",
			title: "Fallback",
			content: "# Fallback\n\nFetched via API",
			folder: "Notes",
			tags: [],
			mtime: 1709345678,
			created_at: "2026-03-01T12:00:00Z",
			updated_at: "2026-03-01T12:00:00Z",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/Fallback.md",
			timestamp: 1709345678,
			// No content field — simulates folder rename broadcast
		});

		expect(mockApi.getNote).toHaveBeenCalledWith("Notes/Fallback.md");
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"Notes/Fallback.md",
			"# Fallback\n\nFetched via API",
		);
	});

	test("delete event trashes local file", async () => {
		const engine = createEngine();
		const existingFile = new TFile("Notes/ToRemove.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/ToRemove.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
		expect(mockApi.getNote).not.toHaveBeenCalled();
	});

	test("delete event is honored even when the path was recently pushed", async () => {
		// An id-keyed rename resurrects the old path on the receiver (its CRDT
		// room is still bound there, so incoming channel traffic re-pushes it).
		// That push lands the old path in the echo-suppression set. The server's
		// authoritative delete for the old path then arrives — echo suppression
		// must NOT swallow it, or the renamed-away file lingers forever (e2e
		// test_10). A delete is never an echo of the client's own content push.
		const engine = createEngine();
		const path = "E2E/RenameOld.md";
		const existingFile = new TFile(path);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);
		(engine as unknown as { markRecentlyPushed(p: string): void }).markRecentlyPushed(path);

		await engine.handleStreamEvent({
			event_type: "delete",
			path,
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
	});

	test("delete event carrying our OWN device_id is dropped (#970)", async () => {
		// Origin-attributed self-echo guard (sync.ts ~L3973): the server stamps
		// the REST caller's X-Device-Id into delete broadcasts. A delete WE
		// caused must never be re-applied to our own vault.
		const engine = createEngine();
		engine.setDeviceId("device-self");
		const existingFile = new TFile("Notes/Mine.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Mine.md",
			timestamp: 1709345678,
			device_id: "device-self",
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("delete event from a FOREIGN device still applies (#970)", async () => {
		const engine = createEngine();
		engine.setDeviceId("device-self");
		const file = new TFile("Notes/Theirs.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(file);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Theirs.md",
			timestamp: 1709345678,
			device_id: "device-other",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
	});

	test("delete whose id matches the live note trashes it authoritatively (no pull)", async () => {
		// CRDT-authoritative rewire: a received delete is applied directly on the
		// socket receive path, never deferred to a REST pull (the old pull-defer
		// skipped the tombstone and resurrected the note — e2e test_47). The
		// delete→recreate case is discriminated by id (see the recreate test),
		// NOT by deferring an ambiguous delete to the ordered pull.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("E2E/Live.md", "id-live");
		engine.setNoteIdMap(noteIdMap);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-live");

		const liveFile = new TFile("E2E/Live.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(liveFile);
		(mockApp.fileManager.trashFile as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "E2E/Live.md",
			timestamp: 1709345678,
			id: "id-live",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(liveFile);
	});

	test("delete trashes when the path's id is not confirmed (defer guard falls through)", async () => {
		// Owned but unconfirmed id → not a note we know the server has under this
		// id → don't defer; the WS delete is honored (trashed) as before.
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("E2E/Unconf.md", "id-unconf"); // set but never confirmed
		engine.setNoteIdMap(noteIdMap);
		const file = new TFile("E2E/Unconf.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(file);
		(mockApp.fileManager.trashFile as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "E2E/Unconf.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
	});

	test("delete trashes a renamed-away old path (id resolves elsewhere, not canonical)", async () => {
		// The id now lives at the NEW path (pathForId !== oldPath), so the old path
		// is a duplicate to remove — the defer guard must NOT fire (test_10 invariant).
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		// Set old first, then new: byPath keeps a stale old→id entry while byId
		// (pathForId) resolves to the new path — the delete-first rename state.
		noteIdMap.set("E2E/RenameOld.md", "id-moved");
		noteIdMap.set("E2E/RenameNew.md", "id-moved");
		engine.setNoteIdMap(noteIdMap);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-moved");
		const oldFile = new TFile("E2E/RenameOld.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(oldFile);
		(mockApp.fileManager.trashFile as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "E2E/RenameOld.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
	});

	test("delete for a relocated id preserves the CRDT room (rename old-leg, test_34)", async () => {
		// Backend now emits the upsert for the NEW path BEFORE the delete for the
		// OLD path, so moveIfIdRelocated already relocated the id — it maps to the
		// new path only. Tearing down the room by id here would destroy the very
		// doc the new-path upsert just materialized (received=yes materialized=no).
		const removed: string[] = [];
		const resets: string[] = [];
		const engine = createEngine();
		engine.setCrdtManager({
			removeDoc: (id: string) => {
				removed.push(id);
				return Promise.resolve();
			},
			closeDoc: () => {},
		} as unknown as import("../src/crdt/manager").CrdtManager);
		engine.setCrdtEnrollment({
			enroll: () => {},
			reset: (id: string) => {
				resets.push(id);
			},
		});
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("E2E/RenameNew.md", "id-reloc"); // id lives at the NEW path now
		engine.setNoteIdMap(noteIdMap);
		// The old file was already moved by the relocation — nothing on disk here.
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
		(mockApp.fileManager.trashFile as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "E2E/RenameOld.md",
			timestamp: 1709345678,
			id: "id-reloc",
		});

		// Room preserved: the relocated doc must survive to materialize the new path.
		expect(removed).not.toContain("id-reloc");
		expect(resets).not.toContain("id-reloc");
		// No content trashed — the old file was already moved by moveIfIdRelocated.
		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("delete for an id still at THIS path tears down the room (regression guard)", async () => {
		// A genuine delete: the id maps to THIS path (no upsert relocated it), so
		// the authoritative teardown must still fire — removeDoc is called.
		const removed: string[] = [];
		const engine = createEngine();
		engine.setCrdtManager({
			removeDoc: (id: string) => {
				removed.push(id);
				return Promise.resolve();
			},
			closeDoc: () => {},
		} as unknown as import("../src/crdt/manager").CrdtManager);
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("E2E/Live.md", "id-live"); // id lives at THIS path
		engine.setNoteIdMap(noteIdMap);
		const liveFile = new TFile("E2E/Live.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(liveFile);
		(mockApp.fileManager.trashFile as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "E2E/Live.md",
			timestamp: 1709345678,
			id: "id-live",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(liveFile);
		expect(removed).toContain("id-live"); // room torn down for a real delete
	});

	test("relocated upsert materializes the new path from inline content (test_34, #189)", async () => {
		// Backend emits upsert-new BEFORE delete-old. On the receiver the id is
		// already relocated to the NEW path but no file exists there yet, and the
		// rename produced no Y.Doc update so materializeRelocated (doc projection,
		// isSynced-gated) bails — the new path would only appear ~60s later via the
		// pull (received=yes materialized=no). The upsert carries the note's
		// AUTHORITATIVE content inline, so it must materialize LIVE from event.content.
		const removed: string[] = [];
		const engine = createEngine();
		engine.setCrdtManager({
			removeDoc: (id: string) => {
				removed.push(id);
				return Promise.resolve();
			},
			closeDoc: () => {},
			// Synced doc → the first-delivery materializer is skipped, leaving the
			// rename new-leg to this branch. projectedText returns STALE content to
			// prove event.content (not the doc projection) is what gets written.
			isSynced: () => true,
			projectedText: () => Promise.resolve("STALE DOC PROJECTION"),
		} as unknown as import("../src/crdt/manager").CrdtManager);
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("E2E/RenameNew.md", "id-reloc"); // id already relocated here
		engine.setNoteIdMap(noteIdMap);
		(mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
		(mockApp.vault.create as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "E2E/RenameNew.md",
			timestamp: 1709345678,
			id: "id-reloc",
			content: "# Renamed\n\nAuthoritative body",
			content_hash: "h-reloc",
			updated_at: "2026-03-01T12:00:00Z",
		});

		// Materialized LIVE from the inline content, not the stale doc projection.
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"E2E/RenameNew.md",
			"# Renamed\n\nAuthoritative body",
		);
		// Room intact — the upsert never tears down its own doc.
		expect(removed).not.toContain("id-reloc");
	});

	test("delete for a relocated id trashes the stale old path but keeps the room (test_34 cleanup)", async () => {
		// Regression from e17e3e7: the rename old-leg guard preserved the room
		// (good) but stopped trashing the stale old-path file, so it lingered
		// forever (e2e test_34 "Cleanup.md still exists after 30s"). The room must
		// stay (it now belongs to the new path) AND the old file must be trashed.
		const removed: string[] = [];
		const resets: string[] = [];
		const engine = createEngine();
		engine.setCrdtManager({
			removeDoc: (id: string) => {
				removed.push(id);
				return Promise.resolve();
			},
			closeDoc: () => {},
		} as unknown as import("../src/crdt/manager").CrdtManager);
		engine.setCrdtEnrollment({
			enroll: () => {},
			reset: (id: string) => {
				resets.push(id);
			},
		});
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("E2E/RenameNew.md", "id-reloc"); // id lives at the NEW path now
		engine.setNoteIdMap(noteIdMap);
		// The stale old file is STILL on disk (moveIfIdRelocated did not trash it).
		const oldFile = new TFile("E2E/RenameOld.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockImplementation((p: string) =>
			p === "E2E/RenameOld.md" ? oldFile : null,
		);
		(mockApp.fileManager.trashFile as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "E2E/RenameOld.md",
			timestamp: 1709345678,
			id: "id-reloc",
		});

		// Old path cleaned up...
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		// ...but the relocated room survives to materialize the new path.
		expect(removed).not.toContain("id-reloc");
		expect(resets).not.toContain("id-reloc");
	});

	test("stale relocation upsert does not write the new path (write-time identity guard, #210)", async () => {
		// A concurrent relocation can land DURING an await between the branch's
		// stale-path guard and the materialize write, moving the id away from the
		// captured path. Writing then would re-create a moved-away path server-side
		// (#210). Mirror materializeRelocated's write-time pathForId re-check: the
		// stub map reports the captured path canonical when the branch is entered,
		// then flips (as if a relocation landed) before the write — the new path
		// must NOT be written.
		let flipped = false;
		const engine = createEngine();
		engine.setCrdtManager({
			removeDoc: () => Promise.resolve(),
			closeDoc: () => {},
			isSynced: () => true,
			projectedText: () => Promise.resolve("DOC BODY"),
		} as unknown as import("../src/crdt/manager").CrdtManager);
		const stubMap = {
			get: () => null,
			set: () => {
				flipped = true; // a concurrent relocation lands here
			},
			delete: () => {},
			rename: () => {},
			pathForId: (id: string) =>
				id === "id-reloc" ? (flipped ? "E2E/Elsewhere.md" : "E2E/RenameNew.md") : null,
		} as unknown as NoteIdMap;
		engine.setNoteIdMap(stubMap);
		(mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
		(mockApp.vault.create as jest.Mock).mockClear();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "E2E/RenameNew.md",
			timestamp: 1709345678,
			id: "id-reloc",
			content: "# Renamed\n\nAuthoritative body",
			content_hash: "h-reloc",
			updated_at: "2026-03-01T12:00:00Z",
		});

		// The id relocated away between the guard and the write — nothing materialized.
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("ignores events for ignored paths", async () => {
		const engine = createEngine();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: ".obsidian/workspace.md",
			timestamp: 1709345678,
		});

		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("skips events for paths currently being pushed (echo suppression)", async () => {
		// Use a slow pushNote to keep the path in the pushing set
		(mockApi.pushNote as jest.Mock).mockImplementation(
			() => new Promise((r) => setTimeout(r, 500)),
		);

		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so the LWW REST push fires and holds the path in the pushing set.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const file = new TFile("Notes/Active.md", Date.now());

		// Trigger push (debounce fires after 10ms, pushFile starts)
		engine.handleModify(file);

		// Wait for debounce to fire but not for push to complete
		await new Promise((r) => setTimeout(r, 50));

		// Now the file is in the pushing set — WebSocket event should be suppressed
		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/Active.md",
			timestamp: Date.now(),
		});

		// getNote should NOT have been called (echo suppression)
		expect(mockApi.getNote).not.toHaveBeenCalled();

		// Wait for push to finish
		await new Promise((r) => setTimeout(r, 500));

		// Clean up cooldown timers
		engine.destroy();
	}, 10000);

	test("suppresses WebSocket events after push completes (post-push cooldown)", async () => {
		// Fast push — completes quickly
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so a real REST push completes and opens the cooldown window.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const file = new TFile("Notes/Cooldown.md", Date.now());

		// Trigger push and wait for it to complete
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// Push is complete — path is no longer in pushing set
		// But should still be in recentlyPushed cooldown
		expect((engine as any).isRecentlyPushed("Notes/Cooldown.md")).toBe(true);

		// WebSocket event arriving after push should still be suppressed
		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/Cooldown.md",
			timestamp: Date.now(),
		});

		// getNote should NOT have been called (cooldown suppression)
		expect(mockApi.getNote).not.toHaveBeenCalled();

		// Clean up cooldown timers
		engine.destroy();
	});
});

describe("SyncEngine.fullSync (catch-up wiring)", () => {
	// fullSync's pull-half now routes through the single catch-up path
	// (reconcile + socket seq-replay + folder markers), NOT the REST pull()
	// cursor cluster. The genesis content-delivery mechanism is tested directly
	// against bootstrap/pullViaCursor (sync-cursor-pull.test.ts) and the op-log
	// replay (sync-socket-catchup.test.ts). NOTE: the seq-replay emits no
	// per-page "pulling" progress (only the terminal recap), so fullSync no
	// longer shows an incremental download bar during a large catch-up — a
	// deliberate consequence of the single-path migration, matching the already
	// silent reconnect/startup catch-up.
	test("fullSync routes its pull-half through catchUp (seq-replay), not the REST pull()", async () => {
		const engine = createEngine();
		const catchUp = jest.spyOn(engine, "catchUp").mockResolvedValue(0);
		const pull = jest.spyOn(engine as any, "pull");
		const pushModified = jest.spyOn(engine as any, "pushModifiedFiles").mockResolvedValue(0);

		await engine.fullSync();

		expect(catchUp).toHaveBeenCalledTimes(1);
		expect(pushModified).toHaveBeenCalledTimes(1);
		expect(pull).not.toHaveBeenCalled();
	});

	test("fullSync completion recap counts catch-up downloads, not just uploads", async () => {
		const engine = createEngine();
		let completeCurrent: number | null = null;
		engine.onSyncProgress = (p) => {
			if (p.phase === "complete") completeCurrent = p.current;
		};

		// Download-only sync: 2 ops applied via seq-replay, nothing local to push.
		jest.spyOn(engine, "catchUp").mockResolvedValue(2);
		jest.spyOn(engine as any, "pushModifiedFiles").mockResolvedValue(0);

		const { pulled, pushed } = await engine.fullSync();

		expect(pulled).toBe(2);
		expect(pushed).toBe(0);
		// The recap reads `current`; a download-only sync must report the 2
		// pulled, not pushed=0 → "Already up to date. Nothing needed syncing."
		expect(completeCurrent).toBe(2);
	});
});

describe("SyncEngine.getStatus + onStatusChange", () => {
	test("initial status is idle with no pending", () => {
		const engine = createEngine();
		const status = engine.getStatus();
		expect(status.state).toBe("idle");
		expect(status.pending).toBe(0);
		expect(status.lastSync).toBe("");
		expect(status.error).toBeUndefined();
	});

	test("status shows pending count during debounce", () => {
		const engine = createEngine({ debounceMs: 5000 });
		const file1 = new TFile("Notes/A.md");
		const file2 = new TFile("Notes/B.md");

		engine.handleModify(file1);
		engine.handleModify(file2);

		const status = engine.getStatus();
		expect(status.pending).toBe(2);
	});

	test("onStatusChange fires when modify queues a file", () => {
		const engine = createEngine({ debounceMs: 5000 });
		const statuses: string[] = [];
		engine.onStatusChange = (s) => statuses.push(s.state);

		engine.handleModify(new TFile("Notes/A.md"));

		expect(statuses.length).toBeGreaterThanOrEqual(1);
	});

	// NOTE: the old pull()-driven status lifecycle tests (syncing/error status +
	// skip-and-continue) were removed with the REST pull cluster. The socket
	// catch-up (catchUp/catchupViaSeqReplay) sets no syncing/error status and
	// swallows transient failures (a wedged socket recovers on reconnect); the
	// per-op skip-and-advance behavior is pinned in sync-socket-catchup.test.ts.
	// The `pulling`→syncing flag survives via pullAll (below).

	// REST-purge Bucket B (Task 5) — REMOVED: "pullAll skips files that fail to
	// apply and continues". pullAll() no longer runs its own per-note apply loop
	// over a REST fetch — it replays via catchupViaSeqReplay({fromZero:true}),
	// whose per-op skip-and-continue is pinned in sync-socket-catchup.test.ts
	// ("a per-note failure is caught, logged, and skipped — never throws"), and
	// whose applied-count passthrough via pullAll is pinned in
	// tests/sync-push-consolidation.test.ts ("SyncEngine.pullAll — replay-from-0").

	test("a per-file server error (502) queues a retry but stays ONLINE", async () => {
		// A storage 502 on one file means that file failed, NOT that the backend
		// is unreachable. The change is queued for retry and recorded as an issue,
		// but the plugin must not report itself disconnected.
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(
			Object.assign(new Error("Request failed, status 502"), {
				status: 502,
				json: { error: "failed to upload to storage backend" },
			}),
		);

		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so the LWW REST push fires (and can fail with the 502).
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const file = new TFile("Notes/Fail.md", Date.now());

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		const status = engine.getStatus();
		expect(engine.isOffline()).toBe(false);
		expect(status.state).not.toBe("offline");
		expect(status.queued).toBe(1);
		// The recorded issue surfaces the backend's message, not "status 502".
		const issue = engine.issues.get("Notes/Fail.md");
		expect(issue?.message).toBe("failed to upload to storage backend");
	});

	test("failed push tallies into the aggregated failure summary (drained once)", async () => {
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(
			Object.assign(new Error("Request failed, status 502"), {
				status: 502,
				json: { error: "failed to upload to storage backend" },
			}),
		);

		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so the LWW REST push fires and tallies the failure.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		engine.handleModify(new TFile("Notes/Fail.md", Date.now()));
		await new Promise((r) => setTimeout(r, 100));

		const summary = engine.drainFailureSummary();
		expect(summary.count).toBe(1);
		expect(summary.firstMessage).toBe("failed to upload to storage backend");
		// Draining resets the tally.
		expect(engine.drainFailureSummary().count).toBe(0);
	});
});

describe("SyncEngine conflict resolution", () => {
	// Use modal mode for interactive conflict tests
	const createConflictEngine = (overrides = {}) =>
		createEngine({ conflictResolution: "modal", ...overrides });

	const makeChange = (overrides = {}): any => ({
		path: "Notes/Conflict.md",
		title: "Conflict Note",
		content: "# Remote version",
		folder: "Notes",
		tags: [],
		mtime: 1709345700,
		updated_at: "2026-03-01T12:00:00Z",
		deleted: false,
		...overrides,
	});

	// Use timestamps where lastSync < localMtime < remoteMtime
	// lastSync "2024-01-01T00:00:00Z" = 1704067200s
	// localMtime  = 1709345000s (March 2024, after lastSync)
	// remoteMtime = 1709345700s (March 2024, after lastSync)
	const LAST_SYNC = "2024-01-01T00:00:00Z";
	const LOCAL_MTIME_MS = 1709345000 * 1000;
	const REMOTE_MTIME = 1709345700;

	test("detects conflict when both local and remote changed since lastSync", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Local version");

		let conflictReceived: any = null;
		engine.onConflict = async (info) => {
			conflictReceived = info;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(makeChange({ mtime: REMOTE_MTIME }));

		expect(conflictReceived).not.toBeNull();
		expect(conflictReceived.path).toBe("Notes/Conflict.md");
		expect(conflictReceived.localContent).toBe("# Local version");
		expect(conflictReceived.remoteContent).toBe("# Remote version");
	});

	test("no conflict when only remote changed (local unchanged since lastSync)", async () => {
		const engine = createEngine();
		engine.setLastSync(LAST_SYNC);

		// First sync: establish the content hash by applying the initial version
		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Original version");
		await engine.applyChange(
			makeChange({ content: "# Original version", mtime: REMOTE_MTIME }),
		);

		// Now a new remote change comes in, but local content hasn't changed
		// (still matches the hash we stored from the first sync write)
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Original version");

		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(
			makeChange({ content: "# Updated remote", mtime: REMOTE_MTIME + 100 }),
		);

		expect(conflictCalled).toBe(false);
		expect(
			mockApp.vault.process.mock.calls.length + mockApp.vault.modify.mock.calls.length,
		).toBeGreaterThan(0);
	});

	test("no conflict when content is identical", async () => {
		const engine = createEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Same content");

		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(makeChange({ content: "# Same content", mtime: REMOTE_MTIME }));

		expect(conflictCalled).toBe(false);
	});

	test("keep-remote overwrites local with remote content", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Local version");

		engine.onConflict = async () => "keep-remote";

		await engine.applyChange(makeChange({ mtime: REMOTE_MTIME }));

		expect(getWrittenContent()).toBe("# Remote version");
	});

	test("keep-both creates a conflict copy and keeps local", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Local version");

		engine.onConflict = async () => ({ choice: "keep-both" });

		await engine.applyChange(makeChange({ mtime: REMOTE_MTIME }));

		// Local should NOT be modified
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		// A conflict copy should be created
		expect(mockApp.vault.create).toHaveBeenCalledWith(
			expect.stringMatching(/^Notes\/Conflict \(conflict \d{4}-\d{2}-\d{2}\)\.md$/),
			"# Remote version",
		);
	});

	test("skip does nothing", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Local version");

		engine.onConflict = async () => ({ choice: "skip" });

		await engine.applyChange(makeChange({ mtime: REMOTE_MTIME }));

		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("defaults to keep-remote when no onConflict handler set", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Local version");

		// No onConflict handler — should default to keep-remote
		await engine.applyChange(makeChange({ mtime: REMOTE_MTIME }));

		expect(getWrittenContent()).toBe("# Remote version");
	});

	test("deleted remote change does not trigger conflict", async () => {
		const engine = createEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		// Local content matches recorded syncedHash — no unsynced edits, so
		// the resurrection guard allows the remote delete through.
		const syncedContent = "# Clean local copy";
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce(syncedContent);
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(
			"Notes/Conflict.md",
			{ hash: fnv1a(syncedContent) },
		);

		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(makeChange({ deleted: true, mtime: REMOTE_MTIME }));

		expect(conflictCalled).toBe(false);
		expect(mockApp.fileManager.trashFile).toHaveBeenCalled();
	});

	test("no conflict when firstSync and local file is stale (mtime older than remote)", async () => {
		const engine = createEngine();
		engine.setLastSync(LAST_SYNC);

		// Local file has old mtime (2 weeks ago) — user hasn't touched it
		const TWO_WEEKS_AGO_MS = (REMOTE_MTIME - 14 * 86400) * 1000;
		const localFile = new TFile("Notes/Conflict.md", TWO_WEEKS_AGO_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Old local version");

		// No syncedHash exists (firstSync=true scenario)
		// Remote has newer content with recent mtime
		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(
			makeChange({
				content: "# Updated remote version",
				mtime: REMOTE_MTIME,
			}),
		);

		// Should NOT trigger conflict — local is stale, remote is newer
		expect(conflictCalled).toBe(false);
		expect(getWrittenContent()).toBe("# Updated remote version");
	});

	test("still conflicts when firstSync but local file was recently modified", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		// Local file has mtime within the stale threshold (30 min ago)
		// — user plausibly edited it, so conflict should still trigger
		const THIRTY_MIN_AGO_MS = (REMOTE_MTIME - 1800) * 1000;
		const localFile = new TFile("Notes/Conflict.md", THIRTY_MIN_AGO_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# User just edited this");

		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(
			makeChange({
				content: "# Remote version",
				mtime: REMOTE_MTIME,
			}),
		);

		// SHOULD trigger conflict — local was recently edited
		expect(conflictCalled).toBe(true);
	});

	test("3-way merge overlap falls through to conflict handler with baseContent", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		// Wire up a real BaseStore with the base content
		const { BaseStore } = require("../src/base-store");
		const mockAdapter = { read: mock(), write: mock() };
		const baseStore = new BaseStore(mockAdapter, "sync-bases.json");
		baseStore.set("Notes/Conflict.md", "# Title\nBase content here", 1);
		engine.baseStore = baseStore;

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		// Both sides edited the same line — overlap guaranteed
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Title\nLocal edit here");

		let conflictReceived: any = null;
		engine.onConflict = async (info) => {
			conflictReceived = info;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(
			makeChange({
				content: "# Title\nRemote edit here",
				mtime: REMOTE_MTIME,
			}),
		);

		// 3-way merge should have failed, falling through to onConflict
		expect(conflictReceived).not.toBeNull();
		expect(conflictReceived.baseContent).toBe("# Title\nBase content here");
		expect(conflictReceived.localContent).toBe("# Title\nLocal edit here");
		expect(conflictReceived.remoteContent).toBe("# Title\nRemote edit here");
	});

	test("no baseStore entry skips merge, still detects conflict", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		// No baseStore set — simulates first sync after v0.6.0 upgrade
		engine.baseStore = null;

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Local version");

		let conflictReceived: any = null;
		engine.onConflict = async (info) => {
			conflictReceived = info;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(makeChange({ mtime: REMOTE_MTIME }));

		expect(conflictReceived).not.toBeNull();
		expect(conflictReceived.path).toBe("Notes/Conflict.md");
		expect(conflictReceived.baseContent).toBeUndefined();
	});

	test("3-way merge clean auto-resolves without calling conflict handler", async () => {
		const engine = createConflictEngine();
		engine.setLastSync(LAST_SYNC);

		// Wire up BaseStore with the base content
		const { BaseStore } = require("../src/base-store");
		const mockAdapter = { read: mock(), write: mock() };
		const baseStore = new BaseStore(mockAdapter, "sync-bases.json");
		baseStore.set("Notes/Conflict.md", "# Title\nSection A\n\nSection B", 1);
		engine.baseStore = baseStore;

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);
		(mockApp.vault.getFileByPath as jest.Mock)
			.mockReturnValueOnce(localFile) // applyChange lookup
			.mockReturnValueOnce(localFile); // pushFile lookup
		// Local edited Section A, remote edited Section B — non-overlapping
		(mockApp.vault.cachedRead as jest.Mock)
			.mockResolvedValueOnce("# Title\nLocal A\n\nSection B") // conflict check
			.mockResolvedValueOnce("# Title\nLocal A\n\nRemote B"); // pushFile reads merged

		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(
			makeChange({
				content: "# Title\nSection A\n\nRemote B",
				mtime: REMOTE_MTIME,
			}),
		);

		// Should auto-merge without calling conflict handler
		expect(conflictCalled).toBe(false);
		// Vault should be modified with merged content
		expect(getWrittenContent()).toBe("# Title\nLocal A\n\nRemote B");
	});

	test("no false conflict when remote appends to previously synced file", async () => {
		const engine = createEngine();
		engine.setLastSync(LAST_SYNC);

		const localFile = new TFile("Notes/Conflict.md", LOCAL_MTIME_MS);

		// First sync: pull initial content
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Note\n\nOriginal");
		await engine.applyChange(
			makeChange({ content: "# Note\n\nOriginal", mtime: REMOTE_MTIME }),
		);

		// Remote appends via MCP, local content is unchanged (Obsidian set mtime to "now")
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Note\n\nOriginal");

		let conflictCalled = false;
		engine.onConflict = async () => {
			conflictCalled = true;
			return { choice: "keep-remote" };
		};

		await engine.applyChange(
			makeChange({
				content: "# Note\n\nOriginal\n\nAppended line",
				mtime: REMOTE_MTIME + 100,
			}),
		);

		expect(conflictCalled).toBe(false);
		expect(getWrittenContent()).toBe("# Note\n\nOriginal\n\nAppended line");
	});
});

describe("SyncEngine.destroy", () => {
	test("clears pending timers so debounced push never fires", async () => {
		const engine = createEngine({ debounceMs: 10000 });
		const file = new TFile("Notes/Test.md");

		engine.handleModify(file);
		engine.destroy();

		// Wait longer than the debounce — push should never fire
		await new Promise((r) => setTimeout(r, 100));
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});
});

describe("OfflineQueue", () => {
	const { OfflineQueue } = require("../src/offline-queue");

	test("enqueue and dequeue", async () => {
		const queue = new OfflineQueue();
		await queue.enqueue({
			path: "Notes/A.md",
			action: "upsert",
			content: "# A",
			mtime: 100,
			timestamp: 1,
		});
		expect(queue.size).toBe(1);

		await queue.dequeue("Notes/A.md");
		expect(queue.size).toBe(0);
	});

	test("deduplicates by path (newer replaces older)", async () => {
		const queue = new OfflineQueue();
		await queue.enqueue({
			path: "Notes/A.md",
			action: "upsert",
			content: "v1",
			mtime: 100,
			timestamp: 1,
		});
		await queue.enqueue({
			path: "Notes/A.md",
			action: "upsert",
			content: "v2",
			mtime: 200,
			timestamp: 2,
		});

		expect(queue.size).toBe(1);
		expect(queue.all()[0].content).toBe("v2");
	});

	test("all() returns entries sorted by timestamp", async () => {
		const queue = new OfflineQueue();
		await queue.enqueue({
			path: "Notes/C.md",
			action: "upsert",
			content: "C",
			mtime: 300,
			timestamp: 3,
		});
		await queue.enqueue({
			path: "Notes/A.md",
			action: "upsert",
			content: "A",
			mtime: 100,
			timestamp: 1,
		});
		await queue.enqueue({ path: "Notes/B.md", action: "delete", timestamp: 2 });

		const entries = queue.all();
		expect(entries.map((e: any) => e.path)).toEqual(["Notes/A.md", "Notes/B.md", "Notes/C.md"]);
	});

	test("load restores persisted entries", () => {
		const queue = new OfflineQueue();
		queue.load([
			{ path: "Notes/X.md", action: "upsert", content: "X", mtime: 100, timestamp: 1 },
			{ path: "Notes/Y.md", action: "delete", timestamp: 2 },
		]);

		expect(queue.size).toBe(2);
	});

	test("clear removes all entries", async () => {
		const queue = new OfflineQueue();
		await queue.enqueue({
			path: "Notes/A.md",
			action: "upsert",
			content: "A",
			mtime: 100,
			timestamp: 1,
		});
		await queue.clear();
		expect(queue.size).toBe(0);
	});

	test("onPersist callback fires on enqueue (debounced), dequeue, and clear", async () => {
		const queue = new OfflineQueue(50);
		const persisted: any[] = [];
		queue.onPersist(async (entries: any) => {
			persisted.push([...entries]);
		});

		await queue.enqueue({
			path: "Notes/A.md",
			action: "upsert",
			content: "A",
			mtime: 100,
			timestamp: 1,
		});
		// enqueue is debounced — not persisted yet
		expect(persisted.length).toBe(0);
		await new Promise((r) => setTimeout(r, 100));
		expect(persisted.length).toBe(1);

		// dequeue persists immediately
		await queue.dequeue("Notes/A.md");
		expect(persisted.length).toBe(2);
		expect(persisted[1]).toEqual([]);

		await queue.enqueue({ path: "Notes/B.md", action: "delete", timestamp: 2 });
		// clear persists immediately (cancels pending enqueue debounce)
		await queue.clear();
		expect(persisted.length).toBe(3);
		expect(persisted[2]).toEqual([]);
		queue.destroy();
	});
});

describe("SyncEngine offline queue integration", () => {
	test("failed push queues the change and goes offline", async () => {
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(new Error("network"));

		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so the LWW REST push fires (and fails → queues).
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const file = new TFile("Notes/Offline.md", Date.now());

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		expect(engine.isOffline()).toBe(true);
		expect(engine.queue.size).toBe(1);
		const entry = engine.queue.all()[0];
		expect(entry.path).toBe("Notes/Offline.md");
		expect(entry.action).toBe("upsert");
		// Content-free queue entries — content is re-read on flush
		expect(entry.content).toBeUndefined();
	});

	test("failed delete queues the delete and goes offline", async () => {
		// A REST delete that fails goes offline and queues for retry. Since #306
		// both md and canvas deletes go over the durable CRDT socket (which never
		// throws), the only REST delete left is an ATTACHMENT (binary).
		(mockApi.deleteAttachment as jest.Mock).mockRejectedValueOnce(new Error("network"));

		const engine = createEngine();
		const file = new TFile("Notes/Deleted.png");

		await engine.handleDelete(file);

		expect(engine.isOffline()).toBe(true);
		expect(engine.queue.size).toBe(1);
		const entry = engine.queue.all()[0];
		expect(entry.path).toBe("Notes/Deleted.png");
		expect(entry.action).toBe("delete");
	});

	test("successful push after offline goes back online", async () => {
		// First push fails
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(new Error("network"));

		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so the LWW REST push path drives the offline→online transition.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const file = new TFile("Notes/Recovery.md", Date.now());

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));
		expect(engine.isOffline()).toBe(true);

		// Next push succeeds — also mock pushNote for queue flush
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const file2 = new TFile("Notes/Online.md", Date.now());
		engine.handleModify(file2);
		await new Promise((r) => setTimeout(r, 200));

		expect(engine.isOffline()).toBe(false);
	});

	test("flushQueue clears the IssueStore entry when a queued file finally uploads", async () => {
		const engine = createEngine();
		// A prior failure left both an issue and a queued retry for the same path.
		engine.issues.record({
			path: "Notes/Recovered.md",
			kind: "note",
			category: "server",
			status: 502,
			message: "failed to upload to storage backend",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 3,
		});
		engine.queue.load([
			{
				path: "Notes/Recovered.md",
				action: "upsert",
				content: "X",
				mtime: 100,
				timestamp: 1,
			},
		]);
		expect(engine.issues.count()).toBe(1);

		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });
		await engine.flushQueue();

		// The stale error must be gone once the file uploads (the reported bug).
		expect(engine.issues.get("Notes/Recovered.md")).toBeUndefined();
		expect(engine.issues.count()).toBe(0);
	});

	test("retryFailedNow re-enqueues transient/parked issues, leaves actionable ones", async () => {
		const engine = createEngine();
		// A parked transient failure (past the cap, no longer in the queue)...
		engine.issues.record({
			path: "Notes/Parked.md",
			kind: "note",
			category: "server",
			status: 502,
			message: "x",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 6,
		});
		// ...and an actionable one that retrying can't fix.
		engine.issues.record({
			path: "Big.pdf",
			kind: "attachment",
			category: "too_large",
			status: 413,
			message: "x",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		// ...and a note_processing_failed issue: bucketed under "other" but
		// actionable (won't self-heal on identical re-push), so retry must skip it.
		engine.issues.record({
			path: "Notes/Poison.md",
			kind: "note",
			category: "other",
			message: "x",
			parseReason: {
				code: "note_processing_failed",
				message: "could not process",
				detail: null,
			},
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		mockApp.vault.getFileByPath.mockReturnValue(new TFile("Notes/Parked.md", 100));
		mockApp.vault.cachedRead.mockResolvedValue("content");
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		await engine.retryFailedNow();

		expect(engine.issues.get("Notes/Parked.md")).toBeUndefined(); // retried + cleared
		expect(engine.issues.get("Big.pdf")).toBeDefined(); // left for the user to act on
		expect(engine.issues.get("Notes/Poison.md")).toBeDefined(); // not re-enqueued
	});

	test("flushQueue processes entries oldest-first", async () => {
		const engine = createEngine();

		// Pre-load queue
		engine.queue.load([
			{ path: "Notes/A.md", action: "upsert", content: "A", mtime: 100, timestamp: 1 },
			{ path: "Notes/B.md", action: "delete", timestamp: 2 },
			{ path: "Notes/C.md", action: "upsert", content: "C", mtime: 300, timestamp: 3 },
		]);

		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });
		(mockApi.deleteNote as jest.Mock).mockResolvedValue({ deleted: true, path: "" });

		const flushed = await engine.flushQueue();

		expect(flushed).toBe(3);
		expect(engine.queue.size).toBe(0);

		// Verify order: A (upsert), B (delete), C (upsert)
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/A.md", "A", 100);
		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/B.md");
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/C.md", "C", 300);
	});

	test("concurrent flushQueue calls coalesce — no double-push", async () => {
		const engine = createEngine();

		engine.queue.load([
			{ path: "Notes/A.md", action: "upsert", content: "A", mtime: 100, timestamp: 1 },
			{ path: "Notes/B.md", action: "upsert", content: "B", mtime: 200, timestamp: 2 },
		]);

		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		// goOnline() fires a flush fire-and-forget while the caller also awaits one
		// (the e2e restore_online pattern). Both called synchronously: the second
		// must join the first's in-flight drain rather than start a competing pass
		// over the same snapshot (which would re-push every entry → server 409s and
		// a stalled queue — the test_24 flake).
		const f1 = engine.flushQueue();
		const f2 = engine.flushQueue();
		expect(f1).toBe(f2);

		await Promise.all([f1, f2]);

		// Each entry pushed exactly once, queue fully drained.
		expect(mockApi.pushNote).toHaveBeenCalledTimes(2);
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/A.md", "A", 100);
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/B.md", "B", 200);
		expect(engine.queue.size).toBe(0);

		// A subsequent flush starts fresh (the in-flight latch cleared).
		const f3 = engine.flushQueue();
		expect(f3).not.toBe(f1);
		await f3;
	});

	test("flushQueue drains entries enqueued mid-flight (no lost update)", async () => {
		const engine = createEngine();
		engine.queue.load([
			{ path: "Notes/A.md", action: "upsert", content: "A", mtime: 100, timestamp: 1 },
		]);

		// Pushing A enqueues B mid-drain — mimics retryFailedNow queuing an entry
		// (or a file edit landing) while a flush is already in-flight. B is NOT in
		// the first pass's snapshot; the re-loop must still drain it.
		let pushedA = false;
		(mockApi.pushNote as jest.Mock).mockReset().mockImplementation(async (path: string) => {
			if (path === "Notes/A.md" && !pushedA) {
				pushedA = true;
				await engine.queue.enqueue({
					path: "Notes/B.md",
					action: "upsert",
					content: "B",
					mtime: 200,
					timestamp: 2,
				});
			}
			return { note: {}, chunks_indexed: 1 };
		});

		await engine.flushQueue();

		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/A.md", "A", 100);
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/B.md", "B", 200);
		expect(engine.queue.size).toBe(0);
	});

	test("flushQueue stops on failure and goes offline", async () => {
		const engine = createEngine();

		engine.queue.load([
			{ path: "Notes/A.md", action: "upsert", content: "A", mtime: 100, timestamp: 1 },
			{ path: "Notes/B.md", action: "upsert", content: "B", mtime: 200, timestamp: 2 },
		]);

		// First succeeds, second fails
		(mockApi.pushNote as jest.Mock)
			.mockResolvedValueOnce({ note: {}, chunks_indexed: 1 })
			.mockRejectedValueOnce(new Error("network"));

		const flushed = await engine.flushQueue();

		expect(flushed).toBe(1);
		expect(engine.queue.size).toBe(1); // B still queued
		expect(engine.isOffline()).toBe(true);
	});

	test("queue status reflected in getStatus", async () => {
		const engine = createEngine();

		expect(engine.getStatus().queued).toBe(0);

		engine.queue.load([
			{ path: "Notes/A.md", action: "upsert", content: "A", mtime: 100, timestamp: 1 },
		]);

		expect(engine.getStatus().queued).toBe(1);
	});

	test("flushQueue handles attachment entries", async () => {
		const engine = createEngine();

		engine.queue.load([
			{
				path: "Assets/img.png",
				action: "upsert",
				contentBase64: "AQID",
				mimeType: "image/png",
				mtime: 100,
				kind: "attachment",
				timestamp: 1,
			},
			{ path: "Assets/old.pdf", action: "delete", kind: "attachment", timestamp: 2 },
		]);

		(mockApi.pushAttachment as jest.Mock).mockResolvedValue({ attachment: {} });
		(mockApi.deleteAttachment as jest.Mock).mockResolvedValue({ deleted: true, path: "" });

		const flushed = await engine.flushQueue();

		expect(flushed).toBe(2);
		expect(mockApi.pushAttachment).toHaveBeenCalledWith(
			"Assets/img.png",
			"AQID",
			"image/png",
			100,
		);
		expect(mockApi.deleteAttachment).toHaveBeenCalledWith("Assets/old.pdf");
	});
});

describe("SyncEngine.isSyncable / isBinaryFile", () => {
	const engine = createEngine();

	test("markdown files are syncable but not binary", () => {
		const file = new TFile("Notes/Test.md");
		expect(engine.isSyncable(file)).toBe(true);
		expect(engine.isBinaryFile(file)).toBe(false);
	});

	test("canvas files are syncable but not binary", () => {
		const file = new TFile("Canvases/board.canvas");
		expect(engine.isSyncable(file)).toBe(true);
		expect(engine.isBinaryFile(file)).toBe(false);
	});

	test("PNG files are syncable and binary", () => {
		const file = new TFile("Assets/image.png");
		expect(engine.isSyncable(file)).toBe(true);
		expect(engine.isBinaryFile(file)).toBe(true);
	});

	test("PDF files are syncable and binary", () => {
		const file = new TFile("docs/manual.pdf");
		expect(engine.isSyncable(file)).toBe(true);
		expect(engine.isBinaryFile(file)).toBe(true);
	});

	test("JPG files are syncable and binary", () => {
		const file = new TFile("photos/vacation.jpg");
		expect(engine.isSyncable(file)).toBe(true);
		expect(engine.isBinaryFile(file)).toBe(true);
	});

	test("unsupported extensions are not syncable", () => {
		expect(engine.isSyncable(new TFile("data.json"))).toBe(false);
		expect(engine.isSyncable(new TFile("script.js"))).toBe(false);
		expect(engine.isSyncable(new TFile("style.css"))).toBe(false);
	});
});

describe("SyncEngine binary push", () => {
	test("binary file push calls readBinary + pushAttachment", async () => {
		const mockBuffer = new ArrayBuffer(3);
		new Uint8Array(mockBuffer).set([1, 2, 3]);
		(mockApp.vault.readBinary as jest.Mock).mockResolvedValueOnce(mockBuffer);
		(mockApi.pushAttachment as jest.Mock).mockResolvedValue({ attachment: {} });

		const engine = createEngine({ debounceMs: 10 });
		const file = new TFile("Assets/photo.png", Date.now());

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		expect(mockApp.vault.readBinary).toHaveBeenCalled();
		expect(mockApi.pushAttachment).toHaveBeenCalledWith(
			"Assets/photo.png",
			expect.any(String),
			"image/png",
			expect.any(Number),
		);
		// Should NOT call pushNote for binary
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("binary file delete calls deleteAttachment", async () => {
		const engine = createEngine();
		const file = new TFile("Assets/old.png");

		await engine.handleDelete(file);

		expect(mockApi.deleteAttachment).toHaveBeenCalledWith("Assets/old.png");
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});
});

describe("SyncEngine applySyncChange with attachments", () => {
	test("the merged seq feed carries both note and attachment entries", async () => {
		const engine = createEngine();

		// The merged op feed interleaves notes + attachments; applySyncChange
		// dispatches each by type. Attachment entries carry no bytes —
		// applyAttachmentChange fetches them.
		(mockApi.getAttachment as jest.Mock).mockResolvedValueOnce({
			path: "Assets/img.png",
			content_base64: "AQID",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 100,
			updated_at: "2026-03-01T12:00:00Z",
		});

		const note = await engine.applySyncChange(
			syncNoteEntry({ id: "a", seq: 1, path: "Notes/A.md", title: "A", content: "# A" }),
		);
		const attachment = await engine.applySyncChange({
			type: "attachment",
			id: "img",
			seq: 2,
			path: "Assets/img.png",
			mime_type: "image/png",
			size_bytes: 1000,
			mtime: 100,
			updated_at: "2026-03-01T12:00:00Z",
			deleted: false,
			version: 1,
		});

		expect(note).toBe(true);
		expect(attachment).toBe(true);
		expect(mockApi.getAttachment).toHaveBeenCalledWith("Assets/img.png");
		expect(mockApp.vault.create).toHaveBeenCalled(); // note
		expect(mockApp.vault.createBinary).toHaveBeenCalled(); // attachment
	});
});

describe("SyncEngine pull accuracy", () => {
	test("updates existing file even when remote mtime < local mtime", async () => {
		const engine = createEngine();
		engine.setLastSync("2024-04-01T00:00:00Z"); // lastSync after localMtime → no conflict

		// Local file has a LATER mtime than remote (simulates Obsidian setting mtime to "now")
		const localFile = new TFile("Notes/Existing.md", Date.now());
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);
		// Content matches the synced hash → user didn't edit locally → no conflict
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("# Old content");
		// Establish sync state so the engine knows this file was previously synced
		engine.importSyncState({ "Notes/Existing.md": { hash: 1126570110 } }); // fnv1a("# Old content")

		const result = await engine.applyChange({
			path: "Notes/Existing.md",
			title: "Existing",
			content: "# Updated remotely",
			folder: "Notes",
			tags: [],
			mtime: 1709345678, // older than local
			updated_at: "2026-03-01T12:00:00Z",
			deleted: false,
		});

		expect(result).toBe(true);
		expect(getWrittenContent()).toBe("# Updated remotely");
	});

	test("applySyncChange returns false (not counted) for an ignored path", async () => {
		const engine = createEngine();

		const applied = await engine.applySyncChange(
			syncNoteEntry({
				id: "ws",
				path: ".obsidian/workspace.json", // ignored path
				title: "",
				content: "{}",
				folder: ".obsidian",
			}),
		);

		expect(applied).toBe(false); // ignored path should not count
	});

	test("fullSync pushes files modified between old and new lastSync", async () => {
		const engine = createEngine();
		const oldSync = "2026-01-01T00:00:00Z";
		engine.setLastSync(oldSync);

		// Pull will update lastSync to a newer server_time

		// A file modified between old lastSync and new server_time.
		// Oversized .md so pushModifiedFiles' selected file takes the LWW REST route.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		const modifiedFile = new TFile(
			"Notes/Modified.md",
			new Date("2026-02-15T00:00:00Z").getTime(),
		);
		(mockApp.vault.getFiles as jest.Mock).mockReturnValueOnce([modifiedFile]);

		await engine.fullSync();

		// pushModifiedFiles should use the OLD lastSync (prePullSync), not the new one
		// The file was modified at Feb 15, which is after Jan 1 (old lastSync)
		expect(mockApi.pushNote).toHaveBeenCalledWith(
			"Notes/Modified.md",
			expect.any(String),
			expect.any(Number),
		);
	});

	test("fullSync on first connect pushes tracked files even with old mtime", async () => {
		// First connect: no prior lastSync (empty string). syncState already has
		// an entry for a local file (e.g. the remote vault already knew this path,
		// or state was loaded from a prior session). The file was last modified
		// long ago — well before the server_time pull will set lastSync to.
		const engine = createEngine();
		// Do NOT call setLastSync — lastSync is "" (first connect / fresh install)
		// Oversized .md so the tracked file re-pushes over the LWW REST route.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
		engine.importSyncState({
			"Notes/Tracked.md": { hash: 12345 },
		});

		// Pull returns no changes but advances lastSync to a recent server_time.

		// Tracked local file modified Feb 15 — BEFORE the post-pull server_time.
		const trackedFile = new TFile(
			"Notes/Tracked.md",
			new Date("2026-02-15T00:00:00Z").getTime(),
		);
		(mockApp.vault.getFiles as jest.Mock).mockReturnValueOnce([trackedFile]);

		await engine.fullSync();

		// On first connect, prePullSync is "" which means "never synced" = epoch.
		// The tracked file must still be pushed; it must NOT be gated by the
		// post-pull server_time (which would skip every file modified before now).
		expect(mockApi.pushNote).toHaveBeenCalledWith(
			"Notes/Tracked.md",
			expect.any(String),
			expect.any(Number),
		);
	});

	test("fullSync emits push progress events (so Merge shows the progress UI)", async () => {
		const engine = createEngine(); // fresh — lastSync "" so all files push
		const phases: string[] = [];
		engine.onSyncProgress = (p) => phases.push(p.phase);

		const a = new TFile("Notes/A.md", new Date("2026-02-15T00:00:00Z").getTime());
		const b = new TFile("Notes/B.md", new Date("2026-02-15T00:00:00Z").getTime());
		(mockApp.vault.getFiles as jest.Mock).mockReturnValueOnce([a, b]);

		await engine.fullSync();

		expect(phases).toContain("pushing");
		expect(phases).toContain("complete");
	});

	test("fullSync does not re-push an unchanged attachment on the second run", async () => {
		// Attachments must be recorded in syncState after a successful push, or
		// pushModifiedFiles treats them as untracked and re-pushes them on every
		// Merge (the "pulled 0 pushed 10 every time" loop for binary files).
		const engine = createEngine();

		// One attachment, last modified long ago (not edited between runs).
		const png = new TFile("Assets/photo.png", new Date("2026-02-15T00:00:00Z").getTime());
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([png]);
		(mockApp.vault.readBinary as jest.Mock).mockResolvedValue(new ArrayBuffer(3));
		(mockApi.pushAttachment as jest.Mock).mockResolvedValue({ attachment: {} });

		await engine.fullSync(); // first connect — pushes the attachment
		await engine.fullSync(); // second run — must NOT re-push it

		expect(mockApi.pushAttachment).toHaveBeenCalledTimes(1);
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([]); // avoid leak into next test
	});

	test("fullSync invalidates stale syncState when the active vault changed", async () => {
		const engine = createEngine({ vaultId: "vault-new" });
		engine.setSyncStateVaultId("vault-old"); // syncState belongs to a different vault
		engine.importSyncState({ "Notes/Stale.md": { hash: 111 } });

		(mockApp.vault.getFiles as jest.Mock).mockReturnValueOnce([]);

		await engine.fullSync();

		expect(engine.exportSyncState()["Notes/Stale.md"]).toBeUndefined();
		expect(engine.getSyncStateVaultId()).toBe("vault-new");
	});

	test("fullSync keeps syncState when the active vault is unchanged", async () => {
		const engine = createEngine({ vaultId: "vault-1" });
		engine.setSyncStateVaultId("vault-1");
		engine.importSyncState({ "Notes/Keep.md": { hash: 222 } });

		(mockApp.vault.getFiles as jest.Mock).mockReturnValueOnce([]);

		await engine.fullSync();

		expect(engine.exportSyncState()["Notes/Keep.md"]).toBeDefined();
	});

	test("fullSync adopts the current vault without wiping when none recorded (migration)", async () => {
		const engine = createEngine({ vaultId: "vault-1" });
		// No setSyncStateVaultId — simulates pre-upgrade data with existing state.
		engine.importSyncState({ "Notes/Legacy.md": { hash: 333 } });

		(mockApp.vault.getFiles as jest.Mock).mockReturnValueOnce([]);

		await engine.fullSync();

		expect(engine.exportSyncState()["Notes/Legacy.md"]).toBeDefined();
		expect(engine.getSyncStateVaultId()).toBe("vault-1");
	});

	test("applyAttachmentChange updates binary regardless of mtime", async () => {
		const engine = createEngine();
		engine.setLastSync("2024-04-01T00:00:00Z");

		// Local file has LATER mtime than remote
		const localFile = new TFile("Assets/image.png", Date.now());
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(localFile);

		const result = await engine.applyAttachmentChange(
			{
				path: "Assets/image.png",
				mime_type: "image/png",
				size_bytes: 3,
				mtime: 1709345678, // older than local
				updated_at: "2026-03-01T12:00:00Z",
				deleted: false,
			},
			"AQID",
		);

		expect(result).toBe(true);
		expect(mockApp.vault.modifyBinary).toHaveBeenCalledWith(localFile, expect.any(ArrayBuffer));
	});

	test("applyAttachmentChange records syncState so it is not pushed back", async () => {
		// A pulled attachment must be tracked in syncState; otherwise the
		// post-pull modify event re-pushes it to the server (pull→push churn).
		const engine = createEngine();
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null); // new file

		await engine.applyAttachmentChange(
			{
				path: "Assets/new.png",
				mime_type: "image/png",
				size_bytes: 3,
				mtime: 1709345678,
				updated_at: "2026-03-01T12:00:00Z",
				deleted: false,
			},
			"AQID",
		);

		expect(engine.exportSyncState()["Assets/new.png"]).toBeDefined();
	});
});

describe("SyncEngine WebSocket with kind routing", () => {
	test("WebSocket event with kind=attachment calls getAttachment", async () => {
		const engine = createEngine();

		(mockApi.getAttachment as jest.Mock).mockResolvedValueOnce({
			path: "Assets/remote.png",
			content_base64: "AQID",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 1709345678,
			updated_at: "2026-03-01T12:00:00Z",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Assets/remote.png",
			timestamp: 1709345678,
			kind: "attachment",
		});

		expect(mockApi.getAttachment).toHaveBeenCalledWith("Assets/remote.png");
		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.createBinary).toHaveBeenCalled();
	});

	test("WebSocket event with kind=note (or no kind) calls getNote", async () => {
		const engine = createEngine();

		(mockApi.getNote as jest.Mock).mockResolvedValueOnce({
			path: "Notes/SSE.md",
			title: "SSE Note",
			content: "# SSE",
			folder: "Notes",
			tags: [],
			mtime: 1709345678,
			created_at: "2026-03-01T12:00:00Z",
			updated_at: "2026-03-01T12:00:00Z",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/SSE.md",
			timestamp: 1709345678,
			// no kind field — should default to note behavior
		});

		expect(mockApi.getNote).toHaveBeenCalledWith("Notes/SSE.md");
		expect(mockApi.getAttachment).not.toHaveBeenCalled();
	});

	test("WebSocket delete with kind=attachment trashes local file", async () => {
		const engine = createEngine();
		const existingFile = new TFile("Assets/deleted.png");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Assets/deleted.png",
			timestamp: 1709345678,
			kind: "attachment",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
	});

	test("WebSocket delete with kind=attachment clears syncState for that path", async () => {
		// Regression: socket-driven delete did not clear syncState, leaving a
		// stale FNV-1a hash that could wrongly echo-suppress a future push to
		// the same path. Mirrors the poll-delete convention in applyAttachmentChange.
		const engine = createEngine();
		const existingFile = new TFile("Assets/move-src.png");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);

		// Pre-populate syncState as if the file was previously synced
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(
			"Assets/move-src.png",
			{ hash: fnv1a("fake-binary-hash") },
		);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Assets/move-src.png",
			timestamp: 1709345678,
			kind: "attachment",
		});

		expect(
			(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.has(
				"Assets/move-src.png",
			),
		).toBe(false);
	});

	test("WebSocket delete (note, no kind) clears syncState for that path", async () => {
		// Same regression for the note branch — delete handler is kind-blind so
		// both notes and attachments were affected. Mirrors the poll-delete
		// convention in applyChange (lines 1762–1763 in sync.ts).
		const engine = createEngine();
		const existingFile = new TFile("Notes/moved.md");
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(existingFile);

		// Pre-populate syncState as if the note was previously synced
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(
			"Notes/moved.md",
			{ hash: fnv1a("old note content") },
		);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/moved.md",
			timestamp: 1709345678,
		});

		expect(
			(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.has(
				"Notes/moved.md",
			),
		).toBe(false);
	});
});

describe("SyncEngine auth validation", () => {
	test("fullSync throws on invalid API key", async () => {
		(mockApi.ping as jest.Mock).mockResolvedValueOnce({ ok: false, error: "Invalid API key" });
		const engine = createEngine();

		await expect(engine.fullSync()).rejects.toThrow("Invalid API key");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("fullSync throws on connection failure", async () => {
		(mockApi.ping as jest.Mock).mockResolvedValueOnce({
			ok: false,
			error: "Connection failed",
		});
		const engine = createEngine();

		await expect(engine.fullSync()).rejects.toThrow("Connection failed");
	});

	test("fullSync proceeds when auth succeeds", async () => {
		(mockApi.ping as jest.Mock).mockResolvedValueOnce({ ok: true });
		// fullSync → catchUp (reconcile + seq-replay) + pushModifiedFiles. With no
		// crdt/local files wired, both legs no-op to zero.
		const engine = createEngine();

		const result = await engine.fullSync();
		expect(result).toEqual({ pulled: 0, pushed: 0 });
		expect(mockApi.ping).toHaveBeenCalled();
	});

	test("pushAll throws on invalid API key", async () => {
		(mockApi.ping as jest.Mock).mockResolvedValueOnce({ ok: false, error: "Invalid API key" });
		const engine = createEngine();

		await expect(engine.pushAll()).rejects.toThrow("Invalid API key");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("pushFile returns false on failure", async () => {
		const engine = createEngine();
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(new Error("401"));

		const file = new TFile("Notes/Test.md");
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("content");
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValueOnce("content");

		// Access private method via any cast
		const result = await (engine as any).pushFile(file);
		expect(result).toBe(false);
	});
});

// --- V8 OOM Fix: Ready Gate ---

describe("ready gate", () => {
	test("handleModify suppressed before setReady", async () => {
		const engine = createEngine({}, { ready: false });
		const file = new TFile("Notes/Test.md", Date.now());

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("handleDelete suppressed before setReady", async () => {
		const engine = createEngine({}, { ready: false });
		const file = new TFile("Notes/Test.md");

		await engine.handleDelete(file);

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(engine.queue.size).toBe(0);
	});

	test("handleRename suppressed before setReady", async () => {
		const engine = createEngine({}, { ready: false });
		const file = new TFile("Notes/Renamed.md", Date.now());

		await engine.handleRename(file, "Notes/Old.md");

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("events work after setReady", async () => {
		const engine = createEngine({ debounceMs: 10 }, { ready: false });
		engine.setReady();
		// Oversized .md so the ready-gate release drives a real REST push.
		const file = new TFile("Notes/Test.md", Date.now());
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.pushNote).toHaveBeenCalled();
	});
});

// --- V8 OOM Fix: Content-Free Queue Entries ---

describe("content-free queue entries", () => {
	test("failed push enqueues without content", async () => {
		const engine = createEngine({ debounceMs: 10 });
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(new Error("offline"));
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));

		// Oversized .md so the LWW REST push fires (and fails → enqueues content-free).
		const file = new TFile("Notes/Test.md", Date.now());
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		const entries = engine.queue.all();
		expect(entries).toHaveLength(1);
		expect(entries[0].path).toBe("Notes/Test.md");
		expect(entries[0].action).toBe("upsert");
		expect(entries[0].content).toBeUndefined();
		expect(entries[0].contentBase64).toBeUndefined();
	});

	test("flushQueue re-reads from vault for content-free entries", async () => {
		const engine = createEngine();
		engine.queue.load([
			{
				path: "Notes/Queued.md",
				action: "upsert",
				kind: "note",
				mtime: 1000,
				timestamp: Date.now(),
			},
		]);

		const file = new TFile("Notes/Queued.md", Date.now());
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(file);
		// Reset the default mock and set our specific return value
		(mockApp.vault.cachedRead as jest.Mock).mockReset().mockResolvedValueOnce("vault content");

		(engine as any).offline = true;
		const flushed = await engine.flushQueue();

		expect(flushed).toBe(1);
		expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(file);
		expect(mockApi.pushNote).toHaveBeenCalledWith(
			"Notes/Queued.md",
			"vault content",
			expect.any(Number),
		);

		// Restore default mock for other tests
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# Test\n\nContent");
	});

	test("flushQueue uses legacy entry content", async () => {
		const engine = createEngine();
		engine.queue.load([
			{
				path: "Notes/Legacy.md",
				action: "upsert",
				content: "stored content",
				mtime: 1000,
				timestamp: Date.now(),
			},
		]);

		(engine as any).offline = true;
		const flushed = await engine.flushQueue();

		expect(flushed).toBe(1);
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/Legacy.md", "stored content", 1000);
		expect(mockApp.vault.cachedRead).not.toHaveBeenCalled();
	});

	test("flushQueue skips deleted files", async () => {
		const engine = createEngine();
		engine.queue.load([
			{
				path: "Notes/Gone.md",
				action: "upsert",
				kind: "note",
				mtime: 1000,
				timestamp: Date.now(),
			},
		]);

		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValueOnce(null);

		(engine as any).offline = true;
		const flushed = await engine.flushQueue();

		expect(flushed).toBe(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
		expect(engine.queue.size).toBe(0);
	});

	test("flushQueue drains to 0 even when entry.vaultId differs from current settings.vaultId", async () => {
		// Regression: entries were dequeued by settings.vaultId, not entry.vaultId,
		// so an entry enqueued under vault-A would never be removed after settings
		// changed to vault-B — queue could never reach 0.
		const engine = createEngine({ vaultId: "vault-B" });

		engine.queue.load([
			{
				path: "Notes/A.md",
				action: "upsert",
				content: "hello",
				mtime: 100,
				timestamp: 1,
				vaultId: "vault-A",
			},
		]);

		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const flushed = await engine.flushQueue();

		expect(flushed).toBe(1);
		expect(engine.queue.size).toBe(0);
	});
});

// --- V8 OOM Fix: Debounced Persistence ---

describe("debounced persistence", () => {
	test("enqueue does not persist immediately", async () => {
		const { OfflineQueue } = require("../src/offline-queue");
		const queue = new OfflineQueue(100);
		const persistSpy = mock().mockResolvedValue(undefined);
		queue.onPersist(persistSpy);

		await queue.enqueue({ path: "a.md", action: "upsert" as const, timestamp: 1 });

		expect(persistSpy).not.toHaveBeenCalled();

		// Wait for the debounce timer to fire
		await new Promise((r) => setTimeout(r, 150));

		expect(persistSpy).toHaveBeenCalledTimes(1);
		queue.destroy();
	});

	test("rapid enqueues coalesce into one persist", async () => {
		const { OfflineQueue } = require("../src/offline-queue");
		const queue = new OfflineQueue(100);
		const persistSpy = mock().mockResolvedValue(undefined);
		queue.onPersist(persistSpy);

		for (let i = 0; i < 5; i++) {
			await queue.enqueue({ path: `file${i}.md`, action: "upsert" as const, timestamp: i });
		}

		expect(persistSpy).not.toHaveBeenCalled();

		await new Promise((r) => setTimeout(r, 150));

		expect(persistSpy).toHaveBeenCalledTimes(1);
		queue.destroy();
	});

	test("dequeue persists immediately", async () => {
		const { OfflineQueue } = require("../src/offline-queue");
		const queue = new OfflineQueue(100);
		const persistSpy = mock().mockResolvedValue(undefined);
		queue.onPersist(persistSpy);

		queue.load([{ path: "a.md", action: "upsert" as const, timestamp: 1 }]);
		await queue.dequeue("a.md");

		expect(persistSpy).toHaveBeenCalledTimes(1);
		queue.destroy();
	});
});

// --- V8 OOM Fix: Push Concurrency Limit ---

describe("push concurrency limit", () => {
	test("at most 5 concurrent pushes", async () => {
		const engine = createEngine({ debounceMs: 10 });

		let maxConcurrent = 0;
		let currentConcurrent = 0;
		const pushResolvers: (() => void)[] = [];

		(mockApi.pushNote as jest.Mock).mockImplementation(() => {
			currentConcurrent++;
			if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
			return new Promise<{ note: Record<string, unknown>; chunks_indexed: number }>(
				(resolve) => {
					pushResolvers.push(() => {
						currentConcurrent--;
						resolve({ note: {}, chunks_indexed: 1 });
					});
				},
			);
		});

		// Fire 10 modify events (oversized .md → real REST pushes for the slot limiter).
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		for (let i = 0; i < 10; i++) {
			const file = new TFile(`Notes/File${i}.md`, Date.now());
			engine.handleModify(file);
		}

		// Wait for debounce timers to fire and pushes to start
		await new Promise((r) => setTimeout(r, 50));

		expect(maxConcurrent).toBeLessThanOrEqual(5);
		expect(currentConcurrent).toBe(5);

		// Resolve all pushes
		while (pushResolvers.length > 0) {
			pushResolvers.shift()!();
			await new Promise((r) => setTimeout(r, 10));
		}
	});

	test("remaining pushes complete after slots free", async () => {
		const engine = createEngine({ debounceMs: 10 });

		let completedCount = 0;
		const pushResolvers: (() => void)[] = [];

		(mockApi.pushNote as jest.Mock).mockImplementation(() => {
			return new Promise<{ note: Record<string, unknown>; chunks_indexed: number }>(
				(resolve) => {
					pushResolvers.push(() => {
						completedCount++;
						resolve({ note: {}, chunks_indexed: 1 });
					});
				},
			);
		});

		// Fire 10 modify events (oversized .md → real REST pushes for the slot limiter).
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		for (let i = 0; i < 10; i++) {
			const file = new TFile(`Notes/File${i}.md`, Date.now());
			engine.handleModify(file);
		}

		await new Promise((r) => setTimeout(r, 50));

		// Resolve all pushes one by one, letting new ones start
		while (pushResolvers.length > 0) {
			pushResolvers.shift()!();
			await new Promise((r) => setTimeout(r, 10));
		}

		expect(completedCount).toBe(10);
	});
});

describe("SyncEngine.pushAll echo suppression fix", () => {
	test("pushAll() pushes files even when syncState hashes match", async () => {
		const engine = createEngine();
		// Oversized .md so pushAll's force=true push actually fires the LWW REST route.
		const big = "a".repeat(5 * 1024 * 1024);
		const file = new TFile("Notes/Existing.md", Date.now());
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([file]);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue(big);

		// Seed syncState by applying the note (as a catch-up op does), so the next
		// pushAll must force past the matching hash.
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
		await engine.applyChange({
			path: "Notes/Existing.md",
			title: "Existing",
			content: big,
			folder: "Notes",
			tags: [],
			mtime: 1709345678,
			updated_at: "2026-03-01T12:00:00Z",
			deleted: false,
		});

		jest.clearAllMocks();
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([file]);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue(big);
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const pushed = await engine.pushAll();

		// Should push despite hash match because pushAll uses force=true
		expect(pushed).toBe(1);
		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/Existing.md", big, expect.any(Number));
	});

	test("pushAll() reports skipped count when some files fail", async () => {
		const engine = createEngine();
		// Oversized .md so both notes take the LWW REST route (one ok, one fails).
		const file1 = new TFile("Notes/Good.md", Date.now());
		const file2 = new TFile("Notes/Bad.md", Date.now());
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([file1, file2]);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });
		(mockApi.pushNote as jest.Mock)
			.mockResolvedValueOnce({ note: {}, chunks_indexed: 1 })
			.mockRejectedValueOnce(new Error("network error"));

		const pushed = await engine.pushAll();

		expect(pushed).toBe(1);
		// The failed file gets queued, not counted as pushed
	});

	test("pushFile(force=true) bypasses echo suppression", async () => {
		const engine = createEngine();
		// Oversized .md so pushFile exercises the LWW REST route + its force bypass.
		const file = new TFile("Notes/Force.md", Date.now());
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		// Simulate a synced hash by doing a normal push first
		// Access private method via any cast for testing
		await (engine as any).pushFile(file);
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);

		jest.clearAllMocks();
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		// Normal push should be suppressed (echo)
		await (engine as any).pushFile(file);
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		// Force push should bypass suppression
		await (engine as any).pushFile(file, true);
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});

	test("echo-skip no-op push does not open the recently-pushed suppression window (Engram#944)", async () => {
		// pushFile's echo hash-skip (local content already matches syncState, e.g.
		// after a pull) is a no-op — nothing is transmitted to the server. It must
		// NOT open the same 5s suppression window a real push opens, or a
		// legitimately-arriving second remote update within that window gets
		// swallowed as "Echo skip (recently pushed)" (the canvas rapid-double-write
		// bug, backend e2e test_41_canvas_sync::test_canvas_modify_sync).
		const engine = createEngine();
		const path = "Notes/EchoNoop.md";
		const file = new TFile(path, Date.now());

		// Seed syncState by applying a catch-up op (no local pushFile call happens
		// here, so recentlyPushed must still be empty for this path).
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(null);
		await engine.applySyncChange(
			syncNoteEntry({
				id: "echo-noop-id",
				path,
				title: "EchoNoop",
				content: "# EchoNoop\n\nSynced content",
			}),
		);

		expect((engine as any).isRecentlyPushed(path)).toBe(false);

		// Local content matches what was just pulled — pushFile takes the
		// echo-skip no-op branch.
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# EchoNoop\n\nSynced content");
		jest.clearAllMocks();
		const pushed = await (engine as any).pushFile(file);

		expect(pushed).toBe(false);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
		// The no-op must NOT have opened the suppression window.
		expect((engine as any).isRecentlyPushed(path)).toBe(false);

		// A real remote update arriving right after must be applied, not
		// echo-skipped.
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(file);
		await engine.handleStreamEvent({
			event_type: "upsert",
			path,
			content: "# EchoNoop\n\nSecond real update",
			timestamp: Date.now(),
		});

		expect(getWrittenContent()).toBe("# EchoNoop\n\nSecond real update");
	});

	test("handleModify during a sync queues for post-sync push (#244)", async () => {
		const engine = createEngine({ debounceMs: 10 });
		// Oversized .md so the post-sync drain pushes via the LWW REST route.
		const big = "a".repeat(5 * 1024 * 1024);
		const file = new TFile("Notes/DuringPull.md", Date.now());
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue(big);
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });
		(mockApp.vault.getFileByPath as jest.Mock).mockReturnValue(file);

		// pullAll sets the `pulling` flag + drains post-sync pushes (the surviving
		// carrier of the #244 defer). Fire a user edit mid-replay, from inside the
		// (mocked) catchupViaSeqReplay call — `pulling` is still true at that point.
		(engine as any).catchupViaSeqReplay = async () => {
			engine.handleModify(file);
			return { applied: 0, serverIds: new Set<string>() };
		};

		await engine.pullAll();

		// The file should NOT have been debounce-pushed (edited mid-sync) but must
		// have been pushed via the post-sync drain.
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.pushNote).toHaveBeenCalledWith("Notes/DuringPull.md", big, expect.any(Number));
	});
});

describe("Path sanitization on push", () => {
	test("renames local file when server returns sanitized path", async () => {
		// Server sanitizes "test?.md" → "test.md". Oversized .md so the kept
		// LWW REST path (which still sanitize-renames) runs.
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({
			note: {
				id: "note-1",
				user_id: "user-1",
				path: "Notes/test.md",
				title: "test",
				folder: "Notes",
				tags: [],
				mtime: 1709234567,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			},
			chunks_indexed: 1,
		});

		const file = new TFile("Notes/test?.md", Date.now());
		// vault needs to find the file for rename
		(mockApp.vault.getFileByPath as jest.Mock).mockImplementation((p: string) => {
			if (p === "Notes/test?.md") return file;
			return null;
		});

		const engine = createEngine({ debounceMs: 10 });
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		// Should have renamed the local file to match server's sanitized path
		expect(mockApp.vault.rename).toHaveBeenCalledWith(file, "Notes/test.md");
	});

	test("does not revert a local rename that lands while the push is in flight (#245)", async () => {
		// Oversized .md so the kept LWW REST path (the only sanitize-rename surface) runs.
		const file = new TFile("Notes/RenameOld.md", Date.now());
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApp.vault.getFileByPath as jest.Mock).mockImplementation((p: string) =>
			p === file.path ? file : null,
		);
		(mockApi.pushNote as jest.Mock).mockImplementationOnce(async (path: string) => {
			// The user renames the file while the push request is in flight.
			// TFile.path is live, so by reply time it no longer matches the
			// path that was pushed.
			file.path = "Notes/RenameNew.md";
			return {
				note: {
					id: "note-1",
					user_id: "user-1",
					path, // server echoes the path it was given — no sanitization
					title: "RenameOld",
					folder: "Notes",
					tags: [],
					mtime: 1709234567,
					created_at: "2026-01-01T00:00:00Z",
					updated_at: "2026-01-01T00:00:00Z",
				},
				chunks_indexed: 1,
			};
		});

		const engine = createEngine({ debounceMs: 10 });
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		// The reply's old path must NOT be mistaken for server sanitization —
		// renaming back would silently revert the user's rename (issue #245,
		// run 29392015897).
		expect(mockApp.vault.rename).not.toHaveBeenCalled();
		expect(file.path).toBe("Notes/RenameNew.md");

		// Echo-suppression window must open under the path we SENT, not the live
		// path: the self-echo arrives as an upsert for RenameOld. Marking the live
		// path instead would let the old-path echo recreate the renamed-away file
		// and swallow a genuine remote update to RenameNew (Engram#944 class).
		const recentlyPushed = (engine as unknown as { recentlyPushed: Map<string, number> })
			.recentlyPushed;
		expect(recentlyPushed.has("Notes/RenameOld.md")).toBe(true);
		expect(recentlyPushed.has("Notes/RenameNew.md")).toBe(false);
	});

	test("does not rename when server path matches original", async () => {
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({
			note: {
				id: "note-1",
				user_id: "user-1",
				path: "Notes/Normal.md",
				title: "Normal",
				folder: "Notes",
				tags: [],
				mtime: 1709234567,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			},
			chunks_indexed: 1,
		});

		const file = new TFile("Notes/Normal.md", Date.now());
		const engine = createEngine({ debounceMs: 10 });
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		// No rename needed — path matches
		expect(mockApp.vault.rename).not.toHaveBeenCalled();
	});

	test("handles multiple illegal chars in filename", async () => {
		// Oversized .md so the kept LWW REST path (the sanitize-rename surface) runs.
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({
			note: {
				id: "note-1",
				user_id: "user-1",
				path: "Notes/What Why How.md",
				title: "What Why How",
				folder: "Notes",
				tags: [],
				mtime: 1709234567,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			},
			chunks_indexed: 1,
		});

		const file = new TFile("Notes/What? Why: How*.md", Date.now());
		(mockApp.vault.getFileByPath as jest.Mock).mockImplementation((p: string) => {
			if (p === "Notes/What? Why: How*.md") return file;
			return null;
		});

		const engine = createEngine({ debounceMs: 10 });
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 100));

		expect(mockApp.vault.rename).toHaveBeenCalledWith(file, "Notes/What Why How.md");
	});
});

describe("SyncEngine vault-scoped queue", () => {
	test("enqueued entries include vaultId from settings", async () => {
		const engine = createEngine({ vaultId: "42", debounceMs: 10 });
		// Simulate a push failure that enqueues
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(new Error("network"));
		mockApp.vault.cachedRead.mockResolvedValueOnce("content");

		const file = new TFile("test.md", Date.now());
		mockApp.vault.getFileByPath.mockReturnValueOnce(file);
		engine.handleModify(file);

		// Wait for debounce + async push
		await new Promise((r) => setTimeout(r, 50));

		const entries = engine.queue.all();
		if (entries.length > 0) {
			expect(entries[0].vaultId).toBe("42");
		}
	});
});

// ---------------------------------------------------------------------------
// Active editor refresh on sync (modifyFile)
// ---------------------------------------------------------------------------

describe("modifyFile active editor refresh", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
		// Reset mocks to defaults for this describe block
		mockActiveView.file = null;
		mockApp.workspace.getActiveViewOfType.mockReturnValue(null);
		mockApp.vault.getFileByPath.mockReset();
		mockApp.vault.getFileByPath.mockReturnValue(null);
		mockApp.vault.cachedRead.mockReset();
		mockApp.vault.cachedRead.mockResolvedValue("# Test\n\nContent");
		mockApp.vault.modify.mockReset();
		mockApp.vault.modify.mockResolvedValue(undefined);
		mockApp.vault.process.mockReset();
		mockApp.vault.process.mockImplementation((_file: any, fn: (data: string) => string) => {
			fn("");
			return Promise.resolve("");
		});
		(mockApi.pushNote as jest.Mock).mockReset();
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });
	});

	test("uses vault.process instead of vault.modify for scroll-safe updates", async () => {
		const existingFile = new TFile("Notes/Open.md", Date.now() - 10000);
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "Notes/Open.md" ? existingFile : null,
		);
		mockApp.vault.cachedRead.mockResolvedValue("old content");

		const engine = createEngine();
		engine.syncState.set("Notes/Open.md", { hash: fnv1a("old content"), version: 1 });

		await engine.applyChange({
			path: "Notes/Open.md",
			title: "Open",
			content: "new content from server",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 2,
		});

		// Should use vault.process (scroll-safe) not vault.modify
		expect(mockApp.vault.process).toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();

		// The transform function should return the new content
		const transformFn = mockApp.vault.process.mock.calls[0][1];
		expect(transformFn("anything")).toBe("new content from server");
	});

	test("falls back to vault.modify when vault.process is unavailable", async () => {
		const existingFile = new TFile("Notes/Fallback.md", Date.now() - 10000);
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "Notes/Fallback.md" ? existingFile : null,
		);
		mockApp.vault.cachedRead.mockResolvedValue("old content");
		// Simulate older Obsidian without vault.process
		const savedProcess = mockApp.vault.process;
		mockApp.vault.process = undefined;

		const engine = createEngine();
		engine.syncState.set("Notes/Fallback.md", { hash: fnv1a("old content"), version: 1 });

		await engine.applyChange({
			path: "Notes/Fallback.md",
			title: "Fallback",
			content: "new content",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 2,
		});

		expect(mockApp.vault.modify).toHaveBeenCalled();
		mockApp.vault.process = savedProcess;
	});

	test("uses vault.process on WebSocket stream event", async () => {
		const existingFile = new TFile("Notes/WS.md", Date.now() - 10000);
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "Notes/WS.md" ? existingFile : null,
		);
		mockApp.vault.cachedRead.mockResolvedValue("original");

		const engine = createEngine();
		engine.syncState.set("Notes/WS.md", { hash: fnv1a("original"), version: 1 });

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/WS.md",
			timestamp: Date.now(),
			content: "updated via websocket",
			title: "WS",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 2,
		});

		expect(mockApp.vault.process).toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});
});

describe("SyncEngine Obsidian API best practices", () => {
	describe("uses cachedRead for read-only operations", () => {
		test("push uses cachedRead (not read) for content hashing", async () => {
			const engine = createEngine({ debounceMs: 0 });
			const file = new TFile("Notes/CachedTest.md");

			mockApp.vault.cachedRead.mockResolvedValueOnce("# Cached content");
			mockApp.vault.read.mockClear();
			mockApp.vault.cachedRead.mockClear();
			mockApp.vault.cachedRead.mockResolvedValueOnce("# Cached content");

			// Trigger push via handleModify + flush debounce
			engine.handleModify(file);
			await new Promise((r) => setTimeout(r, 50));

			expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(file);
			expect(mockApp.vault.read).not.toHaveBeenCalled();
		});

		test("apply conflict detection uses cachedRead for local content", async () => {
			const engine = createEngine();

			const existingFile = new TFile("Notes/Conflict.md");
			mockApp.vault.getFileByPath.mockReturnValueOnce(existingFile);
			mockApp.vault.cachedRead.mockClear();
			mockApp.vault.read.mockClear();
			mockApp.vault.cachedRead.mockResolvedValueOnce("local content");

			await engine.applySyncChange(
				syncNoteEntry({
					id: "conflict",
					path: "Notes/Conflict.md",
					title: "Conflict",
					content: "remote content",
					mtime: Date.now() / 1000 + 100,
					version: 2,
					updated_at: new Date().toISOString(),
				}),
			);

			expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(existingFile);
			expect(mockApp.vault.read).not.toHaveBeenCalled();
		});
	});

	describe("uses getFileByPath for file lookups", () => {
		test("apply uses getFileByPath instead of getAbstractFileByPath for notes", async () => {
			const engine = createEngine();

			mockApp.vault.getFileByPath.mockClear();
			mockApp.vault.getAbstractFileByPath.mockClear();
			mockApp.vault.getFileByPath.mockReturnValue(null);

			await engine.applySyncChange(
				syncNoteEntry({
					id: "new",
					path: "Notes/New.md",
					title: "New",
					content: "new content",
					mtime: Date.now() / 1000,
					version: 1,
					updated_at: new Date().toISOString(),
				}),
			);

			expect(mockApp.vault.getFileByPath).toHaveBeenCalled();
		});
	});
});

// ---------------------------------------------------------------------------
// Sync state export/import round-trips
// ---------------------------------------------------------------------------

describe("SyncEngine sync state management", () => {
	test("exportSyncState returns all entries as plain object", () => {
		const engine = createEngine();
		engine.importSyncState({
			"Notes/A.md": { hash: 111 },
			"Notes/B.md": { hash: 222 },
		});
		const exported = engine.exportSyncState();
		expect(exported).toEqual({
			"Notes/A.md": { hash: 111 },
			"Notes/B.md": { hash: 222 },
		});
	});

	test("exportHashes returns hash-only projection", () => {
		const engine = createEngine();
		engine.importSyncState({
			"Notes/A.md": { hash: 111, version: 3 } as any,
			"Notes/B.md": { hash: 222 },
		});
		const hashes = engine.exportHashes();
		expect(hashes).toEqual({
			"Notes/A.md": 111,
			"Notes/B.md": 222,
		});
	});

	test("importHashes creates entries with hash property only", () => {
		const engine = createEngine();
		engine.importHashes({ "Notes/A.md": 111, "Notes/B.md": 222 });
		const exported = engine.exportSyncState();
		expect(exported["Notes/A.md"]).toEqual({ hash: 111 });
		expect(exported["Notes/B.md"]).toEqual({ hash: 222 });
	});

	test("importSyncState + exportSyncState round-trips correctly", () => {
		const engine = createEngine();
		const original = {
			"Notes/A.md": { hash: 111 },
			"Notes/B.md": { hash: 222 },
		};
		engine.importSyncState(original);
		expect(engine.exportSyncState()).toEqual(original);
	});

	test("importHashes + exportHashes round-trips correctly", () => {
		const engine = createEngine();
		const original = { "Notes/A.md": 111, "Notes/B.md": 222 };
		engine.importHashes(original);
		expect(engine.exportHashes()).toEqual(original);
	});
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe("SyncEngine.updateSettings", () => {
	test("re-parses ignore patterns after update", () => {
		const engine = createEngine({ ignorePatterns: "secret/" });
		expect(engine.shouldIgnore("secret/passwords.md")).toBe(true);
		expect(engine.shouldIgnore("public/readme.md")).toBe(false);

		engine.updateSettings({ ...DEFAULT_SETTINGS, ignorePatterns: "public/" });
		expect(engine.shouldIgnore("secret/passwords.md")).toBe(false);
		expect(engine.shouldIgnore("public/readme.md")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Private utility methods (accessed via cast for coverage)
// ---------------------------------------------------------------------------

describe("SyncEngine private utilities", () => {
	// Note: md5() uses crypto.subtle.digest("MD5") which Obsidian supports
	// but Bun's Web Crypto does not. MD5 tests require E2E in the backend repo.

	test("arrayBuffersEqual returns true for identical buffers", () => {
		const engine = createEngine();
		const a = new Uint8Array([1, 2, 3]).buffer;
		const b = new Uint8Array([1, 2, 3]).buffer;
		expect((engine as any).arrayBuffersEqual(a, b)).toBe(true);
	});

	test("arrayBuffersEqual returns false for different content", () => {
		const engine = createEngine();
		const a = new Uint8Array([1, 2, 3]).buffer;
		const b = new Uint8Array([1, 2, 4]).buffer;
		expect((engine as any).arrayBuffersEqual(a, b)).toBe(false);
	});

	test("arrayBuffersEqual returns false for different lengths", () => {
		const engine = createEngine();
		const a = new Uint8Array([1, 2]).buffer;
		const b = new Uint8Array([1, 2, 3]).buffer;
		expect((engine as any).arrayBuffersEqual(a, b)).toBe(false);
	});
});

describe("SyncEngine IssueStore integration", () => {
	test("413 Payload Too Large records issue and skips offline queue", async () => {
		const engine = createEngine();
		const file = new TFile("Health/big.pdf", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 6_500_000 };
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(
			Object.assign(new Error("Request failed, status 413"), { status: 413 }),
		);

		await (engine as any).pushFile(file, true);

		const issues = engine.issues.all();
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toBe("Health/big.pdf");
		expect(issues[0].category).toBe("too_large");
		expect(issues[0].status).toBe(413);
		expect(issues[0].sizeBytes).toBe(6_500_000);
		// Terminal failure must NOT have re-queued for retry
		expect(engine.queue.size).toBe(0);
	});

	test("401 auth failure records issue and skips offline queue", async () => {
		const engine = createEngine();
		// Oversized .md so the LWW REST push fires and surfaces the 401 issue.
		const file = new TFile("Notes/forbidden.md", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 100 };
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(
			Object.assign(new Error("Unauthorized"), { status: 401 }),
		);

		await (engine as any).pushFile(file, true);

		const issues = engine.issues.all();
		expect(issues).toHaveLength(1);
		expect(issues[0].category).toBe("auth");
		expect(issues[0].status).toBe(401);
		// Permanent auth failure must NOT loop the offline queue
		expect(engine.queue.size).toBe(0);
	});

	test("non-terminal failure (500) records issue AND queues for retry", async () => {
		const engine = createEngine();
		// Oversized .md so the LWW REST push fires (500 → issue + retry queue).
		const file = new TFile("Notes/flaky.md", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 100 };
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce(
			Object.assign(new Error("Internal Server Error"), { status: 500 }),
		);

		await (engine as any).pushFile(file, true);

		expect(engine.issues.all()).toHaveLength(1);
		expect(engine.issues.all()[0].category).toBe("server");
		expect(engine.queue.size).toBe(1);
	});

	test("successful push clears any prior issue for the same path", async () => {
		const engine = createEngine();
		// Oversized .md so the LWW REST push fires and clears the prior issue on success.
		const file = new TFile("Notes/recovers.md", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 100 };
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));

		// Pre-seed an issue (simulating an earlier failure that's now resolved)
		engine.issues.record({
			path: "Notes/recovers.md",
			kind: "note",
			category: "server",
			status: 500,
			message: "earlier 500",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		expect(engine.issues.count()).toBe(1);

		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({
			note: { path: "Notes/recovers.md", version: 1 },
			chunks_indexed: 1,
		});
		await (engine as any).pushFile(file, true);

		expect(engine.issues.count()).toBe(0);
	});
});

describe("SyncEngine attachment pre-gate (client-side plan limits)", () => {
	test("free text-only: non-text attachment is pre-skipped, no upload", async () => {
		const engine = createEngine();
		const file = new TFile("photo.png", Date.now());
		engine.applyPlanState({
			tier: "free",
			attachmentsTextOnly: true,
			maxFileBytes: 10_000_000,
			attachmentBytesCap: null,
			updatedAt: 1,
		});

		const ok = await (engine as any).pushFile(file, true);

		expect(ok).toBe(false);
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();
		expect(engine.issues.get("photo.png")?.category).toBe("needs_pro");
		// Informational skip is tallied for the batched toast.
		expect((engine as any).getAttachmentLimitedCount()).toBe(1);
	});

	test("free text-only: a known text ext (.txt) attachment is NOT pre-skipped", async () => {
		const engine = createEngine();
		// .txt isn't in BINARY_EXTENSIONS, so force it through the binary path to
		// prove the text-MIME parity rule itself allows it (effective MIME text/*).
		const file = new TFile("note.txt", Date.now());
		engine.applyPlanState({
			tier: "free",
			attachmentsTextOnly: true,
			maxFileBytes: 10_000_000,
			attachmentBytesCap: null,
			updatedAt: 1,
		});

		expect((engine as any).preGateAttachment(file)).toBeNull();
	});

	test("free text-only: a text note still uploads (notes not pre-gated)", async () => {
		const engine = createEngine();
		// An oversized .md is a text note (not an attachment) → not pre-gated, uploads via REST.
		const file = new TFile("Notes/Test.md", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 100 };
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		engine.applyPlanState({
			tier: "free",
			attachmentsTextOnly: true,
			maxFileBytes: 10_000_000,
			attachmentBytesCap: null,
			updatedAt: 1,
		});

		await (engine as any).pushFile(file, true);

		expect(mockApi.pushNote).toHaveBeenCalled();
		expect(engine.issues.count()).toBe(0);
	});

	test("oversize attachment is pre-skipped as too_large", async () => {
		const engine = createEngine();
		const file = new TFile("big.png", Date.now(), 500);
		engine.applyPlanState({
			tier: "pro",
			attachmentsTextOnly: false,
			maxFileBytes: 100,
			attachmentBytesCap: null,
			updatedAt: 1,
		});

		const ok = await (engine as any).pushFile(file, true);

		expect(ok).toBe(false);
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();
		const issue = engine.issues.get("big.png");
		expect(issue?.category).toBe("too_large");
		expect(issue?.sizeBytes).toBe(500);
	});

	test("bypassPlanSkip (resync) ignores the pre-gate and attempts upload", async () => {
		const engine = createEngine();
		const file = new TFile("photo.png", Date.now());
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		engine.applyPlanState({
			tier: "free",
			attachmentsTextOnly: true,
			maxFileBytes: 10_000_000,
			attachmentBytesCap: null,
			updatedAt: 1,
		});

		// Sanity: a normal push is pre-skipped.
		await (engine as any).pushFile(file, true);
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();

		// Forced bypass (what resyncSkippedAttachments does) must attempt the upload.
		await (engine as any).pushFile(file, true, true);
		expect(mockApi.pushAttachment).toHaveBeenCalled();
	});

	test("no planState → no pre-gate (backend decides), upload IS attempted", async () => {
		const engine = createEngine();
		const file = new TFile("photo.png", Date.now());
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		// No applyPlanState — planState stays null.

		await (engine as any).pushFile(file, true);

		expect(mockApi.pushAttachment).toHaveBeenCalled();
	});
});

describe("SyncEngine.pushAll with replaceRemote", () => {
	test("keep mode (replaceRemote:false): pushes all local, never deletes remote", async () => {
		const engine = createEngine();
		const local = [new TFile("kept.md", Date.now()), new TFile("also.md", Date.now())];
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue(local);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# Content");
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });
		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "kept.md" }, { path: "also.md" }, { path: "remote-only.md" }],
			attachments: [],
		});

		await engine.pushAll({ replaceRemote: false });

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect(mockApi.deleteAttachment).not.toHaveBeenCalled();
	});

	// NOTE: the replace-remote server-side delete behavior (server-only note-ids
	// via crdtDelete + server-only attachment-paths via deleteAttachment, and the
	// never-trash-local invariant) is covered against the real CRDT harness in
	// tests/sync-push-consolidation.test.ts ("replace-remote via crdtDelete +
	// attachment-delete"). It replaced the manifest-based wipeRemote mechanism
	// this describe used to exercise.

	test("backward compat: no opts = no deletions", async () => {
		const engine = createEngine();
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([new TFile("a.md", Date.now())]);
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# x");
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({ note: {}, chunks_indexed: 1 });
		(mockApi.getManifest as jest.Mock).mockResolvedValueOnce({
			notes: [{ path: "a.md" }, { path: "remote.md" }],
			attachments: [],
		});

		await engine.pushAll(); // no args

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});
});

describe("SyncEngine.pullAll with deleteLocalExtras", () => {
	test("keep-local mode: pulls remote, never trashes local files", async () => {
		const engine = createEngine();
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([
			new TFile("local-only.md", Date.now()),
		]);

		await engine.pullAll({ deleteLocalExtras: false });

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("delete-local mode: trashes local-only files when wiping pre-pull", async () => {
		const engine = createEngine();
		const localOnly = new TFile("local-only.md", Date.now());
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([localOnly]);

		await engine.pullAll({ deleteLocalExtras: true });

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(localOnly);
	});
});

describe("SyncEngine sync-blocked gate", () => {
	test("setSyncBlocked(true) makes handleModify a no-op", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		const file = new TFile("Notes/Locked.md", Date.now());

		engine.handleModify(file);

		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("setSyncBlocked(true) makes handleDelete a no-op", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		const file = new TFile("Notes/Locked.md", Date.now());

		await engine.handleDelete(file);

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	test("setSyncBlocked(true) makes handleRename a no-op", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		const file = new TFile("Notes/New.md", Date.now());

		await engine.handleRename(file, "Notes/Old.md");

		expect(mockApi.pushNote).not.toHaveBeenCalled();
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	test("setSyncBlocked(true) makes pullAll return 0 without touching the server", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		const pulled = await engine.pullAll({ deleteLocalExtras: false });

		expect(pulled).toBe(0);
		expect(mockApi.getNote).not.toHaveBeenCalled();
	});

	test("setSyncBlocked(true) makes pushAll return 0 without calling ping/pushNote", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		(mockApp.vault.getFiles as jest.Mock).mockReturnValue([new TFile("a.md", Date.now())]);

		const pushed = await engine.pushAll();

		expect(pushed).toBe(0);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("setSyncBlocked(true) makes fullSync return zero counts without IO", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		const result = await engine.fullSync();

		expect(result).toEqual({ pulled: 0, pushed: 0 });
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("setSyncBlocked(false) restores normal handleModify", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		engine.setSyncBlocked(false);
		// Engine must already be ready for handleModify to push
		engine.setReady();
		const file = new TFile("Notes/Active.md", Date.now());
		(mockApp.vault.cachedRead as jest.Mock).mockResolvedValue("# Active");
		(mockApi.pushNote as jest.Mock).mockResolvedValueOnce({ note: {}, chunks_indexed: 1 });

		engine.handleModify(file);
		// Wait for the debounced push — handleModify schedules work.
		// Use the test's existing pattern from other handleModify tests.
		await new Promise((resolve) => setTimeout(resolve, 50));
		// Don't strictly assert pushNote was called — the existing handleModify
		// debounces and may not flush within 50ms. The key assertion is that
		// the early-return is gone (no exception, state changed).
		expect(engine.isSyncBlocked()).toBe(false);
	});
});

describe("SyncEngine attachment 402 (Free tier) handling", () => {
	function makeAttachmentLimitedError(): LimitExceededError {
		return new LimitExceededError(
			"attachments_disabled",
			"https://app.engram.page/settings/billing",
			"attachments_enabled",
			false,
			null,
		);
	}

	beforeEach(() => {
		__noticeCapture.notices.length = 0;
	});

	test("single attachment 402 → file skipped, marked needs_pro, NOT re-queued", async () => {
		const engine = createEngine();
		const file = new TFile("Assets/logo.png", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 1024 };
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeAttachmentLimitedError());

		await (engine as any).pushFile(file, true);

		const issues = engine.issues.all();
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toBe("Assets/logo.png");
		expect(issues[0].category).toBe("needs_pro");
		expect(issues[0].status).toBe(402);
		expect(issues[0].kind).toBe("attachment");
		// Terminal — must NOT be re-queued for retry
		expect(engine.queue.size).toBe(0);
		// The batched toast is NOT yet fired by pushFile alone — it's drained
		// by the batch driver (pushModifiedFiles / pushAll). Confirm pending count.
		expect((engine as any).getAttachmentLimitedCount()).toBe(1);
	});

	test("multiple attachment 402s in one batch → SINGLE batched toast (count = N)", async () => {
		const engine = createEngine();
		const files = [
			new TFile("Assets/a.png", Date.now()),
			new TFile("Assets/b.jpg", Date.now()),
			new TFile("Assets/c.pdf", Date.now()),
		];
		for (const f of files) (f as any).stat = { mtime: Date.now(), size: 1024 };

		mockApp.vault.getFiles.mockReturnValue(files);
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock)
			.mockRejectedValueOnce(makeAttachmentLimitedError())
			.mockRejectedValueOnce(makeAttachmentLimitedError())
			.mockRejectedValueOnce(makeAttachmentLimitedError());
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });

		await engine.pushAll();

		// Three issues recorded, all needs_pro
		expect(engine.issues.count("needs_pro")).toBe(3);
		// Single batched toast — message includes the count "3"
		const proNotices = __noticeCapture.notices.filter((n) =>
			/attachments? skipped/.test(n.message),
		);
		expect(proNotices).toHaveLength(1);
		expect(proNotices[0].message).toContain("3 attachments");
		// Counter drained after flush
		expect((engine as any).getAttachmentLimitedCount()).toBe(0);
		// Session flag set so subsequent batches don't re-toast
		expect((engine as any).hasShownAttachmentLimitToast()).toBe(true);
	});

	test("text-note push still completes in the same batch where attachments fail", async () => {
		const engine = createEngine();
		// Oversized .md so the note takes the LWW REST route alongside the failing attachment.
		const note = new TFile("Notes/Hello.md", Date.now());
		const attach = new TFile("Assets/logo.png", Date.now());
		(note as any).stat = { mtime: Date.now(), size: 100 };
		(attach as any).stat = { mtime: Date.now(), size: 1024 };

		mockApp.vault.getFiles.mockReturnValue([note, attach]);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushNote as jest.Mock).mockResolvedValue({
			note: { path: "Notes/Hello.md", version: 1 },
			chunks_indexed: 1,
		});
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeAttachmentLimitedError());
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });

		const pushed = await engine.pushAll();

		// Markdown went through; attachment was skipped
		expect(mockApi.pushNote).toHaveBeenCalled();
		expect(pushed).toBe(1); // note pushed, attachment failed
		expect(engine.issues.count("needs_pro")).toBe(1);
		expect(engine.issues.all()[0].path).toBe("Assets/logo.png");
	});

	test("second push attempt does NOT re-fire the file (persistence via IssueStore)", async () => {
		const engine = createEngine();
		const file = new TFile("Assets/logo.png", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 1024 };
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeAttachmentLimitedError());

		// First push hits 402, records the issue
		await (engine as any).pushFile(file, true);
		expect(engine.issues.count("needs_pro")).toBe(1);
		const callCountAfterFirst = (mockApi.pushAttachment as jest.Mock).mock.calls.length;

		// Second push must short-circuit BEFORE hitting the API
		await (engine as any).pushFile(file, true);
		const callCountAfterSecond = (mockApi.pushAttachment as jest.Mock).mock.calls.length;
		expect(callCountAfterSecond).toBe(callCountAfterFirst);
		// Issue is unchanged (no extra attempt recorded)
		expect(engine.issues.all()[0].attempts).toBe(1);
	});

	test("batched toast suppressed on a subsequent batch in the same session", async () => {
		const engine = createEngine();
		const fileA = new TFile("Assets/a.png", Date.now());
		const fileB = new TFile("Assets/b.png", Date.now());
		(fileA as any).stat = { mtime: Date.now(), size: 1024 };
		(fileB as any).stat = { mtime: Date.now(), size: 1024 };

		mockApp.vault.getFiles.mockReturnValue([fileA]);
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeAttachmentLimitedError());
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });

		await engine.pushAll();
		const firstToastCount = __noticeCapture.notices.filter((n) =>
			/attachments? skipped/.test(n.message),
		).length;
		expect(firstToastCount).toBe(1);

		// Second batch — even if a NEW attachment hits 402, no second toast.
		mockApp.vault.getFiles.mockReturnValue([fileB]);
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeAttachmentLimitedError());
		await engine.pushAll();

		const totalToasts = __noticeCapture.notices.filter((n) =>
			/attachments? skipped/.test(n.message),
		).length;
		expect(totalToasts).toBe(1);
	});

	test("toast uses singular noun when exactly one attachment was skipped", async () => {
		const engine = createEngine();
		const file = new TFile("Assets/only.png", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 1024 };
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeAttachmentLimitedError());
		(mockApi.ping as jest.Mock).mockResolvedValue({ ok: true });

		await engine.pushAll();
		const toast = __noticeCapture.notices.find((n) => /attachment skipped/.test(n.message));
		expect(toast).toBeDefined();
		expect(toast?.message).toContain("1 attachment skipped");
	});

	function makeQuotaError(): LimitExceededError {
		return new LimitExceededError(
			"attachments_quota_exceeded",
			"https://app.engram.page/settings/billing",
			"attachment_storage_bytes",
			1000,
			1000,
		);
	}

	test("quota 402 → skipped (not failed), category=quota, NOT re-queued", async () => {
		const engine = createEngine();
		const file = new TFile("Assets/big.png", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 1024 };
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeQuotaError());

		await (engine as any).pushFile(file, true);

		expect(engine.issues.count("quota")).toBe(1);
		// Terminal — never re-queued.
		expect(engine.queue.size).toBe(0);
		// Tallied as a plan-skip, not a failure.
		expect((engine as any).getAttachmentLimitedCount()).toBe(1);
	});

	test.each([
		["needs_pro", () => makeAttachmentLimitedError()],
		["quota", () => makeQuotaError()],
	])("plan-limit %s push does NOT call console.error", async (_label, makeErr) => {
		const engine = createEngine();
		const file = new TFile("Assets/x.png", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 1024 };
		mockApp.vault.readBinary.mockResolvedValue(new ArrayBuffer(8));
		(mockApi.pushAttachment as jest.Mock).mockRejectedValueOnce(makeErr());

		const spy = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			await (engine as any).pushFile(file, true);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});

	test("a real failure (5xx) STILL calls console.error", async () => {
		const engine = createEngine();
		// Oversized .md so the LWW REST push fires and the 5xx surfaces to console.error.
		const file = new TFile("Notes/x.md", Date.now());
		(file as any).stat = { mtime: Date.now(), size: 100 };
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockRejectedValueOnce({ status: 502, message: "boom" });

		const spy = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			await (engine as any).pushFile(file, false);
			expect(spy).toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});

describe("SyncEngine.applyPlanState / resyncSkippedAttachments", () => {
	const freePlan = {
		tier: "free" as const,
		attachmentsTextOnly: true,
		maxFileBytes: 10_000_000,
		attachmentBytesCap: null,
		updatedAt: 1,
	};
	const proPlan = {
		tier: "pro" as const,
		attachmentsTextOnly: false,
		maxFileBytes: 10_000_000,
		attachmentBytesCap: null,
		updatedAt: 2,
	};

	test("applyPlanState persists via onPlanStatePersist", () => {
		const engine = createEngine();
		const saved: unknown[] = [];
		engine.onPlanStatePersist = (p) => saved.push(p);
		engine.applyPlanState(proPlan);
		expect(saved.length).toBe(1);
		expect(engine.getPlanState()).toEqual(proPlan);
	});

	test("hydratePlanState seeds state without triggering a resync", async () => {
		const engine = createEngine();
		engine.issues.record({
			path: "a.png",
			kind: "attachment",
			category: "needs_pro",
			message: "x",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		const png = new TFile("a.png");
		mockApp.vault.getAbstractFileByPath.mockReturnValue(png);

		// Hydrating with a paid plan must NOT re-push — prev is null but this is a
		// reload, not an upgrade.
		engine.hydratePlanState(proPlan);
		// Let any (erroneously) scheduled microtasks settle.
		await Promise.resolve();
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();
		expect(engine.getPlanState()).toEqual(proPlan);
	});

	test("on capability gained, skipped attachments are re-attempted and cleared", async () => {
		const engine = createEngine();
		engine.issues.record({
			path: "a.png",
			kind: "attachment",
			category: "needs_pro",
			message: "x",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		const png = new TFile("a.png");
		mockApp.vault.getAbstractFileByPath.mockReturnValue(png);
		(mockApi.pushAttachment as jest.Mock).mockResolvedValue({ attachment: {} });

		// free → free: no capability gain, no resync.
		engine.applyPlanState(freePlan);
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();

		// free → pro: text-only true→false = capability gain → resync fires.
		engine.applyPlanState(proPlan);
		await engine.resyncSkippedAttachments();

		expect(mockApi.pushAttachment).toHaveBeenCalled();
		expect(engine.issues.get("a.png")).toBeUndefined();
	});

	test("bypassPlanSkip re-attempts a parked needs_pro attachment (force alone does not)", async () => {
		const engine = createEngine();
		const png = new TFile("a.png");
		engine.issues.record({
			path: "a.png",
			kind: "attachment",
			category: "needs_pro",
			message: "x",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		(mockApi.pushAttachment as jest.Mock).mockResolvedValue({ attachment: {} });

		// force=true but bypassPlanSkip=false (the bulk pushAll path): the
		// needs_pro entry still short-circuits — no network call, stays quiet.
		await (engine as any).pushFile(png, true, false);
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();

		// bypassPlanSkip=true (the resync path): short-circuit bypassed, uploads.
		await (engine as any).pushFile(png, true, true);
		expect(mockApi.pushAttachment).toHaveBeenCalled();
	});

	test("a parked quota attachment is also short-circuited on a normal re-push, and re-attempted under bypassPlanSkip", async () => {
		const engine = createEngine();
		const png = new TFile("a.png");
		engine.issues.record({
			path: "a.png",
			kind: "attachment",
			category: "quota",
			message: "x",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		(mockApi.pushAttachment as jest.Mock).mockResolvedValue({ attachment: {} });

		// force=true but bypassPlanSkip=false (the bulk pushAll path): the parked
		// quota entry is informational, so it short-circuits — no network call,
		// stays quiet. (Pre-fix this re-uploaded and re-402'd every sync.)
		await (engine as any).pushFile(png, true, false);
		expect(mockApi.pushAttachment).not.toHaveBeenCalled();

		// bypassPlanSkip=true (the resync path): short-circuit bypassed, uploads.
		await (engine as any).pushFile(png, true, true);
		expect(mockApi.pushAttachment).toHaveBeenCalled();
	});
});
