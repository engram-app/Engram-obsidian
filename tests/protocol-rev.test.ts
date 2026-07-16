import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// Protocol rev: bulk push via POST /notes/batch, paginated /notes/changes
// with fields=meta, hash-compare live sync, serverHash-based reconcile.

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockResolvedValue({ results: [] }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "Notes/Remote.md",
		title: "Remote Note",
		content: "# Remote",
		content_hash: "srvhash-remote",
		folder: "Notes",
		tags: [],
		mtime: 1709345678,
		created_at: "2026-03-01T12:00:00Z",
		updated_at: "2026-03-01T12:00:00Z",
		version: 1,
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
	getAttachmentChanges: jest
		.fn()
		.mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: jest
		.fn()
		.mockResolvedValue({ id: "vault-1", name: "Test", slug: "test", is_default: true }),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("# Test"),
		cachedRead: mock().mockResolvedValue("# Test"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null) as jest.Mock,
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_file: unknown, fn: (data: string) => string) => {
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

const activeEngines: SyncEngine[] = [];

function createEngine(overrides = {}): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 10, ...overrides },
		mockSaveData,
	);
	engine.setReady();
	activeEngines.push(engine);
	return engine;
}

function metaChange(path: string, hash: string, version: number, extra = {}) {
	return {
		path,
		title: path,
		folder: "",
		tags: [],
		mtime: 100,
		updated_at: "2026-06-12T00:00:00Z",
		deleted: false,
		version,
		content_hash: hash,
		...extra,
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	mockApp.vault.getFileByPath.mockReset().mockReturnValue(null);
	mockApp.vault.getFiles.mockReset().mockReturnValue([]);
	mockApp.vault.cachedRead.mockReset().mockResolvedValue("# Test");
	(mockApi.pushNote as jest.Mock).mockReset().mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApi.pushNotesBatch as jest.Mock).mockReset().mockResolvedValue({ results: [] });
	(mockApi.getChanges as jest.Mock)
		.mockReset()
		.mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" });
	(mockApi.getNote as jest.Mock).mockReset().mockResolvedValue({
		path: "Notes/Remote.md",
		title: "Remote Note",
		content: "# Remote",
		content_hash: "srvhash-remote",
		folder: "Notes",
		tags: [],
		mtime: 1709345678,
		created_at: "2026-03-01T12:00:00Z",
		updated_at: "2026-03-01T12:00:00Z",
		version: 1,
	});
	(mockApi.getManifest as jest.Mock).mockReset().mockResolvedValue(null);
});

afterEach(() => {
	for (const engine of activeEngines) engine.destroy();
	activeEngines.length = 0;
});

