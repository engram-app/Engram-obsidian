import { describe, expect, it } from "bun:test";
import { folderSuggestions } from "../src/folder-suggest";

describe("folderSuggestions", () => {
	const all = ["health", "health/sleep", "projects", "projects/engram", "work"];

	it("substring-matches the fragment, case-insensitive", () => {
		expect(folderSuggestions(all, "heal")).toEqual(["health", "health/sleep"]);
		expect(folderSuggestions(all, "ENGRAM")).toEqual(["projects/engram"]);
	});

	it("matches against any path segment, not just the prefix", () => {
		expect(folderSuggestions(all, "sleep")).toEqual(["health/sleep"]);
	});

	it("returns all folders when the fragment is empty", () => {
		expect(folderSuggestions(all, "")).toEqual(all);
		expect(folderSuggestions(all, "   ")).toEqual(all);
	});

	it("returns an empty list when nothing matches", () => {
		expect(folderSuggestions(all, "nope")).toEqual([]);
	});

	it("caps the result list", () => {
		const many = Array.from({ length: 80 }, (_, i) => `folder${i}`);
		expect(folderSuggestions(many, "folder").length).toBe(50);
	});
});
