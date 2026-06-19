/**
 * Pure search engine: dispatches Semantic / Keyword / Hybrid and normalizes
 * every mode to UnifiedSearchResult[]. No DOM, no Obsidian view code.
 */
import { type App, type TFile, getAllTags, prepareFuzzySearch } from "obsidian";
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

function snippet(text: string | null | undefined): string {
	const t = (text ?? "").trim();
	return t.length > SNIPPET_LEN ? `${t.slice(0, SNIPPET_LEN)}…` : t;
}

function mapSemantic(results: SearchResult[]): UnifiedSearchResult[] {
	return results.map((r) => ({
		source_path: r.source_path ?? r.path ?? "",
		title: r.title,
		text: snippet(r.text ?? r.snippet),
		heading_path: r.heading_path,
		score: r.score,
		origin: "semantic",
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
	const fuzzy = deps.fuzzy ?? prepareFuzzySearch;
	if (mode === "semantic") {
		return { results: await searchSemantic(query, ctx, opts), degraded: false };
	}
	if (mode === "keyword") {
		return { results: await searchKeyword(query, ctx, opts, fuzzy), degraded: false };
	}
	return searchHybrid(query, ctx, opts, fuzzy);
}

function basename(path: string): string {
	const file = path.split("/").pop() ?? path;
	return file.endsWith(".md") ? file.slice(0, -3) : file;
}

function matchesFolder(path: string, folder?: string): boolean {
	if (!folder) return true;
	const prefix = folder.endsWith("/") ? folder : `${folder}/`;
	return path.startsWith(prefix);
}

function noteTags(app: App, file: TFile): Set<string> {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return new Set();
	const all = getAllTags(cache) ?? [];
	return new Set(all.map((t) => t.replace(/^#/, "")));
}

function matchesTags(app: App, file: TFile, tags?: string[]): boolean {
	if (!tags?.length) return true;
	const have = noteTags(app, file);
	return tags.every((t) => have.has(t.replace(/^#/, "")));
}

/** Window a snippet around the first match and rebase ranges into it. */
function windowSnippet(
	content: string,
	matches: [number, number][],
): { snippetText: string; ranges: [number, number][] } {
	const first = matches[0];
	if (!first) return { snippetText: snippet(content), ranges: [] };
	const start = Math.max(0, first[0] - 40);
	const end = Math.min(content.length, start + SNIPPET_LEN);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < content.length ? "…" : "";
	const text = prefix + content.slice(start, end) + suffix;
	const shift = prefix.length - start;
	const ranges = matches
		.filter(([s, e]) => s >= start && e <= end)
		.map(([s, e]) => [s + shift, e + shift] as [number, number]);
	return { snippetText: text, ranges };
}

async function searchKeyword(
	query: string,
	ctx: SearchContext,
	opts: SearchOpts,
	fuzzy: FuzzyFactory,
): Promise<UnifiedSearchResult[]> {
	const scorer = fuzzy(query);
	const files = ctx.app.vault
		.getMarkdownFiles()
		.filter((f) => matchesFolder(f.path, opts.folder))
		.filter((f) => matchesTags(ctx.app, f, opts.tags));

	const scored: UnifiedSearchResult[] = [];
	for (const file of files) {
		let content: string;
		try {
			content = await ctx.app.vault.cachedRead(file);
		} catch {
			continue; // unreadable file — skip, never abort the whole search
		}
		const title = basename(file.path);
		const titleHit = scorer(title);
		const bodyHit = scorer(content);
		const score = Math.max(
			titleHit ? titleHit.score + TITLE_BONUS : Number.NEGATIVE_INFINITY,
			bodyHit ? bodyHit.score : Number.NEGATIVE_INFINITY,
		);
		if (score === Number.NEGATIVE_INFINITY) continue;
		const { snippetText, ranges } = bodyHit
			? windowSnippet(content, bodyHit.matches)
			: { snippetText: snippet(content), ranges: [] as [number, number][] };
		scored.push({
			source_path: file.path,
			title,
			text: snippetText,
			score,
			origin: "keyword",
			matchRanges: ranges,
		});
	}
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, opts.limit ?? DEFAULT_LIMIT);
}

/** AND-filter results by tags using local note metadata (drops notes absent locally). */
function filterResultsByTags(
	app: App,
	results: UnifiedSearchResult[],
	tags?: string[],
): UnifiedSearchResult[] {
	if (!tags?.length) return results;
	return results.filter((r) => {
		const file = app.vault.getFileByPath(r.source_path);
		return file ? matchesTags(app, file, tags) : false;
	});
}

/** Keep the highest-scoring result per note; drop empty paths. */
function collapseByNote(results: UnifiedSearchResult[]): UnifiedSearchResult[] {
	const best = new Map<string, UnifiedSearchResult>();
	for (const r of results) {
		if (!r.source_path) continue;
		const prev = best.get(r.source_path);
		if (!prev || r.score > prev.score) best.set(r.source_path, r);
	}
	return [...best.values()];
}

/** Reciprocal-rank fusion on source_path. Keyword side wins for snippet. */
function rrf(
	keyword: UnifiedSearchResult[],
	semantic: UnifiedSearchResult[],
	limit: number,
): UnifiedSearchResult[] {
	const scores = new Map<string, number>();
	const kw = new Map<string, UnifiedSearchResult>();
	const sem = new Map<string, UnifiedSearchResult>();
	keyword.forEach((r, i) => {
		scores.set(r.source_path, (scores.get(r.source_path) ?? 0) + 1 / (RRF_K + i));
		kw.set(r.source_path, r);
	});
	semantic.forEach((r, i) => {
		scores.set(r.source_path, (scores.get(r.source_path) ?? 0) + 1 / (RRF_K + i));
		sem.set(r.source_path, r);
	});
	const fused: UnifiedSearchResult[] = [];
	for (const [path, score] of scores) {
		const k = kw.get(path);
		const s = sem.get(path);
		const base = k ?? s!; // prefer keyword (carries matchRanges)
		fused.push({
			source_path: path,
			title: base.title ?? s?.title,
			text: base.text,
			heading_path: s?.heading_path,
			score,
			origin: "hybrid",
			matchRanges: k?.matchRanges,
		});
	}
	fused.sort((a, b) => b.score - a.score);
	return fused.slice(0, limit);
}

async function searchHybrid(
	query: string,
	ctx: SearchContext,
	opts: SearchOpts,
	fuzzy: FuzzyFactory,
): Promise<SearchOutcome> {
	const limit = opts.limit ?? DEFAULT_LIMIT;
	const keywordList = await searchKeyword(query, ctx, opts, fuzzy);
	try {
		const resp = await ctx.api.search(query, limit, opts.tags, opts.folder);
		const semanticList = filterResultsByTags(
			ctx.app,
			collapseByNote(mapSemantic(resp.results)),
			opts.tags,
		);
		return { results: rrf(keywordList, semanticList, limit), degraded: false };
	} catch {
		return { results: keywordList.slice(0, limit), degraded: true };
	}
}
