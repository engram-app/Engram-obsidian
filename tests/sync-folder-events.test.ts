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
import { initRemoteLog, rlog } from "../src/remote-log";
import { SyncEngine } from "../src/sync";
import { joinReporter } from "../src/sync-diagnostics";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

// --- Minimal API mock (only folder methods are exercised) ---
const mockApi = {
	createFolder: mock().mockResolvedValue({ folder: { name: "", count: 0 } }),
	deleteFolder: mock().mockResolvedValue(undefined),
	listExplicitFolders: mock().mockResolvedValue([]),
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
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
	mockApp.vault.createFolder.mockReset().mockResolvedValue(undefined);
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

// ---------------------------------------------------------------------------
// Mobile incident 2026-11-16: 429 hammering + failed delete resurrecting
// ---------------------------------------------------------------------------

describe("seedEmptyFolders rate limiting", () => {
	const rateLimited = () =>
		Object.assign(new Error("Request failed, status 429"), {
			status: 429,
			headers: { "Retry-After": "30" },
		});

	test("a 429 stops the pass and the next pass waits out the cooldown", async () => {
		const { engine } = await createEngine();
		mockApp.vault.getAllLoadedFiles = mock().mockReturnValue([
			new TFolder("A", []),
			new TFolder("B", []),
			new TFolder("C", []),
		]);
		(mockApi.createFolder as jest.Mock).mockReset().mockRejectedValue(rateLimited());

		await engine.seedEmptyFolders();
		expect(mockApi.createFolder).toHaveBeenCalledTimes(1); // not 3
		await engine.seedEmptyFolders(); // next catch-up pass, immediately
		expect(mockApi.createFolder).toHaveBeenCalledTimes(1); // still cooling down
	});
});

describe("syncExplicitFolders vs a failed local folder delete", () => {
	test("does not recreate a folder whose server delete failed; retries the delete", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Gone");
		(mockApi.deleteFolder as jest.Mock)
			.mockReset()
			.mockRejectedValueOnce(new Error("Request timed out after 15000ms"))
			.mockResolvedValue(undefined);
		await engine.handleFolderDelete({ path: "Gone" });
		// server never processed the delete, so it still lists the marker
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValue(["Gone"]);
		mockApp.vault.createFolder.mockClear();

		await engine.resyncFolders();

		expect(mockApp.vault.createFolder).not.toHaveBeenCalledWith("Gone");
		expect(mockApi.deleteFolder).toHaveBeenCalledTimes(2);
	});

	test("a server-listed empty/slash-only name never creates a folder", async () => {
		const { engine } = await createEngine();
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValue(["", "/", "ok//sub"]);
		mockApp.vault.createFolder.mockClear();

		await engine.resyncFolders();

		expect(mockApp.vault.createFolder.mock.calls.map((c: any[]) => c[0])).toEqual([
			"ok",
			"ok/sub",
		]);
	});
});

