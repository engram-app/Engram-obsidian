/**
 * Tests for PR B2 cursor-pull sync — device_id minting + X-Device-Id header.
 *
 * Mirrors the requestUrl-stubbing harness from tests/api.test.ts: requestUrl
 * is mocked via tests/preload.ts. We construct an EngramApi, set the device id,
 * issue an authed GET that routes through sendRequest (getChanges), and assert
 * on the captured request headers.
 */
import { type Mock, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { TFile, requestUrl } from "obsidian";
import { EngramApi } from "../src/api";
import { MAX_CURSOR_UUID, encodeCursor } from "../src/cursor";
import { HistoryExpiredError, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type SyncChange } from "../src/types";

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
			json: { changes: [], server_time: "2026-01-01T00:00:00Z" },
		} as any);
		await api.getChanges("2026-01-01T00:00:00Z");
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
			json: { changes: [], server_time: "2026-01-01T00:00:00Z" },
		} as any);
		await api.getChanges("2026-01-01T00:00:00Z");
		const headers = mockRequestUrl.mock.calls[0][0].headers;
		expect(headers["X-Device-Id"]).toBeUndefined();
	});

	test("omits X-Device-Id when deviceId is set to null", async () => {
		api.setDeviceId("dev-xyz");
		api.setDeviceId(null);
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { changes: [], server_time: "2026-01-01T00:00:00Z" },
		} as any);
		await api.getChanges("2026-01-01T00:00:00Z");
		const headers = mockRequestUrl.mock.calls[0][0].headers;
		expect(headers["X-Device-Id"]).toBeUndefined();
	});

	test("omits X-Device-Id when deviceId is set to empty string", async () => {
		api.setDeviceId("");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { changes: [], server_time: "2026-01-01T00:00:00Z" },
		} as any);
		await api.getChanges("2026-01-01T00:00:00Z");
		const headers = mockRequestUrl.mock.calls[0][0].headers;
		expect(headers["X-Device-Id"]).toBeUndefined();
	});

	test("setDeviceId updates the header for subsequent requests", async () => {
		api.setDeviceId("dev-1");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { changes: [], server_time: "2026-01-01T00:00:00Z" },
		} as any);
		await api.getChanges("2026-01-01T00:00:00Z");
		expect(mockRequestUrl.mock.calls[0][0].headers["X-Device-Id"]).toBe("dev-1");

		api.setDeviceId("dev-2");
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { changes: [], server_time: "2026-01-01T00:00:00Z" },
		} as any);
		await api.getChanges("2026-01-01T00:00:00Z");
		expect(mockRequestUrl.mock.calls[1][0].headers["X-Device-Id"]).toBe("dev-2");
	});
});

describe("api.getSyncChanges", () => {
	let api: EngramApi;

	beforeEach(() => {
		api = new EngramApi(TEST_SERVER, TEST_KEY);
	});

	test("builds /sync/changes URL with cursor+limit and parses response", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: {
				changes: [
					{
						type: "note",
						id: "n1",
						seq: 1,
						path: "a.md",
						title: "A",
						content: "hi",
						content_hash: "h1",
						folder: "",
						tags: [],
						mtime: 1,
						updated_at: "2026-01-01T00:00:00Z",
						deleted: false,
						version: 1,
					},
					{
						type: "attachment",
						id: "a1",
						seq: 2,
						path: "img.png",
						mime_type: "image/png",
						size_bytes: 10,
						mtime: 2,
						updated_at: "2026-01-01T00:00:01Z",
						deleted: false,
						version: 1,
					},
				],
				next_cursor: "TOK",
				has_more: true,
			},
		} as any);

		const resp = await api.getSyncChanges("CUR", 2);

		const url = mockRequestUrl.mock.calls[0][0].url as string;
		expect(url).toContain("/sync/changes?");
		expect(url).toContain("cursor=CUR");
		expect(url).toContain("limit=2");

		expect(resp.changes[0].type).toBe("note");
		expect(resp.changes[1].type).toBe("attachment");
		expect(resp.next_cursor).toBe("TOK");
		expect(resp.has_more).toBe(true);
	});

	test("omits cursor param when absent (genesis pull)", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { changes: [], next_cursor: null, has_more: false },
		} as any);

		await api.getSyncChanges();

		const url = mockRequestUrl.mock.calls[0][0].url as string;
		expect(url).toContain("/sync/changes");
		expect(url).not.toContain("cursor=");
	});
});

