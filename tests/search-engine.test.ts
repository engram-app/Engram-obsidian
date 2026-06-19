import { describe, expect, it } from "bun:test";
import { searchEngram } from "../src/search-engine";
import { DEFAULT_SETTINGS } from "../src/types";
import type { SearchResponse } from "../src/types";

describe("search settings", () => {
	it("defaults searchDefaultMode to hybrid", () => {
		expect(DEFAULT_SETTINGS.searchDefaultMode).toBe("hybrid");
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
			getFileByPath: (path: string) => (byPath.has(path) ? { path } : null),
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
		expect(results[0].matchType).toBe("keyword");
		expect(results[0].text.toLowerCase()).toContain("omega");
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
		// b.md matched both legs; a.md only the keyword leg.
		const byPath = new Map(results.map((r) => [r.source_path, r]));
		expect(byPath.get("b.md")?.matchType).toBe("both");
		expect(byPath.get("a.md")?.matchType).toBe("keyword");
		// Semantic chunk text preferred for the snippet when a semantic result exists.
		expect(byPath.get("b.md")?.text).toBe("semantic chunk for b");
	});

	it("tags a semantic-only note as matchType 'semantic'", async () => {
		// "gamma" matches no local file via fakeFuzzy → keyword leg empty;
		// the backend returns a.md → fused result is semantic-only.
		const api = {
			search: async () => ({
				query: "gamma",
				results: [
					{
						text: "semantic chunk for a",
						title: "A",
						heading_path: "Top > A",
						source_path: "a.md",
						tags: [],
						wikilinks: [],
						score: 0.9,
						vector_score: 0.9,
						rerank_score: 0.9,
					},
				],
			}),
		} as any;
		const { results } = await searchEngram(
			"hybrid",
			"gamma",
			{ api, app },
			{ limit: 10 },
			{ fuzzy: fakeFuzzy },
		);
		expect(results.map((r) => r.source_path)).toEqual(["a.md"]);
		expect(results[0].matchType).toBe("semantic");
		expect(results[0].text).toBe("semantic chunk for a");
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

describe("searchEngram hybrid tag consistency", () => {
	it("AND-filters the semantic side client-side (no OR leakage)", async () => {
		const app = fakeApp([
			{ path: "both.md", content: "omega", tags: ["health", "diet"] },
			{ path: "onlyhealth.md", content: "zzz", tags: ["health"] }, // keyword won't match "omega"
		]);
		// Backend (OR) returns onlyhealth.md even though it lacks "diet":
		const api = {
			search: async () => ({
				query: "omega",
				results: [
					{
						text: "semantic",
						title: "OnlyHealth",
						heading_path: "",
						source_path: "onlyhealth.md",
						tags: [],
						wikilinks: [],
						score: 0.9,
						vector_score: 0.9,
						rerank_score: 0.9,
					},
					{
						text: "semantic",
						title: "Both",
						heading_path: "",
						source_path: "both.md",
						tags: [],
						wikilinks: [],
						score: 0.7,
						vector_score: 0.7,
						rerank_score: 0.7,
					},
				],
			}),
		} as any;
		const { results } = await searchEngram(
			"hybrid",
			"omega",
			{ api, app },
			{ tags: ["health", "diet"] },
			{ fuzzy: fakeFuzzy },
		);
		const paths = results.map((r) => r.source_path);
		expect(paths).toContain("both.md");
		expect(paths).not.toContain("onlyhealth.md"); // OR-leaked note excluded
	});
});

describe("searchEngram semantic — backend web-card shape (path/snippet)", () => {
	it("maps path→source_path and snippet→text without throwing", async () => {
		const api = {
			search: async () => ({
				results: [
					{
						id: "n1",
						path: "health/fish.md",
						title: "Fish",
						folder: "health",
						heading_path: "Health > Oils",
						snippet: "  omega-3 oils help  ",
						score: 0.8,
						match_count: 2,
					},
				],
			}),
		} as any;
		const { results, degraded } = await searchEngram(
			"semantic",
			"omega",
			{ api, app: {} as any },
			{ limit: 5 },
		);
		expect(degraded).toBe(false);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			source_path: "health/fish.md",
			title: "Fish",
			heading_path: "Health > Oils",
			text: "omega-3 oils help",
			origin: "semantic",
			score: 0.8,
		});
	});

	it("does not throw when a result has neither text nor snippet", async () => {
		const api = {
			search: async () => ({
				results: [{ path: "a.md", title: "A", score: 0.5 }],
			}),
		} as any;
		const { results, degraded } = await searchEngram(
			"semantic",
			"q",
			{ api, app: {} as any },
			{},
		);
		expect(degraded).toBe(false);
		expect(results[0].text).toBe("");
		expect(results[0].source_path).toBe("a.md");
	});
});
