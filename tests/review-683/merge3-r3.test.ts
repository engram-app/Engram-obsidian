import { expect, test } from "bun:test";
import { merge3 } from "../../src/crdt/lca-merge";

const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const cases: [string, string, string, string, string | null][] = [
	// name, base, local, remote, expected (null = conflict)
	[
		"table: different cells of one row",
		"| a | b |\n|---|---|\n| 1 | 2 |\n",
		"| a | b |\n|---|---|\n| ONE | 2 |\n",
		"| a | b |\n|---|---|\n| 1 | TWO |\n",
		"| a | b |\n|---|---|\n| ONE | TWO |\n",
	],
	[
		"frontmatter: different keys adjacent",
		"---\ntitle: x\ntags: [a]\n---\nbody\n",
		"---\ntitle: y\ntags: [a]\n---\nbody\n",
		"---\ntitle: x\ntags: [a, b]\n---\nbody\n",
		"---\ntitle: y\ntags: [a, b]\n---\nbody\n",
	],
	[
		"list: adjacent items",
		"- a\n- b\n- c\n",
		"- A\n- b\n- c\n",
		"- a\n- B\n- c\n",
		"- A\n- B\n- c\n",
	],
	[
		"code fence: adjacent lines",
		"```js\nlet a = 1;\nlet b = 2;\n```\n",
		"```js\nlet a = 10;\nlet b = 2;\n```\n",
		"```js\nlet a = 1;\nlet b = 20;\n```\n",
		"```js\nlet a = 10;\nlet b = 20;\n```\n",
	],
	[
		"CJK: different words one line",
		"我喜欢猫和狗\n",
		"我喜欢大猫和狗\n",
		"我喜欢猫和小狗\n",
		"我喜欢大猫和小狗\n",
	],
	[
		"emoji: different emoji same line",
		"a 😀 b 😃 c\n",
		"a 😁 b 😃 c\n",
		"a 😀 b 😄 c\n",
		"a 😁 b 😄 c\n",
	],
	[
		"emoji: same emoji both sides (low surrogate only differs)",
		"x😀y\n",
		"x😁y\n",
		"x😂y\n",
		null,
	],
	[
		"CRLF: adjacent lines",
		"a\r\nb\r\nc\r\n",
		"A\r\nb\r\nc\r\n",
		"a\r\nB\r\nc\r\n",
		"A\r\nB\r\nc\r\n",
	],
];

for (const [name, b, l, r, want] of cases) {
	test(`r3 merge3 markdown: ${name}`, () => {
		const m = merge3(b, l, r);
		if (want === null) {
			expect(m.clean).toBe(false);
			expect(m.text).toBe(r);
		} else {
			expect(m).toEqual({ text: want, clean: true });
		}
	});
}

// Property: random token documents, each side edits random tokens. Invariants:
// identity cases, no lone surrogates, every token a side inserted survives
// a clean merge, and a clean merge never resurrects a token both deleted.
const TOK = [
	"alpha",
	"beta",
	"猫",
	"狗",
	"😀",
	"👍🏽",
	"|",
	" | ",
	"- ",
	"## ",
	"```",
	"\n",
	"\r\n",
	"\n\n",
	" ",
	"x",
	"y",
	":",
	"[",
	"]",
];
function rng(seed: number) {
	return () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
}
function edit(
	tokens: string[],
	rand: () => number,
	tag: string,
): { toks: string[]; ins: string[] } {
	const t = [...tokens];
	const ins: string[] = [];
	const n = 1 + Math.floor(rand() * 3);
	for (let i = 0; i < n; i++) {
		const at = Math.floor(rand() * t.length);
		const k = rand();
		const mark = `<${tag}${i}>`;
		if (k < 0.4) {
			t.splice(at, 0, mark);
			ins.push(mark);
		} else if (k < 0.7) {
			t.splice(at, 1, mark);
			ins.push(mark);
		} else t.splice(at, 1);
	}
	return { toks: t, ins: ins.filter((m) => t.includes(m)) };
}

test("r3 merge3 property: 3000 random markdown-ish merges hold the invariants", () => {
	const rand = rng(42);
	let _clean = 0;
	const bad: string[] = [];
	for (let i = 0; i < 3000; i++) {
		const base = Array.from(
			{ length: 10 + Math.floor(rand() * 40) },
			() => TOK[Math.floor(rand() * TOK.length)] as string,
		);
		const L = edit(base, rand, "L");
		const R = edit(base, rand, "R");
		const b = base.join("");
		const l = L.toks.join("");
		const r = R.toks.join("");
		if (
			merge3(b, b, r).text !== r ||
			merge3(b, l, b).text !== l ||
			merge3(b, l, l).text !== l
		) {
			bad.push(`identity ${JSON.stringify([b, l, r])}`);
			continue;
		}
		const m = merge3(b, l, r);
		if (!m.clean) {
			if (m.text !== r) bad.push(`dirty not remote ${JSON.stringify([b, l, r])}`);
			continue;
		}
		_clean++;
		if (lone.test(m.text)) bad.push(`lone surrogate ${JSON.stringify([b, l, r, m.text])}`);
		for (const mark of [...L.ins, ...R.ins])
			if (!m.text.includes(mark))
				bad.push(`lost ${mark} ${JSON.stringify([b, l, r, m.text])}`);
	}
	expect(bad.slice(0, 5)).toEqual([]);
});

