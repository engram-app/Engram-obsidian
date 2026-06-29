import { describe, it, expect } from "bun:test";
import * as Y from "yjs";
import { yDeltaToChangeSpec, applyCmChangesToYText, textDiffToChangeSpec } from "../src/crdt/live/cm-yjs-bridge";

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

/** Inline helper: apply a CmChangeSpec[] against a string, returning the result. */
function applySpec(before: string, specs: { from: number; to: number; insert: string }[]): string {
  let result = before;
  let adj = 0;
  for (const s of specs) {
    result = result.slice(0, s.from + adj) + s.insert + result.slice(s.to + adj);
    adj += s.insert.length - (s.to - s.from);
  }
  return result;
}

describe("textDiffToChangeSpec", () => {
  it("returns [] when before === after", () => {
    expect(textDiffToChangeSpec("hello", "hello")).toEqual([]);
  });

  it("pure insert at end", () => {
    const specs = textDiffToChangeSpec("hello", "hello world");
    expect(specs.length).toBeGreaterThan(0);
    expect(applySpec("hello", specs)).toBe("hello world");
  });

  it("pure delete from middle", () => {
    const specs = textDiffToChangeSpec("hello world", "hello");
    expect(specs.length).toBeGreaterThan(0);
    expect(applySpec("hello world", specs)).toBe("hello");
  });

  it("replace in the middle", () => {
    const specs = textDiffToChangeSpec("hello world", "hello there");
    expect(specs.length).toBeGreaterThan(0);
    expect(applySpec("hello world", specs)).toBe("hello there");
  });
});
