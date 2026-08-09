import { describe, expect, it } from "bun:test";
import { pickInitialTab } from "../src/tabs/start-tab";

describe("pickInitialTab", () => {
	it("lands new/unconfigured users on the welcome page", () => {
		expect(pickInitialTab({})).toBe("about");
	});

	it("treats a URL with no auth as not configured", () => {
		expect(pickInitialTab({ apiUrl: "https://app.engram.page" })).toBe("about");
	});

	it("treats auth with no URL as not configured", () => {
		expect(pickInitialTab({ apiKey: "engram_abc" })).toBe("about");
	});

	it("lands configured (URL + API key) users on the cloud tab", () => {
		expect(pickInitialTab({ apiUrl: "https://app.engram.page", apiKey: "engram_abc" })).toBe(
			"connection",
		);
	});

	it("lands configured (URL + OAuth) users on the cloud tab", () => {
		expect(pickInitialTab({ apiUrl: "https://app.engram.page", refreshToken: "rt_123" })).toBe(
			"connection",
		);
	});
});
