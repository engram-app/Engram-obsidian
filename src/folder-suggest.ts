/**
 * Folder filter autocomplete for the search panel. `folderSuggestions` is pure
 * and unit-tested; `FolderInputSuggest` wires it into Obsidian's native popover.
 */
import { AbstractInputSuggest, type App, setIcon } from "obsidian";

/** Vault folder paths matching `fragment` (case-insensitive substring), capped. */
export function folderSuggestions(allFolders: string[], fragment: string): string[] {
	const frag = fragment.trim().toLowerCase();
	return allFolders.filter((f) => frag === "" || f.toLowerCase().includes(frag)).slice(0, 50);
}

/** Obsidian-native suggestion popover for the single-value folder filter: pick a
 *  folder, drop it into the input, and trigger a search. */
export class FolderInputSuggest extends AbstractInputSuggest<string> {
	private inputEl: HTMLInputElement;
	private getAllFolders: () => string[];
	private onPick: (folder: string) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		getAllFolders: () => string[],
		onPick: (folder: string) => void,
	) {
		super(app, inputEl);
		this.inputEl = inputEl;
		this.getAllFolders = getAllFolders;
		this.onPick = onPick;
	}

	protected getSuggestions(query: string): string[] {
		return folderSuggestions(this.getAllFolders(), query);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.addClass("engram-folder-suggest-item");
		const icon = el.createSpan({ cls: "engram-folder-suggest-icon" });
		setIcon(icon, "folder");
		el.createSpan({ text: value });
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(value);
		this.onPick(value);
		this.close();
	}

	/** Match the dropdown width to the folder input so it spans the panel instead
	 *  of sizing to its content. `suggestEl` is an Obsidian internal — the guard
	 *  keeps this a harmless no-op if that property ever changes. */
	open(): void {
		super.open();
		const el = (this as unknown as { suggestEl?: HTMLElement }).suggestEl;
		if (el) el.style.width = `${this.inputEl.offsetWidth}px`;
	}
}
