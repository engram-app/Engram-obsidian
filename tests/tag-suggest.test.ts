import { describe, expect, it } from "bun:test";
import { tagSuggestions } from "../src/tag-suggest";

describe("tagSuggestions", () => {
	const all = ["health", "diet", "health/sleep", "work"];
	it("substring-matches the fragment, case-insensitive", () => {
		expect(tagSuggestions(all, "hea", [])).toEqual(["health", "health/sleep"]);
	});
	it("excludes already-selected tags (exact, case-insensitive)", () => {
		expect(tagSuggestions(all, "", ["health"])).toEqual(["diet", "health/sleep", "work"]);
		expect(tagSuggestions(all, "die", ["DIET"])).toEqual([]);
	});
	it("returns all unselected when the fragment is empty", () => {
		expect(tagSuggestions(all, "", [])).toEqual(all);
	});
	it("ignores a leading # in the fragment", () => {
		expect(tagSuggestions(all, "#wor", [])).toEqual(["work"]);
	});
});
