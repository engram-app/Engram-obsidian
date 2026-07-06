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

	it("pathForId resolves a set id, and null for unknown", () => {
		const m = new NoteIdMap();
		m.set("a.md", "id-1");
		expect(m.pathForId("id-1")).toBe("a.md");
		expect(m.pathForId("no-such-id")).toBeNull();
	});

	it("rename updates the reverse mapping", () => {
		const m = new NoteIdMap();
		m.set("a.md", "id-1");
		m.rename("a.md", "b.md");
		expect(m.pathForId("id-1")).toBe("b.md");
		expect(m.get("b.md")).toBe("id-1");
	});

	it("set overwriting a path's id cleans the old reverse entry", () => {
		const m = new NoteIdMap();
		m.set("p.md", "id-1");
		m.set("p.md", "id-2");
		expect(m.pathForId("id-1")).toBeNull();
		expect(m.pathForId("id-2")).toBe("p.md");
	});

	it("rename onto a path that already had a different id cleans that id's stale reverse entry", () => {
		const m = new NoteIdMap();
		m.set("b.md", "id-b");
		m.set("a.md", "id-a");
		m.rename("a.md", "b.md");
		expect(m.pathForId("id-b")).toBeNull();
		expect(m.pathForId("id-a")).toBe("b.md");
	});

	it("getOrMint reuses an existing id and mints+persists a new one on miss", () => {
		const m = new NoteIdMap();
		m.set("a.md", "id-1");
		expect(m.getOrMint("a.md")).toBe("id-1");

		const minted = m.getOrMint("new.md");
		expect(typeof minted).toBe("string");
		expect(minted.length).toBeGreaterThan(0);
		expect(minted).not.toBe("id-1");
		expect(m.get("new.md")).toBe(minted);
		expect(m.pathForId(minted)).toBe("new.md");
	});
});
