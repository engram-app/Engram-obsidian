/**
 * Shared search panel mounted by both the sidebar view and the quick modal.
 * Owns input, mode toggle, filters, results list, keyboard nav, highlight,
 * and open / jump-to-heading. UI-only — search logic lives in search-engine.ts.
 */
import { getAllTags, Notice, prepareSimpleSearch, setIcon, type TFile } from "obsidian";
import { FolderInputSuggest } from "./folder-suggest";
import { matchStrengths, type SearchContext, searchEngram } from "./search-engine";
import { buildSegments, queryTokenRanges } from "./search-highlight";
import { TagInputSuggest } from "./tag-suggest";
import type { SearchMode, UnifiedSearchResult } from "./types";

const SEARCH_DEBOUNCE_MS = 550;

// All three modes are selectable now. Keyword was withheld because the only
// keyword implementation was a local fuzzy scan, which Obsidian core Search
// genuinely does better. That argument died when keyword moved to the server:
// the backend stems and scores with BM25, so it answers a question core Search
// cannot.
//
// Both sits in the MIDDLE because it is the default and the one most people
// should stay on. Reading left to right the row is also a spectrum — literal
// words, then words plus meaning, then meaning alone — so the middle position
// is the honest one for the mode that spans both ends, not just the prominent
// one.
export const SELECTABLE_MODES: SearchMode[] = ["keyword", "hybrid", "semantic"];

/** Every panel opens here, every time.
 *
 *  Mode changes used to persist to a `searchDefaultMode` setting, so the picker
 *  reopened wherever it was last left. That reads as the panel having silently
 *  changed its own default: a user who tried Keyword once got keyword-flavoured
 *  results days later with no memory of having chosen it, and the widest mode
 *  is the right place to start a search from. The switch is one click away and
 *  lasts as long as the panel is open, which is the lifetime that matches how
 *  the choice is actually made. */
export const DEFAULT_SEARCH_MODE: SearchMode = "hybrid";

// Named for what the user is asking FOR, not for the retrieval technique.
const MODE_LABEL: Record<SearchMode, string> = {
	keyword: "Keyword",
	semantic: "Semantic",
	hybrid: "Both",
};

// Each hint names the one thing that mode does which the others do not, in the
// user's terms. "BM25", "vector" and "RRF" are the right words for the code and
// the wrong ones for a person deciding which button to press.
//
// Phrased to complete "<Mode>: ..." — the hint is rendered with its label so it
// is unmistakably describing the selected button rather than the filters under
// it. Without that prefix it read as a stray sentence in a settings panel.
const MODE_HINT: Record<SearchMode, string> = {
	keyword: "matches your words and their other forms — 'run' finds 'running' — plus this device.",
	semantic: "matches meaning. Finds notes that never use the words you typed.",
	hybrid: "matches words and meaning together, plus this device. Widest results.",
};

/** The hint line for `mode`, labelled so it visibly belongs to the buttons. */
function modeHintText(mode: SearchMode): string {
	return `${MODE_LABEL[mode]} ${MODE_HINT[mode]}`;
}

export interface SearchPanelOpts {
	/** Called after a result is opened (e.g. so the modal can close itself). */
	onResultOpened?: () => void;
	/** Current `indexed_notes_cap` from plan state, or null when uncapped.
	 *  A getter, not a value: plan state arrives over the WebSocket and can
	 *  change while the panel is open. */
	indexedNotesCap?: () => number | null;
}

/**
 * The "not everything is searchable" line, or null when it should stay quiet.
 *
 * Notes past the plan's indexed-note cap sync normally but are not searchable.
 * Without this the only signal is an empty result list, which reads as "search
 * is broken" rather than "this note isn't indexed" — and because the cap keeps
 * the OLDEST notes, the ones that fall outside it are the user's newest work,
 * which is the opposite of what anyone expects.
 *
 * Split out from the renderer because the panel only renders under Obsidian's
 * HTMLElement extensions, which the unit suite does not have.
 */
