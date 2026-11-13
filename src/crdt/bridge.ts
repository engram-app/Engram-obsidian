import { diff_match_patch } from "diff-match-patch";
import type * as Y from "yjs";
import { lfView } from "./line-endings";

const dmp = new diff_match_patch();

/**
 * Seed disk content into a fresh doc exactly once.
 * Guard 1: skip if an LCA already exists (another device owns the history).
 * Guard 2: only seed when the doc is empty or already equals disk (no clobber).
 * Returns true if content was inserted.
 */
export function seedOnce(text: Y.Text, disk: string, hasLca: boolean): boolean {
	if (hasLca) return false;
	const current = text.toJSON();
	if (current === disk) return false; // already in sync, nothing to seed
	if (current.length > 0) return false; // non-empty + mismatch → wait for remote, don't double-seed
	text.insert(0, disk);
	return true;
}

/**
 * Apply `incoming` onto `text` as minimal inserts/deletes — never full replace.
 * diff-match-patch operates on JS string indices (UTF-16), which matches Y.Text's
 * native UTF-16 offset model, so multibyte codepoints (emoji, CJK surrogate
 * pairs) are handled correctly without any offset translation.
 *
 * The whole op loop runs in ONE transaction: each bare insert/delete is its
 * own implicit transaction, so one logical edit would otherwise ship as
 * several independently-observable updates — receivers could flush a
 * truncated intermediate state to disk (e2e test_83 corruption class).
 */
export function diffIntoYText(text: Y.Text, incoming: string): void {
	// Diff against the doc's LF view and map back to raw offsets, so a CR
	// already in the doc is never deleted-and-reinserted: only the server room
	// removes those (one healer, ./line-endings.ts). Identity for an LF doc.
	const { view: current, rawAt } = lfView(text.toJSON());
	if (current === incoming) return;

	const diffs = dmp.diff_main(current, incoming);
	dmp.diff_cleanupSemantic(diffs);

	const apply = (): void => {
		let cursor = 0; // in the view
		let shift = 0; // raw length change applied so far
		for (const [op, data] of diffs) {
			if (op === 0) {
				cursor += data.length; // EQUAL — advance cursor
			} else if (op === 1) {
				text.insert(rawAt(cursor) + shift, data); // INSERT
				shift += data.length;
			} else {
				const from = rawAt(cursor);
				const len = rawAt(cursor + data.length) - from;
				text.delete(from + shift, len); // DELETE
				shift -= len;
				cursor += data.length;
			}
		}
	};
	if (text.doc) text.doc.transact(apply);
	else apply();
}
