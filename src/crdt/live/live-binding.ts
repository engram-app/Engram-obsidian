// The live editor<->Y.Text binding: a self-contained CM6 ViewPlugin that
// CodeMirror owns.
//
// Derived from No-Instructions/Relay (MIT); see THIRD-PARTY-NOTICES.md.
// One instance is created PER EditorView, so it
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
// Doc hydration is async (the anti-lag design): the plugin binds immediately
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
import { noteRef } from "../../note-ref";
import { rlog } from "../../remote-log";
import {
	applyCmChangesToYText,
	type CmChangeSpec,
	textDiffToChangeSpec,
	type YDeltaEntry,
	yDeltaToChangeSpec,
} from "./cm-yjs-bridge";
import { goLive as goLiveMerge } from "./go-live";
import {
	classifyEditSpan,
	type EditorOwnerInfo,
	fmCreationBodyDiff,
	frontmatterPrefixLen,
	needsReattach,
	ownedMarkdownPath,
} from "./live-binding-decisions";

/** Interval for the drift backstop. */
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
	/** Last full-file text the note's doc and disk provably agreed on, or null. */
	lcaFor(noteId: string): string | null;
	/** Latest full-file text Obsidian wrote to disk for `path` at or after `sinceMs`
	 *  (an autosave while entering), or null if none. */
	latestDiskSince(path: string, sinceMs: number): string | null;
	/** Go-live conflict: the doc won in the editor; `editorText` (full file) must be
	 *  kept as a conflict copy, never dropped. */
	onConflict(path: string, editorText: string): void;
}

/** A `"set"` (Obsidian's pane mirror / reload) equal to a doc state this recent
 *  but no longer current is a stale echo (mirror lands under 300ms, CDP 1.12.7). */
const STALE_ECHO_MS = 1000;

let coordinator: LiveBindingCoordinator | null = null;
export function setLiveBindingCoordinator(c: LiveBindingCoordinator | null): void {
	coordinator = c;
}

let viewSeq = 0;

/** The markdown file path this editor currently shows, or null when it is not the
 *  leaf's own markdown editor (non-md, no file, or a nested editor such as the
 *  Live Preview table cell — see ownedMarkdownPath). */
function editorPath(editor: EditorView): string | null {
	const info = editor.state.field(editorInfoField, false) as EditorOwnerInfo | undefined;
	return ownedMarkdownPath(editor, info);
}

