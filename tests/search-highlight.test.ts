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
	it("matches whole words case-insensitively", () => {
		expect(queryTokenRanges("Business name and the NAME field", "name")).toEqual([
			[9, 13],
			[22, 26],
		]);
	});
	it("does not match inside a larger word", () => {
		expect(queryTokenRanges("the filename is set", "name")).toEqual([]);
	});
	it("skips single-char tokens", () => {
		expect(queryTokenRanges("a business plan", "a business")).toEqual([[2, 10]]);
	});
});
