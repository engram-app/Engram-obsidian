/**
 * Tests for PR B2 cursor-pull sync — device_id minting + X-Device-Id header.
 *
 * Mirrors the requestUrl-stubbing harness from tests/api.test.ts: requestUrl
 * is mocked via tests/preload.ts. We construct an EngramApi, set the device id,
 * issue an authed GET that routes through sendRequest (getChanges), and assert
 * on the captured request headers.
 */
import { type Mock, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { requestUrl } from "obsidian";
import { EngramApi } from "../src/api";
import { encodeCursor } from "../src/cursor";
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
