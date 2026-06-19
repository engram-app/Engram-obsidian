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
	it("puts the search input first and tucks filters behind the settings toggle", () => {
		const parent = document.createElement("div");
		const ctx = {
			api: { search: async () => ({ query: "", results: [] }) } as never,
			app: {} as never,
		};
		const panel = new SearchPanel(parent, ctx, {
			// "keyword" is no longer a user-facing mode; it must fall back gracefully.
			defaultMode: "keyword",
		});
		// Search row is the first child; the filters panel is hidden by default.
		expect(parent.firstElementChild?.classList.contains("engram-search-row")).toBe(true);
		expect(parent.querySelector('.engram-search-row input[type="search"]')).not.toBeNull();
		expect(
			parent.querySelector(".engram-search-filters")?.classList.contains("is-hidden"),
		).toBe(true);
		panel.destroy();
	});
});
