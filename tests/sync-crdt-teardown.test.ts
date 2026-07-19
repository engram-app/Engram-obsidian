/**
 * Tests: Task 5 — CRDT doc teardown on delete/rename (audit P1-3).
 *
 * Asserts that:
 *  - handleDelete (md, success + 404) calls crdt.removeDoc + enrollment.reset
 *  - handleDelete (md, non-404 error) does NOT call removeDoc (delete failed)
 *  - handleDelete for a binary file does NOT call removeDoc
 *  - handleRename (md old path, success + 404) calls crdt.removeDoc + enrollment.reset
 *  - handleRename for a binary file does NOT call removeDoc for old path
 *  - handleStreamEvent remote-delete for md calls crdt.removeDoc + enrollment.reset
 *  - handleStreamEvent remote-delete for a non-md path does NOT call removeDoc
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// ---------------------------------------------------------------------------
// Shared mock infrastructure (mirrors sync-crdt-gate.test.ts patterns)
// ---------------------------------------------------------------------------

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "Notes/Remote.md",
		title: "Remote",
		content: "remote body",
		folder: "Notes",
		tags: [],
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
	}),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue({
		path: "Assets/img.png",
		content_base64: "AQID",
		mime_type: "image/png",
		size_bytes: 3,
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: mock().mockResolvedValue({ id: "v1", name: "Test", slug: "test" }),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("local body"),
		cachedRead: mock().mockResolvedValue("local body"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
		process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
			Promise.resolve(fn("")),
		),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function resetMocks(): void {
	(mockApi.deleteNote as any).mockReset().mockResolvedValue({ deleted: true, path: "" });
	(mockApi.deleteAttachment as any).mockReset().mockResolvedValue({ deleted: true, path: "" });
	(mockApi.pushNote as any).mockReset().mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApp.vault.cachedRead as any).mockReset().mockResolvedValue("local body");
	(mockApp.vault.getFileByPath as any).mockReset().mockReturnValue(null);
	(mockApp.fileManager.trashFile as any).mockReset().mockResolvedValue(undefined);
}

/** Make a fake HTTP-error object with `.status` (mirrors how isHttpStatus checks it). */
function httpError(status: number): Error & { status: number } {
	const e = new Error(`HTTP ${status}`) as Error & { status: number };
	e.status = status;
	return e;
}

// Task 6 (note_id-keyed CRDT): removeDoc/reset are now called with the note's
// note_id, resolved via NoteIdMap — not the path. Defaults to an identity
// mapping (path -> path) so pre-existing assertions that check the exact
// teardown key stay meaningful without every test needing its own map.
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

/** Identity-mapped NoteIdMap: id === path, for tests that assert teardown was
 *  called with a specific known key without caring about id/path distinction. */
function identityNoteIdMap(...paths: string[]): NoteIdMap {
	const m = new NoteIdMap();
	for (const p of paths) m.set(p, p);
	return m;
}

/** Wire a fake CRDT manager that exposes removeDoc + applyLocalEdit spies. */
function fakeCrdt() {
	return {
		removeDoc: mock(async (_path: string) => {}),
		applyLocalEdit: mock(async (_id: string, c: string) => c),
	};
}

/** Wire a fake enrollment that exposes enroll + reset spies. */
function fakeEnrollment() {
	return {
		enroll: mock((_path: string) => {}),
		reset: mock((_path: string) => {}),
	};
}

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// handleDelete — md branch
// ---------------------------------------------------------------------------

