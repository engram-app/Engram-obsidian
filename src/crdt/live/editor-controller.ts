import type { EditorView } from "@codemirror/view";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { bindSpec, crdtCompartment, reconcileEditorToYText } from "./ycollab-binding";

export interface ControllerDeps {
	getYText(path: string): Promise<Y.Text>;
	awareness(): Awareness;
	onBind(path: string, viewId: string): void;
	onRelease(path: string, viewId: string): void;
}

let seq = 0;

/** Drives one Obsidian editor (which Obsidian reuses across note switches):
 *  reconfigures its yCollab Compartment to the leaf's current note and keeps
 *  the viewer refcount balanced. Rebinds when the same view shows a new path. */
export class EditorController {
	private readonly deps: ControllerDeps;
	private readonly viewId = `cm-${seq++}`;
	private path: string | null = null;
	/** Set by release() (or destroy()) to cancel any in-flight bindTo awaiting
	 *  getYText. Once released, the controller is permanently inert — refresh()
	 *  drops it from the map and mints a fresh one on next refresh. */
	private released = false;

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
		// abort — do not dispatch, do not call onBind. The controller is inert.
		if (this.released) return;
		// Now safe to release the old binding, since getYText has resolved.
		const oldPath = this.path;
		if (oldPath) this.deps.onRelease(oldPath, this.viewId);
		// yCollab only forwards future deltas, so reconcile the editor to the
		// current Y.Text content before activating the binding.
		const changes = reconcileEditorToYText(view.state.doc.toString(), ytext);
		view.dispatch({
			changes,
			effects: crdtCompartment.reconfigure(bindSpec(ytext, this.deps.awareness())),
		});
		this.path = path;
		this.deps.onBind(path, this.viewId);
	}

	release(view: EditorView): void {
		this.released = true;
		if (!this.path) return;
		view.dispatch({ effects: crdtCompartment.reconfigure([]) });
		this.deps.onRelease(this.path, this.viewId);
		this.path = null;
	}
}
