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

/** `other`'s edits against `base`. Line level is diff3 granularity: a
 *  character diff's alignment shifts with cleanup, so the same edit on both
 *  sides stops looking identical (duplicated on merge) and same-point inserts
 *  can split a "\r\n". Character level only re-merges one conflicting
 *  region (`merge3`), where both sides' text is short and local. */
function editsFrom(base: string, other: string, granularity: "line" | "char"): Edit[] {
	const dmp = new diff_match_patch();
	let diffs: [number, string][];
	if (granularity === "line") {
		const lines = dmp.diff_linesToChars_(base, other);
		diffs = dmp.diff_main(lines.chars1, lines.chars2, false);
		dmp.diff_charsToLines_(diffs, lines.lineArray);
	} else {
		diffs = dmp.diff_main(base, other);
		dmp.diff_cleanupSemantic(diffs);
	}
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

/** Line-level edits that cannot both apply as lines. Like git's merge, any
 *  edits that overlap or TOUCH conflict: with repeated lines (blank lines,
 *  list items) the line diff can pin an edit to the wrong copy, and touching
 *  edits are where that loses one side's line. The one exception is two pure
 *  insertions at the same point (both appended a line, the concurrent-edit
 *  case): both are kept, remote first, as a CRDT would, unless one contains
 *  the other (the same edit extended on one side; keeping both duplicates it)
 *  or either leaves a line open (no trailing newline; keeping both joins two
 *  lines). A conflict here is only a candidate: `merge3` re-merges it at
 *  character level. */
function conflicts(a: Edit, b: Edit): boolean {
	if (a.start > b.end || b.start > a.end) return false;
	const sameInsertPoint = a.start === a.end && b.start === b.end && a.start === b.start;
	if (!sameInsertPoint) return true;
	if (a.text.includes(b.text) || b.text.includes(a.text)) return true;
	return !a.text.endsWith("\n") || !b.text.endsWith("\n");
}

/** Character-level edits that truly overlap: replaced ranges that share a
 *  character, two insertions at one point (their order is unknowable), or an
 *  insertion inside or AT EITHER END of the other side's replaced range
 *  (which side of a deleted "\n" it lands on decides whether two lines join,
 *  so that is ambiguous too). Two replacements that only touch are fine. */
function overlaps(a: Edit, b: Edit): boolean {
	const aIns = a.start === a.end;
	const bIns = b.start === b.end;
	if (aIns && bIns) return a.start === b.start;
	if (aIns) return b.start <= a.start && a.start <= b.end;
	if (bIns) return a.start <= b.start && b.start <= a.end;
	return a.start < b.end && b.start < a.end;
}

const same = (a: Edit, b: Edit) => a.start === b.start && a.end === b.end && a.text === b.text;

/** Apply non-overlapping edits from both sides to `base`. Remote before
 *  local at the same start; at one start an insertion (empty range) goes
 *  before a replacement so the replacement still finds its base text. */
function apply(base: string, edits: { e: Edit; side: number }[]): string {
	const all = [...edits].sort(
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
	return out + base.slice(pos);
}

/** Merge one conflicting region at character level; null on a true overlap. */
function mergeRegion(base: string, local: string, remote: string): string | null {
	const mine = editsFrom(base, local, "char");
	const theirs = editsFrom(base, remote, "char").filter((r) => !mine.some((m) => same(m, r)));
	if (mine.some((m) => theirs.some((r) => overlaps(m, r)))) return null;
	return apply(base, [
		...theirs.map((e) => ({ e, side: 0 })),
		...mine.map((e) => ({ e, side: 1 })),
	]);
}

/**
 * Three-way merge of two texts that both descend from `base`, at line
 * granularity like diff3: every edit from both sides applies; distinct
 * insertions at the same point are both kept (`remote` first); an edit made
 * identically on both sides applies once. Line edits that overlap or touch
 * (see `conflicts`) are grouped into regions, and each region is re-merged at
 * character level, so edits on adjacent lines, or to different words of one
 * line, still merge. Not clean only when character edits truly overlap
 * (`overlaps`); `text` is then `remote` unchanged, so a caller that ignores
 * `clean` loses nothing remote.
 *
 * Unlike `mergeDiskOntoDoc` this never fuzzy-matches: diff-match-patch's
 * patch_apply reports a same-word conflict as clean and drops one side.
 */
export function merge3(base: string, local: string, remote: string): LcaMergeResult {
	const mine = editsFrom(base, local, "line");
	const theirs = editsFrom(base, remote, "line").filter((r) => !mine.some((m) => same(m, r)));
	type Side = { e: Edit; side: number };
	// Group clashing edits into regions. Each side's edits are disjoint and
	// sorted, so a chain of clashes is a run of consecutive edits by start.
	const sorted: Side[] = [
		...theirs.map((e) => ({ e, side: 0 })),
		...mine.map((e) => ({ e, side: 1 })),
	].sort((x, y) => x.e.start - y.e.start || x.e.end - y.e.end);
	const regions: Side[][] = [];
	for (const x of sorted) {
		const last: Side[] | undefined = regions[regions.length - 1];
		if (last?.some((m) => m.side !== x.side && conflicts(m.e, x.e))) last.push(x);
		else regions.push([x]);
	}
	const out: Side[] = [];
	for (const members of regions) {
		if (members.every((m) => m.side === members[0]?.side)) {
			out.push(...members);
			continue;
		}
		const start = Math.min(...members.map((m) => m.e.start));
		const end = Math.max(...members.map((m) => m.e.end));
		const region = base.slice(start, end);
		const shift = (side: number) =>
			members
				.filter((m) => m.side === side)
				.map((m) => ({
					e: { ...m.e, start: m.e.start - start, end: m.e.end - start },
					side,
				}));
		const text = mergeRegion(region, apply(region, shift(1)), apply(region, shift(0)));
		if (text === null) return { text: remote, clean: false };
		out.push({ e: { start, end, text }, side: 0 });
	}
	return { text: apply(base, out), clean: true };
}
