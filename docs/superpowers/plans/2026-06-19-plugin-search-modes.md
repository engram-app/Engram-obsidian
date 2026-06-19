# Plugin Search Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Semantic / Keyword / Hybrid search modes to the Engram Obsidian plugin, with local keyword search, match highlighting, a tag filter, and jump-to-heading — while deduplicating the two near-identical search views.

**Architecture:** Split the current fused logic+DOM into a pure engine (`search-engine.ts`), a pure highlight helper (`search-highlight.ts`), and one shared UI controller (`search-ui.ts` → `SearchPanel`). Keyword search runs locally over vault markdown via Obsidian's `prepareFuzzySearch`; semantic stays on the backend; hybrid fuses both client-side with note-level RRF. `SearchView` (sidebar) and `SearchModal` become thin shells mounting `SearchPanel`.

**Tech Stack:** TypeScript, esbuild, Obsidian API, `bun:test` (obsidian mocked via `tests/preload.ts` + `tests/__mocks__/obsidian.ts`).

**Spec:** `docs/superpowers/specs/2026-06-19-plugin-search-modes-design.md`

**Working dir:** all paths are relative to the plugin repo root (worktree `.worktrees/feat-search-modes`, branch `feat/search-modes`). node_modules is hardlinked by the post-checkout hook — do NOT run `bun install`.

---

## File Structure

- **Create** `src/search-engine.ts` — pure search dispatch (`searchEngram`) + semantic/keyword/hybrid internals.
- **Create** `src/search-highlight.ts` — pure highlight helpers (`buildSegments`, `queryTokenRanges`).
- **Create** `src/search-ui.ts` — shared `SearchPanel` (DOM + interaction).
- **Create** `tests/search-engine.test.ts`, `tests/search-highlight.test.ts`.
- **Modify** `src/types.ts` — add `SearchMode`, `UnifiedSearchResult`, `searchDefaultMode` setting.
- **Modify** `tests/__mocks__/obsidian.ts` — add `prepareFuzzySearch` stub so module imports resolve.
- **Modify** `src/search-view.ts`, `src/search-modal.ts` — reduce to thin shells over `SearchPanel`.
- **Modify** `src/main.ts` — pass `app` + default-mode persistence into the views.
- **Modify** `styles.css` — `.engram-search-hl`, mode toggle, tag/filter rows.

---

### Task 1: Types + setting

**Files:**
- Modify: `src/types.ts` (add `SearchMode`, `UnifiedSearchResult`; extend `EngramSyncSettings` + `DEFAULT_SETTINGS`)
- Test: `tests/search-engine.test.ts` (new — only the settings-default assertion for now)

- [ ] **Step 1: Write the failing test**

Create `tests/search-engine.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/types";

describe("search settings", () => {
  it("defaults searchDefaultMode to semantic", () => {
    expect(DEFAULT_SETTINGS.searchDefaultMode).toBe("semantic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search-engine.test.ts`
Expected: FAIL — `searchDefaultMode` is `undefined`.

- [ ] **Step 3: Implement the types + default**

In `src/types.ts`, add after the `EngramSyncSettings` interface (before `DEFAULT_SETTINGS`):

```ts
/** Which search backend the panel uses. */
export type SearchMode = "semantic" | "keyword" | "hybrid";

/** A normalized, note-level search result shared across all modes. */
export interface UnifiedSearchResult {
  source_path: string;
  title?: string;
  /** Snippet text shown in the result list / preview. */
  text: string;
  /** Heading trail (semantic / hybrid-semantic side only). */
  heading_path?: string;
  score: number;
  origin: SearchMode;
  /** Character offset ranges into `text` to highlight. */
  matchRanges?: [number, number][];
}
```

Add to the `EngramSyncSettings` interface (after `planState`):

```ts
  /** Default mode for the search panel's toggle. */
  searchDefaultMode: SearchMode;
```

Add to `DEFAULT_SETTINGS` (after `planState: null,`):

```ts
  searchDefaultMode: "semantic",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/search-engine.test.ts
git commit -m "feat(search): add SearchMode + UnifiedSearchResult types and default-mode setting"
```

---

### Task 2: Obsidian mock — `prepareFuzzySearch` stub

