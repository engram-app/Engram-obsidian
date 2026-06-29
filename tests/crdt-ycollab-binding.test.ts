import { describe, expect, it } from "bun:test";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { bindSpec, reconcileEditorToYText } from "../src/crdt/live/ycollab-binding";

describe("bindSpec", () => {
	it("returns an object with extension (truthy) and getSyncAnnotation", () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const aw = new Awareness(new Y.Doc());
		const result = bindSpec(t, aw);
		expect(result).toBeDefined();
		expect(result.extension).toBeTruthy();
		expect(typeof result.getSyncAnnotation).toBe("function");
	});

	it("does not expose syncConfig (internal conf is captured, not stored on BindResult)", () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const aw = new Awareness(new Y.Doc());
		const result = bindSpec(t, aw);
		// syncConfig was removed from BindResult; the internal conf is only
		// accessible via getSyncAnnotation() after the first remote dispatch.
		expect((result as Record<string, unknown>).syncConfig).toBeUndefined();
	});

	it("getSyncAnnotation() returns null before any remote dispatch", () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const aw = new Awareness(new Y.Doc());
		const { getSyncAnnotation } = bindSpec(t, aw);
		// No ySync remote dispatch has happened, so the annotation is not yet captured.
		expect(getSyncAnnotation()).toBeNull();
	});
});

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
