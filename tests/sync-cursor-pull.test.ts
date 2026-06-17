/**
 * Tests for PR B2 cursor-pull sync — device_id minting + X-Device-Id header.
 *
 * Mirrors the requestUrl-stubbing harness from tests/api.test.ts: requestUrl
 * is mocked via tests/preload.ts. We construct an EngramApi, set the device id,
 * issue an authed GET that routes through sendRequest (getChanges), and assert
 * on the captured request headers.
 */
import { type Mock, beforeEach, describe, expect, mock, test } from "bun:test";
import { requestUrl } from "obsidian";
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
	let saveDataSpy: Mock<(data: { lastSync?: string; syncCursor?: string | null }) => Promise<void>>;

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
		expect(saveDataSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ syncCursor: null }),
		);
	});
});
