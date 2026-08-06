// tests/crdt-frontmatter-hook.test.ts
//
// CONTRACT: the CONTENT Y.Text the hook writes into is BODY-ONLY (note-seed
// seeds it with splitFrontmatter(content).body; the live binding maps editor
// offsets past the FM block). view.text at saveFrontmatter time is the FULL
// file text including the `---` block, so the hook must strip the block before
// diffing — diffing the full text in prepends the whole FM block to the body
// Y.Text and broadcasts it (the FM-in-body corruption class).
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { CrdtFrontmatterHook } from "../src/crdt/live/frontmatter-hook";

function fakeView(initialData: string) {
	// patchFrontmatterSave reads view.text (not view.data).
	return {
		file: { path: "n.md" },
		text: initialData,
		saveFrontmatter(next: string) {
			this.text = next; // Obsidian would persist; we just update in-memory.
		},
	};
}

function bodyOnlyYText(body: string): Y.Text {
	const ytext = new Y.Doc().getText("content");
	ytext.insert(0, body);
	return ytext;
}

function hookFor(ytext: Y.Text): CrdtFrontmatterHook {
	return new CrdtFrontmatterHook({
		getPath: (v: any) => v.file.path,
		getYText: async () => ytext,
	});
}

describe("CrdtFrontmatterHook", () => {
	it("does NOT write the frontmatter block into the body-only Y.Text", async () => {
		const ytext = bodyOnlyYText("body");
		const view = fakeView("---\ntags: []\n---\nbody");
		hookFor(ytext).attach(view);
		// Properties edit: only the FM block changes; the body is untouched.
		view.saveFrontmatter("---\ntags: [x]\n---\nbody");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body");
	});

	it("forwards a body change present in the saved text", async () => {
		const ytext = bodyOnlyYText("body");
		const view = fakeView("---\ntags: []\n---\nbody");
		hookFor(ytext).attach(view);
		view.saveFrontmatter("---\ntags: []\n---\nbody edited");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body edited");
	});

	it("handles a save with no frontmatter block at all", async () => {
		const ytext = bodyOnlyYText("body");
		const view = fakeView("body");
		hookFor(ytext).attach(view);
		view.saveFrontmatter("body");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body");
	});

	it("is a safe no-op when the view is not patchable (fallback to disk path)", () => {
		const hook = hookFor(bodyOnlyYText(""));
		// No saveFrontmatter -> patch returns null -> attach must not throw.
		expect(() => hook.attach({ file: { path: "n.md" } })).not.toThrow();
	});

	it("attach() is idempotent: double-attach triggers onSave exactly once", async () => {
		const ytext = bodyOnlyYText("body");
		let onSaveCount = 0;
		const hook = new CrdtFrontmatterHook({
			getPath: (v: any) => v.file.path,
			getYText: async () => {
				onSaveCount++;
				return ytext;
			},
		});
		const view = fakeView("---\ntags: []\n---\nbody");
		hook.attach(view);
		hook.attach(view); // second attach on the same view; must be a no-op
		view.saveFrontmatter("---\ntags: [x]\n---\nbody");
		await Promise.resolve();
		// If attach was not idempotent, getYText would be called twice and the
		// Y.Text would be patched twice (double-apply).
		expect(onSaveCount).toBe(1);
	});

	it("detachAll() uninstalls all attached views", async () => {
		const ytext = bodyOnlyYText("body");
		const hook = hookFor(ytext);
		const view1 = fakeView("---\ntags: []\n---\nbody");
		const view2 = fakeView("---\ntags: []\n---\nbody");
		hook.attach(view1);
		hook.attach(view2);

		// Both attached: a body change from either view updates the Y.Text.
		view1.saveFrontmatter("---\ntags: [a]\n---\nbody a");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body a");

		view2.saveFrontmatter("---\ntags: [b]\n---\nbody b");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body b");

		hook.detachAll();

		view1.saveFrontmatter("---\ntags: [a]\n---\nafter detach 1");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body b");

		view2.saveFrontmatter("---\ntags: [b]\n---\nafter detach 2");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("body b");
	});
});
