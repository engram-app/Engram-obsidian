/**
 * Pure search engine: dispatches Semantic / Keyword / Hybrid and normalizes
 * every mode to UnifiedSearchResult[]. No DOM, no Obsidian view code.
 */
import { type App, type TFile, getAllTags, prepareSimpleSearch } from "obsidian";
import type { EngramApi } from "./api";
import { queryTokenRanges } from "./search-highlight";
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
const EXCERPT_LEN = 140;
// Weakest hit still matched — floor its displayed strength here so it never
// reads as "0% / no match". Top of the set always maps to 100.
const STRENGTH_FLOOR = 40;

/** Relative match strength (0-100) for display, min-max normalized across the
 *  current result set. Mode-agnostic: works for backend cosine, Obsidian fuzzy
 *  (negative), and RRF scores alike because it's purely relative — never an
 *  absolute probability. Equal/single scores all read 100. */
export function matchStrengths(scores: number[]): number[] {
	if (!scores.length) return [];
	const max = Math.max(...scores);
	const min = Math.min(...scores);
	const range = max - min;
	if (range === 0) return scores.map(() => 100);
	return scores.map((s) =>
		Math.round(STRENGTH_FLOOR + ((s - min) / range) * (100 - STRENGTH_FLOOR)),
	);
}
// Used by Task 4 (keyword) and Task 5 (hybrid RRF merge).
const RRF_K = 60;
const TITLE_BONUS = 1;

/** A one-line excerpt focused on the query terms. Collapses whitespace, windows
 *  around the first whole-word query match (or shows the start if none), and
 *  ellipsizes. Highlighting is recomputed in the UI from the returned text. */
function excerpt(text: string | null | undefined, query: string): string {
	const t = (text ?? "").replace(/\s+/g, " ").trim();
	if (!t) return "";
	const first = queryTokenRanges(t, query)[0];
	if (!first)
		return t.length > EXCERPT_LEN ? `${t.slice(0, EXCERPT_LEN).replace(/\s+$/, "")}…` : t;
	let start = Math.max(0, first[0] - 24);
	let end = Math.min(t.length, start + EXCERPT_LEN);
	// Snap the cut points to word boundaries so neither edge chops a word.
	if (start > 0) {
		const sp = t.indexOf(" ", start);
		if (sp !== -1 && sp < first[0]) start = sp + 1;
	}
	if (end < t.length) {
		const sp = t.lastIndexOf(" ", end);
		if (sp > first[1]) end = sp;
	}
	return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

/** Drop a leading YAML frontmatter block so keyword matches/snippets come from
 *  the note body, not its `---` header. */
function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function mapSemantic(results: SearchResult[], query: string): UnifiedSearchResult[] {
	return results.map((r) => ({
		source_path: r.source_path ?? r.path ?? "",
		title: r.title,
		text: excerpt(r.text ?? r.snippet, query),
		heading_path: r.heading_path,
		// Guard against a result missing `score` (web-card shapes may omit it):
		// a non-finite score would propagate NaN through ranking and the strength bar.
		score: Number.isFinite(r.score) ? r.score : 0,
		matchType: "semantic",
	}));
}

async function searchSemantic(
	query: string,
	ctx: SearchContext,
	opts: SearchOpts,
): Promise<UnifiedSearchResult[]> {
	const resp = await ctx.api.search(query, opts.limit ?? DEFAULT_LIMIT, opts.tags, opts.folder);
	return mapSemantic(resp.results, query);
}

export async function searchEngram(
	mode: SearchMode,
	query: string,
	ctx: SearchContext,
	opts: SearchOpts = {},
	deps: SearchDeps = {},
): Promise<SearchOutcome> {
	if (!query.trim()) return { results: [], degraded: false };
	const fuzzy = deps.fuzzy ?? prepareSimpleSearch;
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
		} catch (e) {
			// Skip an unreadable file rather than abort the whole search, but log it
			// so a real read failure (permissions, corruption) isn't silently lost.
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.warn("Engram search: skipping unreadable file", file.path, e);
			continue;
		}
		const body = stripFrontmatter(content);
		const title = basename(file.path);
		const titleHit = scorer(title);
		const bodyHit = scorer(body);
		const score = Math.max(
			titleHit ? titleHit.score + TITLE_BONUS : Number.NEGATIVE_INFINITY,
			bodyHit ? bodyHit.score : Number.NEGATIVE_INFINITY,
		);
		if (score === Number.NEGATIVE_INFINITY) continue;
		scored.push({
			source_path: file.path,
			title,
			text: excerpt(body, query),
			score,
			matchType: "keyword",
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

/** Reciprocal-rank fusion on source_path. Prefers the semantic chunk text
 *  (curated, heading-aware passage) for the snippet when available. */
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
		const matchType: "semantic" | "keyword" | "both" =
			k && s ? "both" : k ? "keyword" : "semantic";
		fused.push({
			source_path: path,
			title: (k ?? s)?.title ?? s?.title,
			// Prefer the semantic chunk text (heading-aware passage); fall back to keyword.
			text: s?.text ?? (k as UnifiedSearchResult).text,
			heading_path: s?.heading_path,
			score,
			matchType,
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
	// Run both legs concurrently: the keyword leg is a local vault scan, the
	// semantic leg a network round-trip — independent, so total latency is the
	// slower of the two rather than their sum. The semantic promise is started
	// here and awaited inside the try so a backend failure degrades gracefully.
	const keywordPromise = searchKeyword(query, ctx, opts, fuzzy);
	const semanticPromise = ctx.api.search(query, limit, opts.tags, opts.folder);
	// Attach a handler now so a rejection while the keyword leg is still running
	// isn't flagged as an unhandled rejection; the real handling is in the try below.
	semanticPromise.catch(() => undefined);
	const keywordList = await keywordPromise;
	try {
		const resp = await semanticPromise;
		const semanticList = filterResultsByTags(
			ctx.app,
			collapseByNote(mapSemantic(resp.results, query)),
			opts.tags,
		);
		return { results: rrf(keywordList, semanticList, limit), degraded: false };
	} catch (e) {
		// Surface the real cause (auth 401, billing 402, rate-limit 429, 5xx) — the
		// caller only shows a generic "semantic offline" notice, so without this the
		// actionable error is invisible.
		// biome-ignore lint/suspicious/noConsole: error boundary
		console.error("Engram hybrid search: semantic leg failed, using keyword only", e);
		return { results: keywordList.slice(0, limit), degraded: true };
	}
}
