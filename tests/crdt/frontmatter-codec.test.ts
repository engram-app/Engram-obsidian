import { describe, expect, test } from "bun:test";
import {
	canonicalJson,
	emitFrontmatter,
	parseFrontmatter,
	projectNote,
	splitFrontmatter,
} from "../../src/crdt/frontmatter-codec";
import fixtures from "./frontmatter-fixtures.json";

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

describe("emitFrontmatter", () => {
	test("round-trips through parse, preserving order", () => {
		const order = ["title", "tags"];
		const values = { title: '"Hi"', tags: '["a","b"]' };
		expect(parseFrontmatter(emitFrontmatter(order, values))).toEqual({ order, values });
	});
	test("empty -> empty string", () => {
		expect(emitFrontmatter([], {})).toBe("");
	});
	test("skips order keys missing from values", () => {
		expect(parseFrontmatter(emitFrontmatter(["title", "x"], { title: '"Hi"' }))).toEqual({
			order: ["title"],
			values: { title: '"Hi"' },
		});
	});
	// A degraded key lives in `raws` (out-of-band verbatim span), NOT `values`.
	// emit must interleave it in source order and NEVER drop it — mirrors the
	// backend Frontmatter.emit/3.
	test("renders a degraded key's raw span verbatim, interleaved in source order", () => {
		const order = ["title", "date"];
		const values = { title: '"Hi"' };
		const raws = { date: "date: 2024-01-01" };
		expect(emitFrontmatter(order, values, raws)).toBe("title: Hi\ndate: 2024-01-01\n");
	});
	test("preserves a multi-line raw span byte-for-byte (degraded first)", () => {
		const order = ["coords", "title"];
		const values = { title: '"Hi"' };
		const raws = { coords: "coords: [\n  1,\n  2,\n]" };
		expect(emitFrontmatter(order, values, raws)).toBe("coords: [\n  1,\n  2,\n]\ntitle: Hi\n");
	});
});

describe("projectNote", () => {
	test("wraps frontmatter in fences + body", () => {
		expect(projectNote(["title"], { title: '"Hi"' }, "body\n")).toBe(
			"---\ntitle: Hi\n---\nbody\n",
		);
	});
	test("empty frontmatter -> body only", () => {
		expect(projectNote([], {}, "body\n")).toBe("body\n");
	});
	test("materializes both good and degraded keys in source order", () => {
		expect(
			projectNote(["title", "date"], { title: '"Hi"' }, "body\n", {
				date: "date: 2024-01-01",
			}),
		).toBe("---\ntitle: Hi\ndate: 2024-01-01\n---\nbody\n");
	});
	test("split then project round-trips a real note", () => {
		const raw = "---\ntitle: Hi\ntags:\n  - a\n---\nthe body\n";
		const { fmBlock, body } = splitFrontmatter(raw);
		const { order, values } = parseFrontmatter(fmBlock as string)!;
		expect(projectNote(order, values, body)).toBe(raw);
	});
});

describe("frontmatter fixtures", () => {
	interface Fixture {
		name: string;
		raw: string;
		values: Record<string, string>;
		order: string[];
		projected?: string;
	}

	for (const fx of fixtures as unknown as Fixture[]) {
		test(`round-trip + values: ${fx.name}`, () => {
			const { fmBlock, body } = splitFrontmatter(fx.raw);
			const parsed = parseFrontmatter(fmBlock ?? "");
			expect(parsed).not.toBeNull();
			expect(parsed!.order).toEqual(fx.order);
			expect(parsed!.values).toEqual(fx.values);
			const expectedProjected = fx.projected ?? fx.raw;
			expect(projectNote(parsed!.order, parsed!.values, body)).toBe(expectedProjected);
		});
	}
});
