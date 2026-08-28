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
	private indexedNotesCap?: () => number | null;
	private panel: SearchPanel | null = null;

	constructor(
		app: App,
		api: EngramApi,
		defaultMode: SearchMode,
		onModeChange: (mode: SearchMode) => void,
		indexedNotesCap?: () => number | null,
	) {
		super(app);
		this.api = api;
		this.defaultMode = defaultMode;
		this.onModeChange = onModeChange;
		this.indexedNotesCap = indexedNotesCap;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("engram-search-modal");
		this.panel = new SearchPanel(
			contentEl,
			{ api: this.api, app: this.app },
			{
				defaultMode: this.defaultMode,
				onModeChange: this.onModeChange,
				indexedNotesCap: this.indexedNotesCap,
				onResultOpened: () => this.close(),
			},
		);
		this.panel.focus();
	}

	onClose(): void {
		this.panel?.destroy();
		this.panel = null;
		this.contentEl.empty();
	}
}
