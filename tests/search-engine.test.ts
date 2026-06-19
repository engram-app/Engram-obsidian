import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/types";
import type { SearchResponse } from "../src/types";
import { searchEngram } from "../src/search-engine";

describe("search settings", () => {
	it("defaults searchDefaultMode to semantic", () => {
		expect(DEFAULT_SETTINGS.searchDefaultMode).toBe("semantic");
	});
});

function fakeApi(resp: SearchResponse) {
	return { search: async () => resp } as any;
}
const noApp = {} as any;

describe("searchEngram semantic", () => {
	it("maps backend chunks to unified results", async () => {
		const api = fakeApi({
			query: "omega",
			results: [
				{
					text: "  omega-3 oils help  ",
					title: "Fish",
					heading_path: "Health > Oils",
					source_path: "health/fish.md",
					tags: [],
					wikilinks: [],
					score: 0.8,
					vector_score: 0.8,
					rerank_score: 0.8,
				},
			],
		});
		const { results, degraded } = await searchEngram(
			"semantic",
			"omega",
			{ api, app: noApp },
			{ limit: 5 },
		);
		expect(degraded).toBe(false);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			source_path: "health/fish.md",
			title: "Fish",
			heading_path: "Health > Oils",
			origin: "semantic",
			score: 0.8,
		});
		expect(results[0].text).toBe("omega-3 oils help");
	});

	it("returns empty for blank query", async () => {
		const api = fakeApi({ query: "", results: [] });
		const { results } = await searchEngram("semantic", "   ", { api, app: noApp }, {});
		expect(results).toEqual([]);
	});
});
