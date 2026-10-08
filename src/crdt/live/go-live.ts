// The live binding's go-live reconcile (#544). Relay's layering, plus one change.
//
// Relay (merge-hsm/MergeHSM.ts): while a note is "entering" (bound, not live)
// editor typing never reaches the doc and disk changes are only accumulated; at
// go-live the doc is 3-way merged with the latest disk text against the LCA,
// then the typing is replayed. Relay replays raw keystroke positions, and its
// rebase (replayBufferedEdits.ts) runs only when Obsidian reloads the editor,
// so an autosave during entering doubles the typing. Run against Relay's own
// code, that sequence doubled and misplaced text.
//
// The change: always rebase the typing, as a second diff3 whose ancestor is the
// disk side. That ancestor is exact by construction, not guessed: Obsidian's
// autosave is a snapshot of THIS editor (so disk is an ancestor of the editor
// text), and step 1 merged disk into the doc (so the doc contains it).
import { adaptiveDiff3Merge } from "../diff3";

export interface GoLiveInput {
	/** Last text the doc and disk provably agreed on, or null when unknown. */
	lca: string | null;
	/** The doc's text now (may hold remote edits that landed while entering). */
	doc: string;
	/** The latest disk text seen while entering, or null if disk did not change. */
	latestDisk: string | null;
	/** The editor's text when the binding attached, before any typing. */
	base: string;
	/** The editor's text now. */
	edited: string;
}

export type GoLiveResult =
	| { kind: "ok"; text: string }
	/** Doc wins; `editorText` must be preserved (conflict copy), never dropped. */
	| { kind: "conflict"; text: string; editorText: string };

/** Relay's performThreeWayMerge (MergeHSM.ts:7422): line-tokenized diff3,
 *  identical changes on both sides collapse. Null on any conflict. */
export function threeWayMerge(lca: string, ours: string, theirs: string): string | null {
	if (ours === theirs) return ours;
	if (ours === lca) return theirs;
	if (theirs === lca) return ours;
	const tok = (s: string) => s.split(/(\n)/);
	const regions = adaptiveDiff3Merge(tok(ours), tok(lca), tok(theirs));
	if (regions.some((r) => "conflict" in r)) return null;
	return regions.flatMap((r) => ("ok" in r && r.ok ? r.ok : [])).join("");
}

export function goLive({ lca, doc, latestDisk, base, edited }: GoLiveInput): GoLiveResult {
	// The disk side: the latest autosave while entering, else the text the
	// editor loaded (also a disk version). It is an ancestor of `edited` by
	// construction: Obsidian's autosave snapshots this editor, and an external
	// modify reaches the editor as a reload Obsidian writes back.
	const disk = latestDisk ?? base;

	// 1. Merge the disk side into the doc (Relay's go-live 3-way merge).
	//    No LCA: Relay's two-way rule, equal is clean, anything else a conflict.
	const merged = lca === null ? (disk === doc ? doc : null) : threeWayMerge(lca, doc, disk);
	if (merged === null) return { kind: "conflict", text: doc, editorText: edited };

	// 2. Rebase the typing not yet on disk onto the merge. `disk` is the exact
	//    common ancestor of `merged` (disk + remote) and `edited` (disk + typing),
	//    so this is a true 3-way merge, not a fuzzy patch (Relay's DMP replay
	//    misplaces text next to repeated lines).
	const out = threeWayMerge(disk, merged, edited);
	if (out === null) return { kind: "conflict", text: merged, editorText: edited };
	return { kind: "ok", text: out };
}
