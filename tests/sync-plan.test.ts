import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";
import type { SyncProgress } from "../src/types";

// Mock the API — mirrors the pattern from sync.test.ts
const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	// Legacy-backend shape: no batch endpoint — pushAll falls back to the
	// per-note path these tests assert.
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue(null),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue(null),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: jest
		.fn()
		.mockResolvedValue({ id: "vault-1", name: "Test", slug: "test", is_default: true }),
} as unknown as EngramApi;

// Mock the Obsidian App
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
			fn("");
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

function makeTFile(path: string): TFile {
	return new TFile(path) as unknown as TFile;
}

function createEngine(overrides = {}): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 10, ...overrides },
		mockSaveData,
	);
	engine.setReady();
	return engine;
}

beforeEach(() => {
	jest.clearAllMocks();
	(mockApi.getChanges as jest.Mock)
		.mockReset()
		.mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" });
	(mockApi.getAttachmentChanges as jest.Mock)
		.mockReset()
		.mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" });
	(mockApi.getManifest as jest.Mock).mockReset().mockResolvedValue(null);
	mockApp.vault.getFiles.mockReset().mockReturnValue([]);
});

describe("SyncEngine.computeSyncPlan", () => {
	test("empty vault and empty server returns zeroed plan", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.vaultName).toBe("Test Vault");
		expect(plan.serverNoteCount).toBe(0);
		expect(plan.localNoteCount).toBe(0);
		expect(plan.localAttachmentCount).toBe(0);
		expect(plan.toPush.notes).toEqual([]);
		expect(plan.toPush.attachments).toEqual([]);
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.toPull.attachments).toEqual([]);
		expect(plan.conflicts).toEqual([]);
		expect(plan.toDeleteLocal).toEqual([]);
		expect(plan.toDeleteRemote).toEqual([]);
	});

	test("local files not on server are counted as toPush", async () => {
		const engine = createEngine();
		const files = [makeTFile("Notes/local-only.md"), makeTFile("Notes/another.md")];
		mockApp.vault.getFiles.mockReturnValue(files);
		// Server has no changes — files don't exist on server
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [],
			server_time: "2026-01-01T00:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toContain("Notes/local-only.md");
		expect(plan.toPush.notes).toContain("Notes/another.md");
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.localNoteCount).toBe(2);
	});

	test("server changes not present locally are counted as toPull", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/remote-only.md",
					title: "Remote",
					content: "# Remote",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-01-01T00:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toContain("Notes/remote-only.md");
		expect(plan.toPush.notes).toEqual([]);
		expect(plan.serverNoteCount).toBe(1);
	});

	test("server deletions are counted in toDeleteLocal", async () => {
		const engine = createEngine();
		// Local file exists
		const localFile = makeTFile("Notes/to-delete.md");
		mockApp.vault.getFiles.mockReturnValue([localFile]);
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		// Server signals deletion
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/to-delete.md",
					title: "Gone",
					content: "",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: true,
				},
			],
			server_time: "2026-01-01T00:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toDeleteLocal).toContain("Notes/to-delete.md");
		expect(plan.toPull.notes).not.toContain("Notes/to-delete.md");
	});

	test("push-all mode does not include toPull entries", async () => {
		const engine = createEngine();
		// Local has one file, server has a different file not locally present
		mockApp.vault.getFiles.mockReturnValue([makeTFile("Notes/local.md")]);
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/remote-only.md",
					title: "Remote",
					content: "# Remote",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-01-01T00:00:00Z",
		});

		const plan = await engine.computeSyncPlan("push-all");

		expect(plan.toPull.notes).toEqual([]);
		expect(plan.toPull.attachments).toEqual([]);
		expect(plan.toPush.notes).toContain("Notes/local.md");
	});

	test("file changed both locally and on server is a conflict", async () => {
		const engine = createEngine();
		const originalContent = "# Original";
		const localContent = "# Modified locally";
		const file = makeTFile("Notes/both-changed.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue(localContent);

		// Simulate prior sync with original content hash
		engine.importHashes({ "Notes/both-changed.md": fnv1a(originalContent) });

		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/both-changed.md",
					title: "Both",
					content: "# Modified on server",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-01-01T00:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.conflicts).toContain("Notes/both-changed.md");
		expect(plan.toPull.notes).not.toContain("Notes/both-changed.md");
	});

	test("file changed only on server (local unchanged) is a pull, not conflict", async () => {
		const engine = createEngine();
		const content = "# Original";
		const file = makeTFile("Notes/server-updated.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue(content);

		// Simulate prior sync with same content hash
		engine.importHashes({ "Notes/server-updated.md": fnv1a(content) });

		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/server-updated.md",
					title: "Updated",
					content: "# New server content",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-01-01T00:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toContain("Notes/server-updated.md");
		expect(plan.conflicts).not.toContain("Notes/server-updated.md");
	});

	test("incremental full mode: long-synced local files are NOT flagged toPush when manifest confirms server has them", async () => {
		// Reproduces the bug from closed PR #31 where PreSyncModal showed e.g.
		// "server: 0 / local: 299 toPush" on a fully-synced vault. computeSyncPlan
		// was using getChanges(since=lastSync) as server inventory — long-synced
		// files don't appear in delta, so they got falsely flagged for push.
		const engine = createEngine();
		const file = makeTFile("Notes/already-synced.md");
		mockApp.vault.getFiles.mockReturnValue([file]);

		// Last sync was recent — getChanges(since=lastSync) returns no delta
		engine.setLastSync("2026-05-16T07:00:00Z");
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [],
			server_time: "2026-05-16T08:00:00Z",
		});
		// Manifest is authoritative: server has this note
		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "Notes/already-synced.md", content_hash: "abc123" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual([]);
		expect(plan.serverNoteCount).toBe(1);
		expect(plan.localNoteCount).toBe(1);
	});

	test("incremental full mode: file in manifest but missing locally is still toPull when delta carries content", async () => {
		// Server has a file the user hasn't pulled yet (e.g., another device pushed it).
		// Manifest lists the path; delta carries the content for pull.
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);
		engine.setLastSync("2026-05-16T07:00:00Z");
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/from-other-device.md",
					title: "Other",
					content: "# Other device",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-05-16T08:00:00Z",
		});
		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "Notes/from-other-device.md", content_hash: "xyz" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toContain("Notes/from-other-device.md");
		expect(plan.toPush.notes).toEqual([]);
		expect(plan.serverNoteCount).toBe(1);
	});

	test("incremental full mode: manifest-unavailable falls back to delta-since-epoch (full inventory query)", async () => {
		// Older self-hosted backends without /sync/manifest still need to work.
		// Fallback: widen the delta query to since=epoch so it doubles as inventory.
		// Slower per-call (one-shot full fetch) but correct.
		const engine = createEngine();
		const file = makeTFile("Notes/local.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		engine.setLastSync("2026-05-16T07:00:00Z");
		(mockApi.getManifest as jest.Mock).mockResolvedValue(null);

		// Stateful mock: server returns the file ONLY when queried since epoch
		// (i.e., full-inventory mode). A since=lastSync query gets empty.
		(mockApi.getChanges as jest.Mock).mockImplementation((since: string) =>
			Promise.resolve({
				changes:
					since === "1970-01-01T00:00:00Z"
						? [
								{
									path: "Notes/local.md",
									title: "Local",
									content: "# Local",
									folder: "Notes",
									tags: [],
									mtime: Date.now() / 1000,
									updated_at: new Date().toISOString(),
									deleted: false,
								},
							]
						: [],
				server_time: "2026-05-16T08:00:00Z",
			}),
		);

		const plan = await engine.computeSyncPlan("full");

		// Fix widened the since param to epoch so the delta returns the full server set
		expect(mockApi.getChanges).toHaveBeenCalledWith("1970-01-01T00:00:00Z", expect.anything());
		expect(plan.toPush.notes).toEqual([]);
	});

	test("locally-modified note (manifest has it, delta empty, hash diverges) is flagged toPush", async () => {
		// The PreSyncModal previously had no way to surface "you edited a note
		// since last sync." The delta only carries server-side changes; the
		// modal silently missed local edits and lied about the work to do.
		const engine = createEngine();
		const file = makeTFile("Notes/edited.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Edited locally");

		engine.setLastSync("2026-05-16T07:00:00Z");
		// syncState was recorded at the LAST sync with a different (earlier) content
		engine.importHashes({ "Notes/edited.md": fnv1a("# Original") });

		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "Notes/edited.md", content_hash: "server-hash" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [],
			server_time: "2026-05-16T08:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toContain("Notes/edited.md");
		expect(plan.conflicts).not.toContain("Notes/edited.md");
	});

	test("locally-modified note NOT double-counted when delta also reports a server change (pull/conflict branch handles it)", async () => {
		// If a path is in the delta (server changed it), the existing pull/conflict
		// branches already decide what to do. Adding the same path to toPush via
		// the locally-modified detector would double-count and confuse the UI.
		const engine = createEngine();
		const file = makeTFile("Notes/both.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Modified locally");

		engine.setLastSync("2026-05-16T07:00:00Z");
		engine.importHashes({ "Notes/both.md": fnv1a("# Original") });

		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "Notes/both.md", content_hash: "server-hash" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "Notes/both.md",
					title: "Both",
					content: "# Modified on server",
					folder: "Notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-05-16T08:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		// Path appears once at most across pull/conflict/push. The pull/conflict
		// branches above own this path; toPush must not duplicate it.
		expect(plan.toPush.notes).not.toContain("Notes/both.md");
	});

	test("file in manifest with NO syncState entry is treated as clean (no spurious push storm on fresh install)", async () => {
		// A fresh plugin install will have an empty syncState but a vault full
		// of files the server already holds. Without this guard we'd push every
		// file unnecessarily. A real content cross-check needs a plugin-side
		// computable server hash (Tier 3 backend work) — not in scope.
		const engine = createEngine();
		const file = makeTFile("Notes/fresh-install.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");

		engine.setLastSync("2026-05-16T07:00:00Z");
		// No importHashes call — syncState is empty

		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "Notes/fresh-install.md", content_hash: "server-hash" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [],
			server_time: "2026-05-16T08:00:00Z",
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual([]);
	});

	test("file in manifest with matching syncState hash is clean (no toPush)", async () => {
		const engine = createEngine();
		const file = makeTFile("Notes/clean.md");
		const content = "# Clean";
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue(content);

		engine.setLastSync("2026-05-16T07:00:00Z");
		engine.importHashes({ "Notes/clean.md": fnv1a(content) });

		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [{ path: "Notes/clean.md", content_hash: "server-hash" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual([]);
	});

	test("ignored files (.obsidian/) are excluded from plan", async () => {
		const engine = createEngine();
		const files = [
			makeTFile(".obsidian/config.json"),
			makeTFile(".obsidian/plugins/some-plugin/main.js"),
			makeTFile("Notes/legit.md"),
		];
		mockApp.vault.getFiles.mockReturnValue(files);

		const plan = await engine.computeSyncPlan("full");

		const allPaths = [
			...plan.toPush.notes,
			...plan.toPush.attachments,
			...plan.toPull.notes,
			...plan.toPull.attachments,
		];
		expect(allPaths).not.toContain(".obsidian/config.json");
		expect(allPaths).not.toContain(".obsidian/plugins/some-plugin/main.js");
		expect(plan.toPush.notes).toContain("Notes/legit.md");
	});
});

describe("SyncEngine.pushAll with progress", () => {
	test("emits progress events during pushAll", async () => {
		// Set up mock files
		const file1 = makeTFile("notes/a.md");
		const file2 = makeTFile("notes/b.md");
		mockApp.vault.getFiles.mockReturnValue([file1, file2]);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const engine = createEngine();
		const progressEvents: SyncProgress[] = [];
		engine.onSyncProgress = (p) => progressEvents.push({ ...p });

		const { SyncLog } = await import("../src/sync-log");
		engine.syncLog = new SyncLog();

		await engine.pushAll();

		// Should have at least a start and complete event
		expect(progressEvents.length).toBeGreaterThanOrEqual(2);
		expect(progressEvents[0].phase).toBe("pushing");
		expect(progressEvents[0].current).toBe(0);
		expect(progressEvents[progressEvents.length - 1].phase).toBe("complete");

		// SyncLog should have entries
		expect(engine.syncLog.entries().length).toBeGreaterThan(0);
	});

	test("pullAll({ deleteLocalExtras: true }) deletes local files and resets sync state before pulling", async () => {
		const file1 = makeTFile("notes/a.md");
		const file2 = makeTFile("notes/b.md");
		mockApp.vault.getFiles.mockReturnValue([file1, file2]);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");

		// Server has one note to pull after wipe
		(mockApi.getChanges as jest.Mock).mockResolvedValue({
			changes: [
				{
					path: "notes/server.md",
					title: "Server",
					content: "# From Server",
					folder: "notes",
					tags: [],
					mtime: Date.now() / 1000,
					updated_at: new Date().toISOString(),
					deleted: false,
				},
			],
			server_time: "2026-01-01T00:00:00Z",
		});
		(mockApi.getAttachmentChanges as jest.Mock).mockResolvedValue({
			changes: [],
			server_time: "2026-01-01T00:00:00Z",
		});
		// After wipe, getFileByPath returns null (files deleted)
		mockApp.vault.getFileByPath.mockReturnValue(null);

		const engine = createEngine();
		const { SyncLog } = await import("../src/sync-log");
		engine.syncLog = new SyncLog();

		// Seed some sync state that should be cleared
		engine.importHashes({ "notes/a.md": 12345 });

		await engine.pullAll({ deleteLocalExtras: true });

		// Both local files should have been trashed
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledTimes(2);

		// Sync log should have delete entries for the wipe
		const deleteEntries = engine.syncLog.entries().filter((e) => e.action === "delete");
		expect(deleteEntries).toHaveLength(2);

		// Server note should have been created (pulled)
		expect(mockApp.vault.create).toHaveBeenCalled();
	});

	test("logs errors to syncLog when push fails", async () => {
		const file = makeTFile("notes/fail.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");
		(mockApi.pushNote as jest.Mock).mockRejectedValue(new Error("500 Internal Server Error"));

		const engine = createEngine();
		const { SyncLog } = await import("../src/sync-log");
		engine.syncLog = new SyncLog();

		await engine.pushAll();

		const errors = engine.syncLog.entries().filter((e) => e.result === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe("notes/fail.md");
		expect(errors[0].error).toContain("500");
	});
});
