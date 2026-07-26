import { describe, expect, it } from "bun:test";
import { decideReconcile, needsReattach } from "../src/crdt/live/live-binding-decisions";

describe("needsReattach", () => {
	const bound = { path: "a.md", noteId: "id-a", coordinator: {} };

	it("false when path, noteId and coordinator all match", () => {
		expect(needsReattach(bound, "a.md", "id-a", bound.coordinator)).toBe(false);
	});

	it("true when the path changed (editor reused for a different file)", () => {
		expect(needsReattach(bound, "b.md", "id-a", bound.coordinator)).toBe(true);
	});

	it("true when the note_id changed under the same path (genesis adopt remap)", () => {
		expect(needsReattach(bound, "a.md", "server-id", bound.coordinator)).toBe(true);
	});

	it("true when the coordinator changed (stack rebuilt on account/backend switch)", () => {
		// The dead-doc bug: path + noteId are unchanged, but the old stack's doc was
		// destroyed and a new coordinator installed. Must re-attach or edits go into
		// the dead doc.
		expect(needsReattach(bound, "a.md", "id-a", {})).toBe(true);
	});

	it("true when currently unbound (path null) and a path is now resolvable", () => {
		expect(
			needsReattach({ path: null, noteId: null, coordinator: null }, "a.md", "id-a", {}),
		).toBe(true);
	});
});

describe("decideReconcile", () => {
	it("noop when editor already equals the doc", () => {
		expect(decideReconcile("hello", "hello", false)).toEqual({ kind: "noop" });
	});

	it("defer when the doc is empty but the editor has a disk body (unseeded)", () => {
		// Must NOT seed locally — the server owns the doc; wait for it (#846).
		expect(decideReconcile("disk body", "", false)).toEqual({ kind: "defer" });
	});

	it("noop when both editor and doc are empty (genuinely-empty note)", () => {
		expect(decideReconcile("", "", false)).toEqual({ kind: "noop" });
	});

	it("adopt (editor -> doc) when the doc is ahead and the user did NOT type", () => {
		// Stale disk editor, server-newer doc, no local edits: snap editor to doc.
		const d = decideReconcile("old", "old and new", false);
		expect(d.kind).toBe("adopt");
		if (d.kind === "adopt") {
			// changes turn the EDITOR ("old") into the doc ("old and new")
			expect(applyCm("old", d.changes)).toBe("old and new");
		}
	});

	it("forward (editor -> doc) when the user typed during hydration (preserve local edits)", () => {
		// docText == the base the editor loaded from; editor has extra local chars.
		// Must forward those into the doc, NOT revert the editor to docText.
		const d = decideReconcile("base+typed", "base", true);
		expect(d.kind).toBe("forward");
		if (d.kind === "forward") {
			// changes turn the DOC ("base") into the editor ("base+typed")
			expect(applyCm("base", d.changes)).toBe("base+typed");
		}
	});

	it("still defers an unseeded doc even when the user typed (never local-seed)", () => {
		expect(decideReconcile("typed on a new note", "", true)).toEqual({ kind: "defer" });
	});
});

/** Apply CmChangeSpec[] (from/to against the pre-image) to a string, for assertions. */
function applyCm(
	before: string,
	changes: Array<{ from: number; to: number; insert: string }>,
): string {
	let out = before;
	let adj = 0;
	for (const c of changes) {
		const from = c.from + adj;
		const to = c.to + adj;
		out = out.slice(0, from) + c.insert + out.slice(to);
		adj += c.insert.length - (c.to - c.from);
	}
	return out;
}
