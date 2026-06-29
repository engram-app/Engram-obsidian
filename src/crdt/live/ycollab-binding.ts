// yCollab-based editor<->Y.Text binding, swappable per note via a CM6 Compartment.
// Built from y-codemirror.next's low-level pieces instead of bare yCollab() so we
// can scope the UndoManager to local-only edits and install a high-precedence
// Mod-z keymap. Bare yCollab() adds a UndoManager but NO Mod-z keymap, so
// Obsidian's native undo runs and reverts remote-applied transactions, then
// ySync propagates the revert as a local delete (divergence).
import { type AnnotationType, Compartment, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
// yCollab, YSyncConfig, and yUndoManagerKeymap are all re-exported from the
// package root (confirmed in node_modules/y-codemirror.next/src/index.js).
// Deep imports (yUndoManagerFacet, ySyncAnnotation, etc.) are NOT re-exported,
// and the package's exports map blocks them at runtime (Bun enforces exports),
// so we use yCollab() with a custom scoped UndoManager option instead.
import { YSyncConfig, yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type CmChangeSpec, textDiffToChangeSpec } from "./cm-yjs-bridge";

/** The single Compartment that holds the active note's yCollab binding. The
 *  plugin registers ycollabExtension() once; CrdtLiveViews reconfigures this
 *  Compartment to bindSpec(newYtext, awareness) on note switch. */
export const crdtCompartment = new Compartment();

/** Registered once via registerEditorExtension. Empty until a note binds. */
export function ycollabExtension(): Extension {
	return crdtCompartment.of([]);
}

/** Returned by bindSpec: the CM6 extension bundle, the per-bind YSyncConfig,
 *  and a lazy getter for y-codemirror.next's internal ySyncAnnotation type
 *  (captured on first remote dispatch). The controller uses these to annotate
 *  drift-repair dispatches so ySync ignores them. */
export interface BindResult {
	extension: Extension;
	syncConfig: YSyncConfig;
	/** Returns y-codemirror.next's ySyncAnnotation type once ySync has dispatched
	 *  at least one remote-to-editor update. Null until then (drift check is a no-op
	 *  annotation-wise on the first interval if no remote edit has arrived yet). */
	getSyncAnnotationType: () => AnnotationType<YSyncConfig> | null;
}

/** Captures y-codemirror.next's internal ySyncAnnotation type the first time
 *  ySync dispatches a remote-to-editor update (line 123 in y-sync.js:
 *  `view.dispatch({ annotations: [ySyncAnnotation.of(this.conf)] })`).
 *
 *  The package's exports map blocks direct deep imports at runtime (Bun enforces
 *  exports), so we capture the EXACT AnnotationType instance by reading it from
 *  the first annotated transaction that has our syncConfig as the annotation value.
 *  This is the same annotation that ySync's update() checks on line 134:
 *  `tr.annotation(ySyncAnnotation) === this.conf`. */
function makeSyncAnnotationCapture(
	syncConfig: YSyncConfig,
	onCapture: (at: AnnotationType<YSyncConfig>) => void,
): Extension {
	let captured = false;
	return EditorView.updateListener.of((update) => {
		if (captured) return;
		for (const tr of update.transactions) {
			// Transactions store annotations as an array of Annotation<T> objects.
			// Each Annotation has `.type` (the AnnotationType) and `.value`.
			// ySync stamps each remote-to-editor dispatch with ySyncAnnotation.of(conf),
			// so we look for the annotation whose value IS our syncConfig instance.
			const rawAnnotations = (
				tr as unknown as {
					annotations?: ReadonlyArray<{
						type: AnnotationType<YSyncConfig>;
						value: unknown;
					}>;
				}
			).annotations;
			if (!rawAnnotations) continue;
			for (const ann of rawAnnotations) {
				if (ann.value === syncConfig) {
					captured = true;
					onCapture(ann.type);
					return;
				}
			}
		}
	});
}

/** Build the live binding using yCollab() with a scoped UndoManager plus a
 *  high-precedence Mod-z keymap that beats Obsidian's native history handler.
 *
 *  Key design choices:
 *  - yCollab() is called with our own Y.UndoManager scoped to ONLY the
 *    YSyncConfig as its tracked origin. Remote peers' edits (null or "remote"
 *    origin) are never added to the undo stack.
 *  - Prec.highest(keymap.of(yUndoManagerKeymap)) is prepended so it beats
 *    Obsidian's native CM6 history keymap for Mod-z / Mod-Shift-z. Real-Obsidian
 *    validation still needed (see task-B-undo-report.md).
 *  - yCollab() already includes a beforeinput handler for platform-level undo
 *    (mobile, macOS Edit menu, OS accessibility).
 *  - ySyncAnnotation is captured lazily from the first ySync remote dispatch
 *    so drift-repair dispatches use the exact AnnotationType ySync checks. */
export function bindSpec(ytext: Y.Text, awareness: Awareness): BindResult {
	const syncConfig = new YSyncConfig(ytext, awareness);
	// Scope the UndoManager to local-only edits. REMOTE_ORIGIN ("remote") and
	// null origins are excluded, so Ctrl+Z never undoes remote peers' edits.
	const undoManager = new Y.UndoManager(ytext, {
		trackedOrigins: new Set([syncConfig]),
	});

	let capturedAnnotationType: AnnotationType<YSyncConfig> | null = null;
	const captureExt = makeSyncAnnotationCapture(syncConfig, (at) => {
		capturedAnnotationType = at;
	});

	// yCollab builds: ySyncFacet.of(syncConfig), ySync, remoteSelections (when
	// awareness is provided), yUndoManagerFacet, yUndoManager, beforeinput handler.
	// Passing our scoped undoManager replaces the default unscoped one.
	const ycollabExt = yCollab(ytext, awareness, { undoManager });

	const extension: Extension = [
		captureExt,
		ycollabExt,
		// Prec.highest so this keymap beats Obsidian's built-in history Mod-z.
		// yUndoManagerKeymap's handlers call preventDefault, so the native history
		// does not also fire.
		Prec.highest(keymap.of(yUndoManagerKeymap)),
	];
	return {
		extension,
		syncConfig,
		getSyncAnnotationType: () => capturedAnnotationType,
	};
}

/** Minimal CM changes to make an editor whose current text is `currentDoc`
 *  equal the Y.Text content. yCollab only forwards FUTURE deltas, so on bind
 *  the editor must be reconciled to the existing Y.Text content first. Returns
 *  [] when already equal. */
export function reconcileEditorToYText(currentDoc: string, ytext: Y.Text): CmChangeSpec[] {
	return textDiffToChangeSpec(currentDoc, ytext.toJSON());
}
