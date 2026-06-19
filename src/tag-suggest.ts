/**
 * Tag filter autocomplete for the search panel. The two exported functions are
 * pure and UI-free (unit-tested); `TagInputSuggest` wires them into Obsidian's
 * native suggestion popover.
 */
import { AbstractInputSuggest, type App } from "obsidian";

/** Suggestions for the active (last, comma-separated) fragment of the tag input,
 *  excluding tags already chosen earlier in the field. Case-insensitive substring. */
export function tagSuggestions(allTags: string[], inputValue: string): string[] {
	const parts = inputValue.split(",");
	const fragment = (parts[parts.length - 1] ?? "").trim().replace(/^#/, "").toLowerCase();
	const chosen = new Set(
		parts
			.slice(0, -1)
			.map((p) => p.trim().replace(/^#/, "").toLowerCase())
			.filter(Boolean),
	);
	return allTags
		.filter((t) => {
			const lc = t.replace(/^#/, "").toLowerCase();
			return !chosen.has(lc) && (fragment === "" || lc.includes(fragment));
		})
		.slice(0, 50);
}

/** Replace the active fragment with the picked tag, leaving a trailing ", " to continue. */
export function applyTagSuggestion(inputValue: string, picked: string): string {
	const parts = inputValue.split(",");
	const prior = parts
		.slice(0, -1)
		.map((p) => p.trim())
		.filter(Boolean);
	prior.push(picked.replace(/^#/, ""));
	return `${prior.join(", ")}, `;
}

/** Obsidian-native suggestion popover for the tag filter input. */
export class TagInputSuggest extends AbstractInputSuggest<string> {
	private getAllVaultTags: () => string[];
	private onPick: () => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		getAllVaultTags: () => string[],
		onPick: () => void,
	) {
		super(app, inputEl);
		this.getAllVaultTags = getAllVaultTags;
		this.onPick = onPick;
	}

	protected getSuggestions(query: string): string[] {
		return tagSuggestions(this.getAllVaultTags(), query);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(`#${value.replace(/^#/, "")}`);
	}

	selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
		const input = this.getValue();
		this.setValue(applyTagSuggestion(input, value));
		this.onPick();
		this.close();
	}
}
