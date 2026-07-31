import { describe, expect, test } from "bun:test";
import { mergeDiskOntoDoc } from "../../src/crdt/lca-merge";

describe("mergeDiskOntoDoc", () => {
	test("applies a disk-side edit that the doc has not seen", () => {
		const r = mergeDiskOntoDoc("hello", "hello world", "hello");

		expect(r.text).toBe("hello world");
		expect(r.clean).toBe(true);
	});

	test("PRESERVES a remote edit the disk snapshot predates", () => {
		// The whole point. Two-way diff(current -> disk) would delete " remote"
		// because the disk snapshot was read before the remote merge landed. This
		// is the stale-snapshot revert class (e2e test_83), and the reason
		// applyLocalEdit needs a 3-attempt retry loop without an LCA.
		const lca = "line one\n";
		const disk = "line one\nlocal\n";
		const current = "line one\nremote\n";

		const r = mergeDiskOntoDoc(lca, disk, current);

		expect(r.text).toContain("remote");
		expect(r.text).toContain("local");
	});

	test("is a no-op when disk matches the base", () => {
		const r = mergeDiskOntoDoc("same", "same", "doc has moved on");

		// No disk-side delta means nothing to apply — the doc keeps its own state
		// rather than being dragged back to a stale snapshot.
		expect(r.text).toBe("doc has moved on");
		expect(r.clean).toBe(true);
	});

	test("returns the disk content unchanged when doc equals base", () => {
		const r = mergeDiskOntoDoc("base", "edited on disk", "base");

		expect(r.text).toBe("edited on disk");
	});

	test("applies a pure deletion made on disk", () => {
		const r = mergeDiskOntoDoc("a\nb\nc\n", "a\nc\n", "a\nb\nc\n");

		expect(r.text).toBe("a\nc\n");
		expect(r.clean).toBe(true);
	});

	test("keeps a remote insertion while applying a disk deletion elsewhere", () => {
		const lca = "one\ntwo\nthree\n";
		const disk = "one\nthree\n"; // deleted "two"
		const current = "one\ntwo\nthree\nfour\n"; // remote appended "four"

		const r = mergeDiskOntoDoc(lca, disk, current);

		expect(r.text).toContain("four");
		expect(r.text).not.toContain("two");
	});

	test("reports clean=false when a hunk could not be applied", () => {
		// Overlapping edits to the same region. The merge still returns usable
		// text, but the caller needs to know it was not a clean apply so it can
		// fall back rather than silently shipping a mangled note.
		const lca = "the quick brown fox jumps over the lazy dog";
		const disk = "the SLOW brown fox jumps over the lazy dog";
		const current = "totally different content with no relation whatsoever";

		const r = mergeDiskOntoDoc(lca, disk, current);

		expect(r.clean).toBe(false);
	});

	test("handles an empty base without throwing", () => {
		const r = mergeDiskOntoDoc("", "new content", "");

		expect(r.text).toBe("new content");
	});

	test("handles emptying a file on disk", () => {
		const r = mergeDiskOntoDoc("content", "", "content");

		expect(r.text).toBe("");
	});

	test("is stable when all three inputs are identical", () => {
		const r = mergeDiskOntoDoc("x", "x", "x");

		expect(r.text).toBe("x");
		expect(r.clean).toBe(true);
	});
});
