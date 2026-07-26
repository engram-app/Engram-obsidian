// The live editor<->Y.Text binding, copied from Relay's LiveNodePlugin model
// (../relay/Relay/src/y-codemirror.next/LiveNodePlugin.ts): a self-contained CM6
// ViewPlugin that CodeMirror owns. One instance is created PER EditorView, so it
// is re-created automatically whenever Obsidian rebuilds a leaf's editor — no
// Compartment to be wiped by setViewData, no poll, no re-bind race, no double
// bind. That structurally erases the whole file-switch wedge class.
//
// It bridges directly (like LiveNode): observe Y.Text deltas -> editor.dispatch;
// forward local editor changes -> Y.Text. An origin (Y side) + an annotation (CM
// side) guard the echo loop. There is NO yCollab/ySync layer, so the elaborate
// native-undo rerouting yCollab required is simply gone: a native undo is just
// more editor changes the plugin forwards to Y.Text as ordinary deltas.
//
// Doc hydration is async (Relay's anti-lag design): the plugin binds immediately
// against the resident (possibly still-hydrating) Y.Text and does the initial
// reconcile once `ready` resolves, so opening a note never blocks on the
// IndexedDB replay.
//
// The bound Y.Text is the note BODY only (frontmatter lives in a separate Y.Map
// handled by CrdtFrontmatterHook); in Live Preview the CM document is body-only
// too, so editor text and Y.Text are directly comparable.
import { Annotation } from "@codemirror/state";
import { type EditorView, type PluginValue, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import type * as Y from "yjs";
import { ediagAlways } from "../ediag";
import { type YDeltaEntry, applyCmChangesToYText, yDeltaToChangeSpec } from "./cm-yjs-bridge";
import { decideReconcile, needsReattach } from "./live-binding-decisions";

/** Marks editor dispatches that ORIGINATE from a Y.Text delta (or the initial
 *  reconcile) so update() does not echo them back into the Y.Text. Value = the
 *  EditorView the sync targeted (mirrors y-codemirror's ySyncAnnotation). */
const ySyncAnnotation = Annotation.define<EditorView>();

export interface LiveBindingCoordinator {
	/** Resolve (minting if new) the note_id that keys the resident doc for a path. */
	resolveId(path: string): string;
	/** Sync handle to the resident Y.Text + a ready promise (IndexedDB hydration). */
	residentText(noteId: string): { text: Y.Text; ready: Promise<void> };
	/** Open the note's CRDT room (syncStep1) so edits reach the server. */
	enroll(noteId: string): void;
	/** Viewer refcount: while bound, remote merges paint the editor instead of
	 *  writing disk directly (the editor owns the file). */
	onBind(path: string, viewId: string): void;
	onRelease(path: string, viewId: string): void;
}

let coordinator: LiveBindingCoordinator | null = null;
export function setLiveBindingCoordinator(c: LiveBindingCoordinator | null): void {
	coordinator = c;
}

let viewSeq = 0;

/** The markdown file path this editor currently shows, or null (non-md / no file). */
function editorPath(editor: EditorView): string | null {
	const info = editor.state.field(editorInfoField, false);
	const path = info?.file?.path ?? null;
	return path?.endsWith(".md") ? path : null;
}

class LiveBindingValue implements PluginValue {
	private readonly viewId = `lb-${viewSeq++}`;
	private editor: EditorView;
	private path: string | null = null;
	private noteId: string | null = null;
	private ytext: Y.Text | null = null;
	/** The coordinator this binding attached against. A stack rebuild (real
	 *  account/backend/vault switch) swaps the module coordinator AND destroys the
	 *  old doc; path + noteId stay the same, so this is the only signal that the
	 *  editor must re-attach off the now-dead doc. */
	private boundCoordinator: LiveBindingCoordinator | null = null;
	/** Forwarding local edits + painting deltas is active (post-reconcile). */
	private ready = false;
	/** The user typed into the editor during the async hydration/defer window
	 *  (edits are in the CM buffer but NOT yet in the doc). Drives the reconcile:
	 *  such edits must be FORWARDED into the doc, never reverted. */
	private dirtySinceAttach = false;
	private destroyed = false;
	/** The permanent delta->editor observer, once live. */
	private observer: ((event: Y.YTextEvent, tr: Y.Transaction) => void) | null = null;
	/** One-shot observer waiting for an unseeded doc to receive its server seed. */
	private deferObserver: ((event: Y.YTextEvent, tr: Y.Transaction) => void) | null = null;

	constructor(editor: EditorView) {
		this.editor = editor;
		this.attach();
	}

	update(u: ViewUpdate): void {
		if (this.destroyed) return;
		// Re-resolve on every update (cheap map lookup). Catches BOTH: Obsidian
		// reusing this editor for a different file (path changes), AND a genesis
		// ADOPT remapping path -> serverId under a live editor (path unchanged, id
		// changes) — which the old EditorController needed an external rebindPath()
		// call to handle. Re-attaching to the new resident Y.Text covers both.
		const path = editorPath(this.editor);
		const noteId = path && coordinator ? coordinator.resolveId(path) : null;
		const bound = { path: this.path, noteId: this.noteId, coordinator: this.boundCoordinator };
		if (needsReattach(bound, path, noteId, coordinator)) {
			this.detach();
			this.attach();
			return;
		}
		if (!u.docChanged) return;
		if (!this.ready || !this.ytext) {
			// Typed before the doc finished hydrating: remember it so the reconcile
			// FORWARDS these edits into the doc instead of reverting them. Only real
			// user edits count — Obsidian's programmatic file load is not a user event.
			if (u.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) {
				this.dirtySinceAttach = true;
			}
			return;
		}
		const doc = this.ytext.doc;
		if (!doc) return;
		const ytext = this.ytext;
		// Forward local editor edits into the Y.Text, PER TRANSACTION, skipping only
		// the transactions we ourselves dispatched from a Y.Text delta / reconcile
		// (the echo). Per-transaction (not an all-or-nothing `.some()` over the whole
		// update) so a real user edit coalesced into the same ViewUpdate as an echo is
		// still forwarded and never dropped. origin === this so our observer suppresses
		// re-painting and the provider broadcasts it (never re-flushed to disk).
		for (const tr of u.transactions) {
			if (!tr.docChanged) continue;
			if (tr.annotation(ySyncAnnotation) === this.editor) continue;
			const changes: Array<{ fromA: number; toA: number; insert: string }> = [];
			tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
				changes.push({
					fromA,
					toA,
					insert: inserted.sliceString(0, inserted.length, "\n"),
				});
			});
			if (changes.length > 0) doc.transact(() => applyCmChangesToYText(ytext, changes), this);
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.detach();
		this.editor = null as unknown as EditorView;
	}

	private attach(): void {
		const path = editorPath(this.editor);
		this.path = path;
		this.noteId = null;
		this.ytext = null;
		this.ready = false;
		this.dirtySinceAttach = false;
		this.boundCoordinator = coordinator;
		if (!path || !coordinator) return;
		const noteId = coordinator.resolveId(path);
		const { text, ready } = coordinator.residentText(noteId);
		this.noteId = noteId;
		this.ytext = text;
		coordinator.enroll(noteId);
		coordinator.onBind(path, this.viewId);
		void ready.then(() => this.onReady(noteId, text));
	}

	private onReady(noteId: string, text: Y.Text): void {
		// A newer attach (file switch / adopt) or destroy superseded this.
		if (this.destroyed || this.noteId !== noteId || this.ytext !== text) return;
		this.reconcileAndGoLive(text);
	}

	/** Initial reconcile then activate. Delegates the decision to decideReconcile
	 *  (pure, unit-tested): adopt the doc into the editor when it is authoritative,
	 *  FORWARD the editor's edits into the doc when the user typed during hydration
	 *  (never revert them — the cold-open loss bug), or defer an unseeded doc. */
	private reconcileAndGoLive(text: Y.Text): void {
		const editorText = this.editor.state.doc.toString();
		const docText = text.toJSON();
		const action = decideReconcile(editorText, docText, this.dirtySinceAttach);
		switch (action.kind) {
			case "defer":
				ediagAlways(
					`[EDIAG] bind DEFER (unseeded) path=${this.path} editorLen=${editorText.length}`,
				);
				this.deferSeed(text);
				return;
			case "adopt":
				this.editor.dispatch({
					changes: action.changes,
					annotations: [ySyncAnnotation.of(this.editor)],
				});
				break;
			case "forward": {
				const doc = text.doc;
				if (doc) {
					const changes = action.changes.map((c) => ({
						fromA: c.from,
						toA: c.to,
						insert: c.insert,
					}));
					doc.transact(() => applyCmChangesToYText(text, changes), this);
				}
				break;
			}
			case "noop":
				break;
		}
		this.goLive(text);
	}

	private deferSeed(text: Y.Text): void {
		const onSeed = (_event: Y.YTextEvent, _tr: Y.Transaction) => {
			if (this.destroyed || this.ytext !== text) {
				text.unobserve(onSeed);
				this.deferObserver = null;
				return;
			}
			if (text.length === 0) return; // still unseeded — keep waiting
			text.unobserve(onSeed);
			this.deferObserver = null;
			this.reconcileAndGoLive(text); // now non-empty -> adopt branch
		};
		this.deferObserver = onSeed;
		text.observe(onSeed);
	}

	private goLive(text: Y.Text): void {
		this.observer = (event, tr) => {
			if (this.destroyed || tr.origin === this) return;
			// Y.Text (not Y.XmlText) deltas only ever carry string inserts; the shared
			// yjs delta type widens `insert` to object, so narrow it here.
			const changes = yDeltaToChangeSpec(event.delta as YDeltaEntry[]);
			if (changes.length > 0) {
				this.editor.dispatch({ changes, annotations: [ySyncAnnotation.of(this.editor)] });
			}
		};
		text.observe(this.observer);
		this.ready = true;
		ediagAlways(`[EDIAG] bind LIVE path=${this.path} note=${this.noteId} len=${text.length}`);
	}

	private detach(): void {
		if (this.observer && this.ytext) this.ytext.unobserve(this.observer);
		if (this.deferObserver && this.ytext) this.ytext.unobserve(this.deferObserver);
		this.observer = null;
		this.deferObserver = null;
		// Release against the coordinator we BOUND to, not the current module one:
		// after a stack swap they differ, and releasing on the new coordinator would
		// leave the old one's refcount stuck (path forever "bound" -> flush skipped).
		if (this.path && this.boundCoordinator)
			this.boundCoordinator.onRelease(this.path, this.viewId);
		this.ytext = null;
		this.noteId = null;
		this.ready = false;
		this.dirtySinceAttach = false;
		this.boundCoordinator = null;
		this.path = null;
	}
}

export const liveBindingPlugin = ViewPlugin.fromClass(LiveBindingValue);
