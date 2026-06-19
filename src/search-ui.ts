/**
 * Shared search panel mounted by both the sidebar view and the quick modal.
 * Owns input, mode toggle, filters, results list, keyboard nav, highlight,
 * and open / jump-to-heading. UI-only — search logic lives in search-engine.ts.
 */
import { Notice, getAllTags, setIcon } from "obsidian";
import { type SearchContext, searchEngram } from "./search-engine";
import { buildSegments, queryTokenRanges } from "./search-highlight";
import { TagInputSuggest } from "./tag-suggest";
import type { SearchMode, UnifiedSearchResult } from "./types";

const KEYWORD_DEBOUNCE_MS = 200;
const REMOTE_DEBOUNCE_MS = 550;

const MODES: { mode: SearchMode; label: string; hint: string; tooltip: string }[] = [
	{
		mode: "hybrid",
		label: "Hybrid",
		hint: "Blends meaning + exact words — best for most searches.",
		tooltip: "Blends meaning + exact words — best default",
	},
	{
		mode: "semantic",
		label: "Semantic",
		hint: "Finds notes by meaning, even if they don't share your words.",
		tooltip: "Find by meaning (AI search)",
	},
	{
		mode: "keyword",
		label: "Keyword",
		hint: "Matches exact words and phrases. Works offline.",
		tooltip: "Exact words & phrases — works offline",
	},
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
		this.mode = opts.defaultMode;
		this.build(parent);
	}

	private build(parent: HTMLElement): void {
		parent.addClass("engram-search-panel");

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
		// One-line, always-visible explanation of the selected mode (teaches new users).
		this.hintEl = parent.createDiv({ cls: "engram-search-mode-hint" });
		this.updateHint();

		this.folderEl = parent.createEl("input", {
			type: "text",
			placeholder: "Filter by folder…",
			cls: "engram-search-input engram-search-folder-input",
		});
		this.tagEl = parent.createEl("input", {
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

		parent.createEl("hr", { cls: "engram-search-divider" });

		const inputWrap = parent.createDiv({ cls: "engram-search-input-wrap" });
		const iconEl = inputWrap.createSpan({ cls: "engram-search-input-icon" });
		setIcon(iconEl, "search");
		this.inputEl = inputWrap.createEl("input", {
			type: "text",
			placeholder: "Search your vault…",
			cls: "engram-search-input",
		});

		// Active tag filters render under the search box, above the results.
		this.tagChipsEl = parent.createDiv({ cls: "engram-search-tag-chips" });
		this.renderTagChips();

		this.resultsEl = parent.createDiv({ cls: "engram-search-results" });
		this.renderEmpty();

		this.scheduleHandler = () => {
			if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
			const delay = this.mode === "keyword" ? KEYWORD_DEBOUNCE_MS : REMOTE_DEBOUNCE_MS;
			this.debounceTimer = window.setTimeout(() => void this.run(), delay);
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
		if (info) this.hintEl.setText(info.hint);
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
		this.tagEl.focus();
		void this.run();
	}

	private removeTag(tag: string): void {
		this.selectedTags = this.selectedTags.filter((t) => t !== tag);
		this.renderTagChips();
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
		this.results.forEach((result, i) => {
			const item = this.resultsEl.createDiv({
				cls: `engram-search-result-item${i === this.selectedIndex ? " is-selected" : ""}`,
			});
			const header = item.createDiv({ cls: "engram-search-result-header" });
			header.createEl("span", {
				text: result.title || result.source_path || "Untitled",
				cls: "engram-search-result-title",
			});
			// Provenance chip — only in hybrid mode, where match type is meaningful.
			if (this.mode === "hybrid" && result.matchType) {
				const chip = header.createSpan({
					cls: `engram-search-match engram-search-match-${result.matchType}`,
				});
				const icon = chip.createSpan({ cls: "engram-search-match-icon" });
				setIcon(
					icon,
					result.matchType === "keyword"
						? "case-sensitive"
						: result.matchType === "both"
							? "layers"
							: "sparkles",
				);
				chip.createSpan({
					text:
						result.matchType === "keyword"
							? "exact"
							: result.matchType === "both"
								? "meaning + exact"
								: "meaning",
				});
			}
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

			item.addEventListener("click", () => this.openResult(result));
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
		if (result) this.openResult(result);
	}

	private headingAnchor(headingPath?: string): string {
		if (!headingPath) return "";
		const last = headingPath.split(">").pop()?.trim();
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
		this.opts.onResultOpened?.();
	}
}
