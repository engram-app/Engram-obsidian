// tests/crdt-frontmatter-hook.test.ts
import { describe, it, expect } from "bun:test";
import * as Y from "yjs";
import { CrdtFrontmatterHook } from "../src/crdt/live/frontmatter-hook";

function fakeView(initialData: string) {
	// Correction 2: patchFrontmatterSave reads view.text (not view.data).
	// Use `text` field and set `this.text = next` in saveFrontmatter.
	return {
		file: { path: "n.md" },
		text: initialData,
		saveFrontmatter(next: string) {
			this.text = next; // Obsidian would persist; we just update in-memory.
		},
	};
}

describe("CrdtFrontmatterHook", () => {
	it("routes a frontmatter save into the Y.Text", async () => {
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		ytext.insert(0, "---\ntags: []\n---\nbody");
		const hook = new CrdtFrontmatterHook({
			getPath: (v: any) => v.file.path,
			getYText: async () => ytext,
		});
		const view = fakeView("---\ntags: []\n---\nbody");
		hook.attach(view);
		// Simulate Obsidian saving new frontmatter.
		view.saveFrontmatter("---\ntags: [x]\n---\nbody");
		await Promise.resolve();
		expect(ytext.toJSON()).toBe("---\ntags: [x]\n---\nbody");
	});

	it("is a safe no-op when the view is not patchable (fallback to disk path)", () => {
		const hook = new CrdtFrontmatterHook({
			getPath: () => "n.md",
			getYText: async () => new Y.Doc().getText("content"),
		});
		// No saveFrontmatter -> patch returns null -> attach must not throw.
		expect(() => hook.attach({ file: { path: "n.md" } })).not.toThrow();
	});

	it("attach() is idempotent: double-attach triggers onSave exactly once", async () => {
		// FIX 1a: attach the same view twice; the second call must be a no-op.
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		ytext.insert(0, "---\ntags: []\n---\nbody");
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
		// Y.Text would be patched twice (double-apply). onSaveCount captures how
		// many times getYText was invoked via the onSave callback.
		expect(onSaveCount).toBe(1);
	});
});