describe("handleDelete — md branch calls removeDoc + enrollment.reset", () => {
	test("successful delete calls removeDoc and enrollment.reset for .md", async () => {
		const engine = createEngine(identityNoteIdMap("Notes/deleted.md"));
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Notes/deleted.md");
		await engine.handleDelete(file);

		expect(crdt.removeDoc).toHaveBeenCalledTimes(1);
		expect(crdt.removeDoc).toHaveBeenCalledWith("Notes/deleted.md");
		expect(enrollment.reset).toHaveBeenCalledTimes(1);
		expect(enrollment.reset).toHaveBeenCalledWith("Notes/deleted.md");
	});

	test("404 (already-deleted) delete also calls removeDoc and enrollment.reset for .md", async () => {
		const engine = createEngine(identityNoteIdMap("Notes/already-gone.md"));
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// Simulate 404 on deleteNote
		(mockApi.deleteNote as any).mockRejectedValueOnce(httpError(404));

		const file = new TFile("Notes/already-gone.md");
		await engine.handleDelete(file);

		expect(crdt.removeDoc).toHaveBeenCalledTimes(1);
		expect(crdt.removeDoc).toHaveBeenCalledWith("Notes/already-gone.md");
		expect(enrollment.reset).toHaveBeenCalledTimes(1);
		expect(enrollment.reset).toHaveBeenCalledWith("Notes/already-gone.md");
	});

	test("non-404 error does NOT call removeDoc (delete failed, ghost survives on purpose)", async () => {
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// Simulate a 500 server error
		(mockApi.deleteNote as any).mockRejectedValueOnce(httpError(500));

		const file = new TFile("Notes/err.md");
		await engine.handleDelete(file);

		// Delete failed — the note still exists on the server, so the ghost is
		// intentional (the doc is not gone yet).
		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("binary file delete does NOT call removeDoc", async () => {
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Assets/image.png");
		await engine.handleDelete(file);

		// Binary files are not CRDT-managed — no removeDoc
		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("canvas file delete does NOT call removeDoc (canvas is syncable text but not CRDT-managed)", async () => {
		// .canvas files pass through isBinary=false but are not CRDT-managed.
		// The teardown gate uses .endsWith(".md") so canvas deletes must not hit removeDoc.
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Notes/board.canvas");
		await engine.handleDelete(file);

		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("removeDoc not called when no CRDT manager is wired", async () => {
		const engine = createEngine();
		// No setCrdtManager — exercises the null-guard path
		const file = new TFile("Notes/no-crdt.md");
		await engine.handleDelete(file);
		// Just asserting it doesn't throw
	});
});

// ---------------------------------------------------------------------------
// handleRename — old-path md branch
// ---------------------------------------------------------------------------

describe("handleRename — old-path md branch does NOT tear down the CRDT doc (Task 6)", () => {
	// Pre-Task-6 behavior closed the old-path doc on every rename (removeDoc +
	// enrollment.reset), because the doc was keyed by path — a rename looked
	// exactly like a delete+create. Task 6 keys the doc by the note's stable
	// note_id instead (SyncEngine.handleRename moves that mapping via
	// noteIdMap.rename, tested in sync-note-id.test.ts), so the doc/IndexedDB
	// entry is untouched by a rename: same id, same entry, live history intact.
	// These tests now pin the opposite of what they used to assert.
	test("successful rename does NOT call removeDoc/enrollment.reset for .md", async () => {
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Notes/NewName.md");
		await engine.handleRename(file, "Notes/OldName.md");

		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("404 on old-path delete still does NOT call removeDoc/enrollment.reset", async () => {
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		(mockApi.deleteNote as any).mockRejectedValueOnce(httpError(404));
		// pushNote still succeeds for the new path
		(mockApi.pushNote as any).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const file = new TFile("Notes/NewName.md");
		await engine.handleRename(file, "Notes/OldName.md");

		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("binary rename does NOT call removeDoc for old path", async () => {
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Assets/new.png");
		await engine.handleRename(file, "Assets/old.png");

		// Binary files: no CRDT teardown for old path
		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("canvas rename does NOT call removeDoc for old path (canvas is not CRDT-managed)", async () => {
		// .canvas renames previously hit removeDoc via the !isBinary branch.
		// The gate now uses oldPath.endsWith(".md") so canvas is excluded.
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Notes/new-board.canvas");
		await engine.handleRename(file, "Notes/old-board.canvas");

		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// handleStreamEvent — remote-delete branch
// ---------------------------------------------------------------------------

describe("handleStreamEvent remote-delete — md branch calls removeDoc + enrollment.reset", () => {
	test("remote delete of a .md note calls removeDoc + enrollment.reset", async () => {
		const engine = createEngine(identityNoteIdMap("Notes/remote-del.md"));
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// Simulate the file existing locally (so trash fires)
		const existingFile = new TFile("Notes/remote-del.md");
		(mockApp.vault.getFileByPath as any).mockReturnValue(existingFile);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/remote-del.md",
			timestamp: Date.now(),
		});

		expect(crdt.removeDoc).toHaveBeenCalledTimes(1);
		expect(crdt.removeDoc).toHaveBeenCalledWith("Notes/remote-del.md");
		expect(enrollment.reset).toHaveBeenCalledTimes(1);
		expect(enrollment.reset).toHaveBeenCalledWith("Notes/remote-del.md");
	});

	test("remote delete of a non-md path does NOT call removeDoc", async () => {
		const engine = createEngine();
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const existingFile = new TFile("Assets/img.png");
		(mockApp.vault.getFileByPath as any).mockReturnValue(existingFile);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Assets/img.png",
			timestamp: Date.now(),
		});

		// Non-markdown: no CRDT teardown
		expect(crdt.removeDoc).not.toHaveBeenCalled();
		expect(enrollment.reset).not.toHaveBeenCalled();
	});

	test("remote delete of a .md note with no local file still calls removeDoc", async () => {
		// Even when the file isn't locally present, the IDB/memory ghost must be cleared.
		const engine = createEngine(identityNoteIdMap("Notes/ghost.md"));
		const crdt = fakeCrdt();
		const enrollment = fakeEnrollment();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// getFileByPath returns null — note not on disk
		(mockApp.vault.getFileByPath as any).mockReturnValue(null);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/ghost.md",
			timestamp: Date.now(),
		});

		expect(crdt.removeDoc).toHaveBeenCalledTimes(1);
		expect(crdt.removeDoc).toHaveBeenCalledWith("Notes/ghost.md");
		expect(enrollment.reset).toHaveBeenCalledTimes(1);
		expect(enrollment.reset).toHaveBeenCalledWith("Notes/ghost.md");
	});
});