// PR B2: pull() now drives the ordered cursor feed (getSyncChanges), not the
// legacy timestamp feed. The meta-page pagination + serverHash body-skip +
// body-fetch-on-hash-diff strategy these tests protect still lives in
// fetchAllNoteChanges / resolveChangeBody, exercised by pullAll(). So these
// were re-pointed from pull() → pullAll() — same wiring, still-live coverage.
describe("paginated pull (legacy meta feed via pullAll)", () => {
	test("loops pages until has_more=false, passing the cursor through", async () => {
		const engine = createEngine();
		(mockApi.getChanges as jest.Mock)
			.mockResolvedValueOnce({
				changes: [metaChange("a.md", "h-a", 1)],
				server_time: "2026-06-12T00:00:01Z",
				has_more: true,
				next_cursor: "cur1",
			})
			.mockResolvedValueOnce({
				changes: [metaChange("b.md", "h-b", 1)],
				server_time: "2026-06-12T00:00:02Z",
				has_more: false,
				next_cursor: null,
			});
		(mockApi.getNote as jest.Mock).mockImplementation((path: string) =>
			Promise.resolve({
				path,
				title: path,
				content: `body of ${path}`,
				content_hash: `h-${path.replace(".md", "")}`,
				folder: "",
				tags: [],
				mtime: 100,
				created_at: "2026-06-12T00:00:00Z",
				updated_at: "2026-06-12T00:00:00Z",
				version: 1,
			}),
		);

		const applied = await engine.pullAll();

		expect(applied).toBe(2);
		const calls = (mockApi.getChanges as jest.Mock).mock.calls;
		expect(calls.length).toBe(2);
		// Second call must carry the cursor from page 1.
		expect(calls[1][1]).toMatchObject({ cursor: "cur1" });
		expect(mockApp.vault.create).toHaveBeenCalledTimes(2);
	});

	test("skips the body fetch when content_hash matches the stored serverHash", async () => {
		const engine = createEngine();
		// The skip requires the local file to exist — a missing file must
		// always be re-fetched (pullAll restore case).
		const local = new TFile("a.md");
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "a.md" ? local : null,
		);
		engine.importSyncState({
			"a.md": { hash: fnv1a("# Test"), version: 4, serverHash: "h-same" },
		});
		(mockApi.getChanges as jest.Mock).mockResolvedValueOnce({
			changes: [metaChange("a.md", "h-same", 5)],
			server_time: "2026-06-12T00:00:01Z",
			has_more: false,
			next_cursor: null,
		});

		await engine.pullAll();

		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();

		// Version advances so the next push doesn't 409 on a stale version.
		const state = engine.exportSyncState();
		expect(state["a.md"]?.version).toBe(5);
		expect(state["a.md"]?.serverHash).toBe("h-same");
	});

	test("fetches the body when content_hash differs from the stored serverHash", async () => {
		const engine = createEngine();
		engine.importSyncState({
			"a.md": { hash: fnv1a("old local"), version: 4, serverHash: "h-old" },
		});
		(mockApi.getChanges as jest.Mock).mockResolvedValueOnce({
			changes: [metaChange("a.md", "h-new", 5)],
			server_time: "2026-06-12T00:00:01Z",
			has_more: false,
			next_cursor: null,
		});
		(mockApi.getNote as jest.Mock).mockResolvedValueOnce({
			path: "a.md",
			title: "a",
			content: "new body",
			content_hash: "h-new",
			folder: "",
			tags: [],
			mtime: 100,
			created_at: "2026-06-12T00:00:00Z",
			updated_at: "2026-06-12T00:00:00Z",
			version: 5,
		});

		await engine.pullAll();

		expect(mockApi.getNote).toHaveBeenCalledWith("a.md");
		expect(mockApp.vault.create).toHaveBeenCalled();
		expect(engine.exportSyncState()["a.md"]?.serverHash).toBe("h-new");
	});
});

describe("hash-compare live sync", () => {
	test("skips events whose content_hash matches the stored serverHash", async () => {
		const engine = createEngine();
		engine.importSyncState({
			"a.md": { hash: fnv1a("# Test"), version: 3, serverHash: "h-known" },
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "a.md",
			timestamp: Date.now(),
			content: "should not be applied",
			content_hash: "h-known",
			version: 4,
		});

		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(mockApi.getNote).not.toHaveBeenCalled();
	});

	test("applies inline content when the hash differs (dual-field release)", async () => {
		const engine = createEngine();
		engine.importSyncState({
			"a.md": { hash: fnv1a("old"), version: 3, serverHash: "h-old" },
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "a.md",
			timestamp: Date.now(),
			content: "# New inline",
			content_hash: "h-new",
			version: 4,
		});

		expect(mockApp.vault.create).toHaveBeenCalled();
		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["a.md"]?.serverHash).toBe("h-new");
	});

	test("fetches the body for hash-only events (post-transition shape)", async () => {
		const engine = createEngine();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/Remote.md",
			timestamp: Date.now(),
			content_hash: "srvhash-remote",
			version: 1,
		});

		expect(mockApi.getNote).toHaveBeenCalledWith("Notes/Remote.md");
		expect(mockApp.vault.create).toHaveBeenCalled();
		expect(engine.exportSyncState()["Notes/Remote.md"]?.serverHash).toBe("srvhash-remote");
	});
});

