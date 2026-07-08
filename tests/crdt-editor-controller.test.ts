// tests/crdt-editor-controller.test.ts
import { describe, expect, it, mock } from "bun:test";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { EditorController } from "../src/crdt/live/editor-controller";

function fakeView() {
	return {
		dispatch: mock((_spec: unknown) => {}),
		state: { doc: { toString: () => "" } },
	} as any;
}

function deps(ytextByPath: Record<string, Y.Text>, calls: string[]) {
	const aw = new Awareness(new Y.Doc());
	return {
		getYText: async (p: string) => ytextByPath[p],
		awareness: () => aw,
		onBind: (p: string, id: string) => calls.push(`bind:${p}:${id}`),
		onRelease: (p: string, id: string) => calls.push(`release:${p}:${id}`),
	};
}

describe("EditorController", () => {
	it("binds a view to a path (refcount bind, dispatch reconfigure)", async () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		t.insert(0, "x");
		const calls: string[] = [];
		const c = new EditorController(deps({ "a.md": t }, calls));
		const v = fakeView();
		await c.bindTo(v, "a.md");
		expect(c.currentPath()).toBe("a.md");
		expect(calls.some((s) => s.startsWith("bind:a.md:"))).toBe(true);
		expect(v.dispatch).toHaveBeenCalled();
	});

	it("rebinds to a new path on the same view: releases old, binds new", async () => {
		const d = new Y.Doc();
		const ta = d.getText("a");
		const tb = d.getText("b");
		const calls: string[] = [];
		const c = new EditorController(deps({ "a.md": ta, "b.md": tb }, calls));
		const v = fakeView();
		await c.bindTo(v, "a.md");
		await c.bindTo(v, "b.md");
		expect(c.currentPath()).toBe("b.md");
		expect(calls.some((s) => s.startsWith("release:a.md:"))).toBe(true);
		expect(calls.some((s) => s.startsWith("bind:b.md:"))).toBe(true);
	});

	it("is idempotent for the same (view,path)", async () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const calls: string[] = [];
		const c = new EditorController(deps({ "a.md": t }, calls));
		const v = fakeView();
		await c.bindTo(v, "a.md");
		await c.bindTo(v, "a.md");
		expect(calls.filter((s) => s.startsWith("bind:a.md:")).length).toBe(1);
	});

	it("release clears the path and fires onRelease", async () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const calls: string[] = [];
		const c = new EditorController(deps({ "a.md": t }, calls));
		const v = fakeView();
		await c.bindTo(v, "a.md");
		c.release(v);
		expect(c.currentPath()).toBe(null);
		expect(calls.some((s) => s.startsWith("release:a.md:"))).toBe(true);
	});

	it("rebind ordering: release old path before bind new path", async () => {
		const d = new Y.Doc();
		const ta = d.getText("a");
		const tb = d.getText("b");
		const calls: string[] = [];
		const c = new EditorController(deps({ "a.md": ta, "b.md": tb }, calls));
		const v = fakeView();
		await c.bindTo(v, "a.md");
		calls.length = 0; // clear initial calls
		await c.bindTo(v, "b.md");
		const releaseIdx = calls.findIndex((s) => s.startsWith("release:a.md:"));
		const bindIdx = calls.findIndex((s) => s.startsWith("bind:b.md:"));
		expect(releaseIdx).toBeGreaterThanOrEqual(0);
		expect(bindIdx).toBeGreaterThanOrEqual(0);
		expect(releaseIdx).toBeLessThan(bindIdx);
	});

	it("release() during pending bindTo: no onBind, no dispatch after release", async () => {
		const d = new Y.Doc();
		const ta = d.getText("a");
		let resolveB!: (t: Y.Text) => void;
		const deferredB = new Promise<Y.Text>((res) => {
			resolveB = res;
		});
		const tb = d.getText("b");
		const calls: string[] = [];
		const dispatchCalls: unknown[][] = [];
		const deferredDeps = {
			getYText: async (p: string) => {
				if (p === "b.md") return deferredB;
				return ta;
			},
			awareness: () => new Awareness(new Y.Doc()),
			onBind: (p: string, id: string) => calls.push(`bind:${p}:${id}`),
			onRelease: (p: string, id: string) => calls.push(`release:${p}:${id}`),
		};
		const c = new EditorController(deferredDeps);
		const v = {
			dispatch: mock((...a: unknown[]) => {
				dispatchCalls.push(a);
			}),
			state: { doc: { toString: () => "" } },
		} as any;
		// Bind to a.md first so the controller is in a bound state
		await c.bindTo(v, "a.md");
		calls.length = 0;
		dispatchCalls.length = 0;
		// Start bindTo b.md (will await deferred getYText)
		const bindPromise = c.bindTo(v, "b.md");
		// release() before getYText resolves
		c.release(v);
		expect(c.currentPath()).toBe(null);
		// Now resolve the deferred getYText
		resolveB(tb);
		await bindPromise;
		// After release was called, onBind must NOT have fired for b.md
		expect(calls.some((s) => s.startsWith("bind:b.md:"))).toBe(false);
		// dispatch must NOT have been called for the b.md reconfigure (after release)
		// (The release() dispatch to clear compartment is fine; no NEW reconfigure for b.md)
		const reconfigureCallsForB = dispatchCalls.filter((args) =>
			JSON.stringify(args).includes("b.md"),
		);
		expect(reconfigureCallsForB.length).toBe(0);
	});

	it("getYText rejection on rebind: editor left UNBOUND (never stale-bound), refcount balanced", async () => {
		// Semantic flip from the original invariant ("old binding untouched"):
		// keeping the old ySync attached across a failed rebind is exactly the
		// window where Obsidian's setViewData lands the NEW file's content into
		// the OLD note's Y.Text (2026-07-07/05 cross-file pollution). A failed
		// rebind must leave the editor unbound (safe: no live sync until the next
		// refresh) rather than bound to the wrong note (data loss).
		const d = new Y.Doc();
		const ta = d.getText("a");
		const calls: string[] = [];
		const rejectDeps = {
			getYText: async (p: string) => {
				if (p === "b.md") throw new Error("getYText failed");
				return ta;
			},
			awareness: () => new Awareness(new Y.Doc()),
			onBind: (p: string, id: string) => calls.push(`bind:${p}:${id}`),
			onRelease: (p: string, id: string) => calls.push(`release:${p}:${id}`),
		};
		const c = new EditorController(rejectDeps);
		const v = fakeView();
		await c.bindTo(v, "a.md");
		expect(c.currentPath()).toBe("a.md");
		calls.length = 0;
		try {
			await c.bindTo(v, "b.md");
		} catch {
			// expected rejection
		}
		expect(c.currentPath()).toBe(null); // unbound, not stale-bound
		expect(calls.filter((s) => s.startsWith("release:a.md:")).length).toBe(1); // refcount balanced
		expect(calls.some((s) => s.startsWith("bind:b.md:"))).toBe(false);
	});

	it("bindTo detaches the old binding SYNCHRONOUSLY, before awaiting getYText", async () => {
		// THE pollution window: while bindTo awaits getYText(newPath), Obsidian's
		// loadFileInternal completes and setViewData replaces the whole editor doc
		// with the NEW file's content. If the OLD note's ySync is still attached,
		// it applies that replacement to the OLD note's Y.Text and syncs it up
		// (2026-07-07 content landing in 2026-07-05). The old binding must be gone
		// before the first await — an unbound gap is safe, a stale-bound gap eats
		// the next file's content. (Relay never lets a binding span a load:
		// __relayLoading in their loadFileInternal patch.)
		const d = new Y.Doc();
		const ta = d.getText("a");
		const tb = d.getText("b");
		let resolveB!: (t: Y.Text) => void;
		const deferredB = new Promise<Y.Text>((res) => {
			resolveB = res;
		});
		const calls: string[] = [];
		const dispatches: unknown[] = [];
		const c = new EditorController({
			getYText: async (p: string) => (p === "b.md" ? deferredB : ta),
			awareness: () => new Awareness(new Y.Doc()),
			onBind: (p: string, id: string) => calls.push(`bind:${p}:${id}`),
			onRelease: (p: string, id: string) => calls.push(`release:${p}:${id}`),
		});
		const v = {
			dispatch: mock((spec: unknown) => {
				dispatches.push(spec);
			}),
			state: { doc: { toString: () => "" } },
		} as any;
		await c.bindTo(v, "a.md");
		calls.length = 0;
		dispatches.length = 0;
		const pending = c.bindTo(v, "b.md"); // do NOT resolve getYText yet
		// Old binding must already be detached — synchronously, before any await
		// completed: refcount released AND the compartment cleared via dispatch.
		expect(calls.filter((s) => s.startsWith("release:a.md:")).length).toBe(1);
		expect(dispatches.length).toBe(1);
		expect(c.currentPath()).toBe(null);
		resolveB(tb);
		await pending;
		expect(c.currentPath()).toBe("b.md");
		expect(calls.some((s) => s.startsWith("bind:b.md:"))).toBe(true);
	});

	it("overlapping bindTo calls: the LATEST path wins even when an earlier call resolves later", async () => {
		// User switches a.md -> b.md -> c.md fast enough that refresh() fires two
		// bindTo calls while the first still awaits getYText. If the stale b.md
		// bind is allowed to complete after c.md's, the view shows c.md but the
		// controller syncs b.md's Y.Text — same stale-binding pollution class.
		const d = new Y.Doc();
		const ta = d.getText("a");
		const tb = d.getText("b");
		const tc = d.getText("c");
		let resolveB!: (t: Y.Text) => void;
		let resolveC!: (t: Y.Text) => void;
		const deferredB = new Promise<Y.Text>((res) => {
			resolveB = res;
		});
		const deferredC = new Promise<Y.Text>((res) => {
			resolveC = res;
		});
		const calls: string[] = [];
		const c = new EditorController({
			getYText: async (p: string) => {
				if (p === "b.md") return deferredB;
				if (p === "c.md") return deferredC;
				return ta;
			},
			awareness: () => new Awareness(new Y.Doc()),
			onBind: (p: string, id: string) => calls.push(`bind:${p}:${id}`),
			onRelease: (p: string, id: string) => calls.push(`release:${p}:${id}`),
		});
		const v = fakeView();
		await c.bindTo(v, "a.md");
		const pendingB = c.bindTo(v, "b.md");
		const pendingC = c.bindTo(v, "c.md");
		// The stale bind resolves LAST — it must abort, not clobber c.md.
		resolveC(tc);
		resolveB(tb);
		await Promise.all([pendingB, pendingC]);
		expect(c.currentPath()).toBe("c.md");
		expect(calls.some((s) => s.startsWith("bind:b.md:"))).toBe(false);
	});

	it("drift check releases the binding when the view no longer shows the bound path", async () => {
		// Relay's view-identity guard (their view.file check): if Obsidian swapped
		// the file in this view and the rebind was missed, the 3s drift repair
		// would paint the OLD note's content into the VISIBLE new file (the
		// "keeps reverting" symptom). It must instead release and let refresh()
		// re-bind — never dispatch into a view showing a different path.
		const d = new Y.Doc();
		const ta = d.getText("a");
		ta.insert(0, "note A content");
		let shown: string | null = "a.md";
		const calls: string[] = [];
		const dispatches: unknown[] = [];
		const c = new EditorController({
			getYText: async () => ta,
			awareness: () => new Awareness(new Y.Doc()),
			onBind: (p: string, id: string) => calls.push(`bind:${p}:${id}`),
			onRelease: (p: string, id: string) => calls.push(`release:${p}:${id}`),
			viewPath: () => shown,
			driftIntervalMs: 5,
		});
		const v = {
			dispatch: mock((spec: unknown) => {
				dispatches.push(spec);
			}),
			// Buffer shows note B's content — drifted from ta on purpose.
			state: { doc: { toString: () => "note B content" } },
		} as any;
		await c.bindTo(v, "a.md");
		calls.length = 0;
		dispatches.length = 0;
		shown = "b.md"; // Obsidian swapped the file; no rebind happened
		await new Promise((res) => setTimeout(res, 30)); // let the drift timer fire
		expect(c.currentPath()).toBe(null); // released itself instead of repairing
		expect(calls.filter((s) => s.startsWith("release:a.md:")).length).toBe(1);
		// Exactly one dispatch: the compartment clear. NO repair changes.
		expect(dispatches.length).toBe(1);
		expect(JSON.stringify(dispatches[0])).not.toContain("note A content");
	});
});
