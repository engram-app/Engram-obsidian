// tests/crdt-reading-view.test.ts
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { CrdtReadingView } from "../src/crdt/live/reading-view";

/** Minimal fake view object (opaque; CrdtReadingView uses it only as a WeakMap key). */
function fakeView(): object {
	return {};
}

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
