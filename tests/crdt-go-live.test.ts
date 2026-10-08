// #544 go-live: Relay's layering (go-live diff3 of LCA, doc, latest disk) plus
// an always-on rebase of the typing layer. Sequences 1-3 are the ones Relay's
// own MergeHSM got wrong when run (doubling / misplacement).
import { describe, expect, it } from "bun:test";
import { goLive, threeWayMerge } from "../src/crdt/live/go-live";

const P = "alpha\nbravo\ncharlie\n";
const withT = "alpha\nbravoTTT\ncharlie\n";
const withTU = "alpha\nbravoTTT\ncharlieUUU\n";
const S = "ALPHA-S\nbravo\ncharlie\n";

describe("goLive", () => {
	it("autosave during entering, then more typing: typing once (Relay doubled it)", () => {
		const r = goLive({ lca: P, doc: P, latestDisk: withT, base: P, edited: withTU });
		expect(r).toEqual({ kind: "ok", text: withTU });
	});

	it("same with a remote edit during entering: remote kept, typing once and in place", () => {
		const r = goLive({ lca: P, doc: S, latestDisk: withT, base: P, edited: withTU });
		expect(r).toEqual({ kind: "ok", text: "ALPHA-S\nbravoTTT\ncharlieUUU\n" });
	});

	it("autosave with no further typing: typing once", () => {
		const r = goLive({ lca: P, doc: P, latestDisk: withT, base: P, edited: withT });
		expect(r).toEqual({ kind: "ok", text: withT });
	});

	it("saved deletion, then more typing: deletion kept", () => {
		const deleted = "alpha\nbravo\n";
		const r = goLive({
			lca: P,
			doc: S,
			latestDisk: deleted,
			base: P,
			edited: "alpha\nbravo\nnew\n",
		});
		expect(r).toEqual({ kind: "ok", text: "ALPHA-S\nbravo\nnew\n" });
	});

	it("doc seeded from an older autosave: newer typing once", () => {
		const d1 = "alpha\nbravoT1\ncharlie\n";
		const d2 = "alpha\nbravoT1\ncharlieT2\n";
		const r = goLive({ lca: d1, doc: d1, latestDisk: d2, base: P, edited: `${d2}T3\n` });
		expect(r).toEqual({ kind: "ok", text: `${d2}T3\n` });
	});

	it("typing never saved: rebased onto a doc that moved", () => {
		const r = goLive({ lca: P, doc: S, latestDisk: null, base: P, edited: withT });
		expect(r).toEqual({ kind: "ok", text: "ALPHA-S\nbravoTTT\ncharlie\n" });
	});

	it("no typing, no disk change: adopt the doc", () => {
		expect(goLive({ lca: P, doc: S, latestDisk: null, base: P, edited: P })).toEqual({
			kind: "ok",
			text: S,
		});
	});

	it("external modify while entering (Obsidian reloads the editor): merged with the doc", () => {
		const ext = "alpha\nbravo\ncharlie\nEXT\n";
		const r = goLive({ lca: P, doc: S, latestDisk: ext, base: ext, edited: ext });
		expect(r).toEqual({ kind: "ok", text: "ALPHA-S\nbravo\ncharlie\nEXT\n" });
	});

	it("same-line conflict: doc wins, editor text kept for a conflict copy", () => {
		const doc = "alpha\nbravo REMOTE\ncharlie\n";
		const r = goLive({ lca: P, doc, latestDisk: withT, base: P, edited: withTU });
		expect(r).toEqual({ kind: "conflict", text: doc, editorText: withTU });
	});

	it("no LCA and disk differs from the doc: conflict, nothing dropped", () => {
		const r = goLive({ lca: null, doc: S, latestDisk: withT, base: P, edited: withTU });
		expect(r).toEqual({ kind: "conflict", text: S, editorText: withTU });
	});

	it("no LCA and disk equals the doc: clean", () => {
		const r = goLive({ lca: null, doc: withT, latestDisk: withT, base: P, edited: withTU });
		expect(r).toEqual({ kind: "ok", text: withTU });
	});
});

describe("threeWayMerge (Relay kernel)", () => {
	it("takes the changed side when the other equals the LCA", () => {
		expect(threeWayMerge(P, P, S)).toBe(S);
		expect(threeWayMerge(P, S, P)).toBe(S);
	});

	it("keeps both sides' changes on different lines", () => {
		expect(threeWayMerge(P, S, withT)).toBe("ALPHA-S\nbravoTTT\ncharlie\n");
	});

	it("returns null on a same-line conflict", () => {
		expect(
			threeWayMerge(P, "alpha\nbravo X\ncharlie\n", "alpha\nbravo Y\ncharlie\n"),
		).toBeNull();
	});
});
