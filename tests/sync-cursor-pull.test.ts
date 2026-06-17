/**
 * Tests for PR B2 cursor-pull sync — device_id minting + X-Device-Id header.
 *
 * Mirrors the requestUrl-stubbing harness from tests/api.test.ts: requestUrl
 * is mocked via tests/preload.ts. We construct an EngramApi, set the device id,
 * issue an authed GET that routes through sendRequest (getChanges), and assert
 * on the captured request headers.
 */
import { type Mock, beforeEach, describe, expect, test } from "bun:test";
import { requestUrl } from "obsidian";
import { EngramApi } from "../src/api";

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
