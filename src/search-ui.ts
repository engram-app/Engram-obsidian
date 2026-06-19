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

const MODES: { mode: SearchMode; label: string }[] = [
	{ mode: "hybrid", label: "Hybrid" },
	{ mode: "semantic", label: "Semantic" },
	{ mode: "keyword", label: "Keyword" },
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
	private selectedTags: string[] = [];
	private tagChipsEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private previewEl: HTMLElement | null = null;
	private toggleEl!: HTMLElement;
	private debounceTimer: number | null = null;
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
		for (const { mode, label } of MODES) {
			const btn = this.toggleEl.createEl("button", {
				text: label,
				cls: `engram-search-mode-btn${mode === this.mode ? " is-active" : ""}`,
			});
			btn.addEventListener("click", () => this.setMode(mode));
		}

		this.folderEl = parent.createEl("input", {
			type: "text",
			placeholder: "Filter by folder…",
			cls: "engram-search-input engram-search-folder-input",
		});
		this.tagChipsEl = parent.createDiv({ cls: "engram-search-tag-chips" });
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
		this.renderTagChips();

		parent.createEl("hr", { cls: "engram-search-divider" });

		const inputWrap = parent.createDiv({ cls: "engram-search-input-wrap" });
		const iconEl = inputWrap.createSpan({ cls: "engram-search-input-icon" });
		setIcon(iconEl, "search");
		this.inputEl = inputWrap.createEl("input", {
			type: "text",
			placeholder: "Search your vault…",
			cls: "engram-search-input",
		});

		this.resultsEl = parent.createDiv({ cls: "engram-search-results" });
		if (this.opts.withPreview) {
			this.previewEl = parent.createDiv({ cls: "engram-search-preview" });
		}
		this.renderEmpty();

		this.scheduleHandler = () => {
			if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
			this.debounceTimer = window.setTimeout(() => void this.run(), 300);
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
				this.openSelected();
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
		this.opts.onModeChange?.(mode);
		void this.run();
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
			const chip = this.tagChipsEl.createSpan({ cls: "engram-search-tag-chip" });
			chip.createSpan({ text: `#${tag}`, cls: "engram-search-tag-chip-label" });
			const remove = chip.createSpan({ cls: "engram-search-tag-chip-remove", text: "×" });
			remove.setAttribute("aria-label", `Remove tag ${tag}`);
			remove.addEventListener("click", () => this.removeTag(tag));
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
		const ranges = result.matchRanges?.length
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
			if (result.origin === "semantic") {
				header.createEl("span", {
					text: `${(result.score * 100).toFixed(0)}%`,
					cls: "engram-search-result-score",
				});
			}
			const lastSlash = result.source_path.lastIndexOf("/");
			const folder = lastSlash > 0 ? result.source_path.slice(0, lastSlash) : "";
			if (folder) {
				item.createEl("span", { text: folder, cls: "engram-search-result-path" });
			}
			const snippetEl = item.createEl("p", { cls: "engram-search-result-snippet" });
			this.highlightInto(snippetEl, result, query);

			item.addEventListener("click", () => {
				this.selectedIndex = i;
				this.updateSelection(query);
			});
			item.addEventListener("dblclick", () => this.openResult(result));
		});
		const selected = this.results[this.selectedIndex];
		if (selected && this.previewEl) this.renderPreview(selected, query);
	}

	/**
	 * Move the selection highlight + preview WITHOUT rebuilding the list DOM.
	 * Toggles `is-selected` on the existing item elements (keeps focus / native
	 * behaviour intact and avoids re-attaching every per-item listener).
	 */
	private updateSelection(query: string): void {
		this.resultsEl.querySelectorAll(".engram-search-result-item").forEach((el, i) => {
			el.classList.toggle("is-selected", i === this.selectedIndex);
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
		this.updateSelection(this.inputEl.value.trim());
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
	}
}
