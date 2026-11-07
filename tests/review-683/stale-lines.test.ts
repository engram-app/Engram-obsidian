import { expect, test } from "bun:test";
import { merge3 } from "../../src/crdt/lca-merge";

function rng(seed: number) {
	return () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
}
function edit(t0: string[], rand: () => number, tag: string) {
	const t = [...t0];
	const n = 1 + Math.floor(rand() * 2);
	for (let i = 0; i < n; i++) {
		const at = Math.floor(rand() * t.length);
		const k = rand();
		const m = `- ${tag}${i}\n`;
		if (k < 0.4) t.splice(at, 0, m);
		else if (k < 0.7) t.splice(at, 1, m);
		else t.splice(at, 1);
	}
	return t;
}
// PINNED AS FAILING (test.failing), on purpose. No three-way merge can be
// right from a stale base: a line added in the shared step S and deleted by
// one side looks, from the old base, exactly like the other side inserting
// it, so it is resurrected (199 of 859 clean line-level merges, and 37
// duplicates, even with the character pass off). The fix is the input, not
// merge3: production never hands it a stale base. The drift repair keeps an
// exact (or frozen, still common) ancestor and merges line level only; the
// disk path's base is a self-validating per-note record, dropped when its
// write fails. If this ever starts passing, merge3 changed: re-check why.
test.failing("r3 stale base, whole-line edits only", () => {
	const rand = rng(5);
	const dups: string[] = [];
	const res: string[] = [];
	let _clean = 0;
	for (let i = 0; i < 5000; i++) {
		const base = Array.from({ length: 3 + Math.floor(rand() * 6) }, (_, j) => `- item ${j}\n`);
		const S = edit(base, rand, "S");
		const L = edit(S, rand, "L");
		const R = edit(S, rand, "R");
		const m = merge3(base.join(""), L.join(""), R.join(""));
		if (!m.clean) continue;
		_clean++;
		const lines = m.text.split("\n").filter(Boolean);
		const ex = JSON.stringify([base.join(""), L.join(""), R.join(""), m.text]);
		if (new Set(lines).size !== lines.length) dups.push(ex);
		for (const t of S)
			if (!(L.includes(t) && R.includes(t)) && m.text.includes(t)) {
				res.push(ex);
				break;
			}
	}
	dups.sort((a, b) => a.length - b.length);
	res.sort((a, b) => a.length - b.length);
	expect(dups.length).toBe(0);
});
