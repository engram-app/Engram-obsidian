import { describe, it, expect } from "bun:test";
import * as Y from "yjs";
import { yDeltaToChangeSpec, applyCmChangesToYText } from "../src/crdt/live/cm-yjs-bridge";

describe("yDeltaToChangeSpec", () => {
  it("maps insert at offset 0", () => {
    expect(yDeltaToChangeSpec([{ insert: "abc" }])).toEqual([{ from: 0, to: 0, insert: "abc" }]);
  });
  it("maps retain then insert", () => {
    expect(yDeltaToChangeSpec([{ retain: 2 }, { insert: "X" }])).toEqual([
      { from: 2, to: 2, insert: "X" },
    ]);
  });
  it("maps retain then delete", () => {
    expect(yDeltaToChangeSpec([{ retain: 1 }, { delete: 3 }])).toEqual([
      { from: 1, to: 4, insert: "" },
    ]);
  });
});

describe("applyCmChangesToYText", () => {
  it("applies an insert into the Y.Text", () => {
    const doc = new Y.Doc();
    const t = doc.getText("content");
    t.insert(0, "hello");
    applyCmChangesToYText(t, [{ fromA: 5, toA: 5, insert: " world" }]);
    expect(t.toJSON()).toBe("hello world");
  });
  it("applies a replace (delete + insert) with offset adjustment", () => {
    const doc = new Y.Doc();
    const t = doc.getText("content");
    t.insert(0, "hello");
    // replace "ello" (1..5) with "i", then insert "!" at original end (5)
    applyCmChangesToYText(t, [
      { fromA: 1, toA: 5, insert: "i" },
      { fromA: 5, toA: 5, insert: "!" },
    ]);
    expect(t.toJSON()).toBe("hi!");
  });
});
