import { describe, expect, it } from "bun:test";
import { patchPreviewEdit } from "../src/crdt/live/obsidian-internals";

/** A stand-in for Obsidian's MarkdownView: the reading view applies an in-preview
 *  edit (checkbox toggle) by calling `previewMode.edit(fullText)`. */
function fakeView(mode: string) {
	const originalCalls: string[] = [];
	return {
		originalCalls,
		getMode: () => mode,
		previewMode: {
			edit(data: string) {
				originalCalls.push(data);
			},
		},
	};
}

describe("patchPreviewEdit", () => {
	it("routes a preview-mode edit to the consumer and skips Obsidian's own write", () => {
		const view = fakeView("preview");
		const seen: string[] = [];
		const unpatch = patchPreviewEdit(view, (data) => {
			seen.push(data);
			return true;
		});

		expect(unpatch).not.toBeNull();
		view.previewMode.edit("- [x] done");
		expect(seen).toEqual(["- [x] done"]);
		// The direct-to-disk write must NOT also run, or it races the CRDT write.
		expect(view.originalCalls).toEqual([]);
	});

	it("falls through to Obsidian when the consumer declines (no editor pane bound)", () => {
		const view = fakeView("preview");
		expect(patchPreviewEdit(view, () => false)).not.toBeNull();

		view.previewMode.edit("- [x] done");
		expect(view.originalCalls).toEqual(["- [x] done"]);
	});

	it("falls through when the view is NOT in preview mode", () => {
		const view = fakeView("source");
		let consumed = 0;
		patchPreviewEdit(view, () => {
			consumed++;
			return true;
		});

		view.previewMode.edit("body");
		expect(consumed).toBe(0);
		expect(view.originalCalls).toEqual(["body"]);
	});

	it("falls through when the consumer throws (a hook failure never breaks editing)", () => {
		const view = fakeView("preview");
		patchPreviewEdit(view, () => {
			throw new Error("boom");
		});

		expect(() => view.previewMode.edit("- [x] done")).not.toThrow();
		expect(view.originalCalls).toEqual(["- [x] done"]);
	});

	it("restores the original edit on unpatch", () => {
		const view = fakeView("preview");
		const original = view.previewMode.edit;
		const unpatch = patchPreviewEdit(view, () => true);
		expect(view.previewMode.edit).not.toBe(original);

		unpatch?.();
		expect(view.previewMode.edit).toBe(original);
		view.previewMode.edit("after");
		expect(view.originalCalls).toEqual(["after"]);
	});

	it("returns null (no patch) when the internals are not the expected shape", () => {
		// previewMode/edit/getMode are undocumented Obsidian internals — a shape
		// change must degrade to "no hook", never throw.
		expect(patchPreviewEdit({}, () => true)).toBeNull();
		expect(patchPreviewEdit({ getMode: () => "preview" }, () => true)).toBeNull();
		expect(
			patchPreviewEdit({ getMode: () => "preview", previewMode: {} }, () => true),
		).toBeNull();
		// previewMode present but no getMode to tell us the mode.
		expect(patchPreviewEdit({ previewMode: { edit: () => {} } }, () => true)).toBeNull();
	});
});
