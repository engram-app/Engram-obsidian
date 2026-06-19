import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/types";

describe("search settings", () => {
	it("defaults searchDefaultMode to semantic", () => {
		expect(DEFAULT_SETTINGS.searchDefaultMode).toBe("semantic");
	});
});
