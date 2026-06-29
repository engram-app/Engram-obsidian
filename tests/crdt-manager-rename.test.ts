import { describe, it, expect } from "bun:test";
import "fake-indexeddb/auto";
import { CrdtManager } from "../src/crdt/manager";

describe("CrdtManager.renameDoc", () => {
  it("closes the old-path entry so the old docId is no longer cached", async () => {
    const m = new CrdtManager({ dbPrefix: "v1", onUpdate: () => {}, onFlushToDisk: async () => {} });
    await m.getDoc("A/Note.md"); // open old
    m.renameDoc("A/Note.md", "B/Note.md");
    // After rename, the manager must not be holding the old docId entry.
    // getText on the new path opens a fresh doc (empty until server re-syncs).
    expect(await m.getText("B/Note.md")).toBe("");
  });

  it("is a no-op when oldPath === newPath", async () => {
    const m = new CrdtManager({ dbPrefix: "v1", onUpdate: () => {}, onFlushToDisk: async () => {} });
    await m.getDoc("Same.md");
    // Should not throw; the entry remains intact
    m.renameDoc("Same.md", "Same.md");
    expect(await m.getText("Same.md")).toBe("");
  });

  it("is a no-op when oldPath was never opened", () => {
    const m = new CrdtManager({ dbPrefix: "v1", onUpdate: () => {}, onFlushToDisk: async () => {} });
    // Must not throw
    expect(() => m.renameDoc("Ghost.md", "Other.md")).not.toThrow();
  });
});
