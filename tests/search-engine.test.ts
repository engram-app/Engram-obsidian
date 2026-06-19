import { describe, expect, it } from "bun:test";
import { searchEngram } from "../src/search-engine";
import { DEFAULT_SETTINGS } from "../src/types";
import type { SearchResponse } from "../src/types";

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

// Deterministic fuzzy: score = higher when match is earlier; one match range.
const fakeFuzzy = (q: string) => (text: string) => {
	const i = text.toLowerCase().indexOf(q.toLowerCase());
	if (i < 0) return null;
	return { score: 100 - i, matches: [[i, i + q.length] as [number, number]] };
};

function fakeApp(files: { path: string; content: string; tags?: string[] }[]) {
	const byPath = new Map(files.map((f) => [f.path, f]));
	return {
		vault: {
			getMarkdownFiles: () => files.map((f) => ({ path: f.path })),
			cachedRead: async (file: { path: string }) => byPath.get(file.path)!.content,
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const tags = byPath.get(file.path)?.tags ?? [];
				return { tags: tags.map((t) => ({ tag: `#${t}` })), frontmatter: {} };
			},
		},
	} as any;
}

describe("searchEngram keyword", () => {
	it("ranks by fuzzy score and builds a highlighted snippet", async () => {
		const app = fakeApp([
			{ path: "a.md", content: "nothing relevant here" },
			{ path: "b.md", content: "the omega story begins" },
			{ path: "c.md", content: "omega up front" },
		]);
		const { results } = await searchEngram(
			"keyword",
			"omega",
			{ api: {} as any, app },
			{ limit: 10 },
			{ fuzzy: fakeFuzzy },
		);
		expect(results.map((r) => r.source_path)).toEqual(["c.md", "b.md"]);
		expect(results[0].origin).toBe("keyword");
		const [s, e] = results[0].matchRanges![0];
		expect(results[0].text.slice(s, e).toLowerCase()).toBe("omega");
	});

	it("filters by folder prefix", async () => {
		const app = fakeApp([
			{ path: "health/x.md", content: "omega" },
			{ path: "other/y.md", content: "omega" },
		]);
		const { results } = await searchEngram(
			"keyword",
			"omega",
			{ api: {} as any, app },
			{ folder: "health" },
			{ fuzzy: fakeFuzzy },
		);
		expect(results.map((r) => r.source_path)).toEqual(["health/x.md"]);
	});

	it("filters by tag (AND across requested tags)", async () => {
		const app = fakeApp([
			{ path: "a.md", content: "omega", tags: ["health"] },
			{ path: "b.md", content: "omega", tags: ["health", "diet"] },
		]);
		const { results } = await searchEngram(
			"keyword",
			"omega",
			{ api: {} as any, app },
			{ tags: ["health", "diet"] },
			{ fuzzy: fakeFuzzy },
		);
		expect(results.map((r) => r.source_path)).toEqual(["b.md"]);
	});
});

describe("searchEngram hybrid", () => {
	const app = fakeApp([
		{ path: "a.md", content: "omega alpha" },
		{ path: "b.md", content: "omega beta" },
	]);

	it("fuses semantic + keyword on source_path and dedupes notes", async () => {
		const api = {
			search: async () => ({
				query: "omega",
				results: [
					{
						text: "semantic chunk for b",
						title: "B",
						heading_path: "Top > B",
						source_path: "b.md",
						tags: [],
						wikilinks: [],
						score: 0.9,
						vector_score: 0.9,
						rerank_score: 0.9,
					},
				],
			}),
		} as any;
		const { results, degraded } = await searchEngram(
			"hybrid",
			"omega",
			{ api, app },
			{ limit: 10 },
			{ fuzzy: fakeFuzzy },
		);
		expect(degraded).toBe(false);
		// b.md appears in both lists → ranked first, exactly once.
		expect(results.map((r) => r.source_path)).toEqual(["b.md", "a.md"]);
		expect(results.every((r) => r.origin === "hybrid")).toBe(true);
		// keyword snippet (with ranges) preferred over the semantic chunk text.
		expect(results[0].matchRanges?.length).toBeGreaterThan(0);
	});

	it("degrades to keyword-only when the backend throws", async () => {
		const api = {
			search: async () => {
				throw new Error("offline");
			},
		} as any;
		const { results, degraded } = await searchEngram(
			"hybrid",
			"omega",
			{ api, app },
			{},
			{ fuzzy: fakeFuzzy },
		);
		expect(degraded).toBe(true);
		expect(results.map((r) => r.source_path).sort()).toEqual(["a.md", "b.md"]);
	});
});
