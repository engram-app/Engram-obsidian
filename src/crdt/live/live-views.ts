import type { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { MarkdownView as MdView, normalizePath } from "obsidian";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import * as YDoc from "yjs";
import { devLog } from "../../dev-log";
import { errMsg } from "../../error-util";
import type { CrdtEnrollment } from "../enrollment";
import type { CrdtManager } from "../manager";
import { EditorController } from "./editor-controller";
import { CrdtFrontmatterHook } from "./frontmatter-hook";
import { getEditorViewForLeaf, getMarkdownFilePath } from "./obsidian-internals";
import { CrdtReadingView } from "./reading-view";

/** Fix wave 6: trailing debounce window for `requestSaveForBoundPath` — a
 *  burst of remote deltas into the same bound doc collapses to one
 *  `requestSave()` call. */
const SAVE_NUDGE_DEBOUNCE_MS = 300;

/** Per-path viewer refcount. A "viewer" is any live binding (editor pane or
 *  reading-view) currently holding a note open. While a path has at least one
 *  viewer, onFlushToDisk skips the disk write (the editor owns the file). When
 *  the last viewer releases, onLastRelease fires so the manager can do one
 *  final flush to disk. Keyed by viewId so multiple panes on the same path
 *  refcount correctly and dup bind/release are no-ops. */
export class ViewerRefcount {
	private readonly viewers = new Map<string, Set<string>>();
	private readonly onLastRelease: (path: string) => void;

	constructor(onLastRelease: (path: string) => void) {
		this.onLastRelease = onLastRelease;
	}

	bind(path: string, viewId: string): void {
		let set = this.viewers.get(path);
		if (!set) {
			set = new Set();
			this.viewers.set(path, set);
		}
		set.add(viewId);
	}

	release(path: string, viewId: string): void {
		const set = this.viewers.get(path);
		if (!set || !set.has(viewId)) return;
		set.delete(viewId);
		if (set.size === 0) {
			this.viewers.delete(path);
			this.onLastRelease(path);
		}
	}

	isBound(path: string): boolean {
		return (this.viewers.get(path)?.size ?? 0) > 0;
	}

	/** Returns all paths that currently have at least one active viewer. */
	boundPaths(): string[] {
		return [...this.viewers.keys()];
	}
}

export interface CrdtLiveViewsDeps {
	app: App;
	manager: CrdtManager;
	enrollment: CrdtEnrollment;
	/**
	 * Task 6 (note_id-keyed CRDT): resolve (minting if this path has never been
	 * seen before) the note_id that keys the CRDT manager and channel for
	 * `path`. Every manager/enrollment call in this file is keyed by the
	 * result, not by `path` directly — the editor binding must share the exact
	 * same doc the wire syncs, so it cannot key by path once the manager keys
	 * by id.
	 */
	resolveId(path: string): string;
	/** The existing disk flush (SyncEngine.flushFromCrdt). Called on last release. */
	flushToDisk(path: string, content: string): Promise<void>;
	/** Optional: surface a last-release flush/getText failure (the doc is left
	 *  resident in that case) instead of dropping the rejection on the floor. */
	onReleaseError?: (path: string, err: unknown) => void;
}

export class CrdtLiveViews {
	private readonly deps: CrdtLiveViewsDeps;
	private readonly refcount: ViewerRefcount;
	private readonly frontmatter: CrdtFrontmatterHook;
	private readonly reading: CrdtReadingView;
	/** Throwaway Y.Doc whose sole purpose is hosting the local-only Awareness. */
	private readonly awarenessDoc = new YDoc.Doc();
	/** Single local-only awareness instance shared across all editor controllers. */
	private readonly localAwareness = new Awareness(this.awarenessDoc);
	/** One EditorController per live CodeMirror EditorView. */
	private readonly controllers = new Map<EditorView, EditorController>();
	/** Fix wave 6: per-path trailing-debounce timers for `requestSaveForBoundPath`. */
	private readonly saveNudgeTimers = new Map<string, number>();
	/** Coalesce guard: one file switch fires active-leaf-change + file-open
	 *  (± layout-change), each calling refresh(). Same-microtask duplicates
	 *  observe identical workspace state, so only the first need do the
	 *  O(open-leaves) rebind. Reset on the next microtask (see refresh). */
	private refreshCoalescing = false;

	constructor(deps: CrdtLiveViewsDeps) {
		this.deps = deps;
		this.refcount = new ViewerRefcount((path) => {
			// A flush/getText failure leaves the doc resident (correct: never free what
			// we couldn't persist) — surface it instead of swallowing the rejection.
			this.onLastViewerRelease(path).catch((e) => this.deps.onReleaseError?.(path, e));
		});
		this.frontmatter = new CrdtFrontmatterHook({
			getPath: (v) => getMarkdownFilePath(v),
			getYText: (path) => this.getYText(path),
		});
		this.reading = new CrdtReadingView({
			getYText: (path) => this.getYText(path),
			isReadingMode: (v) => v instanceof MdView && v.getMode() === "preview",
		});
	}

	isBound(path: string): boolean {
		return this.refcount.isBound(path);
	}

	/** Fix wave 6: nudge Obsidian's own save pipeline for the bound editor
	 *  showing `path`, after a remote merge painted into it. `onFlushToDisk`
	 *  skips the disk write for a bound path (the editor owns the file) — but
	 *  headless/unfocused Obsidian (CI) doesn't promptly flush a
	 *  programmatically-updated buffer on its own, so a converged CRDT doc can
	 *  sit unsaved on disk for tens of seconds. `requestSave()` is Obsidian's
	 *  own API for this (it flushes through Obsidian's pipeline, so it cannot
	 *  fight the binding — it IS the binding-authoritative save).
	 *
	 *  Debounced per path (trailing, `SAVE_NUDGE_DEBOUNCE_MS`) so a burst of
	 *  deltas from one remote edit collapses to one save call. No-op when
	 *  `path` has no active viewer — nothing to nudge, and no burst to
	 *  coalesce (also means a note that closes mid-debounce simply never
	 *  fires, which is correct: the last-viewer-release flush below already
	 *  covers that case via `onLastViewerRelease`). Never throws. */
	requestSaveForBoundPath(path: string): void {
		if (!this.isBound(path)) return;
		const existing = this.saveNudgeTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.saveNudgeTimers.delete(path);
			this.doRequestSave(path);
		}, SAVE_NUDGE_DEBOUNCE_MS);
		this.saveNudgeTimers.set(path, timer);
	}

	/** Fix wave 7 (#191 slice): read the live buffer of the editor currently
	 *  showing `path`, for commitCrdtConvergence's phantom-binding check.
	 *  Returns null when nothing shows the path (nothing to compare). */
	boundBufferText(path: string): string | null {
		for (const leaf of this.deps.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MdView)) continue;
			if (getMarkdownFilePath(view) !== path) continue;
			return view.getViewData();
		}
		return null;
	}

	private doRequestSave(path: string): void {
		try {
			for (const leaf of this.deps.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (!(view instanceof MdView)) continue;
				if (getMarkdownFilePath(view) !== path) continue;
				view.requestSave();
			}
		} catch (e) {
			devLog().log("crdt", `requestSaveForBoundPath failed for ${path}: ${errMsg(e)}`);
		}
	}

	/** The last viewer of `path` left: persist the current Y.Text to disk, then
	 *  free the doc so the resident set stays bounded by open notes (closeDoc was
	 *  dead code before this — a Y.Doc leaked for every note ever visited in a
	 *  session). The IndexedDB store is preserved, so the note re-hydrates on next
	 *  open or remote update; no data loss. Skips the free if a new viewer bound
	 *  during the async flush (re-open race) — destroying a doc the editor just
	 *  re-bound to would break live sync. Returns the promise for tests. */
	private async onLastViewerRelease(path: string): Promise<void> {
		const noteId = this.deps.resolveId(path);
		const text = await this.deps.manager.getText(noteId);
		await this.deps.flushToDisk(path, text);
		if (!this.refcount.isBound(path)) this.deps.manager.closeDoc(noteId);
	}

	/** Open (or get cached) the path's Y.Text from the CRDT manager, resolving
	 *  (minting if needed) the note_id that actually keys the doc (Task 6). */
	async getYText(path: string): Promise<Y.Text> {
		const noteId = this.deps.resolveId(path);
		return (await this.deps.manager.getDoc(noteId)).getText("content");
	}

	/** Re-evaluate open markdown leaves: bind each editor's controller to its
	 *  current path; release and drop controllers whose editor is gone.
	 *  Detaches frontmatter + reading hooks for views whose path changed before
	 *  re-attaching, so the idempotency guard does not block the rebind. */
	refresh(): void {
		// Coalesce duplicate same-tick calls (see refreshCoalescing). The FIRST
		// call runs synchronously as before; a duplicate within the same microtask
		// checkpoint is skipped. Reset via queueMicrotask so any later-turn refresh
		// (observing genuinely new workspace state) always runs — this never defers
		// or drops a refresh, it only elides a redundant re-run of identical state.
		if (this.refreshCoalescing) return;
		this.refreshCoalescing = true;
		queueMicrotask(() => {
			this.refreshCoalescing = false;
		});
		const seen = new Set<EditorView>();
		for (const leaf of this.deps.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MdView)) continue;
			const path = getMarkdownFilePath(view);
			if (!path || !path.endsWith(".md")) continue;
			const cm = getEditorViewForLeaf(view);
			if (!cm) continue;
			seen.add(cm);
			let ctrl = this.controllers.get(cm);
			if (!ctrl) {
				ctrl = new EditorController({
					getYText: (p) => this.getYText(p),
					awareness: () => this.localAwareness,
					onBind: (p, id) => this.refcount.bind(p, id),
					onRelease: (p, id) => this.refcount.release(p, id),
					// The MdView owning this cm is stable for the cm's lifetime, but the
					// FILE it displays is not (Obsidian reuses views across note
					// switches) — this closure always reports the currently shown file.
					viewPath: () => getMarkdownFilePath(view),
				});
				this.controllers.set(cm, ctrl);
			}
			// If the controller is already bound to a different path (e.g. after a
			// rename), detach the hooks for the old path so they are not stuck on
			// the stale path and the re-attach below binds to the current path.
			if (ctrl.currentPath() !== null && ctrl.currentPath() !== path) {
				this.frontmatter.detach(view);
				this.reading.detach(view);
			}
			// The `.md` gate above (line ~112) is the extension check that used to
			// live inside CrdtEnrollment.enroll — it now belongs here, at the one
			// call site in this file that actually knows the path (Task 6).
			this.deps.enrollment.enroll(this.deps.resolveId(path));
			void ctrl.bindTo(cm, path);
			this.frontmatter.attach(view);
			void this.reading.attach(view, path);
		}
		// Release controllers whose editor is no longer an open markdown leaf.
		for (const [cm, ctrl] of this.controllers) {
			if (!seen.has(cm)) {
				ctrl.release(cm);
				this.controllers.delete(cm);
			}
		}
	}

	/** Force any editor controller currently showing `path` to re-resolve its
	 *  note_id and rebind. Used after a genesis ADOPT remaps path -> serverId:
	 *  the path is unchanged so refresh()'s bindTo short-circuits and the editor
	 *  stays on the orphaned mint doc. No-op when nothing shows the path. The
	 *  caller pre-seeds the serverId doc from the mint content, so the rebind's
	 *  reconcile is a no-op and no in-flight edit is lost. */
	rebindPath(path: string): void {
		const norm = normalizePath(path);
		for (const [cm, ctrl] of this.controllers) {
			const cur = ctrl.currentPath();
			if (cur !== null && normalizePath(cur) === norm) ctrl.forceRebind(cm, path);
		}
	}

	/** Release + drop every editor controller WITHOUT tearing down awareness or
	 *  hooks — so no binding spans a Y.Doc teardown (replace-remote's crdtDelete
	 *  destroys docs whose files stay open). The next refresh() re-binds current
	 *  views with fresh controllers. */
	detachAll(): void {
		for (const [cm, ctrl] of this.controllers) {
			ctrl.release(cm);
			this.controllers.delete(cm);
		}
	}

	destroy(): void {
		// Release all editor controllers (sets their released flag, clears compartments).
		for (const [cm, ctrl] of this.controllers) {
			ctrl.release(cm);
		}
		this.controllers.clear();
		// Fix wave 6: cancel any pending save-nudge timers — nothing to save
		// into once the plugin is tearing down.
		for (const timer of this.saveNudgeTimers.values()) {
			window.clearTimeout(timer);
		}
		this.saveNudgeTimers.clear();
		// Detach all frontmatter + reading-view hooks.
		this.frontmatter.detachAll();
		this.reading.detachAll();
		// Tear down the local-only awareness + its throwaway doc.
		this.localAwareness.destroy();
		this.awarenessDoc.destroy();
		// Flush any paths that still have live viewers (mid-session settings save /
		// reconnect). Without this, content typed since the last onLastRelease flush
		// stays only in Y.Text and is never written to disk before the manager tears
		// down.
		for (const path of this.refcount.boundPaths()) {
			const noteId = this.deps.resolveId(path);
			void this.deps.manager
				.getText(noteId)
				.then((content) => this.deps.flushToDisk(path, content));
		}
	}
}
