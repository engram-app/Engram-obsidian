import { describe, expect, it } from "bun:test";
import { NoteIdMap } from "../src/crdt/note-id-map";

describe("NoteIdMap", () => {
	it("rename keeps the id, moves the key", () => {
		const m = new NoteIdMap();
		m.set("a.md", "id-1");
		m.rename("a.md", "b.md");
		expect(m.get("a.md")).toBeNull();
		expect(m.get("b.md")).toBe("id-1");
	});
	it("round-trips through JSON", () => {
		const m = new NoteIdMap();
		m.set("a.md", "id-1");
		expect(NoteIdMap.fromJSON(m.toJSON()).get("a.md")).toBe("id-1");
	});
});