export function capHintText(cap: number | null, total: number): string | null {
	if (unsearchableCount(cap, total) === 0) return null;
	return `Searching ${(cap as number).toLocaleString()} of ${total.toLocaleString()} notes. Upgrade to search everything.`;
}

/**
 * How many notes are synced but NOT searchable. Zero means say nothing.
 *
 * The single place the "is there anything to report" rule lives, so the search
 * panel and the Sync Center cannot drift into disagreeing about whether the
 * user is over their cap. `null` is an uncapped plan; a NEGATIVE cap is the
 * backend's "unlimited" sentinel and must never be read as a literal cap of -1,
 * which would claim every note is unsearchable on the most permissive plan.
 */
export function unsearchableCount(cap: number | null, total: number): number {
	if (cap === null || cap < 0) return 0;
	return Math.max(0, total - cap);
}

export class SearchPanel {
	private ctx: SearchContext;
	private opts: SearchPanelOpts;
	private mode: SearchMode;
	private inputEl!: HTMLInputElement;
	private folderEl!: HTMLInputElement;
	private tagEl!: HTMLInputElement;
	private selectedTags: string[] = [];
	private tagChipsEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private filtersEl!: HTMLElement;
	/** The segmented mode buttons, so a change can move `is-active` without
	 *  re-rendering the panel (which would drop the query and focus). */
	private modeBtns = new Map<SearchMode, HTMLElement>();
	private modeHintEl?: HTMLElement;
	private filterToggleEl!: HTMLElement;
	private clearEl!: HTMLElement;
	private filtersOpen = false;
	private debounceTimer: number | null = null;
	private lastRunQuery = "";
	private results: UnifiedSearchResult[] = [];
	private selectedIndex = -1;
	/** Bumped on every run() so a slow earlier search can't clobber a newer render. */
	private runGeneration = 0;
	private scheduleHandler!: () => void;
	private keydownHandler!: (e: KeyboardEvent) => void;
	private tagKeydownHandler!: (e: KeyboardEvent) => void;
	private clearHandler!: () => void;
	private filterToggleHandler!: () => void;

	constructor(parent: HTMLElement, ctx: SearchContext, opts: SearchPanelOpts) {
		this.ctx = ctx;
		this.opts = opts;
		// Always the default, never a remembered choice — see DEFAULT_SEARCH_MODE.
		this.mode = DEFAULT_SEARCH_MODE;
		this.build(parent);
	}

