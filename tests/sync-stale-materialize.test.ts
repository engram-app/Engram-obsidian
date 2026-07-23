/**
 * materializeRelocated must not resurrect a relocated/tombstoned path
 * (issue #210, e2e test_34).
 *
 * The write is unawaited and races the pull's id-keyed move: a stale
 * old-path upsert event captures (path=old, noteId) while the map still
 * says old is canonical; by the time the write runs, the pull has relocated
 * the id to the new path and cleaned the old file. Without an identity
 * re-check the write re-creates the old-path file, whose modify event then
 * re-pushes it under a FRESH mint — resurrecting the tombstoned path
 * server-side (CI runs 28926868261/28930769463).
 */
import { describe, expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
} as unknown as EngramApi;

function makeApp() {
	return {
		vault: {
			configDir: ".obsidian",
			read: mock().mockResolvedValue("body"),
			cachedRead: mock().mockResolvedValue("body"),
			getMarkdownFiles: mock().mockReturnValue([]),
			getFiles: mock().mockReturnValue([]),
			getAbstractFileByPath: mock().mockReturnValue(null),
			getFileByPath: mock().mockReturnValue(null),
			modify: mock().mockResolvedValue(undefined),
			process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
				Promise.resolve(fn("")),
			),
			create: mock().mockResolvedValue(undefined),
			createFolder: mock().mockResolvedValue(undefined),
			trash: mock().mockResolvedValue(undefined),
			rename: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
}

function createEngine(app: any): SyncEngine {
	const engine = new SyncEngine(
		app,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setCrdtManager({
		applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
		isSynced: mock().mockReturnValue(true),
		projectedText: mock().mockResolvedValue("projected body"),
	} as any);
	return engine;
}

describe("materializeRelocated identity re-check (issue #210)", () => {
	test("id relocated to a new path → stale old-path write is SKIPPED", async () => {
		const app = makeApp();
		const engine = createEngine(app);
		const map = new NoteIdMap();
		// The pull's id-keyed move already relocated the id: new path is canonical.
		map.set("E2E/RenamedCleanup34/Cleanup.md", "note-id-1");
		engine.setNoteIdMap(map);

		// The stale event captured the OLD path before the move.
		await (engine as any).materializeRelocated("E2E/RenameCleanup34/Cleanup.md", "note-id-1");

		expect(app.vault.create).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
	});

	test("id still canonical at the path → materializes as before", async () => {
		const app = makeApp();
		const engine = createEngine(app);
		const map = new NoteIdMap();
		map.set("E2E/RenamedCleanup34/Cleanup.md", "note-id-1");
		engine.setNoteIdMap(map);

		await (engine as any).materializeRelocated("E2E/RenamedCleanup34/Cleanup.md", "note-id-1");

		// flushFromCrdt writes via createFileWithFolders/modify — the body lands.
		const wrote =
			(app.vault.create as ReturnType<typeof mock>).mock.calls.length > 0 ||
			(app.vault.modify as ReturnType<typeof mock>).mock.calls.length > 0 ||
			(app.vault.process as ReturnType<typeof mock>).mock.calls.length > 0;
		expect(wrote).toBe(true);
	});
});
