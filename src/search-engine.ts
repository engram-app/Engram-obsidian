/**
 * Pure search engine: dispatches Semantic / Keyword / Hybrid and normalizes
 * every mode to UnifiedSearchResult[]. No DOM, no Obsidian view code.
 */
import { type App, prepareFuzzySearch } from "obsidian";
import type { EngramApi } from "./api";
import type { SearchMode, SearchResult, UnifiedSearchResult } from "./types";

export interface SearchContext {
	api: EngramApi;
	app: App;
}

export interface SearchOpts {
	limit?: number;
	folder?: string;
	tags?: string[];
}

type FuzzyScorer = (text: string) => { score: number; matches: [number, number][] } | null;
type FuzzyFactory = (query: string) => FuzzyScorer;

/** Test seam: inject a deterministic fuzzy factory. Defaults to Obsidian's. */
export interface SearchDeps {
	fuzzy?: FuzzyFactory;
}

export interface SearchOutcome {
	results: UnifiedSearchResult[];
	/** True when Hybrid fell back to keyword-only because the backend failed. */
	degraded: boolean;
}

const DEFAULT_LIMIT = 10;
const SNIPPET_LEN = 150;
// Used by Task 4 (keyword) and Task 5 (hybrid RRF merge).
const RRF_K = 60;
const TITLE_BONUS = 1;

function snippet(text: string): string {
	const t = text.trim();
	return t.length > SNIPPET_LEN ? `${t.slice(0, SNIPPET_LEN)}…` : t;
}

function mapSemantic(results: SearchResult[]): UnifiedSearchResult[] {
	return results.map((r) => ({
		source_path: r.source_path ?? "",
		title: r.title,
		text: snippet(r.text),
		heading_path: r.heading_path,
		score: r.score,
		origin: "semantic" as SearchMode,
	}));
}

async function searchSemantic(
	query: string,
	ctx: SearchContext,
	opts: SearchOpts,
): Promise<UnifiedSearchResult[]> {
	const resp = await ctx.api.search(query, opts.limit ?? DEFAULT_LIMIT, opts.tags, opts.folder);
	return mapSemantic(resp.results);
}

export async function searchEngram(
	mode: SearchMode,
	query: string,
	ctx: SearchContext,
	opts: SearchOpts = {},
	deps: SearchDeps = {},
): Promise<SearchOutcome> {
	if (!query.trim()) return { results: [], degraded: false };
	const fuzzy = deps.fuzzy ?? (prepareFuzzySearch as unknown as FuzzyFactory);
	if (mode === "semantic") {
		return { results: await searchSemantic(query, ctx, opts), degraded: false };
	}
	if (mode === "keyword") {
		return { results: await searchKeyword(query, ctx, opts, fuzzy), degraded: false };
	}
	return searchHybrid(query, ctx, opts, fuzzy);
}

async function searchKeyword(
	_query: string,
	_ctx: SearchContext,
	_opts: SearchOpts,
	_fuzzy: FuzzyFactory,
): Promise<UnifiedSearchResult[]> {
	return [];
}

async function searchHybrid(
	_query: string,
	_ctx: SearchContext,
	_opts: SearchOpts,
	_fuzzy: FuzzyFactory,
): Promise<SearchOutcome> {
	return { results: [], degraded: false };
}
