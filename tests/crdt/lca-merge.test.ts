import { describe, expect, test } from "bun:test";
import { merge3, mergeDiskOntoDoc } from "../../src/crdt/lca-merge";

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

describe("merge3 (both sides' edits on one base, CRDT-like)", () => {
	const cases: [string, string, string, string, string | null][] = [
		// [name, base, local, remote, expected merged text | null = conflict]
		["no edits", "a\n", "a\n", "a\n", "a\n"],
		["local only", "a\n", "a\nL\n", "a\n", "a\nL\n"],
		["remote only", "a\n", "a\n", "a\nR\n", "a\nR\n"],
		[
			"both append at EOF: remote first, both kept",
			"base line\n",
			"base line\nB change\n",
			"base line\nA change\n",
			"base line\nA change\nB change\n",
		],
		[
			"edits in different paragraphs",
			"# T\n\npara one\n\npara two\n",
			"# T\n\npara one EDIT\n\npara two\n",
			"# T\n\npara one\n\npara two REMOTE\n",
			"# T\n\npara one EDIT\n\npara two REMOTE\n",
		],
		[
			"same word changed differently",
			"one two three\n",
			"one TWO three\n",
			"one deux three\n",
			null,
		],
		["whole text replaced differently", "xxx\n", "zzz\n", "yyy\n", null],
		["identical edit on both sides applied once", "a b c\n", "a B c\n", "a B c\n", "a B c\n"],
		[
			"insert inside the other side's deletion",
			"keep DROPME keep\n",
			"keep DROP+ME keep\n",
			"keep  keep\n",
			null,
		],
		// Line granularity: both sides touched one line, so it is refused, and a
		// "\r\n" can never be split (review of PR 615).
		["two edits on one line", "abcXYZdef\n", "abc!XYZdef\n", "abcdef\n", null],
		["CRLF conversion vs line join", "a\nb", "a\r\nb", "ab", null],
		[
			"one insert contains the other: refused, not duplicated",
			"Hello world.\n",
			"Hello world.\nNew line\n",
			"Hello world.\nNew line\nMore from remote\n",
			null,
		],
		[
			"task line on both, plus more on remote",
			"# T\n\nbody\n",
			"# T\n\nbody\n- [ ] task\n",
			"# T\n\nbody\n- [ ] task\nintro\n",
			null,
		],
		[
			"surrogate pairs around an edit",
			"🤣 a 😂\nmid\n",
			"🤣 A 😂\nmid\n",
			"🤣 a 😂\nmid\nR\n",
			"🤣 A 😂\nmid\nR\n",
		],
		[
			"local deletes, remote edits elsewhere",
			"1\n2\n3\n4\n",
			"1\n3\n4\n",
			"1\n2\n3\n4!\n",
			"1\n3\n4!\n",
		],
		[
			"delete next to the other side's edit (touching, like git)",
			"1\n2\n3\n",
			"1\n3\n",
			"1\n2\n3!\n",
			null,
		],
		// No trailing newline: keeping both would join them into one line "RL".
		["empty base, both write", "", "L", "R", null],
		[
			"EOF line loses its newline on one side, other appends",
			"x\na\n",
			"x\na\nadd\n",
			"x\nab",
			null,
		],
		["both append, no trailing newline in the result", "x\n", "x\nL", "x\nR", null],
	];
	for (const [name, base, local, remote, want] of cases) {
		test(name, () => {
			const r = merge3(base, local, remote);
			if (!r.clean) expect(r.text).toBe(remote); // a refusal changes nothing
			if (want === null) {
				expect(r.clean).toBe(false);
			} else {
				expect(r.clean).toBe(true);
				expect(r.text).toBe(want);
			}
		});
	}
});

test("merge3: edits on adjacent lines conflict, like git", () => {
	expect(merge3("1\n2\n3\n", "1\nTWO\n3\n", "1\n2\nTHREE\n").clean).toBe(false);
	expect(merge3("1\n2\n3\n4\n", "1\nTWO\n3\n4\n", "1\n2\n3\nFOUR\n")).toEqual({
		text: "1\nTWO\n3\nFOUR\n",
		clean: true,
	});
});

test("merge3: an appended line plus an edit elsewhere is not duplicated", () => {
	// Character diffs shifted the append's alignment on one side and kept it twice.
	expect(
		merge3("# T\n\nbody\n", "# T\n\nbody\n- [ ] task\n", "# T\n\nintro\nbody\n- [ ] task\n"),
	).toEqual({ text: "# T\n\nintro\nbody\n- [ ] task\n", clean: true });
});
