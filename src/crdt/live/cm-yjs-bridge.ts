// CM6 <-> Y.Text offset transforms. Adapted from Relay's LiveNodePlugin.ts
// (No-Instructions/Relay; MIT, y-codemirror.next by Kevin Jahns).
import type * as Y from "yjs";

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
