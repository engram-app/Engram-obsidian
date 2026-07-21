// yCollab-based editor<->Y.Text binding, swappable per note via a CM6 Compartment.
// Built from y-codemirror.next's low-level pieces instead of bare yCollab() so we
// can scope the UndoManager to local-only edits and install a high-precedence
// Mod-z keymap. Bare yCollab() adds a UndoManager but NO Mod-z keymap, so
// Obsidian's native undo runs and reverts remote-applied transactions, then
// ySync propagates the revert as a local delete (divergence).
import {
	type AnnotationType,
	Compartment,
	EditorState,
	type Extension,
	Prec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
// yCollab, YSyncConfig, and yUndoManagerKeymap are all re-exported from the
// package root (confirmed in node_modules/y-codemirror.next/src/index.js).
// Deep imports (yUndoManagerFacet, ySyncAnnotation, etc.) are NOT re-exported,
// and the package's exports map blocks them at runtime (Bun enforces exports),
// so we use yCollab() with a custom scoped UndoManager option instead.
import { YSyncConfig, yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { splitFrontmatter } from "../frontmatter-codec";
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

/** Routes undo/redo intent to the CRDT-aware Y.UndoManager. */
export interface UndoRouter {
	undo(): void;
	redo(): void;
}

/** Layer 3 (structural veto). Cancels any transaction CodeMirror tags as a
 *  native undo/redo and reroutes it to the CRDT-aware Y.UndoManager. Obsidian's
 *  editor history is @codemirror/commands, which stamps userEvent "undo"/"redo"
 *  on its reverting transactions, so this intercepts EVERY native-history
 *  transaction regardless of which keymap won the precedence race. That makes it
 *  correct-by-construction: a native, offset-based revert can never reach ySync
 *  and be mis-propagated as a delete of a remote peer's text. The reroute is
 *  deferred to a microtask because undoManager.undo() dispatches a fresh
 *  transaction, which CodeMirror forbids from inside a transactionFilter. */
export function rerouteUndoFilter(router: UndoRouter): Extension {
	return EditorState.transactionFilter.of((tr) => {
		if (tr.isUserEvent("undo")) {
			queueMicrotask(() => router.undo());
			return [];
		}
		if (tr.isUserEvent("redo")) {
			queueMicrotask(() => router.redo());
			return [];
		}
		return tr;
	});
}

/** Layer 2 decision. Maps a beforeinput inputType to an undo/redo reroute,
 *  returning true when handled (the caller must then preventDefault). Covers the
 *  Edit menu, right-click, macOS menu bar, OS accessibility and mobile undo,
 *  which fire a cancelable beforeinput (historyUndo/historyRedo) rather than a
 *  key event the keymap (Layer 1) would see. */
export function handleUndoBeforeInput(inputType: string, router: UndoRouter): boolean {
	if (inputType === "historyUndo") {
		router.undo();
		return true;
	}
	if (inputType === "historyRedo") {
		router.redo();
		return true;
	}
	return false;
}

/** Build the live binding using yCollab() with a scoped UndoManager and a
 *  defense-in-depth stack that suppresses Obsidian's native undo at every entry
 *  point and routes it to the CRDT-aware Y.UndoManager (whose undo() reverses
 *  operations by item identity, scoped to local-only edits — correct by
 *  construction). We do NOT capture-and-replay native undo (Relay's OpCapture);
 *  that is only needed when there is no stock Y.UndoManager, which we have.
 *
 *  Key design choices:
 *  - yCollab() is called with our own Y.UndoManager scoped to an empty
 *    trackedOrigins set. This is intentional: passing `null` (the default)
 *    would track anonymous-origin edits, which we do not want.
 *    YUndoManagerPluginValue.addTrackedOrigin() (line 104 of y-undomanager.js)
 *    adds the real ySync origin (yCollab's INTERNAL YSyncConfig) post-init,
 *    so remote peers' edits are never added to the undo stack.
 *  - Layer 1: Prec.highest(keymap.of(yUndoManagerKeymap)) for keyboard Mod-z.
 *  - Layer 2: Prec.highest beforeinput handler (preventDefault) for the Edit
 *    menu / OS / mobile undo path, which never reaches the keymap.
 *  - Layer 3: rerouteUndoFilter — the structural backstop that catches any
 *    native-history transaction that slipped past Layers 1-2.
 *  - The drift-repair backstop in editor-controller.ts remains the last resort.
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

	const router: UndoRouter = {
		undo: () => undoManager.undo(),
		redo: () => undoManager.redo(),
	};

	// Layer 2: our own high-precedence beforeinput handler for the menu/OS/mobile
	// undo path. preventDefault stops the native history default from also firing.
	const beforeInputHandler = Prec.highest(
		EditorView.domEventHandlers({
			beforeinput(e) {
				if (handleUndoBeforeInput(e.inputType, router)) {
					e.preventDefault();
					return true;
				}
				return false;
			},
		}),
	);

	const extension: Extension = [
		captureExt,
		ycollabExt,
		// Layer 1: Prec.highest so this keymap beats Obsidian's built-in history
		// Mod-z. yUndoManagerKeymap's handlers return true (preventDefault), so the
		// native history does not also fire on the keyboard path.
		Prec.highest(keymap.of(yUndoManagerKeymap)),
		beforeInputHandler,
		// Layer 3: catch any native-history transaction that beat Layers 1-2.
		rerouteUndoFilter(router),
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

/** True when `ytext` is UNSEEDED (or orphaned) rather than genuinely empty: it
 *  holds nothing while the editor still shows a non-empty BODY.
 *
 *  `SyncEngine.flushFromCrdt` materializes base to DISK and deliberately leaves
 *  the Y.Doc EMPTY (adopt-first #161 — the server seeds it on its own lineage;
 *  a local seed would double against that lineage, #846). So an empty Y.Text
 *  beside a non-empty editor body normally means "the seed has not arrived yet".
 *
 *  Reconciling the editor DOWN to such a Y.Text deletes base out of the buffer.
 *  Obsidian then autosaves the emptied buffer (the `modify bytes=0` data-loss
 *  signature) and, at the bind site, ySync forwards the delete as a LOCAL op so
 *  base is lost globally. Both reconcile sites refuse it: `bindTo` defers the
 *  bind (#257), the drift repair rebinds instead of repairing (#256).
 *
 *  BODY, not the raw buffer. The CRDT keeps frontmatter in separate Y.Map/Y.Array
 *  types and `content` holds only the body (`CrdtManager.seedContentInto`), while
 *  the CM6 buffer holds the whole file. Comparing raw text would classify every
 *  frontmatter-only note (non-empty buffer, empty body) as unseeded and strand it.
 *
 *  ACCEPTED TRADE-OFF — this is not an impossibility claim. A real "delete all"
 *  normally reaches the editor through ySync's remote->editor path rather than a
 *  reconcile, so it is unaffected. But when the Y.Doc is LEGITIMATELY empty and
 *  the buffer still holds stale text — e.g. the delete landed while the sync gate
 *  was closed, so `flushFromCrdt` returned early and never rewrote disk — these
 *  sites will not converge the editor down, and the stale body can be autosaved
 *  back. Losing a deletion is judged strictly better than destroying a note's
 *  content: a deletion re-arrives from the server, destroyed content does not. */
export function isUnseededYText(editorText: string, ytext: Y.Text): boolean {
	return ytext.length === 0 && splitFrontmatter(editorText).body.length > 0;
}
