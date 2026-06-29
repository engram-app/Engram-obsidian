import { describe, expect, it } from "bun:test";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { bindSpec, reconcileEditorToYText } from "../src/crdt/live/ycollab-binding";

describe("bindSpec", () => {
	it("returns an object with extension (truthy), syncConfig (defined), and getSyncAnnotationType", () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const aw = new Awareness(new Y.Doc());
		const result = bindSpec(t, aw);
		expect(result).toBeDefined();
		expect(result.extension).toBeTruthy();
		expect(result.syncConfig).toBeDefined();
		expect(typeof result.getSyncAnnotationType).toBe("function");
	});

	it("syncConfig holds the same ytext that was passed in", () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const aw = new Awareness(new Y.Doc());
		const { syncConfig } = bindSpec(t, aw);
		expect(syncConfig.ytext).toBe(t);
	});

	it("getSyncAnnotationType() returns null before any remote dispatch", () => {
		const d = new Y.Doc();
		const t = d.getText("content");
		const aw = new Awareness(new Y.Doc());
		const { getSyncAnnotationType } = bindSpec(t, aw);
		// No ySync remote dispatch has happened, so the annotation type is not yet captured.
		expect(getSyncAnnotationType()).toBeNull();
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
