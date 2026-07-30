/**
 * Tests for the device_id X-Device-Id header, applySyncChange dispatch, and the
 * standalone manifest-diff reconcile (reconcileFromManifest).
 *
 * The REST cursor-pull cluster (pull/bootstrap/pullViaCursor/getSyncChanges +
 * syncCursor) was deleted in the REST-purge Bucket A migration — catch-up now
 * runs entirely over the socket seq-replay (catchupViaSeqReplay → applySyncChange).
 * What survives and is exercised here: the X-Device-Id header on REST requests,
 * applySyncChange's dispatch to applyChange/applyAttachmentChange, and
 * reconcileFromManifest (server-delete-local + folder markers).
 */
import { beforeEach, describe, expect, type Mock, mock, spyOn, test } from "bun:test";
import { requestUrl, TFile } from "obsidian";
import { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// requestUrl is mocked via tests/preload.ts — it is already a mock() instance
const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

const TEST_SERVER = "http://localhost:8000";
const TEST_KEY = "engram_testkey";

beforeEach(() => {
	mockRequestUrl.mockReset();
});

describe("X-Device-Id header", () => {
	let api: EngramApi;

	beforeEach(() => {
		api = new EngramApi(TEST_SERVER, TEST_KEY);
	});

	test("includes X-Device-Id when deviceId is set", async () => {
		api.setDeviceId("dev-xyz");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { notes: [], attachments: [] },
		} as any);
		await api.getManifest();
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({
					"X-Device-Id": "dev-xyz",
				}),
			}),
		);
	});

	test("omits X-Device-Id when no device id is set", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { notes: [], attachments: [] },
		} as any);
		await api.getManifest();
		const headers = mockRequestUrl.mock.calls[0][0].headers;
		expect(headers["X-Device-Id"]).toBeUndefined();
	});

	test("omits X-Device-Id when deviceId is set to null", async () => {
		api.setDeviceId("dev-xyz");
		api.setDeviceId(null);
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { notes: [], attachments: [] },
		} as any);
		await api.getManifest();
		const headers = mockRequestUrl.mock.calls[0][0].headers;
		expect(headers["X-Device-Id"]).toBeUndefined();
	});

	test("omits X-Device-Id when deviceId is set to empty string", async () => {
		api.setDeviceId("");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { notes: [], attachments: [] },
		} as any);
		await api.getManifest();
		const headers = mockRequestUrl.mock.calls[0][0].headers;
		expect(headers["X-Device-Id"]).toBeUndefined();
	});

	test("setDeviceId updates the header for subsequent requests", async () => {
		api.setDeviceId("dev-1");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { notes: [], attachments: [] },
		} as any);
		await api.getManifest();
		expect(mockRequestUrl.mock.calls[0][0].headers["X-Device-Id"]).toBe("dev-1");

		api.setDeviceId("dev-2");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { notes: [], attachments: [] },
		} as any);
		await api.getManifest();
		expect(mockRequestUrl.mock.calls[1][0].headers["X-Device-Id"]).toBe("dev-2");
	});
});

describe("SyncEngine applySyncChange dispatch", () => {
	// applySyncChange is pure dispatch; we spy on the underlying apply primitives
	// and assert the mapped arg shape. It is the surviving apply seam that the
	// socket seq-replay drives every catch-up op through.
	const mockApp = {
		vault: { getName: () => "Test Vault" },
		workspace: {},
		fileManager: {},
	} as any;
	const mockApi = {} as unknown as EngramApi;

	function createEngine(): SyncEngine {
		return new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			mock().mockResolvedValue(undefined),
		);
	}

	test("note entry dispatches to applyChange with a mapped NoteChange", async () => {
		const engine = createEngine();
		const applyChange = spyOn(engine, "applyChange").mockResolvedValue(true);
		const applyAttachment = spyOn(engine, "applyAttachmentChange").mockResolvedValue(true);

		const result = await engine.applySyncChange({
			type: "note",
			id: "n1",
			seq: 7,
			path: "a.md",
			title: "A",
			content: "hi",
			content_hash: "h1",
			folder: "",
			tags: ["x"],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 3,
		});

		expect(result).toBe(true);
		expect(applyAttachment).not.toHaveBeenCalled();
		expect(applyChange).toHaveBeenCalledTimes(1);
		const arg = applyChange.mock.calls[0][0];
		expect(arg.path).toBe("a.md");
		expect(arg.content).toBe("hi");
		expect(arg.version).toBe(3);
		expect(arg.deleted).toBe(false);
		// `seq` now rides through — it feeds applyChange's per-path stale-row
		// fence (the catch-up revert fix). The other feed-only fields stay
		// stripped from the mapped NoteChange.
		expect(arg.seq).toBe(7);
		expect((arg as any).type).toBeUndefined();
		expect((arg as any).id).toBeUndefined();
	});

	test("attachment entry dispatches to applyAttachmentChange with a mapped AttachmentChange", async () => {
		const engine = createEngine();
		const applyChange = spyOn(engine, "applyChange").mockResolvedValue(true);
		const applyAttachment = spyOn(engine, "applyAttachmentChange").mockResolvedValue(true);

		const result = await engine.applySyncChange({
			type: "attachment",
			id: "a1",
			seq: 8,
			path: "img.png",
			mime_type: "image/png",
			size_bytes: 10,
			mtime: 2,
			updated_at: "2026-01-01T00:00:01Z",
			deleted: true,
			version: 1,
		});

		expect(result).toBe(true);
		expect(applyChange).not.toHaveBeenCalled();
		expect(applyAttachment).toHaveBeenCalledTimes(1);
		const arg = applyAttachment.mock.calls[0][0];
		expect(arg.path).toBe("img.png");
		expect(arg.mime_type).toBe("image/png");
		expect(arg.size_bytes).toBe(10);
		expect(arg.deleted).toBe(true);
		// No content bytes passed — applyAttachmentChange fetches metadata-only entries.
		expect(applyAttachment.mock.calls[0][1]).toBeUndefined();
		expect((arg as any).type).toBeUndefined();
		expect((arg as any).seq).toBeUndefined();
		expect((arg as any).id).toBeUndefined();
	});
});

