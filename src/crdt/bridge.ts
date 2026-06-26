import { diff_match_patch } from "diff-match-patch";
import type * as Y from "yjs";

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
 */
export function diffIntoYText(text: Y.Text, incoming: string): void {
	const current = text.toJSON();
	if (current === incoming) return;

	const diffs = dmp.diff_main(current, incoming);
	dmp.diff_cleanupSemantic(diffs);

	let cursor = 0;
	for (const [op, data] of diffs) {
		if (op === 0) {
			cursor += data.length; // EQUAL — advance cursor
		} else if (op === 1) {
			text.insert(cursor, data); // INSERT
			cursor += data.length;
		} else {
			text.delete(cursor, data.length); // DELETE — cursor stays
		}
	}
}