describe("SyncEngine syncCursor state", () => {
	// Minimal harness mirroring tests/sync.test.ts createEngine: a stub App,
	// a stub EngramApi, default settings, and a saveData spy. The cursor is
	// pure in-memory state (no I/O), so the stubs only need to satisfy the
	// constructor signature.
	const mockApp = {
		vault: { getName: () => "Test Vault" },
		workspace: {},
		fileManager: {},
	} as any;
	const mockApi = {} as unknown as EngramApi;
	let saveDataSpy: Mock<
		(data: { lastSync?: string; syncCursor?: string | null }) => Promise<void>
	>;

	function createEngine(): SyncEngine {
		return new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			saveDataSpy,
		);
	}

	beforeEach(() => {
		saveDataSpy = mock().mockResolvedValue(undefined);
	});

	test("get/setSyncCursor round-trips a non-empty value", () => {
		const engine = createEngine();
		expect(engine.getSyncCursor()).toBeNull();
		engine.setSyncCursor("CUR-1");
		expect(engine.getSyncCursor()).toBe("CUR-1");
	});

	test("setSyncCursor('') normalizes to null", () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-1");
		engine.setSyncCursor("");
		expect(engine.getSyncCursor()).toBeNull();
	});

	test("setSyncCursor(null) clears the cursor", () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-1");
		engine.setSyncCursor(null);
		expect(engine.getSyncCursor()).toBeNull();
	});

	test("resetForVaultChange clears the cursor and persists syncCursor:null", async () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-old-vault");
		await engine.resetForVaultChange();
		// Cursor points into the OLD vault's feed — must be dropped on switch.
		expect(engine.getSyncCursor()).toBeNull();
		// And the clear must be persisted (saveData carries syncCursor:null).
		expect(saveDataSpy).toHaveBeenLastCalledWith(expect.objectContaining({ syncCursor: null }));
	});
});

