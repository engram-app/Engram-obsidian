// Pure decision helpers for the live-binding ViewPlugin, split out so the tricky
// reconcile + re-attach logic is unit-testable without mounting a real CodeMirror
// editor. The ViewPlugin (live-binding.ts) executes whatever these return.
import { diff_match_patch } from "diff-match-patch";
import { splitFrontmatter } from "../frontmatter-codec";
import { type CmChangeSpec, textDiffToChangeSpec } from "./cm-yjs-bridge";

/** A dedicated dmp instance for the 3-way merge, tuned MUCH stricter than the
 *  defaults (Match_Threshold 0.5 / Patch_DeleteThreshold 0.5). Fuzzy patching
 *  trades "reject the hunk" against "apply it in the wrong place"; in a note-sync
 *  path a misplaced hunk is silent corruption while a rejected hunk just falls
 *  back to the old two-way behavior. So: reject early, never guess. */
const merger = new diff_match_patch();
merger.Match_Threshold = 0.2;
merger.Patch_DeleteThreshold = 0.2;

/** The number of leading characters of the EDITOR's CM document occupied by a
 *  frontmatter block, or 0 if none. The bound Y.Text is body-only; in Live Preview
 *  the CM document is body-only too (prefix 0, everything below is a no-op), but in
 *  Source mode (and Properties-in-document) the raw `---` block is IN the CM text,
 *  so the editor offsets are shifted by this prefix relative to the body Y.Text.
 *  Callers slice/offset by this to keep body edits mapping to the right Y.Text
 *  position instead of corrupting at prefix-length offsets.
 *
 *  Derived from splitFrontmatter (which mirrors the backend byte-for-byte) so
 *  the editor prefix can never disagree with what the codec put in the Y.Text.
 *  A private regex here once diverged on CRLF opening fences and on trailing
 *  spaces before the closing fence — each disagreement IS the offset-corruption
 *  class the doc above warns about. */
export function frontmatterPrefixLen(editorText: string): number {
	const { fmBlock, body } = splitFrontmatter(editorText);
	return fmBlock === null ? 0 : editorText.length - body.length;
}

/** True when the editor must detach from its current doc and re-attach. Catches
 *  THREE cases:
 *   - path changed  -> Obsidian reused this editor for a different file.
 *   - noteId changed -> a genesis ADOPT remapped path -> serverId under the editor.
 *   - coordinator changed -> the whole CRDT stack was torn down + rebuilt (a real
 *     account/backend/vault switch). path + noteId are unchanged in this case, so
 *     without the coordinator check the editor keeps writing into the DESTROYED
 *     doc of the old stack (silent edit loss). */
export function needsReattach(
	bound: { path: string | null; noteId: string | null; coordinator: unknown },
	path: string | null,
	noteId: string | null,
	coordinator: unknown,
): boolean {
	return path !== bound.path || noteId !== bound.noteId || coordinator !== bound.coordinator;
}

/** What to do on the one-shot initial reconcile once the resident doc has
 *  hydrated. The editor text and doc text are body-aligned (Live Preview), so
 *  they are directly comparable. `dirty` = the user typed into the editor during
 *  the async hydration/defer window (those keystrokes are in the editor buffer
 *  but NOT yet in the doc). */
export type ReconcileAction =
	| { kind: "noop" }
	| { kind: "defer" }
	/** Dispatch `changes` into the EDITOR (turn editor into docText): the doc is
	 *  authoritative and the editor is stale disk. */
	| { kind: "adopt"; changes: CmChangeSpec[] }
	/** Apply `changes` into the Y.TEXT (turn docText into editorText): the user's
	 *  local edits must be forwarded, never reverted. */
	| { kind: "forward"; changes: CmChangeSpec[] }
	/** BOTH sides diverged and merged cleanly: apply `toDoc` into the Y.Text and
	 *  `toEditor` into the editor. Either may be empty. */
	| { kind: "merge"; toDoc: CmChangeSpec[]; toEditor: CmChangeSpec[] };

/** 3-way merge of the user's typed edits (`base` -> `editorText`) onto a doc that
 *  moved on independently (`base` -> `docText`). Returns the merged text, or null
 *  when any hunk fails to apply (a genuine conflict, or a base too stale to match)
 *  — the caller then falls back to the old two-way behavior rather than guessing.
 *
 *  Patch-and-apply is the whole trick: `patch_make` captures ONLY what the user
 *  typed plus surrounding context, so every region of `docText` the editor never
 *  saw is left untouched, and the context match re-locates the hunk when remote
 *  text shifted the offsets. A whole-text diff(docText -> editorText) cannot do
 *  either — it deletes anything the editor lacks. */
export function mergeTypedEdits(base: string, editorText: string, docText: string): string | null {
	const patches = merger.patch_make(base, editorText);
	if (patches.length === 0) return docText; // nothing typed
	const [merged, applied] = merger.patch_apply(patches, docText);
	return applied.every(Boolean) ? merged : null;
}

export function decideReconcile(
	editorText: string,
	docText: string,
	dirty: boolean,
	/** The editor's text immediately BEFORE the user's first keystroke this attach
	 *  — the LCA for the merge below. Null when unknown (no base -> old behavior).
	 *  NOTE: deliberately NOT the SyncEngine's BaseStore: that content is only
	 *  refreshed on the REST push/pull paths (CRDT delivery updates the syncState
	 *  hash alone), so for a live-synced note it can be arbitrarily stale, and
	 *  patching a stale base onto the doc re-creates the content-doubling class. */
	base: string | null = null,
): ReconcileAction {
	// Unseeded doc + a disk body: NEVER seed locally (the server owns this doc and
	// a local seed forks a second lineage -> #846 doubling / base loss). Wait for
	// the server / sync-engine to seed it, then reconcile. Holds even if the user
	// typed: a brand-new note is seeded through the sync-engine push path.
	if (docText.length === 0 && editorText.length > 0) return { kind: "defer" };
	if (editorText === docText) return { kind: "noop" };
	if (dirty) {
		// The editor diverges because the user typed during hydration. Those edits
		// must be preserved and broadcast — reverting the editor to docText is the
		// cold-open edit-loss bug.
		//
		// When the doc ALSO moved away from the base (server-newer content hydrated
		// out of IndexedDB that the editor never saw), a whole-text forward would
		// DELETE that remote content. Merge instead: replay only the typed hunks
		// onto the doc and converge both sides on the result.
		if (base !== null && base !== docText) {
			const merged = mergeTypedEdits(base, editorText, docText);
			if (merged !== null) {
				return {
					kind: "merge",
					toDoc: textDiffToChangeSpec(docText, merged),
					toEditor: textDiffToChangeSpec(editorText, merged),
				};
			}
		}
		// No base, or the merge conflicted: fall back to the two-way forward. The
		// user's own keystrokes win over unseen remote ones.
		return { kind: "forward", changes: textDiffToChangeSpec(docText, editorText) };
	}
	// The user did NOT type; the editor is just stale disk while the doc holds
	// authoritative (e.g. server-newer) content. Snap the editor to the doc.
	return { kind: "adopt", changes: textDiffToChangeSpec(editorText, docText) };
}
