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
	/** The path the Obsidian view currently DISPLAYS (Relay's view.file identity
	 *  check). The drift check refuses to dispatch when this differs from the
	 *  bound path — a repair into a view showing a different file would paint
	 *  the old note's content into the visible one. Optional: absent in tests
	 *  that don't exercise the guard. */
	viewPath?(): string | null;
	/** Test override for the drift-check interval. */
	driftIntervalMs?: number;
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
	/** Monotonic bind counter; a bindTo whose epoch is stale after its await
	 *  (a newer bindTo started meanwhile) aborts instead of clobbering it. */
	private bindEpoch = 0;

	private bindResult: BindResult | null = null;
	private boundYtext: Y.Text | null = null;
	private driftTimer: number | null = null;
	/** Set while a bind is deferred waiting for an unseeded Y.Doc to be seeded
	 *  by the server (see bindTo's data-loss guard). Holds the observed Y.Text +
	 *  its one-shot observer so detach()/release() can unhook it. */
	private pendingSeed: { ytext: Y.Text; onSeed: () => void } | null = null;

	constructor(deps: ControllerDeps) {
		this.deps = deps;
	}

	currentPath(): string | null {
		return this.path;
	}

	async bindTo(view: EditorView, path: string): Promise<void> {
		if (this.path === path) return; // already bound to this note
		// Detach the old binding SYNCHRONOUSLY, before any await. The await gap
		// below is exactly where Obsidian's loadFileInternal/setViewData lands the
		// NEW file's full content in this editor: a still-attached old ySync would
		// apply that replacement to the OLD note's Y.Text and sync it up as that
		// note's content (cross-file pollution, 2026-07-07/05 incident). An
		// unbound gap is safe — worst case a getYText failure leaves the editor
		// without live sync until the next refresh(); a stale-bound gap eats the
		// next file's content. (Relay never lets a binding span a file load.)
		this.detach(view);
		// Epoch guard: if a newer bindTo starts while we await, this one is stale
		// and must abort — otherwise a slow b.md bind can clobber a fast c.md one.
		const epoch = ++this.bindEpoch;
		const ytext = await this.deps.getYText(path);
		if (this.released || epoch !== this.bindEpoch) return;
		// View-identity guard (mirrors runDriftCheck's, at bind time). The await
		// above — and, for a DEFERRED bind, the unbounded wait for the server seed
		// (deferUntilSeeded → onSeed rebind, fired on a network event long after
		// this call) — can span an Obsidian file switch that reused this editor for
		// a DIFFERENT path. Binding/reconciling to `path` now would paint the old
		// note's content into the visible new file and bind ySync across a file
		// boundary (the 2026-07-07 cross-file pollution class). Never bind a view
		// that no longer shows `path`; refresh() will bind whatever it now shows.
		const shown = this.deps.viewPath?.();
		if (shown !== undefined && shown !== path) return;
		// Data-loss guard (deaf live-bound base loss, test_live_bound_both_ends):
		// materialize writes base to DISK but leaves the Y.Doc EMPTY on purpose —
		// the adopt-first gate has the server seed it on its OWN lineage (STEP2 /
		// REST converge), because a local seed would double against that lineage
		// (#846). An empty Y.Text next to a non-empty editor therefore means
		// "not seeded yet", NOT "note is empty". Reconciling the editor DOWN to
		// the empty doc would delete base out of the editor; ySync forwards that
		// as a local op and the base is lost GLOBALLY (server + every device).
		// Defer the bind until the doc is seeded, then rebind (reconcile is then a
		// no-op). Disk still converges meanwhile via the manager's remote-merge
		// flush listener, independent of this editor binding.
		// `editorText` is body-aligned with `ytext` (the reconcile below compares
		// them directly), so a frontmatter-only note has an empty editor body here
		// and does NOT defer — the guard only fires when a real base body is on
		// disk while the doc is still unseeded.
		const editorText = view.state.doc.toString();
		if (ytext.length === 0 && editorText.length > 0) {
			this.deferUntilSeeded(view, path, ytext, epoch);
			return;
		}
		// yCollab only forwards future deltas, so reconcile the editor to the
		// current Y.Text content before activating the binding.
		const changes = reconcileEditorToYText(editorText, ytext);
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

	/** Wait (one-shot) for an unseeded Y.Doc to receive its first content from the
	 *  server, then rebind. Never seeds the doc locally (that would double against
	 *  the server's lineage — the reason the doc is empty in the first place). A
	 *  newer bindTo (epoch bump) or release() unhooks this via detach(). */
	private deferUntilSeeded(view: EditorView, path: string, ytext: Y.Text, epoch: number): void {
		const onSeed = () => {
			// Rebind on the FIRST non-empty state. Safe because a history-less doc
			// adopts the server's FULL state atomically (one STEP2 transaction), so
			// the first non-empty observation is already the complete base — the
			// rebind's reconcile is a no-op, never a base-truncating delete. If a
			// partial-first-update path to an unseeded doc were ever added, gate
			// this on the seed covering the editor's length instead.
			if (ytext.length === 0) return; // still unseeded — keep waiting
			this.unhookPendingSeed();
			// A newer bindTo or a release() supersedes this deferred bind.
			if (this.released || epoch !== this.bindEpoch) return;
			void this.bindTo(view, path);
		};
		this.pendingSeed = { ytext, onSeed };
		ytext.observe(onSeed);
	}

	private unhookPendingSeed(): void {
		if (this.pendingSeed) {
			this.pendingSeed.ytext.unobserve(this.pendingSeed.onSeed);
			this.pendingSeed = null;
		}
	}

	/** Force a rebind even when this.path already equals `path`. detach() clears
	 *  this.path SYNCHRONOUSLY (stopping keystrokes reaching the now-orphaned
	 *  doc immediately), so the subsequent bindTo does not short-circuit on the
	 *  path-equality guard and re-resolves getYText to the note's current id.
	 *  Used after a genesis ADOPT remaps path -> serverId under a live editor:
	 *  the PATH is unchanged (only the id under it moved), so refresh()'s bindTo
	 *  would no-op. The caller pre-seeds the serverId Y.Text with the editor's
	 *  content, so bindTo's reconcile is a no-op (no visible buffer change). */
	forceRebind(view: EditorView, path: string): void {
		this.detach(view);
		void this.bindTo(view, path);
	}

	release(view: EditorView): void {
		this.released = true;
		this.detach(view);
	}

	/** Clears the active binding NOW: compartment emptied, refcount released,
	 *  drift timer stopped. Unlike release(), the controller stays usable so
	 *  bindTo can re-bind the same view to a new path. */
	private detach(view: EditorView): void {
		this.clearDriftTimer();
		// Unhook any deferred-seed observer FIRST — a deferred bind has this.path
		// === null, so this must run before the early-return below (release() and
		// a superseding bindTo both route through detach()).
		this.unhookPendingSeed();
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
		}, this.deps.driftIntervalMs ?? DRIFT_CHECK_INTERVAL_MS);
	}

	private runDriftCheck(view: EditorView): void {
		if (this.released || this.boundYtext === null || this.bindResult === null) return;
		// View-identity guard (Relay's view.file check): if Obsidian swapped the
		// file shown in this view and the rebind was missed or is still pending,
		// dispatching a repair would paint the OLD note's content into the VISIBLE
		// new file. Never repair a view that no longer shows the bound path —
		// detach (NOT release: release marks the controller permanently inert
		// while it stays in live-views' map) and let the next refresh() re-bind.
		const shown = this.deps.viewPath?.();
		if (shown !== undefined && shown !== this.path) {
			this.detach(view);
			return;
		}
		const changes = reconcileEditorToYText(view.state.doc.toString(), this.boundYtext);
		if (changes.length > 0) {
			const captured = this.bindResult.getSyncAnnotation();
			if (captured !== null) {
				// Annotate with yCollab's INTERNAL YSyncConfig (captured.conf) so
				// ySync's update() check (tr.annotation(ySyncAnnotation) === this.conf)
				// matches and ySync does NOT propagate the repair to Y.Text.
				// Using any other conf instance here would fail the === check and
				// cause ySync to re-apply the diff: double-apply corruption.
				view.dispatch({
					changes,
					annotations: [captured.type.of(captured.conf)],
				});
			} else {
				// ySyncAnnotation not yet captured (no remote edit has arrived yet).
				// Known limitation: drift repair is inert until the first remote edit
				// is observed. Skip this cycle. Applying without the annotation would
				// cause ySync to re-apply the diff to Y.Text (double-apply corruption).
				// The next interval will retry once a remote edit has been seen.
			}
		}
		// Reschedule to keep checking while the note is bound.
		this.scheduleDriftCheck(view);
	}
}
