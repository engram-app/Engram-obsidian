/**
 * Shared base for the search panel's autocomplete popovers. Holds the one piece
 * both the tag and folder suggesters need beyond AbstractInputSuggest: matching
 * the dropdown width to its input.
 */
import { AbstractInputSuggest, type App } from "obsidian";

export abstract class WidthMatchedInputSuggest<T> extends AbstractInputSuggest<T> {
	protected inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	/** Match the dropdown width to the input so it spans the panel instead of
	 *  sizing to its content. `suggestEl` is an Obsidian internal — the guard keeps
	 *  this a harmless no-op if that property ever changes. */
	open(): void {
		super.open();
		const el = (this as unknown as { suggestEl?: HTMLElement }).suggestEl;
		if (el) el.style.width = `${this.inputEl.offsetWidth}px`;
	}
}