describe("failed-delete and seed-cooldown memory lifecycle", () => {
	async function failDelete(engine: SyncEngine, explicit: ExplicitFolders) {
		await explicit.add("Gone");
		(mockApi.deleteFolder as jest.Mock)
			.mockReset()
			.mockRejectedValueOnce(new Error("Request timed out after 15000ms"))
			.mockResolvedValue(undefined);
		await engine.handleFolderDelete({ path: "Gone" });
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValue(["Gone"]);
	}

	test("recreating the folder locally clears the memory: its marker is not deleted", async () => {
		const { engine, explicit } = await createEngine();
		await failDelete(engine, explicit);
		await engine.handleFolderCreate({ path: "Gone" });
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "Gone" ? new TFolder("Gone", []) : null,
		);
		await engine.resyncFolders();
		expect(mockApi.deleteFolder).toHaveBeenCalledTimes(1); // only the failed one
	});

	test("renaming a folder onto the path clears the memory", async () => {
		const { engine, explicit } = await createEngine();
		await failDelete(engine, explicit);
		await engine.handleRename(new TFolder("Gone", []), "Old");
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "Gone" ? new TFolder("Gone", []) : null,
		);
		await engine.resyncFolders();
		expect(mockApi.deleteFolder).toHaveBeenCalledTimes(1);
	});

	test("never deletes the marker of a folder that exists on disk", async () => {
		const { engine, explicit } = await createEngine();
		await failDelete(engine, explicit);
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "Gone" ? new TFolder("Gone", []) : null,
		);
		await engine.resyncFolders();
		expect(mockApi.deleteFolder).toHaveBeenCalledTimes(1);
	});

	test("a vault switch forgets failed deletes", async () => {
		const { engine, explicit } = await createEngine();
		await failDelete(engine, explicit);
		await engine.resetForVaultChange();
		await engine.resyncFolders();
		expect(mockApi.deleteFolder).toHaveBeenCalledTimes(1);
	});

	test("a vault switch ends the seed cooldown", async () => {
		const { engine } = await createEngine();
		mockApp.vault.getAllLoadedFiles = mock().mockReturnValue([new TFolder("A", [])]);
		(mockApi.createFolder as jest.Mock)
			.mockReset()
			.mockRejectedValueOnce(Object.assign(new Error("429"), { status: 429 }))
			.mockResolvedValue({});
		await engine.seedEmptyFolders();
		await engine.resetForVaultChange();
		await engine.seedEmptyFolders();
		expect(mockApi.createFolder).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// Always-on outcome lines (Loki-diagnosable mobile reports)
// ---------------------------------------------------------------------------

describe("forced diagnostics from the engine", () => {
	let lines: string[] = [];
	beforeEach(() => {
		lines = [];
		initRemoteLog().configure(
			async (entries) => {
				lines.push(...entries.map((e) => e.message));
			},
			"1.0.0",
			"mobile",
		);
	});
	const shipped = async () => {
		await rlog().flush();
		return lines;
	};

	test("a folder rename is logged with counts, never the path", async () => {
		const { engine } = await createEngine();
		await engine.handleRename(
			new TFolder("Projects/New", [new TFile("Projects/New/a.md")]),
			"Projects/Old",
		);
		(engine as any).folderRenames.clear();
		expect(await shipped()).toContain(
			"folder_renamed children=1 descendants=0 same_parent=true depth_from=2 depth_to=2",
		);
	});

	test("a 429 on folder seeding logs the cooldown and what the server asked", async () => {
		const { engine } = await createEngine();
		mockApp.vault.getAllLoadedFiles = mock().mockReturnValue([new TFolder("A", [])]);
		(mockApi.createFolder as jest.Mock).mockReset().mockRejectedValue(
			Object.assign(new Error("Request failed, status 429"), {
				status: 429,
				headers: { "Retry-After": "30" },
			}),
		);
		await engine.seedEmptyFolders();
		expect(await shipped()).toContain(
			"rate_limited reason=folder_seed streak=1 wait_s=30 retry_after_s=30",
		);
	});

	test("a failed folder delete logs status and how many are pending", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Gone");
		(mockApi.deleteFolder as jest.Mock).mockReset().mockRejectedValue({ status: 504 });
		await engine.handleFolderDelete({ path: "Gone" });
		expect(await shipped()).toContain("folder_delete_failed pending=1 status=504");
	});

	test("gate transitions log once per change with their reason", async () => {
		const { engine } = await createEngine();
		engine.setSyncBlocked(true, "vault_switch");
		engine.setSyncBlocked(true, "vault_switch"); // no change, no line
		engine.setSyncBlocked(false, "user_accepted");
		const gate = (await shipped()).filter((l) => l.startsWith("sync_gate_"));
		expect(gate).toEqual([
			"sync_gate_closed reason=vault_switch",
			expect.stringMatching(/^sync_gate_open reason=user_accepted waited_s=\d+$/),
		] as string[]);
	});

	test("a folder delete that stays failed logs ONCE across N pull cycles, and once when it clears", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("Gone");
		(mockApi.deleteFolder as jest.Mock).mockReset().mockRejectedValue({ status: 504 });
		await engine.handleFolderDelete({ path: "Gone" });
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValue(["Gone"]);
		for (let i = 0; i < 5; i++) await engine.resyncFolders(); // retries keep failing
		let out = (await shipped()).filter((l) => l.startsWith("folder_delete_"));
		expect(out).toEqual(["folder_delete_failed pending=1 status=504"]);
		(mockApi.deleteFolder as jest.Mock).mockReset().mockResolvedValue(undefined);
		await engine.resyncFolders();
		await engine.resyncFolders();
		out = (await shipped()).filter((l) => l.startsWith("folder_delete_"));
		expect(out).toEqual([
			"folder_delete_failed pending=1 status=504",
			"folder_delete_cleared pending=0",
		]);
	});

	test("folder seeding logs the 429 once per streak, not once per 429", async () => {
		const { engine } = await createEngine();
		mockApp.vault.getAllLoadedFiles = mock().mockReturnValue([new TFolder("A", [])]);
		(mockApi.createFolder as jest.Mock)
			.mockReset()
			.mockRejectedValue(
				Object.assign(new Error("429"), { status: 429, headers: { "Retry-After": "1" } }),
			);
		const clock = { now: 1_000_000 };
		(engine as any).time = { ...(engine as any).time, now: () => clock.now };
		for (let i = 0; i < 6; i++) {
			await engine.seedEmptyFolders();
			clock.now += 60_000; // cooldown elapsed, 429 again
		}
		expect((await shipped()).filter((l) => l.startsWith("rate_limited"))).toHaveLength(1);
		(mockApi.createFolder as jest.Mock).mockReset().mockResolvedValue({});
		await engine.seedEmptyFolders();
		expect((await shipped()).filter((l) => l.startsWith("rate_limit_cleared"))).toHaveLength(1);
	});

	test("destroy flushes a pending rename line and leaves no live timer", async () => {
		const clock = new ManualTimeProvider();
		const engine = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			mockSaveData,
			clock,
		);
		engine.setReady();
		await engine.handleRename(new TFolder("B", []), "A");
		expect(await shipped()).toHaveLength(0); // still inside the burst window
		engine.destroy();
		expect((await shipped()).filter((l) => l.startsWith("folder_renamed"))).toHaveLength(1);
		expect((clock as any).pending.size).toBe(0);
	});

	test("a vault switch flushes a pending rename line", async () => {
		const clock = new ManualTimeProvider();
		const engine = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			mockSaveData,
			clock,
		);
		engine.setReady();
		activeEngines.push(engine);
		await engine.handleRename(new TFolder("B", []), "A");
		await engine.resetForVaultChange();
		expect((await shipped()).filter((l) => l.startsWith("folder_renamed"))).toHaveLength(1);
	});

	test("a trailing-slash delete and a clean-path re-create address the SAME failed-delete entry", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("A/b/");
		(mockApi.deleteFolder as jest.Mock).mockReset().mockRejectedValue({ status: 504 });
		await engine.handleFolderDelete({ path: "A/b/" });
		expect((engine as any).failedFolderDeletes.has("A/b")).toBe(true);
		await engine.handleFolderCreate({ path: "A/b" }); // user re-makes it
		expect((engine as any).failedFolderDeletes.size).toBe(0);
	});

	test("a vault switch and destroy reset the join reporter", async () => {
		const { engine } = await createEngine();
		// min differs only so the logger's identical-line collapse does not hide a re-log.
		joinReporter.rejected("plan_limit", 1);
		await engine.resetForVaultChange();
		joinReporter.rejected("plan_limit", 2); // logs again only if the session was reset
		engine.destroy();
		joinReporter.rejected("plan_limit", 3);
		const rejected = (await shipped()).filter((l) => l.startsWith("crdt_join_rejected"));
		expect(rejected).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// folders.batch rename (folder_ops off: a web or MCP folder rename). The old
// folder's only content is an explicit empty subfolder; the batch must leave
// no empty old folder behind (same mechanism as folder_changed,
// docs/context/folder-move-follow-race-empty-old-folder.md).
// ---------------------------------------------------------------------------

/** A stateful disk: createFolder adds, trashFile removes from the parent. */
function statefulDisk(paths: string[]): Map<string, TFolder> {
	const disk = new Map<string, TFolder>();
	const mk = (path: string) => {
		const f = new TFolder(path, []);
		disk.set(path, f);
		const i = path.lastIndexOf("/");
		if (i > 0) disk.get(path.slice(0, i))?.children.push(f);
		return f;
	};
	for (const p of paths) mk(p);
	mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) => disk.get(p) ?? null);
	mockApp.vault.createFolder.mockImplementation(async (p: string) => {
		mk(p);
	});
	(mockApp.fileManager.trashFile as jest.Mock).mockImplementation(async (f: TFolder) => {
		disk.delete(f.path);
		const parent = disk.get(f.path.slice(0, f.path.lastIndexOf("/")));
		if (parent) parent.children = parent.children.filter((c) => c !== f);
	});
	return disk;
}

