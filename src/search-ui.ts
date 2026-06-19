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
		parent.addClass("engram-search-panel");

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
			const snippetEl = item.createEl("p", { cls: "engram-search-result-snippet" });
			this.highlightInto(snippetEl, result, query);

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
