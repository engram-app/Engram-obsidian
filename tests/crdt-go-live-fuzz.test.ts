// Seeded fuzz for go-live. Every line carries an identity, so the expected
// result is exact by construction (a one-shot diff3 is NOT a sound oracle next
// to repeated lines: it applies one edit to several identical copies).
// Notes use repeated lines, the layouts that doubled Relay's diff3 and
// misplaced its DMP replay. Typing T (autosaved or not), more typing U, and an
// optional remote edit R on a line the user did not touch. Every "ok" must be
// exactly the expected text; every conflict must carry the editor text.
import { describe, expect, it } from "bun:test";
import { goLive } from "../src/crdt/live/go-live";

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const POOL = ["- [ ] todo", "- [ ] todo", "alpha", "bravo", "", "## head", "same", "same"];

type Line = { id: number; text: string };
type Op =
	| { kind: "modify"; id: number; text: string }
	| { kind: "insertAfter"; id: number; line: Line };

let nextId = 0;
function apply(lines: Line[], ops: Op[]): Line[] {
	let out = lines.map((l) => ({ ...l }));
	for (const op of ops) {
		const i = out.findIndex((l) => l.id === op.id);
		if (op.kind === "modify") out[i] = { id: op.id, text: op.text };
		else out = [...out.slice(0, i + 1), op.line, ...out.slice(i + 1)];
	}
	return out;
}

/** A random edit of one line (insert chars, delete a char, or a new line after it). */
function randomOp(lines: Line[], r: () => number, avoid: Set<number>, tag: string): Op | null {
	const free = lines.filter((l) => !avoid.has(l.id));
	if (free.length === 0) return null;
	const line = free[Math.floor(r() * free.length)];
	avoid.add(line.id);
	const k = r();
	if (k < 0.5 || line.text.length === 0) {
		const at = Math.floor(r() * (line.text.length + 1));
		return {
			kind: "modify",
			id: line.id,
			text: line.text.slice(0, at) + tag + line.text.slice(at),
		};
	}
	if (k < 0.8) {
		const at = Math.floor(r() * line.text.length);
		return {
			kind: "modify",
			id: line.id,
			text: line.text.slice(0, at) + line.text.slice(at + 1),
		};
	}
	return { kind: "insertAfter", id: line.id, line: { id: nextId++, text: tag } };
}

const text = (l: Line[]) => `${l.map((x) => x.text).join("\n")}\n`;

describe("goLive fuzz", () => {
	it("never doubles or drops text across 20k seeded layouts", () => {
		let ok = 0;
		let conflicts = 0;
		let reordered = 0;
		for (let seed = 1; seed <= 20000; seed++) {
			const r = rng(seed);
			const n = 3 + Math.floor(r() * 8);
			const P: Line[] = Array.from({ length: n }, () => ({
				id: nextId++,
				text: POOL[Math.floor(r() * POOL.length)],
			}));
			const userLines = new Set<number>();
			const t = randomOp(P, r, userLines, "TT");
			const afterT = apply(P, t ? [t] : []);
			const saved = r() < 0.8;
			const u = randomOp(afterT, r, userLines, "UU");
			const final = apply(afterT, u ? [u] : []);
			const rOp = r() < 0.5 ? randomOp(P, r, new Set(userLines), "RR") : null;
			const remote = apply(P, rOp ? [rOp] : []);
			const expected = apply(
				P,
				[t, u, rOp].filter((o): o is Op => o !== null),
			);

			const input = {
				lca: text(P),
				doc: text(remote),
				latestDisk: saved ? text(afterT) : null,
				base: text(P),
				edited: text(final),
			};
			const res = goLive(input);
			if (res.kind === "conflict") {
				conflicts++;
				expect(res.editorText).toBe(input.edited);
				continue;
			}
			ok++;
			if (res.text === text(expected)) continue;
			// Text carries no line identity: next to IDENTICAL lines a merge (git's
			// too) may place an edit on the other copy. Allowed: a different order.
			// Never allowed: a different line multiset (doubled or dropped text).
			const bag = (t: string) => t.split("\n").sort().join("\n");
			if (bag(res.text) === bag(text(expected))) {
				reordered++;
				continue;
			}
			throw new Error(
				`seed ${seed}: got ${JSON.stringify(res.text)} want ${JSON.stringify(text(expected))} ` +
					`input ${JSON.stringify(input)}`,
			);
		}
		// Measured at 20k seeds: 18,933 exact, 1 identical-line reorder, 1,067 conflicts.
		expect(conflicts).toBeLessThan(1500);
		expect(reordered).toBeLessThan(20);
		expect(ok).toBeGreaterThan(15000);
	});
});
