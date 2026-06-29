import type { EditorView } from "@codemirror/view";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import {
	type BindResult,
	bindSpec,
	crdtCompartment,
	reconcileEditorToYText,
} from "./ycollab-binding";

export interface ControllerDeps {
	getYText(path: string): Promise<Y.Text>;
	awareness(): Awareness;
	onBind(path: string, viewId: string): void;
	onRelease(path: string, viewId: string): void;
}

const DRIFT_CHECK_INTERVAL_MS = 3000;

let seq = 0;

/** Drives one Obsidian editor (which Obsidian reuses across note switches):
 *  reconfigures its yCollab Compartment to the leaf's current note and keeps
 *  the viewer refcount balanced. Rebinds when the same view shows a new path.
 *
 *  Drift-repair backstop: after every bind (and on each interval), compares
 *  the editor document to Y.Text. If they differ (e.g. a buggy undo that
 *  bypassed ySync), dispatches the reconciling diff annotated with
 *  y-codemirror.next's ySyncAnnotation so ySync does not re-propagate it
 *  as a local edit. ySyncAnnotation is captured lazily from the first ySync
 *  remote dispatch (see bindSpec / makeSyncAnnotationCapture in ycollab-binding). */
export class EditorController {
	private readonly deps: ControllerDeps;
	private readonly viewId = `cm-${seq++}`;
	private path: string | null = null;
	/** Set by release() (or destroy()) to cancel any in-flight bindTo awaiting
	 *  getYText. Once released, the controller is permanently inert: refresh()
	 *  drops it from the map and mints a fresh one on next refresh. */
	private released = false;

	private bindResult: BindResult | null = null;
	private boundYtext: Y.Text | null = null;
	private driftTimer: number | null = null;

	constructor(deps: ControllerDeps) {
		this.deps = deps;
	}

	currentPath(): string | null {
		return this.path;
	}

	async bindTo(view: EditorView, path: string): Promise<void> {
		if (this.path === path) return; // already bound to this note
		// Fetch the new Y.Text BEFORE mutating any state. This ensures that if
		// getYText rejects, the controller remains unchanged (no onRelease fired,
		// path untouched, refcount balanced).
		const ytext = await this.deps.getYText(path);
		// Concurrency guard: if release() was called while we awaited getYText,
		// abort. Do not dispatch, do not call onBind. The controller is inert.
		if (this.released) return;
		// Now safe to release the old binding, since getYText has resolved.
		const oldPath = this.path;
		if (oldPath) this.deps.onRelease(oldPath, this.viewId);
		// yCollab only forwards future deltas, so reconcile the editor to the
		// current Y.Text content before activating the binding.
		const changes = reconcileEditorToYText(view.state.doc.toString(), ytext);
		const result = bindSpec(ytext, this.deps.awareness());
		view.dispatch({
			changes,
			effects: crdtCompartment.reconfigure(result.extension),
		});
		this.bindResult = result;
		this.boundYtext = ytext;
		this.path = path;
		this.deps.onBind(path, this.viewId);
		this.scheduleDriftCheck(view);
	}

	release(view: EditorView): void {
		this.released = true;
		this.clearDriftTimer();
		this.bindResult = null;
		this.boundYtext = null;
		if (!this.path) return;
		view.dispatch({ effects: crdtCompartment.reconfigure([]) });
		this.deps.onRelease(this.path, this.viewId);
		this.path = null;
	}

	private clearDriftTimer(): void {
		if (this.driftTimer !== null) {
			window.clearTimeout(this.driftTimer);
			this.driftTimer = null;
		}
	}

	private scheduleDriftCheck(view: EditorView): void {
		this.clearDriftTimer();
		this.driftTimer = window.setTimeout(() => {
			this.driftTimer = null;
			this.runDriftCheck(view);
		}, DRIFT_CHECK_INTERVAL_MS);
	}

	private runDriftCheck(view: EditorView): void {
		if (this.released || this.boundYtext === null || this.bindResult === null) return;
		const changes = reconcileEditorToYText(view.state.doc.toString(), this.boundYtext);
		if (changes.length > 0) {
			const annotationType = this.bindResult.getSyncAnnotationType();
			const syncConfig = this.bindResult.syncConfig;
			if (annotationType !== null) {
				// Annotate with y-codemirror.next's ySyncAnnotation so ySync's
				// update() check (tr.annotation(ySyncAnnotation) === this.conf)
				// returns early and does NOT propagate the repair to Y.Text.
				view.dispatch({
					changes,
					annotations: [annotationType.of(syncConfig)],
				});
			} else {
				// ySyncAnnotation not yet captured (no remote edit has arrived).
				// Skip the repair this cycle — applying without the annotation
				// would make ySync re-apply the diff to Y.Text (double-apply).
				// The next interval will retry.
			}
		}
		// Reschedule to keep checking while the note is bound.
		this.scheduleDriftCheck(view);
	}
}
