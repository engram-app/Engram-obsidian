/**
 * Tests for the explicit-folder endpoints on EngramApi:
 *   POST   /folders                  → createFolder
 *   DELETE /folders/<path>           → deleteFolder
 *   GET    /folders/explicit         → listExplicitFolders
 *
 * Mirrors the requestUrl mock pattern from tests/api.test.ts.
 */
import { beforeEach, describe, expect, type Mock, test } from "bun:test";
import { requestUrl } from "obsidian";
import { EngramApi } from "../src/api";

const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

const TEST_SERVER = "http://localhost:8000";
const TEST_API_BASE = `${TEST_SERVER}/api`;
const TEST_KEY = "engram_testkey";

beforeEach(() => {
	mockRequestUrl.mockReset();
});

describe("EngramApi.createFolder", () => {
	test("POSTs /folders with the folder body", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 201,
			json: { folder: { name: "Projects/Active", count: 0 } },
		} as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		const result = await api.createFolder("Projects/Active");
		const opts = mockRequestUrl.mock.calls[0][0] as any;
		expect(opts.method).toBe("POST");
		expect(opts.url).toBe(`${TEST_API_BASE}/folders`);
		expect(JSON.parse(opts.body)).toEqual({ folder: "Projects/Active" });
		expect(result.folder.name).toBe("Projects/Active");
	});

	test("accepts 200 (idempotent server response)", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { folder: { name: "Twice", count: 0 } },
		} as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		await expect(api.createFolder("Twice")).resolves.toEqual({
			folder: { name: "Twice", count: 0 },
		});
	});
});

describe("EngramApi.deleteFolder", () => {
	test("sends DELETE /folders/<path>", async () => {
		mockRequestUrl.mockResolvedValueOnce({ status: 204, json: null } as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		await api.deleteFolder("Doomed");
		const opts = mockRequestUrl.mock.calls[0][0] as any;
		expect(opts.method).toBe("DELETE");
		expect(opts.url).toBe(`${TEST_API_BASE}/folders/Doomed`);
	});

	test("URL-encodes each path segment but preserves slashes", async () => {
		mockRequestUrl.mockResolvedValueOnce({ status: 204, json: null } as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		await api.deleteFolder("Has Space/Sub");
		const opts = mockRequestUrl.mock.calls[0][0] as any;
		expect(opts.url).toBe(`${TEST_API_BASE}/folders/Has%20Space/Sub`);
	});

	test("resolves to void", async () => {
		mockRequestUrl.mockResolvedValueOnce({ status: 204, json: null } as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		await expect(api.deleteFolder("X")).resolves.toBeUndefined();
	});
});

describe("EngramApi.listExplicitFolders", () => {
	test("returns the folder name strings", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { folders: [{ name: "Explicit" }, { name: "Another/One" }] },
		} as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		expect(await api.listExplicitFolders()).toEqual(["Explicit", "Another/One"]);
	});

	test("tolerates an empty list", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { folders: [] },
		} as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		expect(await api.listExplicitFolders()).toEqual([]);
	});

	test("hits /folders/explicit", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 200,
			json: { folders: [] },
		} as any);
		const api = new EngramApi(TEST_SERVER, TEST_KEY);
		await api.listExplicitFolders();
		const opts = mockRequestUrl.mock.calls[0][0] as any;
		expect(opts.method).toBe("GET");
		expect(opts.url).toBe(`${TEST_API_BASE}/folders/explicit`);
	});
});
