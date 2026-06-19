# Plugin Search: Semantic / Keyword / Hybrid — Design

**Issue:** engram-app/Engram-obsidian #113 — *Expose keyword/hybrid search in the plugin*
**Date:** 2026-06-19
**Status:** Approved (brainstorming), pending implementation plan

## Problem

The plugin's search is semantic-only and "technically working but not flushed out":

- `src/api.ts` `search()` sends only `query`/`limit`/`tags`/`folder` — backend defaults to `:vector` (semantic).
- `src/search-view.ts` (sidebar) and `src/search-modal.ts` (command/hotkey) are ~95% duplicated.
- No way to do an exact/keyword lookup, no match highlighting, the `tags` filter has no UI, and results always open at the note top (never the matched heading).

## Deviation from the issue (deliberate)

Issue #113's scope line says "add `mode` to `search()` + `SearchRequest`" so the plugin can call the backend's hybrid endpoint (engram-app/Engram #595, Qdrant sparse + RRF). **We are not doing that.** Keyword search runs **locally** against the vault's own markdown files, which are already on disk.

Rationale:
- Source files are local — keyword matching needs no network round-trip and no embedding/quota cost.
- **Keyword and the keyword half of Hybrid keep working offline.** Only Semantic needs the backend.
- Avoids coupling the plugin to a backend search-protocol revision.

Therefore the plugin **never sends `mode` to the backend**. `SearchRequest`/`api.search()` are left semantic-only. This deviation is recorded so the issue's original scope-line does not mislead later.

## Modes

| Mode | Source | Granularity | Offline |
|------|--------|-------------|---------|
| **Semantic** | Backend `POST /search` (unchanged) | Chunk (per `heading_path`) | No |
| **Keyword** | Local vault files via Obsidian fuzzy search | Note (file) | Yes |
| **Hybrid** | Both, fused client-side | Note (collapsed) | Degrades to Keyword-only |

## Architecture

Split the current fused logic+DOM into a **pure engine** and a **shared UI panel**. This is what makes the feature testable and removes the duplication in one move.

### `src/search-engine.ts` (pure, UI-free)

Single entry point:

```ts
type SearchMode = "semantic" | "keyword" | "hybrid";

interface SearchContext { api: EngramApi; app: App; }
interface SearchOpts { limit?: number; folder?: string; tags?: string[]; }

async function searchEngram(
  mode: SearchMode,
  query: string,
  ctx: SearchContext,
  opts: SearchOpts,
): Promise<UnifiedSearchResult[]>;
```

Internals:

- **semantic** — `ctx.api.search(query, limit, tags, folder)` → map each `SearchResult` chunk to a `UnifiedSearchResult` (`origin: "semantic"`, keep `heading_path`, `score`, snippet from `text`). No match ranges.
- **keyword** — enumerate markdown files (`ctx.app.vault.getMarkdownFiles()`), filter by `folder` (path prefix) and `tags` (via `metadataCache`), `cachedRead` each, score with Obsidian `prepareFuzzySearch(query)`:
  - Run the scorer against the **title** (boosted) and the **body**; take the better of the two.
  - Keep top `limit` by score (descending — Obsidian fuzzy scores are higher = better).
  - Build a snippet around the first body match offset; carry the match ranges for highlighting.
  - `origin: "keyword"`, no `heading_path`.
- **hybrid** — run semantic + keyword concurrently:
  - Collapse semantic chunks to the **best chunk per `source_path`**.
  - **RRF fuse** the two ranked note-lists on `source_path`: `score = Σ 1/(k + rankᵢ)`, `k = 60` (same constant the backend #595 hybrid uses).
  - For a fused note, prefer the **keyword** snippet + match ranges (so highlighting works); fall back to the semantic chunk snippet + `heading_path` when only semantic matched.
  - `origin: "hybrid"`.
  - **If the backend call fails**, degrade to keyword-only results and signal the caller (so the UI can surface a notice).

### `src/search-ui.ts` (shared DOM + interaction)

```ts
class SearchPanel {
  constructor(parentEl: HTMLElement, ctx: SearchContext, opts: { withPreview: boolean });
  // owns: input, mode toggle, folder filter, tag filter, results list,
  //       keyboard nav, highlight rendering, open / jump-to-heading
  destroy(): void; // clears debounce timer, detaches
}
```

- **Mode toggle** — segmented control (Semantic | Keyword | Hybrid) at the top. Default mode is read from / written to plugin settings.
- **Debounce** — 300ms, matching current behavior.
- **Keyboard nav** — ArrowUp/Down/Enter, matching current behavior.
- **Preview pane** — rendered only when `withPreview` is true (sidebar yes, modal no — matches today).

### Thin shells

- `SearchView` (sidebar `ItemView`) → build container, `new SearchPanel(el, ctx, { withPreview: true })`, `destroy()` on close.
- `SearchModal` (`Modal`) → build container, `new SearchPanel(el, ctx, { withPreview: false })`, `destroy()` + `close()` on open-result.

Both lose their duplicated search/render/nav code.

## New types (`src/types.ts`)

```ts
type SearchMode = "semantic" | "keyword" | "hybrid";

interface UnifiedSearchResult {
  source_path: string;
  title?: string;
  text: string;            // snippet
  heading_path?: string;   // semantic / hybrid-semantic side only
  score: number;
  origin: SearchMode;
  matchRanges?: [number, number][]; // offsets into `text`, for highlight
}
```

`SearchRequest` and `SearchResult` are unchanged (no backend `mode`).

## Polish items (all four in scope)

1. **Mode toggle** — segmented control; default persisted to settings.
2. **Match highlighting** — keyword/hybrid wrap match ranges in `<span class="engram-search-hl">`; semantic falls back to case-insensitive query-token highlighting in the snippet.
3. **Tag filter** — UI input/chips. Backend gets `tags` (already supported). Local keyword filters candidate files via `metadataCache` tags. In hybrid, applies to both halves.
4. **Jump to heading** — when `heading_path` is present, open `source_path#<last heading segment>` (via `openLinkText`); otherwise open the note top.

## Settings

- `searchDefaultMode: SearchMode` (default `"semantic"`) — persisted; sets the toggle's initial state.

## Error handling

- **Hybrid + backend down** → degrade to keyword-only, `Notice("Semantic offline — keyword results only")`.
- **Semantic-only + backend down** → existing "Search failed — check connection" message.
- **Per-file read error (keyword)** → skip that file, continue (never abort the whole search).

## Testing (TDD)

Unit tests for `search-engine.ts` (bun test, mirroring existing plugin test style), mocking `app.vault.cachedRead`, `app.metadataCache`, and `api.search`:

- keyword: ordering by score, title boost, folder filter, tag filter, snippet + match-range construction.
- semantic: chunk → `UnifiedSearchResult` mapping.
- hybrid: RRF math / note-level collapse, keyword-snippet preference, **degrade-on-backend-error** path.
- pure highlight-range builder (offsets → spans), including the semantic query-token fallback.

UI gets a light render smoke test (panel mounts, toggle switches mode, results render). Keyboard nav and existing behaviors are preserved.

## Out of scope

- Backend `mode` parameter / server-side hybrid wiring (explicitly replaced by local keyword).
- README "Two ways to find anything" update — track as a follow-up once this ships (the README was kept semantic-only on purpose in #111 to stay truthful).
- Ranking sophistication beyond Obsidian's fuzzy scorer (e.g. BM25).