**Files:**
- Modify: `tests/__mocks__/obsidian.ts`

The engine imports `prepareFuzzySearch` from `"obsidian"`. The mock must export it so test modules load (tests inject their own fuzzy factory for determinism, so this stub only needs to exist).

- [ ] **Step 1: Add the stub export**

Append to `tests/__mocks__/obsidian.ts`:

```ts
/** Test stub. Real ranking is exercised via an injected fuzzy factory in
 *  search-engine tests; this only needs to resolve the import. */
export function prepareFuzzySearch(
  query: string,
): (text: string) => { score: number; matches: [number, number][] } | null {
  const q = query.toLowerCase();
  return (text: string) => {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return null;
    return { score: 1, matches: [[i, i + q.length]] };
  };
}
```

- [ ] **Step 2: Verify the suite still loads**

Run: `bun test tests/search-engine.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add tests/__mocks__/obsidian.ts
git commit -m "test(search): stub prepareFuzzySearch in the obsidian mock"
```

---

### Task 3: Engine — semantic mapping + dispatcher skeleton

**Files:**
- Create: `src/search-engine.ts`
- Test: `tests/search-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/search-engine.test.ts`:

```ts
import { searchEngram } from "../src/search-engine";
import type { SearchResponse } from "../src/types";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search-engine.test.ts`
Expected: FAIL — `searchEngram` not found.

- [ ] **Step 3: Implement the engine skeleton**

Create `src/search-engine.ts`:

```ts
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
  const resp = await ctx.api.search(
    query,
    opts.limit ?? DEFAULT_LIMIT,
    opts.tags,
    opts.folder,
  );
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
```

> Note: `searchKeyword` and `searchHybrid` are added in Tasks 4–5. To keep this task compiling on its own, also add these temporary stubs at the bottom of the file now; they are fully replaced in the next tasks:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search-engine.test.ts`
Expected: PASS (semantic + blank-query + settings tests).

- [ ] **Step 5: Commit**

```bash
git add src/search-engine.ts tests/search-engine.test.ts
git commit -m "feat(search): engine dispatcher + semantic mapping"
```

---

### Task 4: Engine — local keyword search

**Files:**
- Modify: `src/search-engine.ts` (replace the `searchKeyword` stub + add helpers)
- Test: `tests/search-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/search-engine.test.ts`:

```ts
// Deterministic fuzzy: score = higher when match is earlier; one match range.
const fakeFuzzy =
  (q: string) =>
  (text: string) => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search-engine.test.ts`
Expected: FAIL — keyword returns `[]` (stub).

- [ ] **Step 3: Implement keyword search**

In `src/search-engine.ts`, replace the temporary `searchKeyword` stub with:

```ts
function basename(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}

function matchesFolder(path: string, folder?: string): boolean {
  if (!folder) return true;
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return path.startsWith(prefix);
}

