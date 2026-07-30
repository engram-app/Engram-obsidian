import type { Mock } from "bun:test";
import { beforeEach, describe, expect, test } from "bun:test";
import { requestUrl } from "obsidian";
import { checkForPluginUpdate, isNewerVersion, MANIFEST_URL } from "../src/update-check";

const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

describe("isNewerVersion", () => {
	test("true when latest patch/minor/major is higher", () => {
		expect(isNewerVersion("1.12.17", "1.12.16")).toBe(true);
		expect(isNewerVersion("1.13.0", "1.12.99")).toBe(true);
		expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
	});

	test("false when equal or older", () => {
		expect(isNewerVersion("1.12.17", "1.12.17")).toBe(false);
		expect(isNewerVersion("1.12.16", "1.12.17")).toBe(false);
	});

	test("compares numerically, not lexically (1.10 > 1.9)", () => {
		expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
		expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
	});
});

describe("checkForPluginUpdate", () => {
	beforeEach(() => mockRequestUrl.mockReset());

	test("returns the newer version string when GitHub manifest is ahead", async () => {
		mockRequestUrl.mockResolvedValue({ status: 200, json: { version: "1.13.0" } });
		expect(await checkForPluginUpdate("1.12.17")).toBe("1.13.0");
		expect(mockRequestUrl).toHaveBeenCalledWith({
			url: MANIFEST_URL,
			method: "GET",
			throw: false,
		});
	});

	test("returns null when already up to date", async () => {
		mockRequestUrl.mockResolvedValue({ status: 200, json: { version: "1.12.17" } });
		expect(await checkForPluginUpdate("1.12.17")).toBeNull();
	});

	test("returns null (silent) on non-200 or network error", async () => {
		mockRequestUrl.mockResolvedValue({ status: 404, json: {} });
		expect(await checkForPluginUpdate("1.12.17")).toBeNull();
		mockRequestUrl.mockRejectedValue(new Error("offline"));
		expect(await checkForPluginUpdate("1.12.17")).toBeNull();
	});
});
