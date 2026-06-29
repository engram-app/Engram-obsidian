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

	constructor(deps: ControllerDeps) {
		this.deps = deps;
	}

	currentPath(): string | null {
		return this.path;
	}

	async bindTo(view: EditorView, path: string): Promise<void> {
		if (this.path === path) return; // already bound to this note
		if (this.path) this.deps.onRelease(this.path, this.viewId);
		const ytext = await this.deps.getYText(path);
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
		if (!this.path) return;
		view.dispatch({ effects: crdtCompartment.reconfigure([]) });
		this.deps.onRelease(this.path, this.viewId);
		this.path = null;
	}
}
