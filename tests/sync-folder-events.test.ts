/**
 * Tests for SyncEngine's folder-aware behavior:
 *  - removeEmptyFolders exempts paths in the ExplicitFolders set.
 *  - handleFolderCreate pushes POST /folders + records in the set.
 *  - handleFolderDelete pushes DELETE only for known folders.
 *
 * The engine's folder methods are reached via `as unknown as` for the
 * private removeEmptyFolders (the simplest way to assert on its
 * walk-up loop) and directly for the public handleFolderCreate /
 * handleFolderDelete.
 */
import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { ExplicitFolders } from "../src/explicit-folders";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// --- Minimal API mock (only folder methods are exercised) ---
const mockApi = {
	createFolder: mock().mockResolvedValue({ folder: { name: "", count: 0 } }),
	deleteFolder: mock().mockResolvedValue(undefined),
	listExplicitFolders: mock().mockResolvedValue([]),
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	ping: mock().mockResolvedValue({ ok: true }),
} as unknown as EngramApi;

class MemoryAdapter {
	files = new Map<string, string>();
	read(path: string): Promise<string> {
		if (!this.files.has(path)) return Promise.reject(new Error("ENOENT"));
		return Promise.resolve(this.files.get(path) as string);
	}
	write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}
}

const mockApp = {
	vault: {
		configDir: ".obsidian",
		getAbstractFileByPath: mock().mockReturnValue(null),
		createFolder: mock().mockResolvedValue(undefined),
	},
	fileManager: {
		trashFile: mock().mockResolvedValue(undefined),
	},
} as any;

const mockSaveData = mock().mockResolvedValue(undefined);

const activeEngines: SyncEngine[] = [];

async function createEngine(): Promise<{ engine: SyncEngine; explicit: ExplicitFolders }> {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 10 },
		mockSaveData,
	);
	engine.setReady();
	const explicit = new ExplicitFolders(new MemoryAdapter(), "f.json");
	await explicit.load();
	engine.explicitFolders = explicit;
	activeEngines.push(engine);
	return { engine, explicit };
}

beforeEach(() => {
	jest.clearAllMocks();
	mockApp.vault.getAbstractFileByPath.mockReset().mockReturnValue(null);
	mockApp.fileManager.trashFile.mockReset().mockResolvedValue(undefined);
	(mockApi.createFolder as jest.Mock)
		.mockReset()
		.mockResolvedValue({ folder: { name: "", count: 0 } });
	(mockApi.deleteFolder as jest.Mock).mockReset().mockResolvedValue(undefined);
	(mockApi.listExplicitFolders as jest.Mock).mockReset().mockResolvedValue([]);
});

afterEach(() => {
	for (const engine of activeEngines) {
		engine.destroy();
	}
	activeEngines.length = 0;
});

// ---------------------------------------------------------------------------
// removeEmptyFolders exemption
// ---------------------------------------------------------------------------

describe("SyncEngine.removeEmptyFolders explicit-folder exemption", () => {
	test("stops walking up at an explicit folder", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Keeper");

		const keeper = new TFolder("Keeper", []);
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
			path === "Keeper" ? keeper : null,
		);

		const removeEmptyFolders = (
			engine as unknown as { removeEmptyFolders(p: string): Promise<void> }
		).removeEmptyFolders.bind(engine);

		await removeEmptyFolders("Keeper/a.md");

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("removes a non-explicit empty folder", async () => {
		const { engine } = await createEngine();

		const empty = new TFolder("Doomed", []);
		mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) =>
			path === "Doomed" ? empty : null,
		);

		const removeEmptyFolders = (
			engine as unknown as { removeEmptyFolders(p: string): Promise<void> }
		).removeEmptyFolders.bind(engine);

		await removeEmptyFolders("Doomed/a.md");

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(empty);
	});
});

// ---------------------------------------------------------------------------
// handleFolderCreate
// ---------------------------------------------------------------------------

