import { describe, it, expect } from "bun:test";
import * as Y from "yjs";
import { reconcileEditorToYText } from "../src/crdt/live/ycollab-binding";

describe("reconcileEditorToYText", () => {
  it("returns [] when editor already equals ytext", () => {
    const d = new Y.Doc();
    const t = d.getText("content");
    t.insert(0, "hello");
    expect(reconcileEditorToYText("hello", t)).toEqual([]);
  });
  it("produces changes to bring an empty editor up to ytext content", () => {
    const d = new Y.Doc();
    const t = d.getText("content");
    t.insert(0, "note body");
    const changes = reconcileEditorToYText("", t);
    // applying the changes to "" must yield "note body"
    let s = "";
    let adj = 0;
    for (const c of changes) {
      s = s.slice(0, c.from + adj) + c.insert + s.slice(c.to + adj);
      adj += c.insert.length - (c.to - c.from);
    }
    expect(s).toBe("note body");
  });
});
