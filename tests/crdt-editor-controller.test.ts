// tests/crdt-editor-controller.test.ts
import { describe, it, expect, mock } from "bun:test";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { EditorController } from "../src/crdt/live/editor-controller";

function fakeView() {
  return { dispatch: mock((_spec: unknown) => {}), state: { doc: { toString: () => "" } } } as any;
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
    const deferredB = new Promise<Y.Text>((res) => { resolveB = res; });
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
    const v = { dispatch: mock((...a: unknown[]) => { dispatchCalls.push(a); }), state: { doc: { toString: () => "" } } } as any;
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
    const reconfigureCallsForB = dispatchCalls.filter(
      (args) => JSON.stringify(args).includes("b.md")
    );
    expect(reconfigureCallsForB.length).toBe(0);
  });

  it("getYText rejection on rebind: old binding untouched, refcount balanced", async () => {
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
    expect(c.currentPath()).toBe("a.md"); // path unchanged
    expect(calls.some((s) => s.startsWith("release:a.md:"))).toBe(false); // no release fired
  });
});
