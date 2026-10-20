/**
 * Apply a disk edit to a Y.Doc's text WITHOUT reverting remote work.
 *
 * The problem this replaces (#357). `seedContentInto` ends in
 * `diffIntoYText(text, diskBody)` — a TWO-way diff that forces the Y.Text to
 * equal the disk snapshot. Any remote op that landed between reading the file
 * and running the diff is absent from that snapshot, so the diff deletes it.
 * That is the stale-snapshot revert class (e2e test_83), and it is why
 * `applyLocalEdit` carries a 3-attempt retry loop that ticks `remoteSeq` and
 * awaits `pendingFlush` just to detect the race — a workaround for a missing
 * merge base.
 *
 * With a base (the last-synced content, which `BaseStore` already persists —
 * its own docstring calls it "the common ancestor for 3-way merge") the right
 * operation is not "make the doc equal disk" but "apply the disk's delta
 * RELATIVE TO THE BASE onto the doc". Remote ops survive because they exist in
 * the doc and are untouched by that delta.
 *
 * ponytail: `diff-match-patch` is already a dependency and `patch_make` /
 * `patch_apply` is precisely this operation. No node-diff3, no
 * hand-rolled merge.
 */

import { diff_match_patch } from "diff-match-patch";

export interface LcaMergeResult {
	/** Merged text. Usable even when `clean` is false. */
	text: string;
	/** False when at least one hunk could not be applied — overlapping edits to
	 *  the same region. The caller must not treat a dirty merge as authoritative;
	 *  it should fall back to its conflict path rather than silently shipping
	 *  mangled content. */
	clean: boolean;
}

/**
 * Merge the disk-side delta onto the document's current text.
 *
 * @param base    last-synced content (the common ancestor)
 * @param disk    what the file says now
 * @param current what the Y.Doc says now (may already contain remote work)
 */
export function mergeDiskOntoDoc(base: string, disk: string, current: string): LcaMergeResult {
	// Nothing changed on disk relative to the base: there is no delta to apply,
	// and forcing the doc back toward a stale snapshot is exactly the bug.
	if (base === disk) return { text: current, clean: true };
	// The doc has not moved since the base, so the disk content IS the answer.
	// Short-circuited rather than routed through patching, which can fuzz.
	if (base === current) return { text: disk, clean: true };

	const dmp = new diff_match_patch();
	const patches = dmp.patch_make(base, disk);
	const [merged, applied] = dmp.patch_apply(patches, current);
	return { text: merged, clean: applied.every(Boolean) };
}

/** One side's change to the base: replace `base[start, end)` with `text`. */
interface Edit {
	start: number;
	end: number;
	text: string;
}

function editsFrom(dmp: diff_match_patch, base: string, other: string): Edit[] {
	const diffs = dmp.diff_main(base, other);
	dmp.diff_cleanupSemantic(diffs);
	const out: Edit[] = [];
	let pos = 0;
	let cur: Edit | null = null;
	for (const [op, s] of diffs) {
		if (op === 0) {
			if (cur) out.push(cur);
			cur = null;
			pos += s.length;
			continue;
		}
		cur ??= { start: pos, end: pos, text: "" };
		if (op === -1) {
			pos += s.length;
			cur.end = pos;
		} else {
			cur.text += s;
		}
	}
	if (cur) out.push(cur);
	return out;
}

/** Edits that cannot both apply: their replaced ranges overlap, or one
 *  inserts strictly inside the range the other replaces. Two insertions at
 *  the same point do not conflict; both are kept, as a CRDT would. */
function conflicts(a: Edit, b: Edit): boolean {
	if (a.start < b.end && b.start < a.end) return true;
	const inside = (p: number, e: Edit) => e.start < p && p < e.end;
	return (a.start === a.end && inside(a.start, b)) || (b.start === b.end && inside(b.start, a));
}

/**
 * Three-way merge of two texts that both descend from `base`, with CRDT-like
 * semantics: every edit from both sides applies; insertions at the same point
 * are all kept (`remote` first); an edit made identically on both sides
 * applies once. Not clean when the two sides changed overlapping text, and
 * then `text` is `remote` unchanged, so a caller that ignores `clean` loses
 * nothing remote.
 *
 * Unlike `mergeDiskOntoDoc` this never fuzzy-matches: diff-match-patch's
 * patch_apply reports a same-word conflict as clean and drops one side.
 */
export function merge3(base: string, local: string, remote: string): LcaMergeResult {
	const dmp = new diff_match_patch();
	const mine = editsFrom(dmp, base, local);
	const theirs = editsFrom(dmp, base, remote).filter(
		(r) => !mine.some((m) => m.start === r.start && m.end === r.end && m.text === r.text),
	);
	for (const m of mine) {
		const clash = theirs.some((r) => conflicts(m, r));
		if (clash) return { text: remote, clean: false };
	}
	// Remote before local at the same start; at one start an insertion
	// (empty range) goes before a replacement so the replacement still finds
	// its base text.
	const all = [...theirs.map((e) => ({ e, side: 0 })), ...mine.map((e) => ({ e, side: 1 }))].sort(
		(x, y) =>
			x.e.start - y.e.start ||
			Number(x.e.end > x.e.start) - Number(y.e.end > y.e.start) ||
			x.side - y.side,
	);
	let out = "";
	let pos = 0;
	for (const { e } of all) {
		out += base.slice(pos, e.start) + e.text;
		pos = Math.max(pos, e.end);
	}
	return { text: out + base.slice(pos), clean: true };
}
