import { describe, expect, test } from "bun:test";
import { fnv1a } from "../../src/content-hash";
import { decideReplay } from "../../src/crdt/ingest-gate";

const C1 = "line one\nline two\n";
const C2 = "line one\nline two\nline three\n";
const canon = (t: string) => t.replace(/^key:$/m, "key: null");

describe("decideReplay", () => {
	test("server unchanged → apply text", () => {
		const d = decideReplay(
			{ server: C1, text: C2, base: C1, baselineHash: fnv1a(C1), kind: "note" },
			canon,
		);
		expect(d).toEqual({ kind: "apply", text: C2 });
	});

	test("canonicalized server counts as unchanged (#1928)", () => {
		const B = "---\nkey:\n---\nbody\n";
		const text = "---\nkey:\n---\nbody edited\n";
		const d = decideReplay(
			{ server: canon(B), text, base: B, baselineHash: fnv1a(B), kind: "note" },
			canon,
		);
		expect(d).toEqual({ kind: "apply", text });
	});

	test("server moved, base known, clean merge → apply merged", () => {
		const d = decideReplay(
			{ server: `REMOTE\n${C1}`, text: C2, base: C1, baselineHash: fnv1a(C1), kind: "note" },
			canon,
		);
		expect(d).toEqual({ kind: "apply", text: `REMOTE\n${C2}` });
	});

	test("server moved, base known, conflicting merge → keep-both", () => {
		const d = decideReplay(
			{
				server: "line one\nREMOTE\n",
				text: "line one\nLOCAL\n",
				base: "line one\nline two\n",
				baselineHash: fnv1a("line one\nline two\n"),
				kind: "note",
			},
			canon,
		);
		expect(d).toEqual({ kind: "keep-both" });
	});

	test("no base, only inserts → apply text", () => {
		const d = decideReplay(
			{ server: C1, text: C2, base: null, baselineHash: undefined, kind: "note" },
			canon,
		);
		expect(d).toEqual({ kind: "apply", text: C2 });
	});

	test("no base, deletes server text → keep-both", () => {
		const d = decideReplay(
			{ server: C2, text: C1, base: null, baselineHash: undefined, kind: "note" },
			canon,
		);
		expect(d).toEqual({ kind: "keep-both" });
	});

	test("canvas never merges when server moved", () => {
		const d = decideReplay(
			{
				server: `REMOTE\n${C1}`,
				text: C2,
				base: C1,
				baselineHash: fnv1a(C1),
				kind: "canvas",
			},
			canon,
		);
		expect(d).toEqual({ kind: "keep-both" });
	});

	test("canvas with server unchanged → apply text", () => {
		const d = decideReplay(
			{ server: C1, text: C2, base: C1, baselineHash: fnv1a(C1), kind: "canvas" },
			canon,
		);
		expect(d).toEqual({ kind: "apply", text: C2 });
	});
});
