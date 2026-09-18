import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { currentLocale, t } from "../src/i18n";
import { __setLanguage } from "./__mocks__/obsidian";

// The mock's language is module state shared with every other test file, so a
// test that leaves it set to zh would translate another file's Notice assertions.
afterAll(() => __setLanguage("en"));

const PULLED = "Engram Sync: pulled {count} files from server";
const ENTER_KEY = "Enter an API key first";

describe("locale resolution", () => {
	beforeEach(() => __setLanguage("en"));

	test("defaults to en when the app reports nothing", () => {
		__setLanguage("");
		expect(currentLocale()).toBe("en");
	});

	test("passes through Obsidian's own code verbatim", () => {
		__setLanguage("zh-TW");
		expect(currentLocale()).toBe("zh-TW");
	});
});

describe("t() fallback chain", () => {
	beforeEach(() => __setLanguage("en"));

	test("English returns the key itself, so there is no en dictionary to drift", () => {
		expect(t(ENTER_KEY)).toBe(ENTER_KEY);
	});

	test("a locale we do not ship returns the key", () => {
		__setLanguage("af");
		expect(t(ENTER_KEY)).toBe(ENTER_KEY);
	});

	test("a shipped locale returns its translation", () => {
		__setLanguage("ja");
		expect(t(ENTER_KEY)).toBe("先に API キーを入力してください");
	});

	test("a string the locale has not translated falls back to English", () => {
		__setLanguage("ja");
		expect(t("A string no locale will ever contain")).toBe(
			"A string no locale will ever contain",
		);
	});

	test("zh-TW uses the Traditional dictionary, not the Simplified one", () => {
		__setLanguage("zh");
		const simplified = t(ENTER_KEY);
		__setLanguage("zh-TW");
		expect(t(ENTER_KEY)).not.toBe(simplified);
	});

	test("a regional code falls back to its base language", () => {
		__setLanguage("pt-BR");
		const br = t(ENTER_KEY);
		__setLanguage("pt");
		expect(t(ENTER_KEY)).toBe(br);
	});

	test("en-GB resolves to English rather than to a missing dictionary", () => {
		__setLanguage("en-GB");
		expect(t(ENTER_KEY)).toBe(ENTER_KEY);
	});
});

describe("interpolation", () => {
	beforeEach(() => __setLanguage("en"));

	test("substitutes a named variable", () => {
		expect(t("Signed in as {email}", { email: "a@b.co" })).toBe("Signed in as a@b.co");
	});

	test("substitutes numbers", () => {
		expect(t("Waiting {ms}ms", { ms: 250 })).toBe("Waiting 250ms");
	});

	test("leaves an unsupplied placeholder visible instead of printing undefined", () => {
		expect(t("Signed in as {email}")).toBe("Signed in as {email}");
	});

	test("substitutes every occurrence of the same variable", () => {
		expect(t("{n} of {n}", { n: 3 })).toBe("3 of 3");
	});
});

describe("plurals", () => {
	test("English picks the singular at one and the plural otherwise", () => {
		__setLanguage("en");
		expect(t(PULLED, { count: 1 })).toBe("Engram Sync: pulled 1 file from server");
		expect(t(PULLED, { count: 5 })).toBe("Engram Sync: pulled 5 files from server");
	});

	test("Russian selects among its three forms", () => {
		__setLanguage("ru");
		const one = t(PULLED, { count: 1 });
		const few = t(PULLED, { count: 2 });
		const many = t(PULLED, { count: 5 });
		expect(new Set([one, few, many]).size).toBe(3);
		expect(one).toContain("файл");
	});

	test("Chinese has a single form and still substitutes the count", () => {
		__setLanguage("zh");
		expect(t(PULLED, { count: 1 })).toBe(t(PULLED, { count: 5 }).replace("5", "1"));
		expect(t(PULLED, { count: 7 })).toContain("7");
	});

	// Regression: this label sits beside a span that already prints the number
	// (`⚡ 3`). It takes a count only to pick the plural category, so putting
	// {count} in the key rendered "⚡ 3 3 conflicts need resolution".
	test("a category-only plural does not print the count it was given", () => {
		for (const lang of ["en", "ja", "de", "ru", "zh"]) {
			__setLanguage(lang);
			expect(t(" conflicts need resolution", { count: 3 })).not.toMatch(/\d/);
		}
	});

	test("a plural string with no count behaves like the plural form", () => {
		__setLanguage("en");
		expect(t(PULLED)).toBe("Engram Sync: pulled {count} files from server");
	});
});
