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

// File-export hint so the test runner sees this file. Tests also serve as
// documentation of the engine's folder contract.
test("module loaded", () => {
	expect(TFile).toBeDefined();
});