describe("batch push", () => {
	function okResult(path: string, version = 1, extra = {}) {
		return {
			path,
			status: "ok",
			id: `id-${path}`,
			version,
			content_hash: `srv-${path}`,
			server_path: path,
			...extra,
		};
	}

	test("pushAll sends notes through POST /notes/batch in one request", async () => {
		const engine = createEngine();
		const files = [new TFile("a.md"), new TFile("b.md"), new TFile("c.md")];
		mockApp.vault.getFiles.mockReturnValue(files);
		mockApp.vault.cachedRead.mockImplementation((f: TFile) =>
			Promise.resolve(`content of ${f.path}`),
		);
		(mockApi.pushNotesBatch as jest.Mock).mockResolvedValueOnce({
			results: files.map((f) => okResult(f.path)),
		});

		const pushed = await engine.pushAll();

		expect(pushed).toBe(3);
		expect(mockApi.pushNotesBatch).toHaveBeenCalledTimes(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		const sent = (mockApi.pushNotesBatch as jest.Mock).mock.calls[0][0];
		expect(sent.map((n: { path: string }) => n.path)).toEqual(["a.md", "b.md", "c.md"]);

		const state = engine.exportSyncState();
		expect(state["a.md"]?.serverHash).toBe("srv-a.md");
		expect(state["a.md"]?.version).toBe(1);
	});

	test("falls back to per-note pushes when the batch endpoint is missing (404)", async () => {
		const engine = createEngine();
		// .canvas notes take the kept LWW single-note REST path (md notes route
		// CRDT-sole and never REST-push), so they exercise the batch-unsupported
		// → per-note fallback the same as pre-rev md did.
		const files = [new TFile("a.canvas"), new TFile("b.canvas")];
		mockApp.vault.getFiles.mockReturnValue(files);
		(mockApi.pushNotesBatch as jest.Mock).mockRejectedValueOnce({ status: 404 });
		(mockApi.pushNote as jest.Mock).mockResolvedValue({
			note: { path: "", version: 1 },
			chunks_indexed: 0,
		});

		const pushed = await engine.pushAll();

		expect(pushed).toBe(2);
		expect(mockApi.pushNote).toHaveBeenCalledTimes(2);
	});

	test("a conflict result falls back to the single-note push flow for that file", async () => {
		const engine = createEngine();
		// .canvas so the single-note fallback takes the kept LWW REST path (md is
		// CRDT-sole). The batch-conflict → pushFile hand-off itself is unchanged.
		const files = [new TFile("ok.md"), new TFile("conflicted.canvas")];
		mockApp.vault.getFiles.mockReturnValue(files);
		(mockApi.pushNotesBatch as jest.Mock).mockResolvedValueOnce({
			results: [
				okResult("ok.md"),
				{
					path: "conflicted.canvas",
					status: "conflict",
					server_note: {
						id: "x",
						path: "conflicted.canvas",
						title: "c",
						content: "server content",
						folder: "",
						tags: [],
						mtime: 100,
						created_at: "2026-06-12T00:00:00Z",
						updated_at: "2026-06-12T00:00:00Z",
						version: 9,
					},
				},
			],
		});
		(mockApi.pushNote as jest.Mock).mockResolvedValue({
			note: { path: "conflicted.canvas", version: 10 },
			chunks_indexed: 0,
		});

		await engine.pushAll();

		// The conflicted file went through the single-note flow.
		const pushNoteCalls = (mockApi.pushNote as jest.Mock).mock.calls;
		expect(pushNoteCalls.some((c: unknown[]) => c[0] === "conflicted.canvas")).toBe(true);
	});

	test("renames the local file when the server sanitized the path", async () => {
		const engine = createEngine();
		const dirty = new TFile("dirty?.md");
		mockApp.vault.getFiles.mockReturnValue([dirty]);
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "dirty?.md" ? dirty : null,
		);
		(mockApi.pushNotesBatch as jest.Mock).mockResolvedValueOnce({
			results: [okResult("dirty?.md", 1, { server_path: "dirty.md" })],
		});

		await engine.pushAll();

		expect(mockApp.vault.rename).toHaveBeenCalledWith(dirty, "dirty.md");
		const state = engine.exportSyncState();
		expect(state["dirty.md"]).toBeDefined();
		expect(state["dirty?.md"]).toBeUndefined();
	});
});

