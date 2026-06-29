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

/** The annotation type plus the INTERNAL YSyncConfig instance that yCollab
 *  creates inside yCollab(). Both are needed to annotate drift-repair
 *  dispatches so ySync's `tr.annotation(ySyncAnnotation) === this.conf`
 *  check matches and ySync ignores the dispatch. */
export interface CapturedSyncAnnotation {
	type: AnnotationType<YSyncConfig>;
	conf: YSyncConfig;
}

/** Returned by bindSpec: the CM6 extension bundle and a lazy getter for
 *  y-codemirror.next's internal ySyncAnnotation type+conf (captured on first
 *  remote dispatch). The controller uses these to annotate drift-repair
 *  dispatches so ySync ignores them. */
export interface BindResult {
	extension: Extension;
	/** Returns y-codemirror.next's internal ySyncAnnotation type and the
	 *  INTERNAL YSyncConfig once ySync has dispatched at least one
	 *  remote-to-editor update. Null until then (drift check is a no-op
	 *  annotation-wise on the first interval if no remote edit has arrived). */
	getSyncAnnotation: () => CapturedSyncAnnotation | null;
}

/** Captures y-codemirror.next's internal ySyncAnnotation type AND internal
 *  YSyncConfig instance the first time ySync dispatches a remote-to-editor
 *  update (line 123 in y-sync.js:
 *  `view.dispatch({ annotations: [ySyncAnnotation.of(this.conf)] })`).
 *
 *  yCollab() creates its OWN YSyncConfig internally (INTERNAL conf) and puts
 *  it in ySyncFacet. Our external syncConfig is a DIFFERENT instance. Matching
 *  on `instanceof YSyncConfig` (not `=== syncConfig`) ensures we capture the
 *  INTERNAL conf that ySync actually uses. The drift-repair dispatch must
 *  annotate with `type.of(INTERNAL_conf)`: annotating with our external
 *  syncConfig would NOT match ySync's check and would cause double-apply
 *  corruption.
 *
 *  The package's exports map blocks direct deep imports at runtime (Bun enforces
 *  exports), so we capture the EXACT AnnotationType+conf by reading them from
 *  the first annotated transaction that has a YSyncConfig as the annotation value. */
function makeSyncAnnotationCapture(
	onCapture: (captured: CapturedSyncAnnotation) => void,
): Extension {
	let captured = false;
	return EditorView.updateListener.of((update) => {
		if (captured) return;
		for (const tr of update.transactions) {
			// Transactions store annotations as an array of Annotation<T> objects.
			// Each Annotation has `.type` (the AnnotationType) and `.value`.
			// ySync stamps each remote-to-editor dispatch with ySyncAnnotation.of(conf),
			// so we look for the annotation whose value is an instance of YSyncConfig.
			// We match instanceof (not ===) because yCollab creates the internal conf
			// independently; our external syncConfig is a different instance.
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
				if (ann.value instanceof YSyncConfig) {
					captured = true;
					onCapture({ type: ann.type, conf: ann.value });
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
 *  - yCollab() is called with our own Y.UndoManager scoped to an empty
 *    trackedOrigins set. This is intentional: passing `null` (the default)
 *    would track anonymous-origin edits, which we do not want.
 *    YUndoManagerPluginValue.addTrackedOrigin() (line 104 of y-undomanager.js)
 *    adds the real ySync origin (yCollab's INTERNAL YSyncConfig) post-init,
 *    so remote peers' edits are never added to the undo stack.
 *  - Prec.highest(keymap.of(yUndoManagerKeymap)) is prepended so it beats
 *    Obsidian's native CM6 history keymap for Mod-z / Mod-Shift-z. Real-Obsidian
 *    validation still needed (see task-B-undo-report.md).
 *  - yCollab() already includes a beforeinput handler for platform-level undo
 *    (mobile, macOS Edit menu, OS accessibility).
 *  - ySyncAnnotation is captured lazily from the first ySync remote dispatch
 *    so drift-repair dispatches use the exact AnnotationType+conf ySync checks. */
export function bindSpec(ytext: Y.Text, awareness: Awareness): BindResult {
	// Empty trackedOrigins set: crucially NOT the default `{null}`, so
	// anonymous-origin edits are not tracked. YUndoManagerPluginValue calls
	// addTrackedOrigin(internalConf) post-init to wire the real ySync origin.
	const undoManager = new Y.UndoManager(ytext, {
		trackedOrigins: new Set(),
	});

	let capturedAnnotation: CapturedSyncAnnotation | null = null;
	const captureExt = makeSyncAnnotationCapture((captured) => {
		capturedAnnotation = captured;
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
		getSyncAnnotation: () => capturedAnnotation,
	};
}

/** Minimal CM changes to make an editor whose current text is `currentDoc`
 *  equal the Y.Text content. yCollab only forwards FUTURE deltas, so on bind
 *  the editor must be reconciled to the existing Y.Text content first. Returns
 *  [] when already equal. */
export function reconcileEditorToYText(currentDoc: string, ytext: Y.Text): CmChangeSpec[] {
	return textDiffToChangeSpec(currentDoc, ytext.toJSON());
}
