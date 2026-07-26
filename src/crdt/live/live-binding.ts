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
import {
	type CmChangeSpec,
	type YDeltaEntry,
	applyCmChangesToYText,
	textDiffToChangeSpec,
	yDeltaToChangeSpec,
} from "./cm-yjs-bridge";
import { decideReconcile, frontmatterPrefixLen, needsReattach } from "./live-binding-decisions";

/** Interval for the drift backstop (Relay's DRIFT_CHECK_DELAY is 3000ms). */
const DRIFT_CHECK_MS = 3000;

/** Shift CM change offsets by `n` (0 leaves them untouched). Used to map body-Y.Text
 *  coordinates to the editor's coordinates when a frontmatter block occupies the
 *  first `n` chars of the CM document (Source mode). */
function shiftChanges(changes: CmChangeSpec[], n: number): CmChangeSpec[] {
	if (n === 0) return changes;
	return changes.map((c) => ({ from: c.from + n, to: c.to + n, insert: c.insert }));
}

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
	/** The editor's FULL text as it stood right before the user's first keystroke
	 *  this attach — i.e. the plain on-disk content Obsidian loaded. It is the LCA
	 *  the reconcile needs to forward ONLY the typed hunks into a doc that hydrated
	 *  with remote content the editor never saw, instead of a whole-text diff that
	 *  would delete it. Tracked here rather than read from the SyncEngine's
	 *  BaseStore because that store is only refreshed on the REST push/pull paths
	 *  (CRDT delivery advances the syncState hash alone), so it goes stale for
	 *  live-synced notes. Null = unknown -> two-way fallback. */
	private preEditText: string | null = null;
	private destroyed = false;
	/** The permanent delta->editor observer, once live. */
	private observer: ((event: Y.YTextEvent, tr: Y.Transaction) => void) | null = null;
	/** One-shot observer waiting for an unseeded doc to receive its server seed. */
	private deferObserver: ((event: Y.YTextEvent, tr: Y.Transaction) => void) | null = null;
	/** Periodic drift-check timer (self-heal backstop); null when not scheduled. */
	private driftTimer: number | null = null;

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
			// If this very update carried a user keystroke, it is in the editor but NOT
			// in the new doc yet (e.g. a genesis ADOPT remap: the key landed in the mint
			// doc after its content was transferred to serverId). Carry the dirty flag
			// so the reconcile FORWARDS the editor into the new doc instead of reverting
			// that keystroke. A programmatic file-load re-attach is not a user event.
			const carriedUserEdit =
				u.docChanged &&
				u.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"));
			this.detach();
			this.attach();
			if (carriedUserEdit) {
				this.dirtySinceAttach = true;
				// attach() snapshotted the base AFTER that keystroke, which would make
				// the merge see "nothing typed" and adopt the doc over it. Rewind to the
				// pre-update text. Only valid when the FILE is the same (a genesis-adopt
				// remap); across a real file switch the old text is not this note's base,
				// so drop it and let the two-way fallback handle it.
				this.preEditText = path === bound.path ? u.startState.doc.toString() : null;
			}
			return;
		}
		if (!u.docChanged) return;
		if (!this.ready || !this.ytext) {
			// Typed before the doc finished hydrating: remember it so the reconcile
			// FORWARDS these edits into the doc instead of reverting them. Only real
			// user edits count — Obsidian's programmatic file load is not a user event.
			if (u.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) {
				this.dirtySinceAttach = true;
			} else if (!this.dirtySinceAttach) {
				// Obsidian's programmatic file load lands here (it is not a user event),
				// often AFTER the ViewPlugin was constructed against an empty editor.
				// Keep the base tracking it until the user's first keystroke, so the
				// merge diffs against what they actually saw.
				this.preEditText = u.state.doc.toString();
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
			// Map editor (full-doc) offsets to body-Y.Text offsets. In Source mode the
			// frontmatter block occupies the first `prefix` chars of the CM document,
			// which the body-only Y.Text does not have. Offsets are against the
			// PRE-change doc, so compute the prefix from the transaction's start state.
			const prefix = frontmatterPrefixLen(tr.startState.doc.toString());
			const changes: Array<{ fromA: number; toA: number; insert: string }> = [];
			let spansFrontmatter = false;
			tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
				if (toA <= prefix) return; // entirely inside frontmatter — the FM hook owns it
				if (fromA < prefix) {
					spansFrontmatter = true; // straddles the boundary — repair via drift, not a guess
					return;
				}
				changes.push({
					fromA: fromA - prefix,
					toA: toA - prefix,
					insert: inserted.sliceString(0, inserted.length, "\n"),
				});
			});
			if (spansFrontmatter) this.scheduleDriftCheck();
			if (changes.length === 0) continue;
			try {
				doc.transact(() => applyCmChangesToYText(ytext, changes), this);
			} catch (err) {
				// A malformed offset / concurrent-transaction error must not throw out of
				// update() and wedge the editor. Log and let the drift check reconcile.
				ediagAlways(`[EDIAG] forward FAILED path=${this.path}: ${String(err)}`);
				this.scheduleDriftCheck();
			}
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
		this.preEditText = this.editor.state.doc.toString();
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
		const fullText = this.editor.state.doc.toString();
		// Compare/reconcile against the BODY only: in Source mode the CM document
		// carries the raw frontmatter block, which the body-only Y.Text does not.
		const prefix = frontmatterPrefixLen(fullText);
		const editorText = prefix > 0 ? fullText.slice(prefix) : fullText;
		const docText = text.toJSON();
		// Body-align the base the same way (Source mode carries the frontmatter block).
		const base =
			this.preEditText === null
				? null
				: this.preEditText.slice(frontmatterPrefixLen(this.preEditText));
		const action = decideReconcile(editorText, docText, this.dirtySinceAttach, base);
		switch (action.kind) {
			case "defer":
				ediagAlways(
					`[EDIAG] bind DEFER (unseeded) path=${this.path} editorLen=${editorText.length}`,
				);
				this.deferSeed(text);
				return;
			case "adopt":
				this.paintEditor(action.changes, prefix);
				break;
			case "forward":
				this.writeYText(text, action.changes);
				break;
			case "merge":
				// Both sides diverged and merged cleanly: converge each onto the merge
				// result. The doc write comes first so the editor paint is never the
				// state that briefly wins if the second step throws.
				this.writeYText(text, action.toDoc);
				this.paintEditor(action.toEditor, prefix);
				break;
			case "noop":
				break;
		}
		this.goLive(text);
	}

	/** Dispatch BODY-coordinate changes into the editor, shifted past any
	 *  frontmatter block, annotated so update() does not echo them back. */
	private paintEditor(changes: CmChangeSpec[], prefix: number): void {
		if (changes.length === 0) return;
		this.editor.dispatch({
			changes: shiftChanges(changes, prefix),
			annotations: [ySyncAnnotation.of(this.editor)],
		});
	}

	/** Apply BODY-coordinate changes into the Y.Text under our own origin (so the
	 *  observer suppresses a repaint and the provider broadcasts them). */
	private writeYText(text: Y.Text, changes: CmChangeSpec[]): void {
		const doc = text.doc;
		if (!doc || changes.length === 0) return;
		const mapped = changes.map((c) => ({ fromA: c.from, toA: c.to, insert: c.insert }));
		doc.transact(() => applyCmChangesToYText(text, mapped), this);
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
			if (changes.length === 0) return;
			try {
				// Body-coordinate delta -> editor coordinates (offset past any frontmatter).
				const prefix = frontmatterPrefixLen(this.editor.state.doc.toString());
				this.editor.dispatch({
					changes: shiftChanges(changes, prefix),
					annotations: [ySyncAnnotation.of(this.editor)],
				});
			} catch (err) {
				// A dispatch mid-update / offset disagreement throws here (inside a Y.Text
				// observe callback, which would otherwise break painting for this
				// transaction). Swallow and let the drift check re-adopt the doc.
				ediagAlways(`[EDIAG] paint FAILED path=${this.path}: ${String(err)}`);
				this.scheduleDriftCheck();
			}
		};
		text.observe(this.observer);
		this.ready = true;
		this.scheduleDriftCheck();
		ediagAlways(`[EDIAG] bind LIVE path=${this.path} note=${this.noteId} len=${text.length}`);
	}

	/** Periodic backstop (Relay's checkAndCorrectDrift): while bound, compare the
	 *  editor text to the Y.Text every DRIFT_CHECK_MS. If a delta/forward was silently
	 *  dropped (a swallowed dispatch/transact error, a filtered transaction) they
	 *  diverge; re-adopt the doc into the editor so the two never stay out of sync.
	 *  The doc is authoritative for a live-bound synced note, so adopting toward it is
	 *  the safe restore. Skipped during IME composition (a diff mid-composition would
	 *  corrupt the input). Reschedules itself; cleared on detach. */
	private scheduleDriftCheck(): void {
		if (this.driftTimer !== null) window.clearTimeout(this.driftTimer);
		this.driftTimer = window.setTimeout(() => {
			this.driftTimer = null;
			this.runDriftCheck();
		}, DRIFT_CHECK_MS);
	}

	private runDriftCheck(): void {
		if (this.destroyed || !this.ready || !this.ytext) return;
		if (this.editor.composing) {
			// Mid-IME: a diff dispatch now would corrupt the composition. Retry later.
			this.scheduleDriftCheck();
			return;
		}
		const fullText = this.editor.state.doc.toString();
		const prefix = frontmatterPrefixLen(fullText);
		const editorText = prefix > 0 ? fullText.slice(prefix) : fullText;
		const docText = this.ytext.toJSON();
		if (editorText !== docText) {
			ediagAlways(
				`[EDIAG] DRIFT path=${this.path} editorLen=${editorText.length} docLen=${docText.length} — re-adopting`,
			);
			try {
				this.editor.dispatch({
					changes: shiftChanges(textDiffToChangeSpec(editorText, docText), prefix),
					annotations: [ySyncAnnotation.of(this.editor)],
				});
			} catch (err) {
				ediagAlways(`[EDIAG] drift re-adopt FAILED path=${this.path}: ${String(err)}`);
			}
		}
		this.scheduleDriftCheck();
	}

	private detach(): void {
		if (this.driftTimer !== null) {
			window.clearTimeout(this.driftTimer);
			this.driftTimer = null;
		}
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
		this.preEditText = null;
		this.boundCoordinator = null;
		this.path = null;
	}
}

export const liveBindingPlugin = ViewPlugin.fromClass(LiveBindingValue);
