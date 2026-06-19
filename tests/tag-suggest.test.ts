import { describe, expect, it } from "bun:test";
import { applyTagSuggestion, tagSuggestions } from "../src/tag-suggest";

describe("tagSuggestions", () => {
	const all = ["health", "diet", "health/sleep", "work"];
	it("substring-matches the active fragment, case-insensitive", () => {
		expect(tagSuggestions(all, "hea")).toEqual(["health", "health/sleep"]);
	});
	it("excludes already-chosen tags and suggests for the last fragment", () => {
		expect(tagSuggestions(all, "health, di")).toEqual(["diet"]);
	});
	it("returns all (minus chosen) when the fragment is empty", () => {
		expect(tagSuggestions(all, "health, ")).toEqual(["diet", "health/sleep", "work"]);
	});
	it("ignores a leading # in the fragment", () => {
		expect(tagSuggestions(all, "#wor")).toEqual(["work"]);
	});
});

describe("applyTagSuggestion", () => {
	it("replaces the active fragment and adds a trailing comma-space", () => {
		expect(applyTagSuggestion("hea", "health")).toBe("health, ");
	});
	it("keeps prior chosen tags", () => {
		expect(applyTagSuggestion("health, di", "diet")).toBe("health, diet, ");
	});
});
