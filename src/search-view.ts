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
		return "brain-circuit";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("engram-search-view-container");
		this.panel = new SearchPanel(
			this.contentEl,
			{ api: this.api, app: this.app },
			{
				withPreview: true,
				defaultMode: this.defaultMode,
				onModeChange: this.onModeChange,
			},
		);
	}

	async onClose(): Promise<void> {
		this.panel?.destroy();
		this.panel = null;
	}
}
