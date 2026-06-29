import { describe, expect, it } from "bun:test";
import { EditorState, Transaction } from "@codemirror/state";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
	bindSpec,
	handleUndoBeforeInput,
	reconcileEditorToYText,
	rerouteUndoFilter,
} from "../src/crdt/live/ycollab-binding";

function makeRouter() {
	const calls = { undo: 0, redo: 0 };
	return {
		calls,
		router: {
			undo() {
				calls.undo++;
			},
			redo() {
				calls.redo++;
			},
		},
	};
}

describe("rerouteUndoFilter (Layer 3 structural veto)", () => {
	it("cancels a transaction tagged userEvent 'undo' and reroutes to router.undo()", async () => {
		const { calls, router } = makeRouter();
		const state = EditorState.create({ doc: "abc", extensions: [rerouteUndoFilter(router)] });
		const tr = state.update({
			changes: { from: 0, to: 3, insert: "" },
			annotations: Transaction.userEvent.of("undo"),
		});
		// The native reverting change must be cancelled — doc unchanged.
		expect(tr.changes.empty).toBe(true);
		expect(tr.newDoc.toString()).toBe("abc");
		// Reroute is deferred (escapes the update cycle) — flush the microtask.
		await Promise.resolve();
		expect(calls.undo).toBe(1);
		expect(calls.redo).toBe(0);
	});

	it("cancels a 'redo' transaction and reroutes to router.redo()", async () => {
		const { calls, router } = makeRouter();
		const state = EditorState.create({ doc: "abc", extensions: [rerouteUndoFilter(router)] });
		const tr = state.update({
			changes: { from: 0, to: 3, insert: "" },
			annotations: Transaction.userEvent.of("redo"),
		});
		expect(tr.changes.empty).toBe(true);
		await Promise.resolve();
		expect(calls.redo).toBe(1);
		expect(calls.undo).toBe(0);
	});

	it("passes a normal edit through unchanged and does not reroute", async () => {
		const { calls, router } = makeRouter();
		const state = EditorState.create({ doc: "abc", extensions: [rerouteUndoFilter(router)] });
		const tr = state.update({
			changes: { from: 3, insert: "d" },
			annotations: Transaction.userEvent.of("input.type"),
		});
		expect(tr.newDoc.toString()).toBe("abcd");
		await Promise.resolve();
		expect(calls.undo).toBe(0);
		expect(calls.redo).toBe(0);
	});
});

describe("handleUndoBeforeInput (Layer 2 menu/OS/mobile path)", () => {
	it("handles historyUndo: reroutes to undo and reports handled", () => {
		const { calls, router } = makeRouter();
		expect(handleUndoBeforeInput("historyUndo", router)).toBe(true);
		expect(calls.undo).toBe(1);
	});

	it("handles historyRedo: reroutes to redo and reports handled", () => {
		const { calls, router } = makeRouter();
		expect(handleUndoBeforeInput("historyRedo", router)).toBe(true);
		expect(calls.redo).toBe(1);
	});

	it("ignores a normal input type and reports not handled", () => {
		const { calls, router } = makeRouter();
		expect(handleUndoBeforeInput("insertText", router)).toBe(false);
		expect(calls.undo).toBe(0);
		expect(calls.redo).toBe(0);
	});
});

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