	private build(parent: HTMLElement): void {
		parent.addClass("engram-search-panel");

		// ── Search row (first item): a leading magnifier, the query input with an
		//    in-field clear button, and a settings toggle — mirroring native .search-row.
		const searchRow = parent.createDiv({ cls: "engram-search-row" });
		const inputWrap = searchRow.createDiv({ cls: "engram-search-input-wrap" });
		const iconEl = inputWrap.createSpan({ cls: "engram-search-input-icon" });
		setIcon(iconEl, "search");
		this.inputEl = inputWrap.createEl("input", {
			type: "search",
			placeholder: "Search your vault…",
			cls: "engram-search-input",
		});
		this.clearEl = inputWrap.createSpan({ cls: "engram-search-clear clickable-icon" });
		setIcon(this.clearEl, "x");
		this.clearEl.setAttribute("aria-label", "Clear search");
		this.clearHandler = () => {
			this.inputEl.value = "";
			this.inputEl.focus();
			void this.run();
			this.reflectInputState();
		};
		this.clearEl.addEventListener("click", this.clearHandler);
		this.filterToggleEl = searchRow.createSpan({
			cls: "engram-search-filter-toggle clickable-icon",
		});
		setIcon(this.filterToggleEl, "sliders-horizontal");
		this.filterToggleEl.setAttribute("aria-label", "Search settings");
		this.filterToggleHandler = () => this.toggleFilters();
		this.filterToggleEl.addEventListener("click", this.filterToggleHandler);

		// ── Settings panel — collapsed by default, revealed by the settings toggle
		//    (mirrors native's .search-params hidden behind the settings icon). Holds
		//    the search-type toggle and the folder / tag filters.
		this.filtersEl = parent.createDiv({ cls: "engram-search-filters is-hidden" });
		// Segmented control, not a dropdown: three mutually exclusive options
		// where the current one should be readable without opening anything, and
		// switching between them is the point of the control.
		const modeRow = this.filtersEl.createDiv({ cls: "engram-search-mode" });
		for (const m of SELECTABLE_MODES) {
			const btn = modeRow.createEl("button", {
				cls: "engram-search-mode-btn",
				text: MODE_LABEL[m],
			});
			btn.setAttribute("aria-label", modeHintText(m));
			if (m === this.mode) btn.addClass("is-active");
			btn.addEventListener("click", () => this.setMode(m));
			this.modeBtns.set(m, btn);
		}
		const hintRow = this.filtersEl.createDiv({ cls: "engram-search-mode-hint" });
		// A leading icon, so the line reads as an annotation on the control above
		// rather than as another setting in the stack.
		setIcon(hintRow.createSpan({ cls: "engram-search-mode-hint-icon" }), "info");
		this.modeHintEl = hintRow.createSpan({ cls: "engram-search-mode-hint-text" });
		this.modeHintEl.setText(modeHintText(this.mode));
		this.folderEl = this.filtersEl.createEl("input", {
			type: "text",
			placeholder: "Filter by folder…",
			cls: "engram-search-input engram-search-folder-input",
		});
		new FolderInputSuggest(
			this.ctx.app,
			this.folderEl,
			() => this.collectVaultFolders(),
			() => {
				void this.run();
			},
		);
		// Active tag filters sit above the tag input so the suggestion dropdown
		// (which drops below the input) never covers them.
		this.tagChipsEl = this.filtersEl.createDiv({ cls: "engram-search-tag-chips" });
		this.renderTagChips();
		this.tagEl = this.filtersEl.createEl("input", {
			type: "text",
			placeholder: "Filter by tags…",
			cls: "engram-search-input engram-search-tag-input",
		});
		new TagInputSuggest(
			this.ctx.app,
			this.tagEl,
			() => this.collectVaultTags(),
			() => this.selectedTags,
			(tag) => this.addTag(tag),
		);

		// No divider rule. Each result row already carries its own border and the
		// list scrolls as its own block, so the line drew a boundary the layout
		// had made twice over.
		const resultsSection = parent.createDiv({ cls: "engram-search-results-section" });
		this.resultsEl = resultsSection.createDiv({ cls: "engram-search-results" });
		this.renderEmpty();

		this.scheduleHandler = () => {
			this.reflectInputState();
			if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
			this.debounceTimer = window.setTimeout(() => void this.run(), SEARCH_DEBOUNCE_MS);
		};
		this.inputEl.addEventListener("input", this.scheduleHandler);
		this.folderEl.addEventListener("input", this.scheduleHandler);

		this.tagKeydownHandler = (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === ",") {
				const raw = this.tagEl.value.trim().replace(/^#/, "").replace(/,$/, "").trim();
				if (raw) {
					e.preventDefault();
					this.addTag(raw);
					this.tagEl.value = "";
				}
			}
		};
		this.tagEl.addEventListener("keydown", this.tagKeydownHandler);

		this.keydownHandler = (e) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				this.moveSelection(1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				this.moveSelection(-1);
			} else if (e.key === "Enter") {
				e.preventDefault();
				const q = this.inputEl.value.trim();
				if (q && q !== this.lastRunQuery) {
					if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
					void this.run();
				} else {
					this.openSelected();
				}
			}
		};
		this.inputEl.addEventListener("keydown", this.keydownHandler);
	}

	focus(): void {
		this.inputEl.focus();
	}

	destroy(): void {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		// Invalidate any in-flight run() so a late resolve can't touch detached DOM.
		this.runGeneration++;
		this.inputEl.removeEventListener("input", this.scheduleHandler);
		this.folderEl.removeEventListener("input", this.scheduleHandler);
		this.tagEl.removeEventListener("keydown", this.tagKeydownHandler);
		this.inputEl.removeEventListener("keydown", this.keydownHandler);
		this.clearEl.removeEventListener("click", this.clearHandler);
		this.filterToggleEl.removeEventListener("click", this.filterToggleHandler);
	}

	private setMode(mode: SearchMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		for (const [m, btn] of this.modeBtns) btn.toggleClass("is-active", m === mode);
		this.modeHintEl?.setText(modeHintText(mode));
		void this.run();
	}

	private toggleFilters(): void {
		this.filtersOpen = !this.filtersOpen;
		this.filtersEl.toggleClass("is-hidden", !this.filtersOpen);
		this.filterToggleEl.toggleClass("is-active", this.filtersOpen);
	}

	/** Reflect transient input state in the chrome: show the clear button when the
	 *  query is non-empty, and mark the filters toggle when a folder/tag filter is
	 *  active (so applied filters aren't invisible while the panel is collapsed). */
	private reflectInputState(): void {
		this.clearEl.toggleClass("is-visible", this.inputEl.value.length > 0);
		const hasFilters = this.folderEl.value.trim().length > 0 || this.selectedTags.length > 0;
		this.filterToggleEl.toggleClass("has-filters", hasFilters);
	}

	private parseTags(): string[] | undefined {
		return this.selectedTags.length ? [...this.selectedTags] : undefined;
	}

	private addTag(tag: string): void {
		const clean = tag.replace(/^#/, "").trim();
		if (!clean) return;
		const exists = this.selectedTags.some((t) => t.toLowerCase() === clean.toLowerCase());
		if (!exists) this.selectedTags.push(clean);
		this.renderTagChips();
		this.reflectInputState();
		this.tagEl.focus();
		void this.run();
	}

	private removeTag(tag: string): void {
		this.selectedTags = this.selectedTags.filter((t) => t !== tag);
		this.renderTagChips();
		this.reflectInputState();
		void this.run();
	}

	private renderTagChips(): void {
		this.tagChipsEl.empty();
		for (const tag of this.selectedTags) {
			// The whole chip is the remove target (the × is just an affordance).
			const chip = this.tagChipsEl.createSpan({ cls: "engram-search-tag-chip" });
			chip.createSpan({ text: `#${tag}`, cls: "engram-search-tag-chip-label" });
			chip.createSpan({ cls: "engram-search-tag-chip-remove", text: "×" });
			chip.setAttribute("aria-label", `Remove tag ${tag}`);
			chip.addEventListener("click", () => this.removeTag(tag));
		}
	}

	private collectVaultTags(): string[] {
		const set = new Set<string>();
		for (const file of this.ctx.app.vault.getMarkdownFiles()) {
			const cache = this.ctx.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			for (const t of getAllTags(cache) ?? []) set.add(t.replace(/^#/, ""));
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}

	/** Distinct note-bearing folder paths (each ancestor included) for the folder
	 *  filter dropdown. Derived from file paths so we only ever suggest folders
	 *  that actually contain notes the prefix filter can match. */
	private collectVaultFolders(): string[] {
		const set = new Set<string>();
		for (const file of this.ctx.app.vault.getMarkdownFiles()) {
			const slash = file.path.lastIndexOf("/");
			if (slash <= 0) continue; // root-level note — no folder to filter on
			let dir = file.path.slice(0, slash);
			while (dir) {
				set.add(dir);
				const s = dir.lastIndexOf("/");
				dir = s > 0 ? dir.slice(0, s) : "";
			}
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}

	private async run(): Promise<void> {
		const gen = ++this.runGeneration;
		const query = this.inputEl.value.trim();
		if (!query) {
			this.lastRunQuery = "";
			this.results = [];
			this.selectedIndex = -1;
			this.renderEmpty();
			return;
		}
		this.lastRunQuery = query;
		try {
			const outcome = await searchEngram(this.mode, query, this.ctx, {
				limit: 10,
				folder: this.folderEl.value.trim() || undefined,
				tags: this.parseTags(),
			});
			// A newer run() (or destroy) superseded us — discard this stale result.
			if (gen !== this.runGeneration) return;
			if (outcome.degraded) {
				new Notice("Semantic offline — keyword results only");
			}
			this.results = outcome.results;
			this.selectedIndex = this.results.length ? 0 : -1;
			this.renderResults(query);
		} catch (e) {
			if (gen !== this.runGeneration) return;
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram search failed", e);
			this.resultsEl.empty();
			this.resultsEl.createEl("p", {
				text: "Search failed — check connection",
				cls: "engram-search-empty",
			});
		}
	}

	private renderEmpty(): void {
		this.resultsEl.empty();
		this.resultsEl.createEl("p", {
			text: "Type to search your vault",
			cls: "engram-search-empty",
		});
	}

	private highlightInto(el: HTMLElement, result: UnifiedSearchResult, query: string): void {
		// Recompute whole-word query-term ranges against the displayed excerpt so
		// every mode (semantic included) highlights matched terms in the snippet.
		for (const seg of buildSegments(result.text, queryTokenRanges(result.text, query))) {
			if (seg.hit) {
				el.createSpan({ text: seg.text, cls: "engram-search-hl" });
			} else {
				el.appendText(seg.text);
			}
		}
	}

	private renderCapHint(): void {
		const text = capHintText(
			this.opts.indexedNotesCap?.() ?? null,
			this.ctx.app.vault?.getMarkdownFiles?.().length ?? 0,
		);
		if (text === null) return;
		this.resultsEl.createEl("p", { text, cls: "engram-search-cap-hint" });
	}

	private renderResults(query: string): void {
		this.resultsEl.empty();
		if (!this.results.length) {
			this.resultsEl.createEl("p", { text: "No results found", cls: "engram-search-empty" });
			this.renderCapHint();
			return;
		}
		this.renderCapHint();
		// Relative strength across the displayed set — drives the per-result bar.
		const strengths = matchStrengths(this.results.map((r) => r.score));
		this.results.forEach((result, i) => {
			const item = this.resultsEl.createDiv({
				cls: `engram-search-result-item${i === this.selectedIndex ? " is-selected" : ""}`,
			});
			const header = item.createDiv({ cls: "engram-search-result-header" });
			header.createSpan({
				text: result.title || result.source_path || "Untitled",
				cls: "engram-search-result-title",
			});
			// Meta row (its own line): provenance pill (hybrid only) + match strength.
			const meta = item.createDiv({ cls: "engram-search-result-meta" });
			if (this.mode === "hybrid" && result.matchType) {
				const pill = meta.createSpan({
					cls: `engram-search-match engram-search-match-${result.matchType}`,
				});
				const icon = pill.createSpan({ cls: "engram-search-match-icon" });
				setIcon(
					icon,
					result.matchType === "keyword"
						? "case-sensitive"
						: result.matchType === "both"
							? "layers"
							: "sparkles",
				);
				pill.createSpan({
					text:
						result.matchType === "keyword"
							? "exact"
							: result.matchType === "both"
								? "meaning + exact"
								: "meaning",
				});
			}
			const pct = strengths[i] ?? 100;
			const strength = meta.createSpan({ cls: "engram-search-strength" });
			const bar = strength.createSpan({ cls: "engram-search-strength-bar" });
			bar.createSpan({ cls: "engram-search-strength-fill" }).style.width = `${pct}%`;
			strength.createSpan({
				cls: "engram-search-strength-label",
				text: `match strength: ${pct}%`,
			});
			// Context line: folder · heading-trail (heading-trail drops the note title).
			const parts: string[] = [];
			const lastSlash = result.source_path.lastIndexOf("/");
			if (lastSlash > 0) parts.push(result.source_path.slice(0, lastSlash));
			if (result.heading_path) {
				const trail = result.heading_path
					.split(">")
					.slice(1)
					.map((s) => s.trim())
					.filter(Boolean)
					.join(" › ");
				if (trail) parts.push(trail);
			}
			if (parts.length) {
				item.createDiv({
					text: parts.join(" · "),
					cls: "engram-search-result-path",
				});
			}
			const snippetEl = item.createEl("p", { cls: "engram-search-result-snippet" });
			this.highlightInto(snippetEl, result, query);

			item.addEventListener("click", () => void this.openResult(result));
		});
	}

	/**
	 * Move the selection highlight WITHOUT rebuilding the list DOM. Toggles
	 * `is-selected` on the existing item elements (keeps focus / native
	 * behaviour intact and avoids re-attaching every per-item listener).
	 */
	private updateSelection(): void {
		this.resultsEl.querySelectorAll(".engram-search-result-item").forEach((el, i) => {
			const selected = i === this.selectedIndex;
			el.classList.toggle("is-selected", selected);
			// Keep the highlighted row visible — the list scrolls, so arrowing past
			// the fold would otherwise move the selection off-screen.
			if (selected) (el as HTMLElement).scrollIntoView({ block: "nearest" });
		});
	}

	private moveSelection(delta: number): void {
		if (!this.results.length) return;
		this.selectedIndex = Math.max(
			0,
			Math.min(this.results.length - 1, this.selectedIndex + delta),
		);
		this.updateSelection();
	}

	private openSelected(): void {
		const result = this.results[this.selectedIndex];
		if (result) void this.openResult(result);
	}

	private headingAnchor(headingPath?: string): string {
		if (!headingPath) return "";
		const last = headingPath.split(">").pop()?.trim();
		return last ? `#${last}` : "";
	}

	private async openResult(result: UnifiedSearchResult): Promise<void> {
		if (!result.source_path) {
			new Notice("No source path for this result");
			return;
		}
		const file = this.ctx.app.vault.getFileByPath(result.source_path);
		if (!file) {
			new Notice("Note not synced locally");
			return;
		}
		// Lift Obsidian's own global-search behaviour: open the note with an
		// ephemeral `match` state so the editor scrolls to and flash-highlights the
		// matched text. prepareSimpleSearch returns ranges in the exact SearchMatches
		// format the `match` state expects, against the same content we hand back.
		const match = await this.buildMatchState(file);
		if (match) {
			await this.ctx.app.workspace.getLeaf(false).openFile(file, { eState: { match } });
		} else {
			// No literal term hit (pure semantic-by-meaning): jump to the heading instead.
			const linktext = `${result.source_path}${this.headingAnchor(result.heading_path)}`;
			await this.ctx.app.workspace.openLinkText(linktext, "");
		}
		this.opts.onResultOpened?.();
	}

	/** Compute the native `match` ephemeral state (full content + matched ranges)
	 *  for the current query, or null when there's no literal term hit to jump to. */
	private async buildMatchState(
		file: TFile,
	): Promise<{ content: string; matches: [number, number][] } | null> {
		const query = this.lastRunQuery.trim();
		if (!query) return null;
		let content: string;
		try {
			content = await this.ctx.app.vault.cachedRead(file);
		} catch (e) {
			// Best-effort jump-to-match; caller falls back to a plain heading open.
			// Log so a real read failure isn't mistaken for "no match found".
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.warn("Engram search: could not read note for match highlight", file.path, e);
			return null;
		}
		const res = prepareSimpleSearch(query)(content);
		if (!res?.matches.length) return null;
		return { content, matches: res.matches };
	}
}
