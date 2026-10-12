import { describe, expect, test } from "bun:test";
import { shouldReportLocale } from "../src/main";

describe("shouldReportLocale", () => {
	test("fills in an account with no language yet", () => {
		expect(shouldReportLocale(null)).toBe(true);
	});

	test("never overrides a language the web app already set", () => {
		expect(shouldReportLocale("de")).toBe(false);
	});

	test("stays quiet against an older backend that has no locale field", () => {
		expect(shouldReportLocale(undefined)).toBe(false);
	});
});