describe("reconcile (serverHash-based)", () => {
	test("flags local-only files as missing and hash drift as diverged", async () => {
		const engine = createEngine();
		const synced = new TFile("synced.md");
		const drifted = new TFile("drifted.md");
		const localOnly = new TFile("local-only.md");
		const edited = new TFile("edited.md");
		mockApp.vault.getFiles.mockReturnValue([synced, drifted, localOnly, edited]);
		mockApp.vault.cachedRead.mockImplementation((f: TFile) =>
			Promise.resolve(`content of ${f.path}`),
		);

		engine.importSyncState({
			"synced.md": { hash: fnv1a("content of synced.md"), version: 1, serverHash: "h-s" },
			"drifted.md": { hash: fnv1a("content of drifted.md"), version: 1, serverHash: "h-d" },
			// edited.md: local content differs from the last-synced hash
			"edited.md": { hash: fnv1a("something else"), version: 1, serverHash: "h-e" },
		});

		(mockApi.getManifest as jest.Mock).mockResolvedValueOnce({
			notes: [
				{ path: "synced.md", content_hash: "h-s" },
				{ path: "drifted.md", content_hash: "h-d-CHANGED" },
				{ path: "edited.md", content_hash: "h-e" },
				{ path: "server-only.md", content_hash: "h-x" },
			],
			attachments: [],
			total_notes: 4,
			total_attachments: 0,
		});

		const result = await engine.reconcile();

		expect(result).not.toBeNull();
		expect(result!.missing).toEqual(["local-only.md"]);
		expect(result!.diverged.sort()).toEqual(["drifted.md", "edited.md"]);
		expect(result!.extraOnServer).toEqual(["server-only.md"]);
	});
});

// PR B2 — REMOVED: "pull resilience + fetch strategy" (3 tests).
//
// These protected behaviors of the LEGACY timestamp-feed pull() that the cursor
// pull deliberately abandoned, with no equivalent to port:
//
//   • "first sync full / incremental meta" — the full-vs-meta fields choice was
//     driven by lastSync. The cursor feed always delivers full content inline
//     (one ordered stream), so there is no fields/meta distinction to assert.
//
//   • "a transient body-fetch failure pins lastSync" and "a local apply failure
//     does NOT pin lastSync" — lastSync is no longer the pull watermark; the
//     cursor is. The cursor flow's resilience (persist-after-each-page so a
//     failed page is re-served; skip-a-permanent-apply-failure without wedging
//     the feed) is already covered in tests/sync-cursor-pull.test.ts under
//     "SyncEngine pullViaCursor". Re-pinning these to a watermark pull() no
//     longer maintains would assert dead behavior.
//
// The body-fetch / serverHash meta-skip mechanics themselves remain covered via
// pullAll() in the "paginated pull (legacy meta feed via pullAll)" suite above.

describe("batch push sizing", () => {
	test("notes above 10MB are routed through the single-note path", async () => {
		const engine = createEngine();
		const small = new TFile("small.md");
		const huge = new TFile("huge.md", Date.now(), 11 * 1024 * 1024);
		mockApp.vault.getFiles.mockReturnValue([small, huge]);
		// The oversized single-note path only REST-pushes when the *content* also
		// exceeds MAX_CRDT_NOTE_BYTES (4MB) — an in-cap md body routes CRDT-sole
		// and returns false. Give huge.md a body past the cap so pushFile REST-pushes.
		mockApp.vault.cachedRead.mockImplementation((f: TFile) =>
			Promise.resolve(f.path === "huge.md" ? "x".repeat(5 * 1024 * 1024) : "# Test"),
		);
		(mockApi.pushNotesBatch as jest.Mock).mockResolvedValueOnce({
			results: [
				{
					path: "small.md",
					status: "ok",
					id: "id-s",
					version: 1,
					content_hash: "h-s",
					server_path: "small.md",
				},
			],
		});
		(mockApi.pushNote as jest.Mock).mockResolvedValue({
			note: { path: "huge.md", version: 1 },
			chunks_indexed: 0,
		});

		await engine.pushAll();

		const sent = (mockApi.pushNotesBatch as jest.Mock).mock.calls[0][0];
		expect(sent.map((n: { path: string }) => n.path)).toEqual(["small.md"]);
		// The oversized file went through pushNote (single-note 413 path owns
		// the too_large Sync Center categorization).
		const single = (mockApi.pushNote as jest.Mock).mock.calls;
		expect(single.some((c: unknown[]) => c[0] === "huge.md")).toBe(true);
	});
});