describe("SyncEngine reconcileFromManifest", () => {
	// The standalone manifest-diff reconcile (server-delete-local + empty-folder
	// markers). Does NOT pull content and does NOT push — content arrives via the
	// seq-replay catch-up, offline-created files push via pushModifiedFiles. Runs
	// on every catch-up path (fullSync/poll).
	function fakeFile(path: string): TFile {
		return new TFile(path);
	}

	let getManifest: Mock<() => Promise<any>>;
	let trashFile: Mock<(file: any) => Promise<void>>;

	function createEngine(localFiles: any[]): {
		engine: SyncEngine;
		pushFileSpy: ReturnType<typeof spyOn>;
	} {
		const mockApp = {
			vault: {
				getName: () => "Test Vault",
				configDir: ".obsidian",
				getFiles: () => localFiles,
			},
			workspace: {},
			fileManager: { trashFile },
		} as any;
		const api = { getManifest } as unknown as EngramApi;
		const engine = new SyncEngine(
			mockApp,
			api,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			mock().mockResolvedValue(undefined),
		);
		const pushFileSpy = spyOn(engine as any, "pushFile").mockResolvedValue(true);
		return { engine, pushFileSpy };
	}

	function emptyManifest() {
		return { notes: [], attachments: [], total_notes: 0, total_attachments: 0 };
	}

	beforeEach(() => {
		getManifest = mock();
		trashFile = mock().mockResolvedValue(undefined);
	});

	test("trashes a server-deleted file (in baseline, gone from manifest) + drops its baseline", async () => {
		getManifest.mockResolvedValueOnce(emptyManifest());
		const gone = fakeFile("gone.md");
		const { engine, pushFileSpy } = createEngine([gone]);
		engine.importSyncState({ "gone.md": { hash: 123 } });

		await (engine as any).reconcileFromManifest();

		expect(trashFile).toHaveBeenCalledTimes(1);
		expect(trashFile.mock.calls[0][0]).toBe(gone);
		expect(engine.exportSyncState()["gone.md"]).toBeUndefined();
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("leaves an offline-created file (not in baseline) untouched (pushModifiedFiles pushes it)", async () => {
		getManifest.mockResolvedValueOnce(emptyManifest());
		const created = fakeFile("new.md");
		const { engine, pushFileSpy } = createEngine([created]);

		await (engine as any).reconcileFromManifest();

		// Never synced → reconcile neither trashes nor pushes it; the push half
		// (pushModifiedFiles) handles never-synced files separately.
		expect(trashFile).not.toHaveBeenCalled();
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("an in-manifest file present locally is skipped (not trashed)", async () => {
		getManifest.mockResolvedValueOnce({
			notes: [{ path: "a.md", content_hash: "h1" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});
		const local = fakeFile("a.md");
		const { engine, pushFileSpy } = createEngine([local]);
		engine.importSyncState({ "a.md": { hash: 123 } });

		await (engine as any).reconcileFromManifest();

		expect(trashFile).not.toHaveBeenCalled();
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("a trash failure does NOT throw and KEEPS the baseline (no resurrection)", async () => {
		getManifest.mockResolvedValueOnce(emptyManifest());
		trashFile.mockReset().mockRejectedValueOnce(new Error("file locked"));
		const gone = fakeFile("gone.md");
		const { engine, pushFileSpy } = createEngine([gone]);
		engine.importSyncState({ "gone.md": { hash: 123 } });

		// Must not throw.
		await (engine as any).reconcileFromManifest();

		// Baseline retained so the next run retries the trash rather than
		// reclassifying it as offline-created (which would resurrect it).
		expect(pushFileSpy).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["gone.md"]).toBeDefined();
	});

	test("does NOT trash a live note when an identity swap races the manifest fetch (#283)", async () => {
		// OAuth reconnect swaps the api auth provider while a fullSync/poll's
		// manifest fetch is already in flight. The manifest resolves as a stale
		// snapshot that omits a note the server actually still holds. Trashing it
		// as "server-deleted" is the #283 local data-loss bug.
		const live = fakeFile("live.md");
		const { engine, pushFileSpy } = createEngine([live]);
		engine.importSyncState({ "live.md": { hash: 123 } });
		getManifest.mockImplementationOnce(async () => {
			engine.bumpAuthGeneration(); // swap lands mid-fetch
			return emptyManifest(); // stale: omits the still-live note
		});

		await (engine as any).reconcileFromManifest();

		expect(trashFile).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["live.md"]).toBeDefined();
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("a null manifest (pre-B1 backend / 404) is a no-op", async () => {
		getManifest.mockResolvedValueOnce(null);
		const gone = fakeFile("gone.md");
		const { engine, pushFileSpy } = createEngine([gone]);
		engine.importSyncState({ "gone.md": { hash: 123 } });

		await (engine as any).reconcileFromManifest();

		// Nothing to reconcile against → the local file is left untouched.
		expect(trashFile).not.toHaveBeenCalled();
		expect(pushFileSpy).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["gone.md"]).toBeDefined();
	});
});
