/**
 * Smoke test for the shared SearchPanel UI.
 *
 * SearchPanel renders via Obsidian's HTMLElement extensions (createDiv /
 * createEl / addClass …). This repo does NOT patch real jsdom/happy-dom
 * elements with those extensions (the existing render tests build their own
 * FakeEl tree adapters instead), and Bun's runtime has no `document` global
 * at all. So this smoke test self-skips when those extensions are unavailable;
 * the panel is fully exercised by the Obsidian E2E suite.
 */
import { describe, expect, it } from "bun:test";
import { SearchPanel } from "../src/search-ui";

const canRender =
	typeof document !== "undefined" &&
	typeof (document.createElement("div") as unknown as { createDiv?: unknown }).createDiv ===
		"function";

(canRender ? describe : describe.skip)("SearchPanel", () => {
	it("renders Hybrid + Semantic, coercing a retired keyword default to Hybrid", () => {
		const parent = document.createElement("div");
		const ctx = {
			api: { search: async () => ({ query: "", results: [] }) } as never,
			app: {} as never,
		};
		const panel = new SearchPanel(parent, ctx, {
			// "keyword" is no longer a user-facing mode; it must fall back gracefully.
			defaultMode: "keyword",
		});
		const buttons = parent.querySelectorAll(".engram-search-mode-btn");
		expect(buttons.length).toBe(2);
		expect(parent.querySelector(".engram-search-mode-btn.is-active")?.textContent).toBe(
			"Hybrid",
		);
		panel.destroy();
	});
});
