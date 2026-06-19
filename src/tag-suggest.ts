/**
 * Tag filter autocomplete for the search panel. `tagSuggestions` is pure and
 * unit-tested; `TagInputSuggest` wires it into Obsidian's native popover.
 */
import { AbstractInputSuggest, type App } from "obsidian";

/** Vault tags matching `fragment` (case-insensitive substring), excluding any
 *  already-selected tag. `#` prefixes are ignored on both sides. */
export function tagSuggestions(allTags: string[], fragment: string, selected: string[]): string[] {
	const frag = fragment.trim().replace(/^#/, "").toLowerCase();
	const chosen = new Set(selected.map((t) => t.replace(/^#/, "").toLowerCase()));
	return allTags
		.filter((t) => {
			const lc = t.replace(/^#/, "").toLowerCase();
			return !chosen.has(lc) && (frag === "" || lc.includes(frag));
		})
		.slice(0, 50);
}

/** Obsidian-native suggestion popover that adds the picked tag as a chip and
 *  immediately re-opens for the next one. */
export class TagInputSuggest extends AbstractInputSuggest<string> {
	private inputEl: HTMLInputElement;
	private getAllVaultTags: () => string[];
	private getSelected: () => string[];
	private onAddTag: (tag: string) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		getAllVaultTags: () => string[],
		getSelected: () => string[],
		onAddTag: (tag: string) => void,
	) {
		super(app, inputEl);
		this.inputEl = inputEl;
		this.getAllVaultTags = getAllVaultTags;
		this.getSelected = getSelected;
		this.onAddTag = onAddTag;
	}

	protected getSuggestions(query: string): string[] {
		return tagSuggestions(this.getAllVaultTags(), query, this.getSelected());
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(`#${value.replace(/^#/, "")}`);
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		this.onAddTag(value);
		this.setValue("");
		// Re-open the popover for the next tag without making the user type again.
		this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
	}
}
