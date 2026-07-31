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
 * `patch_apply` is precisely this operation. No node-diff3 (what Relay uses), no
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
