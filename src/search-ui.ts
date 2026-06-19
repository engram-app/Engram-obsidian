/**
 * Shared search panel mounted by both the sidebar view and the quick modal.
 * Owns input, mode toggle, filters, results list, keyboard nav, highlight,
 * and open / jump-to-heading. UI-only — search logic lives in search-engine.ts.
 */
import { Notice, type TFile, getAllTags, prepareSimpleSearch, setIcon } from "obsidian";
import { FolderInputSuggest } from "./folder-suggest";
import { type SearchContext, matchStrengths, searchEngram } from "./search-engine";
import { buildSegments, queryTokenRanges } from "./search-highlight";
import { TagInputSuggest } from "./tag-suggest";
import type { SearchMode, UnifiedSearchResult } from "./types";

const SEARCH_DEBOUNCE_MS = 550;

const MODES: { mode: SearchMode; label: string; icon: string; hint: string; tooltip: string }[] = [
	{
		mode: "hybrid",
		label: "Hybrid",
		// Icons mirror the result provenance pills so the hint teaches the same vocabulary.
		icon: "layers",
		hint: "Blends meaning and exact words. Best for most searches.",
		tooltip: "Blends meaning + exact words — best default",
	},
	{
		mode: "semantic",
		label: "Semantic",
		icon: "sparkles",
		hint: "Finds notes by meaning, even when they don't share your words.",
		tooltip: "Find by meaning (AI search)",
	},
	// No standalone "keyword" mode: Obsidian's core Search does pure keyword
	// better (operators, context, regex), and Hybrid already covers exact words
	// (and degrades to keyword-only when the backend is offline). The keyword
	// engine still powers Hybrid's fusion — it's just not a user-facing toggle.
];

export interface SearchPanelOpts {
	defaultMode: SearchMode;
	/** Persist a mode change (e.g. write to plugin settings). */
	onModeChange?: (mode: SearchMode) => void;
	/** Called after a result is opened (e.g. so the modal can close itself). */
	onResultOpened?: () => void;
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
	private toggleEl!: HTMLElement;
	private hintEl!: HTMLElement;
	private filtersEl!: HTMLElement;
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

	constructor(parent: HTMLElement, ctx: SearchContext, opts: SearchPanelOpts) {
		this.ctx = ctx;
		this.opts = opts;
		// Coerce a persisted mode that's no longer offered (e.g. an old "keyword"
		// default) to the first available mode so the toggle always has an active button.
		this.mode = MODES.some((m) => m.mode === opts.defaultMode)
			? opts.defaultMode
			: (MODES[0]?.mode ?? "hybrid");
		this.build(parent);
	}

	private build(parent: HTMLElement): void {
		parent.addClass("engram-search-panel");

		// ── Search row (first item): the query input with an in-field clear button,
		//    plus a filters toggle — mirroring Obsidian's native .search-row.
		const searchRow = parent.createDiv({ cls: "engram-search-row" });
		const inputWrap = searchRow.createDiv({ cls: "engram-search-input-wrap" });
		this.inputEl = inputWrap.createEl("input", {
			type: "search",
			placeholder: "Search your vault…",
			cls: "engram-search-input",
		});
		this.clearEl = inputWrap.createSpan({ cls: "engram-search-clear clickable-icon" });
		setIcon(this.clearEl, "x");
		this.clearEl.setAttribute("aria-label", "Clear search");
		this.clearEl.addEventListener("click", () => {
			this.inputEl.value = "";
			this.inputEl.focus();
			void this.run();
			this.reflectInputState();
		});
		this.filterToggleEl = searchRow.createSpan({
			cls: "engram-search-filter-toggle clickable-icon",
		});
		setIcon(this.filterToggleEl, "sliders-horizontal");
		this.filterToggleEl.setAttribute("aria-label", "Toggle filters");
		this.filterToggleEl.addEventListener("click", () => this.toggleFilters());

		// ── Search type (Hybrid / Semantic) + its one-line explainer.
		this.toggleEl = parent.createDiv({ cls: "engram-search-mode-toggle" });
		for (const { mode, label, tooltip } of MODES) {
			const btn = this.toggleEl.createEl("button", {
				text: label,
				cls: `engram-search-mode-btn${mode === this.mode ? " is-active" : ""}`,
			});
			// Obsidian renders a tooltip for any element carrying aria-label.
			btn.setAttribute("aria-label", tooltip);
			btn.addEventListener("click", () => this.setMode(mode));
		}
		this.hintEl = parent.createDiv({ cls: "engram-search-mode-hint" });
		this.updateHint();

		// ── Filters panel — collapsed by default, revealed by the filters toggle
		//    (mirrors native's .search-params hidden behind the settings icon).
		this.filtersEl = parent.createDiv({ cls: "engram-search-filters is-hidden" });
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

		this.resultsEl = parent.createDiv({ cls: "engram-search-results" });
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
	}

	private setMode(mode: SearchMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		const btns = this.toggleEl.querySelectorAll(".engram-search-mode-btn");
		btns.forEach((b, i) => {
			const m = MODES[i];
			if (m && m.mode === mode) b.classList.add("is-active");
			else b.classList.remove("is-active");
		});
		this.updateHint();
		this.opts.onModeChange?.(mode);
		void this.run();
	}

	private updateHint(): void {
		const info = MODES.find((m) => m.mode === this.mode);
		if (!info) return;
		this.hintEl.empty();
		const icon = this.hintEl.createSpan({ cls: "engram-search-mode-hint-icon" });
		setIcon(icon, info.icon);
		this.hintEl.createEl("strong", {
			cls: "engram-search-mode-hint-label",
			text: info.label,
		});
		this.hintEl.appendText(` — ${info.hint}`);
	}

	private toggleFilters(): void {
		this.filtersOpen = !this.filtersOpen;
		this.filtersEl.toggleClass("is-hidden", !this.filtersOpen);
		this.filterToggleEl.toggleClass("is-active", this.filtersOpen);
		if (this.filtersOpen) this.folderEl.focus();
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

	private renderResults(query: string): void {
		this.resultsEl.empty();
		if (!this.results.length) {
			this.resultsEl.createEl("p", { text: "No results found", cls: "engram-search-empty" });
			return;
		}
		// Relative strength across the displayed set — drives the per-result bar.
		const strengths = matchStrengths(this.results.map((r) => r.score));
		this.results.forEach((result, i) => {
			const item = this.resultsEl.createDiv({
				cls: `engram-search-result-item${i === this.selectedIndex ? " is-selected" : ""}`,
			});
			const header = item.createDiv({ cls: "engram-search-result-header" });
			header.createEl("span", {
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
				item.createEl("div", {
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
			el.classList.toggle("is-selected", i === this.selectedIndex);
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
		} catch {
			return null;
		}
		const res = prepareSimpleSearch(query)(content);
		if (!res || !res.matches.length) return null;
		return { content, matches: res.matches };
	}
}
