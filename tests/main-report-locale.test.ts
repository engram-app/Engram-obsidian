import { describe, expect, test } from "bun:test";
import { localeToReport } from "../src/main";

describe("localeToReport", () => {
	test("fills in an account with no language yet", () => {
		expect(localeToReport(null, "de", false)).toBe("de");
	});

	test("never overrides a language the web app already set", () => {
		expect(localeToReport("en", "de", false)).toBeUndefined();
	});

	test("stays quiet against an older backend that has no locale field", () => {
		expect(localeToReport(undefined, "de", false)).toBeUndefined();
	});

	// An app too old for getLanguage() would otherwise store the "en" fallback as
	// the user's choice, and the account would never be filled in again.
	test("reports nothing when Obsidian cannot say its language", () => {
		expect(localeToReport(null, undefined, false)).toBeUndefined();
	});

	// The report runs on every channel connect; a rejected value must not turn
	// every reconnect into another doomed PATCH.
	test("tries once per session", () => {
		expect(localeToReport(null, "de", true)).toBeUndefined();
	});
});
