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
});
