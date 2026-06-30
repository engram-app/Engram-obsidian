import { describe, expect, test } from "bun:test";
import { splitFrontmatter } from "../../src/crdt/frontmatter-codec";

describe("splitFrontmatter", () => {
	test("extracts yaml block and body for a well-formed fence", () => {
		expect(splitFrontmatter("---\ntitle: Hi\n---\nbody\n")).toEqual({
			fmBlock: "title: Hi\n",
			body: "body\n",
		});
	});
	test("no frontmatter -> null block, whole text body", () => {
		expect(splitFrontmatter("just body\n")).toEqual({ fmBlock: null, body: "just body\n" });
	});
	test("missing closing fence -> null", () => {
		expect(splitFrontmatter("---\ntitle: Hi\nno close\n")).toEqual({
			fmBlock: null,
			body: "---\ntitle: Hi\nno close\n",
		});
	});
	test("empty frontmatter -> empty block", () => {
		expect(splitFrontmatter("---\n---\nbody\n")).toEqual({ fmBlock: "", body: "body\n" });
	});
	test("must start at byte 0", () => {
		expect(splitFrontmatter("\n---\nt: 1\n---\nbody\n")).toEqual({
			fmBlock: null,
			body: "\n---\nt: 1\n---\nbody\n",
		});
	});
	test("closing fence with trailing whitespace recognized", () => {
		expect(splitFrontmatter("---\ntitle: Hi\n--- \nbody\n")).toEqual({
			fmBlock: "title: Hi\n",
			body: "body\n",
		});
	});
});
