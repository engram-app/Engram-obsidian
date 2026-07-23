import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// Protocol rev: hash-compare live sync + serverHash-based reconcile over the
// op-log feed (the REST batch/changes endpoints were removed in #304).

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockResolvedValue({ results: [] }),
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

beforeEach(() => {
	jest.clearAllMocks();
	mockApp.vault.getFileByPath.mockReset().mockReturnValue(null);
	mockApp.vault.getFiles.mockReset().mockReturnValue([]);
	mockApp.vault.cachedRead.mockReset().mockResolvedValue("# Test");
	(mockApi.pushNote as jest.Mock).mockReset().mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApi.pushNotesBatch as jest.Mock).mockReset().mockResolvedValue({ results: [] });
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

// pullAll() replays the note op-log from cursor 0 via
// catchupViaSeqReplay({fromZero:true}); the legacy paginated meta-feed pull
// (fetchAllNoteChanges) and the REST changes endpoints it rode are gone (#304).

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
// The body-fetch / serverHash meta-skip mechanics themselves were covered via
// pullAll() in a "paginated pull (legacy meta feed via pullAll)" suite that
// USED to sit above this comment — removed by Task 5 of the CRDT
// single-push-path rework (see that removal note further up this file):
// pullAll() no longer drives fetchAllNoteChanges/resolveChangeBody at all
// (Task 7 deleted resolveChangeBody outright — its only remaining caller was
// pullAll, already removed by Task 5. fetchAllNoteChanges survives: it still
// backs computeSyncPlan's inventory query, tests/sync-plan.test.ts).
//
// The REST batch-push suites that used to sit here ("batch push", "batch push
// sizing") exercised pushNotesViaBatch/recordBatchPushOk directly — both
// deleted by Task 7 (dead since Task 3 routed pushAll's genesis notes through
// crdtCreateBatch/pushGenesisBatch instead). Their invariants (chunking,
// oversized→pushFile routing, mint-refusal, id-adoption, #245 mid-flight
// rename) are pinned for the surviving producer in
// tests/sync-push-consolidation.test.ts ("pushGenesisBatch — direct"); the
// batch-specific sanitize-rename case is covered generically for pushFile in
// tests/sync.test.ts ("Path sanitization on push").
