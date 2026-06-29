// src/crdt/live/editor-binding.ts
// Adapted from Relay src/y-codemirror.next/LiveNodePlugin.ts
// (No-Instructions/Relay; MIT, y-codemirror.next by Kevin Jahns).
import type { Extension } from "@codemirror/state";
import { type EditorView, type PluginValue, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type * as Y from "yjs";
import { ySyncAnnotation } from "./annotations";
import { applyCmChangesToYText, textDiffToChangeSpec, yDeltaToChangeSpec } from "./cm-yjs-bridge";

export interface BindingDeps {
	/** Map this EditorView to its note path, or null if not a CRDT-managed md note. */
	resolvePath(view: EditorView): string | null;
	/** Open (or get cached) the path's Y.Text. */
	getYText(path: string): Promise<Y.Text>;
	/** Refcount bind (path now has a live viewer). */
	onBind(path: string, viewId: string): void;
	/** Refcount release. */
	onRelease(path: string, viewId: string): void;
	/** One-time seed of editor content into the Y.Text after the async open,
	 *  so keystrokes typed during the open gap are not lost. No-op if equal. */
	seedFromEditor(path: string, editorText: string): Promise<void>;
}

let viewSeq = 0;

class CrdtEditorBindingValue implements PluginValue {
	private readonly view: EditorView;
	private readonly deps: BindingDeps;
	private readonly viewId = `cm-${viewSeq++}`;
	private path: string | null = null;
	private ytext: Y.Text | null = null;
	private observer: ((event: Y.YTextEvent, tr: Y.Transaction) => void) | null = null;
	private destroyed = false;

	constructor(view: EditorView, deps: BindingDeps) {
		this.view = view;
		this.deps = deps;
		this.path = deps.resolvePath(view);
		if (!this.path) return;
		deps.onBind(this.path, this.viewId);
		const path = this.path;
		void deps.getYText(path).then(async (ytext) => {
			if (this.destroyed) return;
			this.ytext = ytext;
			// Seed any keystrokes typed during the async open (no-op if identical).
			await deps.seedFromEditor(path, this.view.state.doc.toString());
			if (this.destroyed) return;
			// Attach the observer before the catch-up so no remote update is missed.
			this.observer = (event, tr) => this.onYTextEvent(event, tr);
			ytext.observe(this.observer);
			// Catch-up: a remote Y.Text update may have arrived during the seed await.
			// Compute the minimal diff and push it into the editor, marked sync-origin
			// to prevent a loop. Guard in case destroy raced with the await resolution.
			const after = ytext.toJSON();
			const before = this.view.state.doc.toString();
			if (before !== after) {
				if (this.destroyed) return;
				this.view.dispatch({
					changes: textDiffToChangeSpec(before, after),
					annotations: [ySyncAnnotation.of(this.view)],
				});
			}
		});
	}

	/** Y.Text changed. If the change did NOT originate from this binding, push it
	 *  into the editor as minimal changes, marked sync-origin to avoid a loop. */
	private onYTextEvent(event: Y.YTextEvent, tr: Y.Transaction): void {
		if (this.destroyed || tr.origin === this) return;
		const changes = yDeltaToChangeSpec(event.delta as never);
		if (changes.length === 0) return;
		this.view.dispatch({
			changes,
			annotations: [ySyncAnnotation.of(this.view)],
		});
	}

	/** Editor changed. If it was a real local edit (not our own sync dispatch),
	 *  apply it to the Y.Text with origin=this so onYTextEvent ignores the echo
	 *  and CrdtManager.onUpdate ships it to the server. */
	update(update: ViewUpdate): void {
		if (!update.docChanged || !this.ytext) return;
		const fromSync = update.transactions.some(
			(t) => t.annotation(ySyncAnnotation) === this.view,
		);
		if (fromSync) return;
		const edits: Array<{ fromA: number; toA: number; insert: string }> = [];
		update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			edits.push({ fromA, toA, insert: inserted.sliceString(0, inserted.length, "\n") });
		});
		const ytext = this.ytext;
		// Optional chain is intentional: guards the destroy race when Y.Doc is torn down.
		ytext.doc?.transact(() => applyCmChangesToYText(ytext, edits), this);
	}

	destroy(): void {
		this.destroyed = true;
		if (this.ytext && this.observer) this.ytext.unobserve(this.observer);
		if (this.path) this.deps.onRelease(this.path, this.viewId);
		this.ytext = null;
		this.observer = null;
	}
}

export function crdtEditorBinding(deps: BindingDeps): Extension {
	return ViewPlugin.define((view) => new CrdtEditorBindingValue(view, deps));
}
