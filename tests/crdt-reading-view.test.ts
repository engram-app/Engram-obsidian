// tests/crdt-reading-view.test.ts
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { CrdtReadingView } from "../src/crdt/live/reading-view";

/** Minimal fake view object (opaque; CrdtReadingView uses it only as a WeakMap key). */
function fakeView(): object {
	return {};
}

/** Defaults for the preview-edit capture deps: no editor pane holds the path, so
 *  the hook declines and Obsidian's own write runs (the pre-#6 behavior). */
const noBinding = { isBound: () => false, onEditCaptured: () => {} };

describe("CrdtReadingView", () => {
	it("attach() registers the Y.Text observer exactly once even when called twice", async () => {
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		let observeCount = 0;
		// Wrap observe so we can count registrations.
		const realObserve = ytext.observe.bind(ytext);
		ytext.observe = (fn: Parameters<typeof ytext.observe>[0]) => {
			observeCount++;
			realObserve(fn);
		};

		const view = fakeView();
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			...noBinding,
		});

		await rv.attach(view, "n.md");
		await rv.attach(view, "n.md"); // idempotent: must not double-register

		expect(observeCount).toBe(1);
	});

	it("concurrent attach() calls on the same view register the observer exactly once", async () => {
		// FIX 1b race guard: two attach() calls that both await getYText before
		// either resolves must still produce a single observer registration.
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		let observeCount = 0;
		const realObserve = ytext.observe.bind(ytext);
		ytext.observe = (fn: Parameters<typeof ytext.observe>[0]) => {
			observeCount++;
			realObserve(fn);
		};

		// Both promises resolve at the same tick via Promise.resolve() so neither
		// has returned before the other starts.
		const view = fakeView();
		let resolveA!: (t: Y.Text) => void;
		let resolveB!: (t: Y.Text) => void;
		const promiseA = new Promise<Y.Text>((res) => {
			resolveA = res;
		});
		const promiseB = new Promise<Y.Text>((res) => {
			resolveB = res;
		});
		let callCount = 0;
		const rv = new CrdtReadingView({
			getYText: async () => {
				callCount++;
				return callCount === 1 ? promiseA : promiseB;
			},
			isReadingMode: () => true,
			...noBinding,
		});

		// Launch both attaches before either getYText resolves.
		const p1 = rv.attach(view, "n.md");
		const p2 = rv.attach(view, "n.md");

		// Now let both promises settle.
		resolveA(ytext);
		resolveB(ytext);
		await Promise.all([p1, p2]);

		expect(observeCount).toBe(1);
	});

	it("detach() then re-attach() re-subscribes exactly once", async () => {
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		let observeCount = 0;
		let unobserveCount = 0;
		const realObserve = ytext.observe.bind(ytext);
		const realUnobserve = ytext.unobserve.bind(ytext);
		ytext.observe = (fn: Parameters<typeof ytext.observe>[0]) => {
			observeCount++;
			realObserve(fn);
		};
		ytext.unobserve = (fn: Parameters<typeof ytext.unobserve>[0]) => {
			unobserveCount++;
			realUnobserve(fn);
		};

		const view = fakeView();
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			...noBinding,
		});

		await rv.attach(view, "n.md");
		expect(observeCount).toBe(1);

		rv.detach(view);
		expect(unobserveCount).toBe(1);

		await rv.attach(view, "n.md");
		expect(observeCount).toBe(2); // re-attach re-registers
	});

	it("detachAll() unobserves all attached views", async () => {
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		let observeCount = 0;
		let unobserveCount = 0;
		const realObserve = ytext.observe.bind(ytext);
		const realUnobserve = ytext.unobserve.bind(ytext);
		ytext.observe = (fn: Parameters<typeof ytext.observe>[0]) => {
			observeCount++;
			realObserve(fn);
		};
		ytext.unobserve = (fn: Parameters<typeof ytext.unobserve>[0]) => {
			unobserveCount++;
			realUnobserve(fn);
		};

		// Attach two distinct views.
		const view1 = fakeView();
		const view2 = fakeView();
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			...noBinding,
		});

		await rv.attach(view1, "n1.md");
		await rv.attach(view2, "n2.md");
		expect(observeCount).toBe(2); // two observers registered

		// detachAll should unobserve both.
		rv.detachAll();
		expect(unobserveCount).toBe(2);

		// Verify that mutations no longer trigger the handlers by attaching new views
		// (which would register observers again if the old ones were working).
		await rv.attach(view1, "n1.md");
		expect(observeCount).toBe(3); // fresh observer, not the old one
	});
});

/** A reading view with the internals the preview-edit hook patches. */
function fakePreviewView() {
	const diskWrites: string[] = [];
	return {
		diskWrites,
		getMode: () => "preview",
		previewMode: {
			edit(data: string) {
				diskWrites.push(data);
			},
		},
	};
}

describe("CrdtReadingView — preview-edit capture (#6)", () => {
	it("routes a checkbox toggle into the Y.Text when an editor pane holds the path", async () => {
		// THE BUG: with an editor pane bound, Obsidian's direct write is dropped as
		// binding-owned, so the toggle never reached the Y.Text and got reverted.
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		ytext.insert(0, "- [ ] task\nrest\n");

		const saved: string[] = [];
		const view = fakePreviewView();
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			isBound: () => true,
			onEditCaptured: (p) => saved.push(p),
		});
		await rv.attach(view, "n.md");

		view.previewMode.edit("- [x] task\nrest\n");

		expect(ytext.toJSON()).toBe("- [x] task\nrest\n");
		expect(view.diskWrites).toEqual([]); // Obsidian's own write must not also run
		expect(saved).toEqual(["n.md"]); // and the bound editor gets nudged to save
	});

	it("strips frontmatter before diffing into the body-only Y.Text", async () => {
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		ytext.insert(0, "- [ ] task\n");

		const view = fakePreviewView();
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			isBound: () => true,
			onEditCaptured: () => {},
		});
		await rv.attach(view, "n.md");

		// previewMode.edit hands over the WHOLE file, frontmatter included.
		view.previewMode.edit("---\ntags: [a]\n---\n- [x] task\n");

		expect(ytext.toJSON()).toBe("- [x] task\n");
	});

	it("leaves Obsidian's own write alone when no editor pane holds the path", async () => {
		// Unbound: the disk write lands and the ordinary modify path routes it.
		// Intercepting here would be a second write path for no gain.
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		ytext.insert(0, "- [ ] task\n");

		const view = fakePreviewView();
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			isBound: () => false,
			onEditCaptured: () => {},
		});
		await rv.attach(view, "n.md");

		view.previewMode.edit("- [x] task\n");

		expect(view.diskWrites).toEqual(["- [x] task\n"]);
		expect(ytext.toJSON()).toBe("- [ ] task\n"); // untouched by us
	});

	it("detach() restores Obsidian's original previewMode.edit", async () => {
		const doc = new Y.Doc();
		const ytext = doc.getText("content");
		ytext.insert(0, "- [ ] task\n");

		const view = fakePreviewView();
		const original = view.previewMode.edit;
		const rv = new CrdtReadingView({
			getYText: async () => ytext,
			isReadingMode: () => true,
			isBound: () => true,
			onEditCaptured: () => {},
		});
		await rv.attach(view, "n.md");
		expect(view.previewMode.edit).not.toBe(original);

		rv.detach(view);
		expect(view.previewMode.edit).toBe(original);
	});
});