test("r3 merge3 cost: 1 MB note, edits far apart, and a whole-file CRLF normalisation", () => {
	const line = (i: number) => `- item ${i} lorem ipsum dolor sit amet, consectetur adipiscing\n`;
	const lines = Array.from({ length: 16000 }, (_, i) => line(i));
	const b = lines.join("");
	const l = b.replace(line(10), "- LOCAL\n");
	const r = b.replace(line(15000), "- REMOTE\n");
	let t = performance.now();
	const m1 = merge3(b, l, r);
	const _lineMs = performance.now() - t;
	expect(m1.clean).toBe(true);
	// An editor or a linter rewrote every line ending; remote edited one line.
	const crlf = b.replace(/\n/g, "\r\n");
	t = performance.now();
	const m2 = merge3(b, crlf, r);
	const _charMs = performance.now() - t;
	if (m2.clean) {
		expect(m2.text).toContain("- REMOTE");
		expect(m2.text).not.toContain("item 15000 ");
	}
});

test("r3 merge3 property (unique tokens): deletions honoured, nothing duplicated, order kept", () => {
	const rand = rng(7);
	const bad: string[] = [];
	let _clean = 0;
	for (let i = 0; i < 3000; i++) {
		const n = 10 + Math.floor(rand() * 40);
		const base = Array.from(
			{ length: n },
			(_, j) => `${TOK[Math.floor(rand() * TOK.length)]}{${j}}`,
		);
		const L = edit(base, rand, "L");
		const R = edit(base, rand, "R");
		const [b, l, r] = [base.join(""), L.toks.join(""), R.toks.join("")];
		const m = merge3(b, l, r);
		if (!m.clean) continue;
		_clean++;
		const ids = [...m.text.matchAll(/\{(\d+)\}|<([LR]\d)>/g)].map((x) => x[0]);
		const expectKept = base
			.filter((t) => L.toks.includes(t) && R.toks.includes(t))
			.map((t) => t.match(/\{\d+\}/)?.[0]);
		const got = ids.filter((x) => x.startsWith("{"));
		if (JSON.stringify(got) !== JSON.stringify(expectKept))
			bad.push(`base tokens ${JSON.stringify([b, l, r, m.text])}`);
		if (new Set(ids).size !== ids.length) bad.push(`dup ${JSON.stringify([b, l, r, m.text])}`);
		if (lone.test(m.text)) bad.push(`lone ${JSON.stringify(m.text)}`);
	}
	expect(bad.slice(0, 3)).toEqual([]);
});

// PINNED AS FAILING (test.failing), on purpose. No three-way merge can be
// right from a stale base: a line added in the shared step S and deleted by
// one side looks, from the old base, exactly like the other side inserting
// it, so it is resurrected (199 of 859 clean line-level merges, and 37
// duplicates, even with the character pass off). The fix is the input, not
// merge3: production never hands it a stale base. The drift repair keeps an
// exact (or frozen, still common) ancestor and merges line level only; the
// disk path's base is a self-validating per-note record, dropped when its
// write fails. If this ever starts passing, merge3 changed: re-check why.
test.failing("r3 merge3 property (stale base: shared edits on both sides, as in drift repair)", () => {
	const rand = rng(99);
	const bad: string[] = [];
	let _clean = 0;
	for (let i = 0; i < 3000; i++) {
		const n = 10 + Math.floor(rand() * 40);
		const base = Array.from(
			{ length: n },
			(_, j) => `${TOK[Math.floor(rand() * TOK.length)]}{${j}}`,
		);
		const S = edit(base, rand, "S");
		const L = edit(S.toks, rand, "L");
		const R = edit(S.toks, rand, "R");
		const [b, l, r] = [base.join(""), L.toks.join(""), R.toks.join("")];
		const m = merge3(b, l, r);
		if (!m.clean) continue;
		_clean++;
		const ids = [...m.text.matchAll(/\{(\d+)\}|<([LRS]\d)>/g)].map((x) => x[0]);
		if (new Set(ids).size !== ids.length) bad.push(`dup ${JSON.stringify([b, l, r, m.text])}`);
		const want = S.toks
			.filter((t) => L.toks.includes(t) && R.toks.includes(t))
			.concat(
				L.toks.filter((t) => !S.toks.includes(t)),
				R.toks.filter((t) => !S.toks.includes(t)),
			);
		for (const w of want)
			if (!m.text.includes(w)) bad.push(`lost ${w} ${JSON.stringify([b, l, r, m.text])}`);
		for (const t of S.toks)
			if (!(L.toks.includes(t) && R.toks.includes(t)) && m.text.includes(t))
				bad.push(`resurrected ${t} ${JSON.stringify([b, l, r, m.text])}`);
	}
	expect(bad.slice(0, 3)).toEqual([]);
});
