import { describe, expect, test } from "bun:test";
import {
	canonicalJson,
	parseFrontmatter,
	splitFrontmatter,
} from "../../src/crdt/frontmatter-codec";

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

describe("parseFrontmatter", () => {
	test("ordered keys + canonical JSON values", () => {
		expect(parseFrontmatter("title: Hi\ntags:\n  - a\n  - b\n")).toEqual({
			order: ["title", "tags"],
			values: { title: '"Hi"', tags: '["a","b"]' },
		});
	});
	test("empty block", () => {
		expect(parseFrontmatter("")).toEqual({ order: [], values: {} });
	});
	test("nested map value uses sorted keys", () => {
		expect(parseFrontmatter("meta:\n  b: 2\n  a: 1\n")).toEqual({
			order: ["meta"],
			values: { meta: '{"a":1,"b":2}' },
		});
	});
	test("malformed yaml -> null", () => {
		expect(parseFrontmatter("a: : : broken\n  - x\n")).toBeNull();
	});
	test("bare list (non-object) -> null", () => {
		expect(parseFrontmatter("- a\n- b\n")).toBeNull();
	});
});

describe("canonicalJson", () => {
	test("sorts nested object keys, preserves array order", () => {
		expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
	});
});