describe("SyncEngine.resyncFolders folders.batch rename", () => {
	test.each([
		["implicit", false],
		["explicit", true],
	])("removes the emptied old folder (%s parent)", async (_label, parentExplicit) => {
		const { engine, explicit } = await createEngine();
		if (parentExplicit) await explicit.add("AR6");
		await explicit.add("AR6/sub");
		const disk = statefulDisk(["AR6", "AR6/sub"]);

		const listed = parentExplicit ? ["A2R6", "A2R6/sub"] : ["A2R6/sub"];
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValueOnce(listed);

		await engine.resyncFolders({ op: "rename", from: "AR6", folder: "A2R6" });

		expect(disk.has("A2R6/sub")).toBe(true);
		expect(disk.has("AR6/sub")).toBe(false);
		expect(disk.has("AR6")).toBe(false);
		expect(mockApi.deleteFolder).not.toHaveBeenCalled();
	});

	// A late or out-of-order batch (AR6 renamed to A2R6 and back): the fresh
	// server list still names AR6/sub, so it is the authority and nothing
	// under AR6 is left.
	test("keeps an old folder the fresh server list still names", async () => {
		const { engine, explicit } = await createEngine();
		await explicit.add("AR6/sub");
		const disk = statefulDisk(["AR6", "AR6/sub"]);
		(mockApi.listExplicitFolders as jest.Mock).mockResolvedValueOnce(["AR6/sub"]);

		await engine.resyncFolders({ op: "rename", from: "AR6", folder: "A2R6" });

		expect(disk.has("AR6/sub")).toBe(true);
		expect(explicit.has("AR6/sub")).toBe(true);
	});
});