describe("SyncEngine.handleFolderCreate", () => {
	test("POSTs /folders and records in the explicit set", async () => {
		const { engine, explicit } = await createEngine();
		const folder = new TFolder("Projects/New", []);

		await engine.handleFolderCreate(folder);

		expect(mockApi.createFolder).toHaveBeenCalledWith("Projects/New");
		expect(explicit.has("Projects/New")).toBe(true);
	});

	test("is idempotent client-side — skips folders already in the set", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Known");

		await engine.handleFolderCreate(new TFolder("Known", []));

		expect(mockApi.createFolder).not.toHaveBeenCalled();
	});

	test("skips always-ignored paths (.obsidian, .trash)", async () => {
		const { engine, explicit } = await createEngine();

		await engine.handleFolderCreate(new TFolder(".obsidian/plugins/foo", []));
		await engine.handleFolderCreate(new TFolder(".trash/old", []));

		expect(mockApi.createFolder).not.toHaveBeenCalled();
		expect(explicit.has(".obsidian/plugins/foo")).toBe(false);
	});

	test("non-fatal on server error — folder stays on disk, not recorded", async () => {
		const { engine, explicit } = await createEngine();
		(mockApi.createFolder as jest.Mock).mockRejectedValueOnce({ status: 500 });

		await expect(
			engine.handleFolderCreate(new TFolder("Brittle", [])),
		).resolves.toBeUndefined();
		expect(explicit.has("Brittle")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// handleFolderDelete
// ---------------------------------------------------------------------------

describe("SyncEngine.handleFolderDelete", () => {
	test("DELETEs and drops from the set for known folders", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Known");

		await engine.handleFolderDelete(new TFolder("Known", []));

		expect(mockApi.deleteFolder).toHaveBeenCalledWith("Known");
		expect(explicit.has("Known")).toBe(false);
	});

	test("is a no-op for folders the server never knew about", async () => {
		const { engine } = await createEngine();

		await engine.handleFolderDelete(new TFolder("Unknown", []));

		expect(mockApi.deleteFolder).not.toHaveBeenCalled();
	});

	test("still drops from the set when the server call fails", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Brittle");
		(mockApi.deleteFolder as jest.Mock).mockRejectedValueOnce({ status: 500 });

		await engine.handleFolderDelete(new TFolder("Brittle", []));

		// Local set is the source of truth post-delete — the server marker
		// either succeeded or will be cleaned up on the next pull.
		expect(explicit.has("Brittle")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resyncFolders removal reconcile — a folder deleted on another device (web)
// must be trashed locally, not just dropped from the tracked set.
// ---------------------------------------------------------------------------

describe("SyncEngine.resyncFolders removal reconcile", () => {
	test("trashes an explicit folder the server no longer lists", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Keep");
		await explicit.add("Gone");

		// Server now lists only Keep — Gone was deleted on another device.
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValueOnce(["Keep"]);

		const gone = new TFolder("Gone", []);
		const keep = new TFolder("Keep", []);
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "Gone" ? gone : p === "Keep" ? keep : null,
		);

		await engine.resyncFolders();

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(gone);
		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalledWith(keep);
		expect(explicit.has("Gone")).toBe(false);
	});

	test("does NOT echo a DELETE /folders when the trash fires the vault delete event mid-reconcile", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Gone");

		// Server dropped Gone; it exists on disk as an empty folder.
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValueOnce([]);
		const gone = new TFolder("Gone", []);
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "Gone" ? gone : null,
		);

		// Obsidian dispatches vault.on("delete") while trashFile runs; that routes
		// to handleFolderDelete. If Gone is still in the explicit set at that
		// moment it echoes a real DELETE /folders to the server (the folder-level
		// twin of the test_86 wipe echo). The reconcile must drop Gone from the
		// set BEFORE trashing so the echo is suppressed.
		(mockApp.fileManager.trashFile as jest.Mock).mockImplementationOnce(async () => {
			await engine.handleFolderDelete(gone);
		});

		await engine.resyncFolders();

		expect(mockApi.deleteFolder).not.toHaveBeenCalled();
	});

	test("does NOT trash a server-removed folder that still holds children", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Busy");
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValueOnce([]);

		const busy = new TFolder("Busy", [new TFile("Busy/note.md")]);
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "Busy" ? busy : null,
		);

		await engine.resyncFolders();

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("never trashes an ignored folder even if it drops off the list", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add(".obsidian/snippets");
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValueOnce([]);

		const ignored = new TFolder(".obsidian/snippets", []);
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === ".obsidian/snippets" ? ignored : null,
		);

		await engine.resyncFolders();

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// seedEmptyFolders — first-sync seeding of folders the server can't derive
// ---------------------------------------------------------------------------
//
// The server only learns a folder exists when a note is pushed into it (or an
// explicit marker is POSTed). A folder whose entire subtree holds NO syncable
// file — truly empty, or containing only non-syncable types (.txt, .excalidraw)
// — would therefore never appear in the web UI after a first sync. seedEmptyFolders
// walks the local vault and POSTs a marker for exactly those folders.

describe("SyncEngine.seedEmptyFolders", () => {
	/** Point the engine's folder enumeration at a fixed tree. */
	function setVaultFolders(folders: TFolder[]) {
		mockApp.vault.getAllLoadedFiles = mock().mockReturnValue(folders);
	}

	test("seeds a truly-empty folder", async () => {
		const { engine, explicit } = await createEngine();
		setVaultFolders([new TFolder("EmptyDir", [])]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).toHaveBeenCalledWith("EmptyDir");
		expect(explicit.has("EmptyDir")).toBe(true);
	});

	test("seeds a folder containing only non-syncable files (.txt)", async () => {
		const { engine } = await createEngine();
		const onlyTxt = new TFolder("OnlyTxt", [new TFile("OnlyTxt/a.txt")]);
		setVaultFolders([onlyTxt]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).toHaveBeenCalledWith("OnlyTxt");
	});

	test("does NOT seed a folder containing a syncable note", async () => {
		const { engine } = await createEngine();
		const withNote = new TFolder("WithNote", [new TFile("WithNote/n.md")]);
		setVaultFolders([withNote]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).not.toHaveBeenCalledWith("WithNote");
	});

	test("does NOT seed an ancestor whose syncable file is nested deeper", async () => {
		const { engine } = await createEngine();
		// Parent -> Child -> n.md. The note creates folder Parent/Child server-side;
		// Parent appears via the SPA's ancestor synthesis. No marker needed for either.
		const child = new TFolder("Parent/Child", [new TFile("Parent/Child/n.md")]);
		const parent = new TFolder("Parent", [child]);
		setVaultFolders([parent, child]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).not.toHaveBeenCalled();
	});

	test("skips ignored folders and the vault root", async () => {
		const { engine } = await createEngine();
		setVaultFolders([
			new TFolder("/", []),
			new TFolder("", []),
			new TFolder(".obsidian/plugins/foo", []),
			new TFolder(".trash/old", []),
		]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).not.toHaveBeenCalled();
	});

	test("skips folders already in the explicit set (idempotent)", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Known");
		setVaultFolders([new TFolder("Known", [])]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).not.toHaveBeenCalled();
	});

	test("non-fatal on server error — keeps going, not recorded", async () => {
		const { engine, explicit } = await createEngine();
		(mockApi.createFolder as jest.Mock).mockRejectedValueOnce({ status: 500 });
		setVaultFolders([new TFolder("Brittle", []), new TFolder("Fine", [])]);

		await expect(engine.seedEmptyFolders()).resolves.toBeUndefined();
		expect(explicit.has("Brittle")).toBe(false);
		// The error on "Brittle" must not abort seeding of "Fine".
		expect(mockApi.createFolder).toHaveBeenCalledWith("Fine");
		expect(explicit.has("Fine")).toBe(true);
	});

	test("seeds a folder whose only note is ignored", async () => {
		const { engine } = await createEngine();
		// A per-file ignore makes the .md inside it non-syncable → folder is empty
		// from the server's view → must be seeded.
		(engine as unknown as { ignoredFiles: Set<string> }).ignoredFiles.add("Foo/skip.md");
		setVaultFolders([new TFolder("Foo", [new TFile("Foo/skip.md")])]);

		await engine.seedEmptyFolders();

		expect(mockApi.createFolder).toHaveBeenCalledWith("Foo");
	});
});

// File-export hint so the test runner sees this file. Tests also serve as
// documentation of the engine's folder contract.
test("module loaded", () => {
	expect(TFile).toBeDefined();
});