describe("SyncEngine applySyncChange dispatch", () => {
	// Same minimal harness as above — applySyncChange is pure dispatch; we spy
	// on the underlying apply primitives and assert the mapped arg shape.
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
		// The feed-only fields must be stripped from the mapped NoteChange.
		expect((arg as any).type).toBeUndefined();
		expect((arg as any).seq).toBeUndefined();
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

describe("SyncEngine pullViaCursor", () => {
	// Same minimal harness, but the api stub now carries a getSyncChanges spy so
	// we can script the paged feed. applySyncChange is spied on the engine.
	const mockApp = {
		vault: { getName: () => "Test Vault" },
		workspace: {},
		fileManager: {},
	} as any;
	let getSyncChanges: Mock<(cursor?: string, limit?: number) => Promise<any>>;
	let saveDataSpy: Mock<(data: { syncCursor?: string | null }) => Promise<void>>;

	// Tiny factory for a well-formed note feed entry.
	function noteEntry(seq: number, path: string): SyncChange {
		const stem = path.replace(/\.md$/, "");
		return {
			type: "note",
			id: `id-${stem}`,
			seq,
			path,
			title: stem,
			content: `body-${stem}`,
			content_hash: `h-${stem}`,
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		};
	}

	function createEngine(): SyncEngine {
		const api = { getSyncChanges } as unknown as EngramApi;
		return new SyncEngine(mockApp, api, { ...DEFAULT_SETTINGS, debounceMs: 10 }, saveDataSpy);
	}

	beforeEach(() => {
		getSyncChanges = mock();
		saveDataSpy = mock().mockResolvedValue(undefined);
	});

	test("drains all pages, advances cursor, and persists the tip", async () => {
		const p1a = noteEntry(1, "a.md");
		const p1b = noteEntry(2, "b.md");
		const p2 = noteEntry(3, "c.md");
		getSyncChanges
			.mockResolvedValueOnce({ changes: [p1a, p1b], next_cursor: "C1", has_more: true })
			.mockResolvedValueOnce({ changes: [p2], next_cursor: null, has_more: false });

		const engine = createEngine();
		const applySpy = spyOn(engine, "applySyncChange").mockResolvedValue(true);

		const applied = await (engine as any).pullViaCursor(undefined);

		expect(applied).toBe(3);
		expect(applySpy).toHaveBeenCalledTimes(3);
		// First call is a genesis pull (no cursor); second resumes from "C1".
		expect(getSyncChanges).toHaveBeenCalledTimes(2);
		expect(getSyncChanges.mock.calls[0][0]).toBeUndefined();
		expect(getSyncChanges.mock.calls[1][0]).toBe("C1");
		// Final page has next_cursor:null → cursor advanced to the head of the
		// last entry so the server watermark reaches the feed tip.
		expect(engine.getSyncCursor()).toBe(encodeCursor(p2.seq, p2.id));
		// Persisted after every page (2 pages).
		expect(saveDataSpy).toHaveBeenCalledTimes(2);
	});

	test("maps a 410 response to HistoryExpiredError", async () => {
		getSyncChanges.mockRejectedValueOnce({ status: 410 });
		const engine = createEngine();

		await expect((engine as any).pullViaCursor("CUR")).rejects.toBeInstanceOf(
			HistoryExpiredError,
		);
	});

	test("skips a permanent apply failure without wedging the feed", async () => {
		const e1 = noteEntry(1, "a.md");
		const bad = noteEntry(2, "bad.md");
		const e3 = noteEntry(3, "c.md");
		getSyncChanges.mockResolvedValueOnce({
			changes: [e1, bad, e3],
			next_cursor: null,
			has_more: false,
		});

		const engine = createEngine();
		const applySpy = spyOn(engine, "applySyncChange").mockImplementation(
			async (c: SyncChange) => {
				if (c.path === "bad.md") throw new Error("illegal filename");
				return true;
			},
		);

		const applied = await (engine as any).pullViaCursor(undefined);

		// The two good entries applied; the bad one was logged + skipped, not fatal.
		expect(applied).toBe(2);
		expect(applySpy).toHaveBeenCalledTimes(3);
		// Loop still completed and advanced the cursor to the tip.
		expect(engine.getSyncCursor()).toBe(encodeCursor(e3.seq, e3.id));
	});
});

describe("SyncEngine bootstrap (§F reconcile + genesis pull)", () => {
	// A real mock TFile — isSyncable needs `instanceof TFile` + an `extension`,
	// shouldIgnore needs a `path`. The shim constructor sets both.
	function fakeFile(path: string): TFile {
		return new TFile(path);
	}

	let getManifest: Mock<() => Promise<any>>;
	let getSyncChanges: Mock<(cursor?: string, limit?: number) => Promise<any>>;
	let trashFile: Mock<(file: any) => Promise<void>>;
	let saveDataSpy: Mock<(data: any) => Promise<void>>;

	function createEngine(localFiles: any[]): {
		engine: SyncEngine;
		pushFileSpy: ReturnType<typeof spyOn>;
		applySpy: ReturnType<typeof spyOn>;
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
		const api = { getManifest, getSyncChanges } as unknown as EngramApi;
		const engine = new SyncEngine(
			mockApp,
			api,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			saveDataSpy,
		);
		// pushFile is private; spy via the prototype so we can assert calls.
		const pushFileSpy = spyOn(engine as any, "pushFile").mockResolvedValue(true);
		const applySpy = spyOn(engine, "applySyncChange").mockResolvedValue(true);
		return { engine, pushFileSpy, applySpy };
	}

	function emptyManifest() {
		return { notes: [], attachments: [], total_notes: 0, total_attachments: 0 };
	}

	beforeEach(() => {
		getManifest = mock();
		getSyncChanges = mock().mockResolvedValue({
			changes: [],
			next_cursor: null,
			has_more: false,
		});
		trashFile = mock().mockResolvedValue(undefined);
		saveDataSpy = mock().mockResolvedValue(undefined);
	});

	test("server-deleted (in baseline, gone from manifest) → trashed, NOT pushed", async () => {
		getManifest.mockResolvedValueOnce(emptyManifest());
		const gone = fakeFile("gone.md");
		const { engine, pushFileSpy } = createEngine([gone]);
		// Baseline knows this path → it was previously synced.
		engine.importSyncState({ "gone.md": { hash: 123 } });

		await (engine as any).bootstrap();

		expect(trashFile).toHaveBeenCalledTimes(1);
		expect(trashFile.mock.calls[0][0]).toBe(gone);
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("offline-created (not in baseline, gone from manifest) → pushed, NOT trashed", async () => {
		getManifest.mockResolvedValueOnce(emptyManifest());
		const created = fakeFile("new.md");
		const { engine, pushFileSpy } = createEngine([created]);
		// Baseline empty → never synced → created locally while offline.

		await (engine as any).bootstrap();

		expect(pushFileSpy).toHaveBeenCalledTimes(1);
		expect(pushFileSpy.mock.calls[0][0]).toBe(created);
		expect(trashFile).not.toHaveBeenCalled();
	});

	test("in-manifest file → content delivered by the genesis pull (no per-file action)", async () => {
		getManifest.mockResolvedValueOnce({
			notes: [{ path: "a.md", content_hash: "h1" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});
		getSyncChanges.mockReset().mockResolvedValueOnce({
			changes: [noteEntryFor("a.md")],
			next_cursor: null,
			has_more: false,
		});
		// Empty local vault — server has a file we don't.
		const { engine, pushFileSpy, applySpy } = createEngine([]);

		const applied = await (engine as any).bootstrap();

		// Content came through the cursor pull, not a structural push/trash.
		expect(applySpy).toHaveBeenCalledTimes(1);
		expect(applied).toBe(1);
		expect(pushFileSpy).not.toHaveBeenCalled();
		expect(trashFile).not.toHaveBeenCalled();
	});

	test("no manifest endpoint (404 → null) → genesis pull only, no reconcile", async () => {
		getManifest.mockResolvedValueOnce(null);
		getSyncChanges.mockReset().mockResolvedValueOnce({
			changes: [noteEntryFor("a.md")],
			next_cursor: null,
			has_more: false,
		});
		// A local file in baseline would normally be trashed — but with no manifest
		// there's nothing to reconcile against, so it must be left untouched.
		const gone = fakeFile("gone.md");
		const { engine, pushFileSpy, applySpy } = createEngine([gone]);
		engine.importSyncState({ "gone.md": { hash: 123 } });

		const applied = await (engine as any).bootstrap();

		expect(applied).toBe(1);
		expect(applySpy).toHaveBeenCalledTimes(1);
		expect(trashFile).not.toHaveBeenCalled();
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("in-manifest file present locally → skipped by structural pass (not trashed/pushed)", async () => {
		getManifest.mockResolvedValueOnce({
			notes: [{ path: "a.md", content_hash: "h1" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		});
		const local = fakeFile("a.md");
		const { engine, pushFileSpy } = createEngine([local]);
		// Even with a baseline entry, an in-manifest file is left to the pull.
		engine.importSyncState({ "a.md": { hash: 123 } });

		await (engine as any).bootstrap();

		expect(trashFile).not.toHaveBeenCalled();
		expect(pushFileSpy).not.toHaveBeenCalled();
	});

	test("trash failure does NOT abort bootstrap and keeps the baseline (no resurrection)", async () => {
		getManifest.mockResolvedValueOnce(emptyManifest());
		trashFile.mockReset().mockRejectedValueOnce(new Error("file locked"));
		const gone = fakeFile("gone.md");
		const { engine, pushFileSpy } = createEngine([gone]);
		engine.importSyncState({ "gone.md": { hash: 123 } });

		// Must not throw — the genesis pull still runs.
		await (engine as any).bootstrap();

		// Not pushed (still server-deleted), and the baseline entry is retained so
		// the next run retries the trash rather than reclassifying it as
		// offline-created (which would resurrect it).
		expect(pushFileSpy).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["gone.md"]).toBeDefined();
	});

	test("empty-vault bootstrap seeds the cursor from manifest.change_seq (§E)", async () => {
		// Empty vault → genesis pull delivers nothing → cursor would stay null and
		// every pull would re-bootstrap. §E: seed from change_seq so the next pull
		// resumes incrementally (and a reconnect catch-up has a position to resume).
		getManifest.mockResolvedValueOnce({
			notes: [],
			attachments: [],
			total_notes: 0,
			total_attachments: 0,
			change_seq: 42,
		});
		getSyncChanges.mockReset().mockResolvedValueOnce({
			changes: [],
			next_cursor: null,
			has_more: false,
		});
		const { engine } = createEngine([]);

		await (engine as any).bootstrap();

		expect(engine.getSyncCursor()).toBe(encodeCursor(42, MAX_CURSOR_UUID));
	});

	// Helper: a well-formed note feed entry for a given path.
	function noteEntryFor(path: string): SyncChange {
		const stem = path.replace(/\.md$/, "");
		return {
			type: "note",
			id: `id-${stem}`,
			seq: 1,
			path,
			title: stem,
			content: `body-${stem}`,
			content_hash: `h-${stem}`,
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		};
	}
});

describe("SyncEngine.pull (cursor orchestration)", () => {
	// pull() is pure orchestration over bootstrap() / pullViaCursor() — both
	// private, both spied via (engine as any). The stubs only need to satisfy
	// the constructor; the spies replace the real I/O.
	const mockApp = {
		vault: { getName: () => "Test Vault" },
		workspace: {},
		fileManager: {},
	} as any;
	const mockApi = {} as unknown as EngramApi;
	let saveDataSpy: Mock<(data: any) => Promise<void>>;

	function createEngine(): SyncEngine {
		return new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 10 },
			saveDataSpy,
		);
	}

	beforeEach(() => {
		saveDataSpy = mock().mockResolvedValue(undefined);
	});

	test("no cursor → bootstrap (pullViaCursor not called directly)", async () => {
		const engine = createEngine();
		const bootstrap = spyOn(engine as any, "bootstrap").mockResolvedValue(5);
		const pullViaCursor = spyOn(engine as any, "pullViaCursor").mockResolvedValue(0);

		const applied = await engine.pull();

		expect(applied).toBe(5);
		expect(bootstrap).toHaveBeenCalledTimes(1);
		expect(pullViaCursor).not.toHaveBeenCalled();
	});

	test("has cursor → pullViaCursor called with that cursor (bootstrap not)", async () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-7");
		const bootstrap = spyOn(engine as any, "bootstrap").mockResolvedValue(0);
		const pullViaCursor = spyOn(engine as any, "pullViaCursor").mockResolvedValue(3);

		const applied = await engine.pull();

		expect(applied).toBe(3);
		expect(bootstrap).not.toHaveBeenCalled();
		expect(pullViaCursor).toHaveBeenCalledTimes(1);
		expect(pullViaCursor.mock.calls[0][0]).toBe("CUR-7");
	});

	test("calls syncExplicitFolders post-pull (empty-folder markers ride a separate endpoint)", async () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-7");
		spyOn(engine as any, "pullViaCursor").mockResolvedValue(0);
		const syncFolders = spyOn(engine as any, "syncExplicitFolders").mockResolvedValue(
			undefined,
		);

		await engine.pull();

		expect(syncFolders).toHaveBeenCalledTimes(1);
	});

	test("a failing syncExplicitFolders is non-fatal (pull still returns applied count)", async () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-7");
		spyOn(engine as any, "pullViaCursor").mockResolvedValue(4);
		spyOn(engine as any, "syncExplicitFolders").mockRejectedValue(
			new Error("folders endpoint down"),
		);

		const applied = await engine.pull();

		expect(applied).toBe(4);
		expect(engine.getStatus().lastError).toBeFalsy();
	});

	test("pullViaCursor throws HistoryExpiredError → cursor cleared + re-bootstrap", async () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-stale");
		const bootstrap = spyOn(engine as any, "bootstrap").mockResolvedValue(9);
		const pullViaCursor = spyOn(engine as any, "pullViaCursor").mockRejectedValue(
			new HistoryExpiredError(),
		);

		const applied = await engine.pull();

		expect(applied).toBe(9);
		expect(pullViaCursor).toHaveBeenCalledTimes(1);
		// 410 → the cursor is dropped, persisted as null, and we re-bootstrap.
		expect(engine.getSyncCursor()).toBeNull();
		expect(saveDataSpy).toHaveBeenCalledWith(expect.objectContaining({ syncCursor: null }));
		expect(bootstrap).toHaveBeenCalledTimes(1);
	});

	test("syncBlocked short-circuits without touching bootstrap/pullViaCursor", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		const bootstrap = spyOn(engine as any, "bootstrap").mockResolvedValue(0);
		const pullViaCursor = spyOn(engine as any, "pullViaCursor").mockResolvedValue(0);

		const applied = await engine.pull();

		expect(applied).toBe(0);
		expect(bootstrap).not.toHaveBeenCalled();
		expect(pullViaCursor).not.toHaveBeenCalled();
	});

	test("a non-HistoryExpired error sets lastError and returns 0 (status → error)", async () => {
		const engine = createEngine();
		engine.setSyncCursor("CUR-1");
		spyOn(engine as any, "pullViaCursor").mockRejectedValue(new Error("network down"));

		const applied = await engine.pull();

		expect(applied).toBe(0);
		expect(engine.getStatus().state).toBe("error");
		expect(engine.getStatus().error).toBe("Pull failed: network down");
	});

	test("re-entry coalesces: a pull requested while one is in flight re-runs once after it", async () => {
		// Regression for #646: the reconnect catch-up (onStatusChange → pull())
		// could land while a prior pull (e.g. a post-OAuth-swap bootstrap) was
		// still in flight. The old guard dropped it outright (returned 0 and did
		// nothing), so the missed events were never fetched. Now the in-flight
		// guard records a pending request and re-runs the pull once the current
		// one finishes — the catch-up is coalesced, not lost.
		const engine = createEngine();
		const resolvers: Array<(n: number) => void> = [];
		const bootstrap = spyOn(engine as any, "bootstrap").mockImplementation(
			() => new Promise<number>((r) => resolvers.push(r)),
		);

		const first = engine.pull(); // enters, pulling=true, awaits bootstrap #1
		const second = await engine.pull(); // re-entry while in flight

		// Still non-blocking for the caller (onStatusChange doesn't await), but
		// the request is now remembered rather than discarded.
		expect(second).toBe(0);
		expect(bootstrap).toHaveBeenCalledTimes(1);

		resolvers[0](4); // finish the first pull
		expect(await first).toBe(4);

		// The coalesced rerun fires after the first completes — bootstrap runs
		// again, proving the catch-up was not lost.
		await new Promise((r) => setTimeout(r, 0));
		expect(bootstrap).toHaveBeenCalledTimes(2);

		resolvers[1]?.(0); // let the rerun settle
	});

	test("pull() self-heals a vault swap: stale cursor cleared → bootstrap (not a stale-cursor pull)", async () => {
		const engine = createEngine();
		// Synced under vault-A (cursor belongs to A); the active vault is now B
		// (e.g. an OAuth re-login). A reconnect catch-up calls pull() directly, so
		// the swap MUST be detected here or the stale A-cursor queries B for
		// seq > <A's seq> and silently returns nothing.
		engine.setSyncStateVaultId("vault-A");
		engine.setSyncCursor("STALE-CURSOR-FROM-A");
		(engine as unknown as { settings: { vaultId: string } }).settings.vaultId = "vault-B";
		const bootstrap = spyOn(engine as any, "bootstrap").mockResolvedValue(2);
		const pullViaCursor = spyOn(engine as any, "pullViaCursor").mockResolvedValue(0);

		await engine.pull();

		expect(engine.getSyncCursor()).toBeNull(); // stale cursor invalidated
		expect(bootstrap).toHaveBeenCalledTimes(1);
		expect(pullViaCursor).not.toHaveBeenCalled();
	});
});
