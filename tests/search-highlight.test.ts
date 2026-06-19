import { describe, expect, it } from "bun:test";
import { buildSegments, queryTokenRanges } from "../src/search-highlight";

describe("buildSegments", () => {
	it("splits text into hit / non-hit segments", () => {
		expect(buildSegments("the omega oil", [[4, 9]])).toEqual([
			{ text: "the ", hit: false },
			{ text: "omega", hit: true },
			{ text: " oil", hit: false },
		]);
	});

	it("returns a single non-hit segment when there are no ranges", () => {
		expect(buildSegments("plain", [])).toEqual([{ text: "plain", hit: false }]);
	});
});

describe("queryTokenRanges", () => {
	it("finds case-insensitive token offsets for the semantic fallback", () => {
		expect(queryTokenRanges("Omega and OIL", "omega oil")).toEqual([
			[0, 5],
			[10, 13],
		]);
	});
});
