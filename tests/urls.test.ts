import { describe, expect, test } from "bun:test";
import { ENGRAM_APP_URL, ENGRAM_CLOUD_URL, engramWebUrl } from "../src/tabs/urls";

describe("engramWebUrl", () => {
	test("cloud apiUrl resolves to the managed SPA host", () => {
		expect(engramWebUrl(ENGRAM_CLOUD_URL)).toBe(ENGRAM_APP_URL);
	});

	test("self-hosted apiUrl serves its own SPA, so it maps to itself", () => {
		expect(engramWebUrl("https://engram.example.com")).toBe("https://engram.example.com");
	});

	test("trailing slash on a self-hosted apiUrl is preserved as-is", () => {
		expect(engramWebUrl("https://my.host:4000")).toBe("https://my.host:4000");
	});
});