function noteTags(app: App, file: { path: string }): Set<string> {
  // biome-ignore lint/suspicious/noExplicitAny: Obsidian cache shape
  const cache: any = app.metadataCache.getFileCache(file as any);
  const out = new Set<string>();
  for (const t of cache?.tags ?? []) {
    if (typeof t?.tag === "string") out.add(t.tag.replace(/^#/, ""));
  }
  const fmTags = cache?.frontmatter?.tags;
  if (Array.isArray(fmTags)) for (const t of fmTags) out.add(String(t).replace(/^#/, ""));
  else if (typeof fmTags === "string") out.add(fmTags.replace(/^#/, ""));
  return out;
}

function matchesTags(app: App, file: { path: string }, tags?: string[]): boolean {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search-engine.test.ts`
Expected: PASS (keyword ranking, folder filter, tag filter).

- [ ] **Step 5: Commit**

```bash
git add src/search-engine.ts tests/search-engine.test.ts
git commit -m "feat(search): local keyword search with folder/tag filter + snippet"
```

---

### Task 5: Engine — hybrid (note-level RRF + degrade)

**Files:**
- Modify: `src/search-engine.ts` (replace the `searchHybrid` stub + add helpers)
- Test: `tests/search-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/search-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search-engine.test.ts`
Expected: FAIL — hybrid returns `[]` (stub).

- [ ] **Step 3: Implement hybrid**

In `src/search-engine.ts`, replace the temporary `searchHybrid` stub with:

```ts
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
    const semanticList = collapseByNote(mapSemantic(resp.results));
    return { results: rrf(keywordList, semanticList, limit), degraded: false };
  } catch {
    return { results: keywordList.slice(0, limit), degraded: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search-engine.test.ts`
Expected: PASS (fusion + degrade).

- [ ] **Step 5: Commit**

```bash
git add src/search-engine.ts tests/search-engine.test.ts
git commit -m "feat(search): hybrid note-level RRF with offline degrade"
```

---

### Task 6: Highlight helpers (pure)

**Files:**
- Create: `src/search-highlight.ts`
- Test: `tests/search-highlight.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/search-highlight.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search-highlight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/search-highlight.ts`:

```ts
/** Pure helpers for rendering match highlights. No DOM. */

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** Split `text` into ordered hit / non-hit segments from sorted ranges. */
export function buildSegments(
  text: string,
  ranges: [number, number][],
): HighlightSegment[] {
  if (!ranges.length) return [{ text, hit: false }];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: HighlightSegment[] = [];
  let cursor = 0;
  for (const [s, e] of sorted) {
    if (s < cursor) continue; // skip overlaps
    if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/** Semantic fallback: ranges of each query token within `text`, case-insensitive. */
export function queryTokenRanges(text: string, query: string): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const tokenRaw of query.split(/\s+/)) {
    const token = tokenRaw.toLowerCase().trim();
    if (!token) continue;
    let from = 0;
    let i = lower.indexOf(token, from);
    while (i >= 0) {
      ranges.push([i, i + token.length]);
      from = i + token.length;
      i = lower.indexOf(token, from);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/search-highlight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search-highlight.ts tests/search-highlight.test.ts
git commit -m "feat(search): pure highlight segment + query-token helpers"
```

---

### Task 7: Shared `SearchPanel` UI

**Files:**
- Create: `src/search-ui.ts`
- Test: `tests/search-ui.test.ts`

`SearchPanel` owns the input, the mode toggle, folder + tag filters, the results list, keyboard nav, highlighting, and open/jump-to-heading. It is constructed with a parent element so both the sidebar view and the modal can mount it.

- [ ] **Step 1: Write the failing test (render + mode toggle smoke)**

Create `tests/search-ui.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { SearchPanel } from "../src/search-ui";

// jsdom-free minimal DOM: bun provides happy-dom? Use document from preload.
// tests/preload.ts registers a DOM. If `document` is undefined, this test is
// skipped by the guard below.
const hasDom = typeof document !== "undefined";

(hasDom ? describe : describe.skip)("SearchPanel", () => {
  it("renders a mode toggle with three options defaulting to the given mode", () => {
    const parent = document.createElement("div");
    const ctx = { api: { search: async () => ({ query: "", results: [] }) } as any, app: {} as any };
    const panel = new SearchPanel(parent, ctx, {
      withPreview: false,
      defaultMode: "keyword",
    });
    const buttons = parent.querySelectorAll(".engram-search-mode-btn");
    expect(buttons.length).toBe(3);
    const active = parent.querySelector(".engram-search-mode-btn.is-active");
    expect(active?.textContent).toBe("Keyword");
    panel.destroy();
  });
});
```

> If `tests/preload.ts` does not register a DOM (`document` is undefined), the suite self-skips via `describe.skip`. The panel is still exercised end-to-end by the existing E2E Obsidian tests. Do NOT add a DOM library just for this smoke test — keep it guarded.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/search-ui.test.ts`
Expected: FAIL — module not found (or self-skip if no DOM; in that case proceed to implement and rely on `bun run build` for type-check).

- [ ] **Step 3: Implement `SearchPanel`**

Create `src/search-ui.ts`:

```ts
/**
 * Shared search panel mounted by both the sidebar view and the quick modal.
 * Owns input, mode toggle, filters, results list, keyboard nav, highlight,
 * and open / jump-to-heading. UI-only — search logic lives in search-engine.ts.
 */
import { Notice } from "obsidian";
import { type SearchContext, searchEngram } from "./search-engine";
import { buildSegments, queryTokenRanges } from "./search-highlight";
import type { SearchMode, UnifiedSearchResult } from "./types";

const MODES: { mode: SearchMode; label: string }[] = [
  { mode: "semantic", label: "Semantic" },
  { mode: "keyword", label: "Keyword" },
  { mode: "hybrid", label: "Hybrid" },
];

export interface SearchPanelOpts {
  withPreview: boolean;
  defaultMode: SearchMode;
  /** Persist a mode change (e.g. write to plugin settings). */
  onModeChange?: (mode: SearchMode) => void;
}

export class SearchPanel {
  private ctx: SearchContext;
  private opts: SearchPanelOpts;
  private mode: SearchMode;
  private inputEl!: HTMLInputElement;
  private folderEl!: HTMLInputElement;
  private tagEl!: HTMLInputElement;
  private resultsEl!: HTMLElement;
  private previewEl: HTMLElement | null = null;
  private toggleEl!: HTMLElement;
  private debounceTimer: number | null = null;
  private results: UnifiedSearchResult[] = [];
  private selectedIndex = -1;

  constructor(parent: HTMLElement, ctx: SearchContext, opts: SearchPanelOpts) {
    this.ctx = ctx;
    this.opts = opts;
    this.mode = opts.defaultMode;
    this.build(parent);
  }

  private build(parent: HTMLElement): void {
    parent.addClass?.("engram-search-panel");

    this.toggleEl = parent.createDiv({ cls: "engram-search-mode-toggle" });
    for (const { mode, label } of MODES) {
      const btn = this.toggleEl.createEl("button", {
        text: label,
        cls: `engram-search-mode-btn${mode === this.mode ? " is-active" : ""}`,
      });
      btn.addEventListener("click", () => this.setMode(mode));
    }

    this.inputEl = parent.createEl("input", {
      type: "text",
      placeholder: "Search your vault…",
      cls: "engram-search-input",
    });
    this.folderEl = parent.createEl("input", {
      type: "text",
      placeholder: "Filter by folder…",
      cls: "engram-search-input engram-search-folder-input",
    });
    this.tagEl = parent.createEl("input", {
      type: "text",
      placeholder: "Filter by tags (comma-separated)…",
      cls: "engram-search-input engram-search-tag-input",
    });

    this.resultsEl = parent.createDiv({ cls: "engram-search-results" });
    if (this.opts.withPreview) {
      this.previewEl = parent.createDiv({ cls: "engram-search-preview" });
    }
    this.renderEmpty();

    const schedule = () => {
      if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => void this.run(), 300);
    };
    this.inputEl.addEventListener("input", schedule);
    this.folderEl.addEventListener("input", schedule);
    this.tagEl.addEventListener("input", schedule);

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSelection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.openSelected();
      }
    });
  }

  focus(): void {
    this.inputEl.focus();
  }

  destroy(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
  }

  private setMode(mode: SearchMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.toggleEl.findAll?.(".engram-search-mode-btn");
    const btns = this.toggleEl.querySelectorAll(".engram-search-mode-btn");
    btns.forEach((b, i) => b.toggleClass?.("is-active", MODES[i].mode === mode));
    btns.forEach((b, i) =>
      MODES[i].mode === mode ? b.classList.add("is-active") : b.classList.remove("is-active"),
    );
    this.opts.onModeChange?.(mode);
    void this.run();
  }

  private parseTags(): string[] | undefined {
    const raw = this.tagEl.value.trim();
    if (!raw) return undefined;
    const tags = raw
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    return tags.length ? tags : undefined;
  }

  private async run(): Promise<void> {
    const query = this.inputEl.value.trim();
    if (!query) {
      this.results = [];
      this.selectedIndex = -1;
      this.renderEmpty();
      return;
    }
    try {
      const outcome = await searchEngram(this.mode, query, this.ctx, {
        limit: 10,
        folder: this.folderEl.value.trim() || undefined,
        tags: this.parseTags(),
      });
      if (outcome.degraded) {
        new Notice("Semantic offline — keyword results only");
      }
      this.results = outcome.results;
      this.selectedIndex = this.results.length ? 0 : -1;
      this.renderResults(query);
    } catch (e) {
      // biome-ignore lint/suspicious/noConsole: error boundary
      console.error("Engram search failed", e);
      this.resultsEl.empty();
      this.previewEl?.empty();
      this.resultsEl.createEl("p", {
        text: "Search failed — check connection",
        cls: "engram-search-empty",
      });
    }
  }

  private renderEmpty(): void {
    this.resultsEl.empty();
    this.previewEl?.empty();
    this.resultsEl.createEl("p", {
      text: "Type to search your vault",
      cls: "engram-search-empty",
    });
  }

  private highlightInto(el: HTMLElement, result: UnifiedSearchResult, query: string): void {
    const ranges =
      result.matchRanges && result.matchRanges.length
        ? result.matchRanges
        : queryTokenRanges(result.text, query);
    for (const seg of buildSegments(result.text, ranges)) {
      if (seg.hit) {
        el.createSpan({ text: seg.text, cls: "engram-search-hl" });
      } else {
        el.appendText(seg.text);
      }
    }
  }

  private renderResults(query: string): void {
    this.resultsEl.empty();
    if (!this.results.length) {
      this.resultsEl.createEl("p", { text: "No results found", cls: "engram-search-empty" });
      this.previewEl?.empty();
      return;
    }
    this.results.forEach((result, i) => {
      const item = this.resultsEl.createDiv({
        cls: `engram-search-result-item${i === this.selectedIndex ? " is-selected" : ""}`,
      });
      const header = item.createDiv({ cls: "engram-search-result-header" });
      header.createEl("span", {
        text: result.title || result.source_path || "Untitled",
        cls: "engram-search-result-title",
      });
      if (result.origin === "semantic" || result.origin === "hybrid") {
        header.createEl("span", {
          text: `${(result.score * 100).toFixed(0)}%`,
          cls: "engram-search-result-score",
        });
      }
      const folder = result.source_path.replace(/\/[^/]+$/, "");
      if (folder) {
        item.createEl("span", { text: folder, cls: "engram-search-result-path" });
      }
      const snippet = item.createEl("p", { cls: "engram-search-result-snippet" });
      this.highlightInto(snippet, result, query);

      item.addEventListener("click", () => {
        this.selectedIndex = i;
        this.renderResults(query);
        if (this.previewEl) this.renderPreview(result, query);
      });
      item.addEventListener("dblclick", () => this.openResult(result));
    });
    const selected = this.results[this.selectedIndex];
    if (selected && this.previewEl) this.renderPreview(selected, query);
  }

  private renderPreview(result: UnifiedSearchResult, query: string): void {
    if (!this.previewEl) return;
    this.previewEl.empty();
    if (result.heading_path) {
      this.previewEl.createEl("h4", {
        text: result.heading_path,
        cls: "engram-search-preview-heading",
      });
    }
    const text = this.previewEl.createEl("p", { cls: "engram-search-preview-text" });
    this.highlightInto(text, result, query);
    const openBtn = this.previewEl.createEl("button", {
      text: "Open note",
      cls: "engram-search-preview-open",
    });
    openBtn.addEventListener("click", () => this.openResult(result));
  }

  private moveSelection(delta: number): void {
    if (!this.results.length) return;
    this.selectedIndex = Math.max(
      0,
      Math.min(this.results.length - 1, this.selectedIndex + delta),
    );
    this.renderResults(this.inputEl.value.trim());
  }

  private openSelected(): void {
    const result = this.results[this.selectedIndex];
    if (result) this.openResult(result);
  }

  private headingAnchor(headingPath?: string): string {
    if (!headingPath) return "";
    const last = headingPath.split(/>|\//).pop()?.trim();
    return last ? `#${last}` : "";
  }

  private openResult(result: UnifiedSearchResult): void {
    if (!result.source_path) {
      new Notice("No source path for this result");
      return;
    }
    const file = this.ctx.app.vault.getFileByPath(result.source_path);
    if (!file) {
      new Notice("Note not synced locally");
      return;
    }
    const linktext = `${result.source_path}${this.headingAnchor(result.heading_path)}`;
    void this.ctx.app.workspace.openLinkText(linktext, "");
  }
}
```

> Note on the two `findAll`/`toggleClass` lines in `setMode`: those Obsidian helper calls are guarded with `?.` so the plain-DOM smoke test still runs; the `classList` add/remove lines do the actual work in both environments. Keep both.

- [ ] **Step 4: Run test + type-check**

Run: `bun test tests/search-ui.test.ts`
Expected: PASS or self-skip (no DOM).
Run: `bun run build`
Expected: tsc passes, esbuild emits `main.js`.

- [ ] **Step 5: Commit**

```bash
git add src/search-ui.ts tests/search-ui.test.ts
git commit -m "feat(search): shared SearchPanel with mode toggle, filters, highlight, jump-to-heading"
```

---

### Task 8: Thin shells + main.ts wiring

**Files:**
- Modify: `src/search-view.ts` (replace body with shell over `SearchPanel`)
- Modify: `src/search-modal.ts` (replace body with shell over `SearchPanel`)
- Modify: `src/main.ts` (pass `this.app` + default mode + persistence)

- [ ] **Step 1: Replace `src/search-view.ts`**

```ts
/**
 * Sidebar search view — persistent search panel in the right sidebar.
 * Thin shell over the shared SearchPanel.
 */
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { EngramApi } from "./api";
import { SearchPanel } from "./search-ui";
import type { SearchMode } from "./types";

export const SEARCH_VIEW_TYPE = "engram-search-view";

export class SearchView extends ItemView {
  private api: EngramApi;
  private defaultMode: SearchMode;
  private onModeChange: (mode: SearchMode) => void;
  private panel: SearchPanel | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    api: EngramApi,
    defaultMode: SearchMode,
    onModeChange: (mode: SearchMode) => void,
  ) {
    super(leaf);
    this.api = api;
    this.defaultMode = defaultMode;
    this.onModeChange = onModeChange;
  }

  getViewType(): string {
    return SEARCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Engram search";
  }

  getIcon(): string {
    return "search";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("engram-search-view-container");
    this.panel = new SearchPanel(this.contentEl, { api: this.api, app: this.app }, {
      withPreview: true,
      defaultMode: this.defaultMode,
      onModeChange: this.onModeChange,
    });
  }

  async onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
  }
}
```

- [ ] **Step 2: Replace `src/search-modal.ts`**

```ts
/**
 * Quick search modal — Mod+Shift+S opens this. Thin shell over SearchPanel.
 */
import { type App, Modal } from "obsidian";
import type { EngramApi } from "./api";
import { SearchPanel } from "./search-ui";
import type { SearchMode } from "./types";

export class SearchModal extends Modal {
  private api: EngramApi;
  private defaultMode: SearchMode;
  private onModeChange: (mode: SearchMode) => void;
  private panel: SearchPanel | null = null;

  constructor(
    app: App,
    api: EngramApi,
    defaultMode: SearchMode,
    onModeChange: (mode: SearchMode) => void,
  ) {
    super(app);
    this.api = api;
    this.defaultMode = defaultMode;
    this.onModeChange = onModeChange;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("engram-search-modal");
    this.panel = new SearchPanel(contentEl, { api: this.api, app: this.app }, {
      withPreview: false,
      defaultMode: this.defaultMode,
      onModeChange: this.onModeChange,
    });
    this.panel.focus();
  }

  onClose(): void {
    this.panel?.destroy();
    this.panel = null;
    this.contentEl.empty();
  }
}
```

> The modal no longer auto-closes when opening a result (the shared `openResult` keeps the panel open, matching the sidebar). This is an intentional, minor behavior change. If preserving auto-close is desired, that is a follow-up — do not special-case it here.

- [ ] **Step 3: Wire `src/main.ts`**

In `src/main.ts`, define a helper to read/persist the default mode and pass it to both constructors. Replace the `registerView` call (around line 354) and the `SearchModal` construction (around line 360):

```ts
// near the other private helpers on the plugin class:
private persistSearchMode = (mode: SearchMode): void => {
  this.settings.searchDefaultMode = mode;
  void this.saveSettings();
};
```

Replace the search view registration:

```ts
this.registerView(
  SEARCH_VIEW_TYPE,
  (leaf) =>
    new SearchView(leaf, this.api, this.settings.searchDefaultMode, this.persistSearchMode),
);
```

Replace the `SearchModal` construction inside the `"search"` command callback:

```ts
new SearchModal(
  this.app,
  this.api,
  this.settings.searchDefaultMode,
  this.persistSearchMode,
).open();
```

Add `SearchMode` to the existing `./types` import in `main.ts` (it already imports `DEFAULT_SETTINGS` from `./types`):

```ts
import { DEFAULT_SETTINGS, type SearchMode /* …existing… */ } from "./types";
```

> Verify `this.saveSettings()` exists on the plugin (it is used elsewhere for settings persistence). If the method has a different name, use the existing one — grep `saveSettings\|saveData` in `src/main.ts`.

- [ ] **Step 4: Type-check + full suite**

Run: `bun run build`
Expected: tsc passes, `main.js` emitted.
Run: `bun test`
Expected: all tests pass (engine, highlight, ui, plus the pre-existing suite).

- [ ] **Step 5: Commit**

```bash
git add src/search-view.ts src/search-modal.ts src/main.ts
git commit -m "refactor(search): views become thin shells over SearchPanel + persist default mode"
```

---

### Task 9: Styles

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Add styles**

Append to `styles.css` (use existing CSS variables, no `!important`):

```css
.engram-search-mode-toggle {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.engram-search-mode-btn {
  flex: 1;
  padding: 0.25rem 0.5rem;
  font-size: var(--font-ui-small);
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-muted);
  border-radius: var(--radius-s);
  cursor: pointer;
}

.engram-search-mode-btn.is-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-color: var(--interactive-accent);
}

.engram-search-hl {
  background: var(--text-highlight-bg);
  border-radius: var(--radius-s);
}
```

- [ ] **Step 2: Verify style lints + build**

Run: `bun run build`
Expected: build passes.
Run (if present in package.json scripts): `bun run lint:css`
Expected: no errors. (Per project rule, run `lint:obsidian`, `lint:css`, and biome locally before pushing — they are CI-only.)

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style(search): mode toggle + match-highlight styling"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full test + build + lints**

```bash
bun test
bun run build
bun run lint:obsidian
bun run lint:css
bunx biome check .
```

Expected: all green. Fix any failure at its root — do not suppress.

- [ ] **Step 2: Manual smoke (note for the human/operator)**

In a dev vault with the plugin loaded: open the sidebar and the modal, switch Semantic / Keyword / Hybrid, confirm keyword works offline (stop the backend), confirm highlight ranges land on matched terms, confirm a folder + tag filter narrows results, and confirm a result with a heading opens at that heading.

- [ ] **Step 3: Finish the branch**

Use `superpowers:finishing-a-development-branch` to open the PR (`Closes #113`), bump the plugin version once per the per-PR rule, and update the README "Two ways to find anything" section to document keyword/hybrid search (the spec's out-of-scope note defers the README to ship-time — do it here as part of the PR).

---

## Self-Review

**Spec coverage:**
- Local keyword (no backend `mode`) → Tasks 3–4. ✓
- Semantic unchanged backend → Task 3. ✓
- Hybrid note-level RRF + degrade → Task 5. ✓
- `SearchMode` / `UnifiedSearchResult` types → Task 1. ✓
- Dedupe two views into shared panel → Tasks 7–8. ✓
- Match highlighting (fuzzy ranges + semantic token fallback) → Tasks 6–7. ✓
- Tag filter UI (backend tags + local metadataCache) → Tasks 4, 7. ✓
- Jump to heading → Task 7 (`headingAnchor` + `openResult`). ✓
- Settings default mode + persistence → Tasks 1, 8. ✓
- Error handling (degrade notice, semantic-fail message, per-file skip) → Tasks 4, 5, 7. ✓
- Tests (engine ordering/filters/RRF/degrade/highlight) → Tasks 3–6. ✓
- README follow-up → Task 10. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `SearchMode`, `UnifiedSearchResult`, `SearchContext`, `SearchOpts`, `SearchDeps`, `SearchOutcome`, `SearchPanelOpts` are defined in Tasks 1/3/7 and used consistently. `searchEngram(mode, query, ctx, opts, deps)` signature is identical across all call sites and tests. `prepareFuzzySearch` import resolves via Task 2. ✓
