// Pure decision helpers for the live-binding ViewPlugin, split out so the tricky
// reconcile + re-attach logic is unit-testable without mounting a real CodeMirror
// editor. The ViewPlugin (live-binding.ts) executes whatever these return.
import { type CmChangeSpec, textDiffToChangeSpec } from "./cm-yjs-bridge";

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
	| { kind: "forward"; changes: CmChangeSpec[] };

export function decideReconcile(
	editorText: string,
	docText: string,
	dirty: boolean,
): ReconcileAction {
	// Unseeded doc + a disk body: NEVER seed locally (the server owns this doc and
	// a local seed forks a second lineage -> #846 doubling / base loss). Wait for
	// the server / sync-engine to seed it, then reconcile. Holds even if the user
	// typed: a brand-new note is seeded through the sync-engine push path.
	if (docText.length === 0 && editorText.length > 0) return { kind: "defer" };
	if (editorText === docText) return { kind: "noop" };
	if (dirty) {
		// The editor diverges because the user typed during hydration. Forward those
		// edits INTO the doc (turn docText -> editorText) so they are preserved and
		// broadcast. Reverting the editor to docText here is the cold-open edit-loss
		// bug. (In the rare case the doc was ALSO server-newer, this prefers the
		// local edits over the unseen remote ones — the user's own keystrokes win.)
		return { kind: "forward", changes: textDiffToChangeSpec(docText, editorText) };
	}
	// The user did NOT type; the editor is just stale disk while the doc holds
	// authoritative (e.g. server-newer) content. Snap the editor to the doc.
	return { kind: "adopt", changes: textDiffToChangeSpec(editorText, docText) };
}
