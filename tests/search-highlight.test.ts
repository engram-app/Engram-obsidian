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
	it("matches accented words via Unicode-aware boundaries", () => {
		// ASCII \b fails on é; the term must still match as a whole word.
		expect(queryTokenRanges("a café opens", "café")).toEqual([[2, 6]]);
	});
	it("does not match an accented term inside a larger word", () => {
		expect(queryTokenRanges("the cafés list", "café")).toEqual([]);
	});
	it("matches CJK terms as substrings (no word boundaries)", () => {
		// "機械" appears at index 0 of "機械学習"; boundary matching would reject it.
		expect(queryTokenRanges("機械学習の本", "機械")).toEqual([[0, 2]]);
	});
});