/** Exported for the integration test only; Obsidian mounts it via liveBindingPlugin. */
export class LiveBindingValue implements PluginValue {
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
	/** The editor's full text when this attach began (a disk version: Obsidian
	 *  constructs the editor with the file loaded, CDP-verified) and when. */
	private attachText = "";
	private attachedAt = 0;
	/** Recent doc body states, newest last, for the stale-echo guard. */
	private recentDoc: Array<{ text: string; at: number }> = [];
	private destroyed = false;
	/** Bumped on every attach, so an async step started by an older attach (the
	 *  disk read) can tell it was superseded even when the Y.Text is the same. */
	private attachSeq = 0;
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
			// Nothing to carry: unforwarded typing is in the editor text, which the new
			// attach treats as its disk side; go-live merges it against the LCA.
			this.detach();
			this.attach();
			return;
		}
		if (!u.docChanged) return;
		// Entering (Relay): typing stays in the editor; go-live merges it.
		if (!this.ready || !this.ytext) return;
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
			if (tr.isUserEvent("set")) {
				this.forwardSet(ytext, tr.state.doc.toString());
				continue;
			}
			// Map editor (full-doc) offsets to body-Y.Text offsets. In Source mode the
			// frontmatter block occupies the first `prefix` chars of the CM document,
			// which the body-only Y.Text does not have. Offsets are against the
			// PRE-change doc, so compute the prefix from the transaction's start state.
			const beforeDoc = tr.startState.doc.toString();
			const prefix = frontmatterPrefixLen(beforeDoc);
			// A transaction that CREATES frontmatter (prefix 0 -> N) invalidates
			// per-change classification (the same chars flip from body to FM);
			// forward the body->body diff instead — empty for a pure FM paste.
			const creation = fmCreationBodyDiff(prefix, beforeDoc, tr.state.doc.toString());
			if (creation !== null) {
				try {
					this.writeYText(ytext, creation);
				} catch (err) {
					rlog().error(
						"crdt-live-binding",
						`fm-creation forward failed for ${noteRef(this.path)}: ${String(err)}`,
					);
					this.scheduleDriftCheck();
				}
				continue;
			}
			const changes: Array<{ fromA: number; toA: number; insert: string }> = [];
			let spansFrontmatter = false;
			tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
				const span = classifyEditSpan(fromA, toA, prefix);
				switch (span) {
					case "frontmatter":
						return; // entirely inside frontmatter — the FM hook owns it
					case "spans":
						spansFrontmatter = true; // straddles the boundary — repair via drift, not a guess
						return;
					case "body":
						changes.push({
							fromA: fromA - prefix,
							toA: toA - prefix,
							insert: inserted.sliceString(0, inserted.length, "\n"),
						});
						return;
					default: {
						// Compile-time exhaustiveness: a new variant must not silently
						// drop edits (the bug class this file exists to kill).
						const exhaustive: never = span;
						return exhaustive;
					}
				}
			});
			if (spansFrontmatter) this.scheduleDriftCheck();
			if (changes.length === 0) continue;
			try {
				doc.transact(() => applyCmChangesToYText(ytext, changes), this);
			} catch (err) {
				// A malformed offset / concurrent-transaction error must not throw out of
				// update() and wedge the editor. Log and let the drift check reconcile.
				rlog().error(
					"crdt-live-binding",
					`forward failed for ${noteRef(this.path)}: ${String(err)}`,
				);
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
		this.attachSeq++;
		this.path = path;
		this.noteId = null;
		this.ytext = null;
		this.ready = false;
		this.attachText = this.editor.state.doc.toString();
		this.attachedAt = Date.now();
		this.recentDoc = [];
		this.boundCoordinator = coordinator;
		if (!path || !coordinator) return;
		const noteId = coordinator.resolveId(path);
		const { text, ready } = coordinator.residentText(noteId);
		this.noteId = noteId;
		this.ytext = text;
		coordinator.enroll(noteId);
		coordinator.onBind(path, this.viewId);
		const seq = this.attachSeq;
		void ready.then(() => this.onReady(seq, text));
	}

	private onReady(seq: number, text: Y.Text): void {
		// A newer attach (file switch / adopt) or destroy superseded this. Checked by
		// attach seq, not noteId: switching away and back re-attaches the SAME note
		// and Y.Text, and both attaches' ready would otherwise go live.
		if (this.destroyed || this.attachSeq !== seq || this.ytext !== text) return;
		this.reconcileAndGoLive(text);
	}

	/** Go-live (#544): Relay's 3-way merge of the disk side into the doc, then the
	 *  unsaved typing rebased by a second 3-way merge (go-live.ts). One synchronous
	 *  task, so the editor text read here is the text the paint diffs against. */
	private reconcileAndGoLive(text: Y.Text): void {
		const fullText = this.editor.state.doc.toString();
		const prefix = frontmatterPrefixLen(fullText);
		const edited = fullText.slice(prefix);
		const docText = text.toJSON();
		// Unseeded doc under a non-empty editor: the server owns the seed (unchanged).
		if (docText.length === 0 && edited.length > 0) {
			this.deferSeed(text);
			return;
		}
		const coord = this.boundCoordinator;
		const body = (t: string | null) => (t === null ? null : t.slice(frontmatterPrefixLen(t)));
		const lca = coord && this.noteId ? coord.lcaFor(this.noteId) : null;
		const disk = coord && this.path ? coord.latestDiskSince(this.path, this.attachedAt) : null;
		const result = goLiveMerge({
			lca: body(lca),
			doc: docText,
			latestDisk: body(disk),
			base: body(this.attachText) ?? "",
			edited,
		});
		// Runs BEFORE goLive(): the observer is unregistered and `ready` is false,
		// which is what stops these writes from being re-forwarded or re-painted.
		try {
			this.writeYText(text, textDiffToChangeSpec(docText, result.text));
			this.paintEditor(textDiffToChangeSpec(edited, result.text), prefix);
			if (result.kind === "conflict" && coord && this.path) {
				coord.onConflict(this.path, fullText);
			}
		} catch (err) {
			rlog().error(
				"crdt-live-binding",
				`go-live ${result.kind} failed for ${noteRef(this.path)}: ${String(err)}`,
			);
		}
		this.goLive(text);
	}

	/** Forward an Obsidian `"set"` (pane mirror, external-modify reload) as a text
	 *  diff against the Y.Text (Relay, MergeHSM.ts:3745). Equal to the doc: an echo,
	 *  nothing to do (Relay, 3658). Equal to a recent but superseded doc state: a
	 *  stale mirror that would revert a newer edit; repaint from the doc instead. */
	private forwardSet(ytext: Y.Text, full: string): void {
		const prefix = frontmatterPrefixLen(full);
		const next = full.slice(prefix);
		const current = ytext.toJSON();
		if (next === current) return;
		const now = Date.now();
		if (this.recentDoc.some((s) => s.text === next && now - s.at < STALE_ECHO_MS)) {
			this.repaintFromDoc();
			return;
		}
		this.writeYText(ytext, textDiffToChangeSpec(current, next));
	}

	private repaintFromDoc(): void {
		if (!this.ytext) return;
		const fullText = this.editor.state.doc.toString();
		const prefix = frontmatterPrefixLen(fullText);
		const changes = textDiffToChangeSpec(fullText.slice(prefix), this.ytext.toJSON());
		// Dispatching inside an update throws; defer to the next task.
		window.setTimeout(() => {
			if (this.destroyed || !this.ready) return;
			this.paintEditor(changes, prefix);
		}, 0);
	}

	private noteDocState(text: Y.Text): void {
		const now = Date.now();
		this.recentDoc = [
			...this.recentDoc.filter((s) => now - s.at < STALE_ECHO_MS),
			{ text: text.toJSON(), at: now },
		].slice(-8);
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

	/** Wait for the server seed, then reconcile. Reconciling on the FIRST non-empty
	 *  observe cannot catch a half-applied doc: a seed arrives as one syncStep2,
	 *  which `readSyncMessage` applies as a single Y.applyUpdate, and Yjs fires
	 *  observers once at transaction cleanup with every delta already applied. A
	 *  partial seed would need the server to split one document across separate
	 *  transactions, which the sync protocol never does. */
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
			this.reconcileAndGoLive(text); // now seeded
		};
		this.deferObserver = onSeed;
		text.observe(onSeed);
	}

	private goLive(text: Y.Text): void {
		this.noteDocState(text);
		this.observer = (event, tr) => {
			if (this.destroyed) return;
			this.noteDocState(text);
			if (tr.origin === this) return;
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
				rlog().error(
					"crdt-live-binding",
					`paint failed for ${noteRef(this.path)}: ${String(err)}`,
				);
				this.scheduleDriftCheck();
			}
		};
		text.observe(this.observer);
		this.ready = true;
		this.scheduleDriftCheck();
	}

	/** Periodic drift backstop: while bound, compare the
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
			// A tripwire, not routine: every delta and forward is supposed to keep these
			// in lockstep, so drift means one was silently dropped. warn (not info) so it
			// actually reaches Loki.
			rlog().warn(
				"crdt-live-binding",
				`drift on ${noteRef(this.path)} (editor ${editorText.length} vs doc ${docText.length}) - re-adopting`,
			);
			try {
				this.editor.dispatch({
					changes: shiftChanges(textDiffToChangeSpec(editorText, docText), prefix),
					annotations: [ySyncAnnotation.of(this.editor)],
				});
			} catch (err) {
				rlog().error(
					"crdt-live-binding",
					`drift re-adopt failed for ${noteRef(this.path)}: ${String(err)}`,
				);
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
		this.recentDoc = [];
		this.boundCoordinator = null;
		this.path = null;
	}
}

export const liveBindingPlugin = ViewPlugin.fromClass(LiveBindingValue);
