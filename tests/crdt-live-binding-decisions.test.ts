import { describe, expect, it } from "bun:test";
import { splitFrontmatter } from "../src/crdt/frontmatter-codec";
import {
	decideReconcile,
	frontmatterPrefixLen,
	needsReattach,
} from "../src/crdt/live/live-binding-decisions";

describe("frontmatterPrefixLen", () => {
	it("is 0 when there is no frontmatter (Live Preview body-only doc)", () => {
		expect(frontmatterPrefixLen("just body text")).toBe(0);
		expect(frontmatterPrefixLen("")).toBe(0);
	});

	it("returns the prefix length through the closing --- (source mode)", () => {
		const text = "---\nfoo: bar\n---\nbody here";
		expect(frontmatterPrefixLen(text)).toBe("---\nfoo: bar\n---\n".length);
		// The body slice is exactly the note body.
		expect(text.slice(frontmatterPrefixLen(text))).toBe("body here");
	});

	it("covers the whole doc for a frontmatter-only note (no body, no trailing newline)", () => {
		const text = "---\nfoo: bar\n---";
		expect(frontmatterPrefixLen(text)).toBe(text.length);
		expect(text.slice(frontmatterPrefixLen(text))).toBe("");
	});

	it("is 0 for an unterminated --- (not real frontmatter)", () => {
		expect(frontmatterPrefixLen("--- not really\nfoo")).toBe(0);
		expect(frontmatterPrefixLen("text with --- in the middle\n---\n")).toBe(0);
	});

	// The editor prefix MUST agree with splitFrontmatter (which mirrors the
	// backend Engram.Notes.Frontmatter byte-for-byte): the bound Y.Text holds
	// exactly splitFrontmatter(raw).body, so any input where the two disagree
	// shifts every mapped edit by the disagreement — silent offset corruption.
	// The old regex diverged on two inputs, one in each direction:
	//  - CRLF opening fence: regex matched, codec does not (backend is LF-only)
	//  - trailing spaces on the closing fence: codec splits, regex did not
	it("agrees with splitFrontmatter on a CRLF-opened file (treated as body, like the backend)", () => {
		const text = "---\r\nfoo: bar\r\n---\r\nbody";
		expect(splitFrontmatter(text).fmBlock).toBeNull(); // codec: not frontmatter
		expect(frontmatterPrefixLen(text)).toBe(0); // editor must agree
	});

	it("agrees with splitFrontmatter on a closing fence with trailing spaces", () => {
		const text = "---\nfoo: bar\n---  \nbody";
		expect(text.slice(frontmatterPrefixLen(text))).toBe(splitFrontmatter(text).body);
		expect(splitFrontmatter(text).body).toBe("body");
	});

	it("slices to exactly the codec body on every representative input", () => {
		const inputs = [
			"just body",
			"",
			"---\nfoo: bar\n---\nbody here",
			"---\nfoo: bar\n---",
			"---\n---\nempty block",
			"--- not really\nfoo",
			"---\r\nfoo: bar\r\n---\r\nbody",
			"---\nfoo: bar\n--- \t\nbody",
		];
		for (const text of inputs) {
			expect(text.slice(frontmatterPrefixLen(text))).toBe(splitFrontmatter(text).body);
		}
	});
});

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

describe("decideReconcile — base-aware 3-way merge (#3)", () => {
	// The pre-edit base = the editor's text right before the user's first keystroke
	// (captured by the ViewPlugin at attach / on each programmatic load). It is the
	// LCA of "what the user typed" and "what the doc already held".

	it("merges typed edits into a server-newer doc instead of deleting the remote text", () => {
		// THE BUG: doc hydrated from IndexedDB with a remote paragraph the editor
		// never saw; the user typed at the top during hydration. Old behavior
		// forwarded diff(doc -> editor), DELETING "remote line". Both sides must
		// converge on the union.
		const base = "line one\nline two\n";
		const editorText = "line one EDITED\nline two\n";
		const docText = "line one\nline two\nremote line\n";

		const d = decideReconcile(editorText, docText, true, base);
		expect(d.kind).toBe("merge");
		if (d.kind !== "merge") return;
		const merged = "line one EDITED\nline two\nremote line\n";
		expect(applyCm(docText, d.toDoc)).toBe(merged);
		expect(applyCm(editorText, d.toEditor)).toBe(merged);
	});

	it("merges a remote edit made ABOVE the user's typing (offset shift)", () => {
		// Whole-text forwarding is offset-blind; the patch carries context so the
		// user's tail edit still lands correctly after the doc grew at the top.
		const base = "alpha\nbravo\ncharlie\n";
		const editorText = "alpha\nbravo\ncharlie TYPED\n";
		const docText = "REMOTE\nalpha\nbravo\ncharlie\n";

		const d = decideReconcile(editorText, docText, true, base);
		expect(d.kind).toBe("merge");
		if (d.kind !== "merge") return;
		const merged = "REMOTE\nalpha\nbravo\ncharlie TYPED\n";
		expect(applyCm(docText, d.toDoc)).toBe(merged);
		expect(applyCm(editorText, d.toEditor)).toBe(merged);
	});

	it("falls back to plain forward when the doc has NOT diverged from the base", () => {
		// base === docText: nothing unseen to preserve, so the cheap whole-text
		// forward is already exactly right (and stays the common path).
		const d = decideReconcile("base+typed", "base", true, "base");
		expect(d.kind).toBe("forward");
		if (d.kind === "forward") expect(applyCm("base", d.changes)).toBe("base+typed");
	});

	it("falls back to plain forward on a CONFLICT (user's keystrokes win)", () => {
		// Both sides rewrote the same region: no clean merge exists. Keep today's
		// behavior — the user's live keystrokes win — rather than guessing.
		const base = "the quick brown fox\n";
		const editorText = "the quick RED fox\n";
		const docText = "the quick GREEN fox\n";

		const d = decideReconcile(editorText, docText, true, base);
		expect(d.kind).toBe("forward");
		if (d.kind === "forward") expect(applyCm(docText, d.changes)).toBe(editorText);
	});

	it("falls back to plain forward when the base is unavailable (null)", () => {
		expect(decideReconcile("base+typed", "base", true, null).kind).toBe("forward");
		expect(decideReconcile("base+typed", "base", true).kind).toBe("forward");
	});

	it("ignores the base when the user did NOT type (adopt is unchanged)", () => {
		// dirty=false means the editor is just stale disk; the doc is authoritative.
		const d = decideReconcile("old", "old and new", false, "whatever");
		expect(d.kind).toBe("adopt");
	});

	it("still defers an unseeded doc regardless of base", () => {
		expect(decideReconcile("typed", "", true, "base")).toEqual({ kind: "defer" });
	});

	it("adopts (empty toDoc) when the typed text is already present in the doc", () => {
		// The doc independently received the same edit. A clean merge collapses to
		// docText: nothing to forward, editor snaps to the doc.
		const base = "one\ntwo\n";
		const editorText = "one\ntwo\nthree\n";
		const docText = "one\ntwo\nthree\n";
		// editorText === docText short-circuits to noop before the merge runs.
		expect(decideReconcile(editorText, docText, true, base)).toEqual({ kind: "noop" });
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
