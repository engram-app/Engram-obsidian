// CM6 <-> Y.Text offset transforms. Adapted from Relay's LiveNodePlugin.ts
// (No-Instructions/Relay; MIT, y-codemirror.next by Kevin Jahns).
import { diff_match_patch } from "diff-match-patch";
import type * as Y from "yjs";

const dmp = new diff_match_patch();

export interface YDeltaEntry {
	insert?: string;
	delete?: number;
	retain?: number;
}

export interface CmChangeSpec {
	from: number;
	to: number;
	insert: string;
}

/** Convert a Y.Text observe() delta into CM6 ChangeSpec entries. Y deltas are
 *  expressed as retain/insert/delete walking a cursor; CM6 wants absolute
 *  from/to/insert triplets against the PRE-change document, so a delete
 *  advances the cursor by its length while an insert does not. */
export function yDeltaToChangeSpec(delta: YDeltaEntry[]): CmChangeSpec[] {
	const changes: CmChangeSpec[] = [];
	let pos = 0;
	for (const d of delta) {
		if (d.insert != null) {
			changes.push({ from: pos, to: pos, insert: d.insert });
		} else if (d.delete != null) {
			changes.push({ from: pos, to: pos + d.delete, insert: "" });
			pos += d.delete;
		} else if (d.retain != null) {
			pos += d.retain;
		}
	}
	return changes;
}

/** Apply CM6 iterChanges-shaped edits onto a Y.Text. `adj` tracks the running
 *  offset shift as earlier edits change the document length. Caller MUST wrap
 *  this in ytext.doc.transact(fn, origin) so the origin guard works. */
export function applyCmChangesToYText(
	ytext: Y.Text,
	changes: Array<{ fromA: number; toA: number; insert: string }>,
): void {
	let adj = 0;
	for (const c of changes) {
		if (c.fromA !== c.toA) {
			ytext.delete(c.fromA + adj, c.toA - c.fromA);
		}
		if (c.insert.length > 0) {
			ytext.insert(c.fromA + adj, c.insert);
		}
		adj += c.insert.length - (c.toA - c.fromA);
	}
}

/** Compute minimal CM6 ChangeSpec entries to transform `before` into `after`.
 *  Uses diff-match-patch (UTF-16 offsets, matches Y.Text's native model).
 *  Returns [] when before === after. Walk: EQUAL advances cursor; INSERT emits
 *  {cursor,cursor,text} without advancing cursor into `before`; DELETE emits
 *  {cursor,cursor+len,""} and advances cursor by len.
 *
 *  A replacement comes out of dmp as DELETE-then-INSERT (diff_cleanupSemantic
 *  ends in diff_cleanupMerge, which orders deletions first), which would emit two
 *  changes touching the same boundary. They are coalesced into ONE replacement:
 *  Relay hit CM6 silently dropping the split pair (ViewHookPlugin
 *  `incrementalBufferChange`), and a single replace is what both CM6 and
 *  applyCmChangesToYText handle most predictably anyway. */
export function textDiffToChangeSpec(before: string, after: string): CmChangeSpec[] {
	if (before === after) return [];
	const diffs = dmp.diff_main(before, after);
	dmp.diff_cleanupSemantic(diffs);
	const changes: CmChangeSpec[] = [];
	let cursor = 0;
	for (const [op, data] of diffs) {
		if (op === 0) {
			cursor += data.length; // EQUAL: advance cursor through `before`
		} else if (op === 1) {
			const prev = changes[changes.length - 1];
			// INSERT butted against the preceding DELETE -> fold into a replacement.
			if (prev && prev.to === cursor && prev.insert === "") {
				prev.insert = data;
			} else {
				changes.push({ from: cursor, to: cursor, insert: data }); // no cursor advance
			}
		} else {
			changes.push({ from: cursor, to: cursor + data.length, insert: "" }); // DELETE
			cursor += data.length;
		}
	}
	return changes;
}
