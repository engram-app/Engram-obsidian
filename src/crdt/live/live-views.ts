import type { App } from "obsidian";
import { MarkdownView as MdView, TFile } from "obsidian";
import type * as Y from "yjs";
import { devLog } from "../../dev-log";
import { errMsg } from "../../error-util";
import { isMarkdownPath } from "../../file-kind";
import { isDestroyedError } from "../destroyed-error";
import { CONTENT_KEY } from "../frontmatter-codec";
import type { ProviderRegistry } from "../provider-registry";
import { CrdtFrontmatterHook } from "./frontmatter-hook";
import type { LiveBindingCoordinator } from "./live-binding";
import { getMarkdownFilePath } from "./obsidian-internals";
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
		if (!set?.has(viewId)) return;
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
	manager: ProviderRegistry;
	enrollment: ProviderRegistry;
	/**
	 * Task 6 (note_id-keyed CRDT): resolve (minting if this path has never been
	 * seen before) the note_id that keys the CRDT manager and channel for
	 * `path`. Every manager/enrollment call in this file is keyed by the
	 * result, not by `path` directly — the editor binding must share the exact
	 * same doc the wire syncs, so it cannot key by path once the manager keys
	 * by id.
	 */
	resolveId(path: string): string;
	/** Resolve WITHOUT minting: the id this path already has, or null.
	 *
	 *  Relay parity (`SharedFolder.deleteFiles` / `syncStore.get(vpath)`): a path
	 *  with no entry has no document, so there is nothing to persist. The
	 *  minting `resolveId` must never be used on a teardown path — after a delete
	 *  the map entry is gone, so minting hands back a BRAND-NEW id whose doc is
	 *  empty and, crucially, carries no tombstone. Flushing that wrote a 0-byte
	 *  file at the just-deleted path (2026-07-28). */
	resolveExistingId(path: string): string | null;
	/** The existing disk flush (SyncEngine.flushFromCrdt). Called on last release. */
	flushToDisk(path: string, content: string): Promise<void>;
	/** Optional: surface a last-release flush/getText failure (the doc is left
	 *  resident in that case) instead of dropping the rejection on the floor. */
	onReleaseError?: (path: string, err: unknown) => void;
}

/** Owns the non-editor CRDT view concerns (frontmatter properties + reading-mode
 *  render) and the viewer refcount, and serves as the LiveBindingCoordinator for
 *  the editor ViewPlugin (live-binding.ts). The editor text binding itself lives
 *  in the ViewPlugin now — a CM6-owned per-view lifecycle that cannot be wiped by
 *  Obsidian's setViewData (the old Compartment-based wedge class). */
export class CrdtLiveViews implements LiveBindingCoordinator {
	private readonly deps: CrdtLiveViewsDeps;
	private readonly refcount: ViewerRefcount;
	private readonly frontmatter: CrdtFrontmatterHook;
	private readonly reading: CrdtReadingView;
	/** Fix wave 6: per-path trailing-debounce timers for `requestSaveForBoundPath`. */
	private readonly saveNudgeTimers = new Map<string, number>();
	/** Last path each view's frontmatter/reading hooks were attached for, so a
	 *  file switch that reuses the view detaches the stale hooks before re-attach. */
	private readonly hookPaths = new WeakMap<MdView, string>();
	/** Coalesce guard: one file switch fires active-leaf-change + file-open
	 *  (± layout-change), each calling refresh(). Same-microtask duplicates
	 *  observe identical workspace state, so only the first need do the work.
	 *  Reset on the next microtask (see refresh). */
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
			isBound: (path) => this.isBound(path),
			onEditCaptured: (path) => this.requestSaveForBoundPath(path),
		});
	}

	// --- LiveBindingCoordinator (for the editor ViewPlugin) ---------------------

	resolveId(path: string): string {
		return this.deps.resolveId(path);
	}

	residentText(noteId: string): { text: Y.Text; ready: Promise<void> } {
		return this.deps.manager.residentText(noteId);
	}

	enroll(noteId: string): void {
		this.deps.enrollment.enroll(noteId);
	}

	onBind(path: string, viewId: string): void {
		this.refcount.bind(path, viewId);
	}

	onRelease(path: string, viewId: string): void {
		this.refcount.release(path, viewId);
	}

	isBound(path: string): boolean {
		return this.refcount.isBound(path);
	}

	/** Every path an editor is currently bound to. Enumerable (not just the
	 *  isBound predicate) so the invariant checker can assert properties ACROSS
	 *  the whole binding set, e.g. every bound path resolves to a note_id. */
	boundPaths(): string[] {
		return this.refcount.boundPaths();
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
	 *  `path` has no active viewer. Never throws. */
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

	/** The last viewer of `path` left: persist the current Y.Text to disk. The doc
	 *  stays resident (Relay persistent-doc model — closeDoc is a no-op), so the
	 *  note keeps syncing and re-paints instantly on re-open. */
	private async onLastViewerRelease(path: string): Promise<void> {
		// Relay parity, three rules for a teardown flush:
		//
		// 1. NEVER mint. `syncStore.get(vpath)` returning nothing means the note is
		//    not tracked — there is no document, so there is nothing to persist.
		//    Minting here resurrects a deleted note under a fresh, untombstoned id.
		const noteId = this.deps.resolveExistingId(path);
		if (noteId === null) return;
		// 2. NEVER materialize. A release persists an OPEN editor's buffer; if the
		//    file is gone the note was deleted while open, and writing recreates it.
		if (!(this.deps.app.vault.getAbstractFileByPath(path) instanceof TFile)) return;
		// 3. A destroyed doc is expected here (delete races the view teardown) and
		//    is swallowed — exactly and only this error, as Relay's LiveViews do.
		try {
			const text = await this.deps.manager.getText(noteId);
			await this.deps.flushToDisk(path, text);
		} catch (e) {
			if (isDestroyedError(e)) return;
			throw e;
		}
	}

	/** Open (or get cached) the path's Y.Text from the CRDT manager, resolving
	 *  (minting if needed) the note_id that actually keys the doc (Task 6). */
	async getYText(path: string): Promise<Y.Text> {
		const noteId = this.deps.resolveId(path);
		return (await this.deps.manager.getDoc(noteId)).getText(CONTENT_KEY);
	}

	/** Re-evaluate open markdown leaves: enroll each, and (re)attach the
	 *  frontmatter + reading-mode hooks. The editor TEXT binding is handled
	 *  independently by the ViewPlugin (CM6-owned), so refresh() no longer binds
	 *  editors — it only covers the concerns without a per-view CM lifecycle. */
	refresh(): void {
		if (this.refreshCoalescing) return;
		this.refreshCoalescing = true;
		queueMicrotask(() => {
			this.refreshCoalescing = false;
		});
		for (const leaf of this.deps.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MdView)) continue;
			const path = getMarkdownFilePath(view);
			if (!path || !isMarkdownPath(path)) continue;
			// If this view was showing a different note (rename / reuse), detach the
			// stale hooks first so their idempotency guard does not block the rebind.
			const prev = this.hookPaths.get(view);
			if (prev !== undefined && prev !== path) {
				this.frontmatter.detach(view);
				this.reading.detach(view);
			}
			this.hookPaths.set(view, path);
			// Reading-only leaves have no CM editor (no ViewPlugin), so enroll here
			// too. Idempotent + edge-guarded, so an already-enrolled note is ~free.
			this.deps.enrollment.enroll(this.deps.resolveId(path));
			this.frontmatter.attach(view);
			void this.reading.attach(view, path);
		}
	}

	/** Flush any paths that still have live viewers (settings save / reconnect /
	 *  unload), then resolve. Content is read SYNCHRONOUSLY from the resident doc
	 *  BEFORE returning, so a caller that immediately destroys the manager
	 *  (crdtManager.destroyAll()) cannot make a later toJSON() run on a dead doc and
	 *  write empty over the note. The reconnect path awaits this; unload cannot, but
	 *  the synchronous capture keeps it safe there too. */
	destroy(): Promise<void> {
		// Cancel any pending save-nudge timers — nothing to save into on teardown.
		for (const timer of this.saveNudgeTimers.values()) {
			window.clearTimeout(timer);
		}
		this.saveNudgeTimers.clear();
		// Detach all frontmatter + reading-view hooks.
		this.frontmatter.detachAll();
		this.reading.detachAll();
		const flushes: Array<Promise<void>> = [];
		for (const path of this.refcount.boundPaths()) {
			// Teardown path: same NEVER-mint rule as onLastViewerRelease — minting
			// resurrects a deleted note under a fresh, untombstoned id (2026-07-28).
			const noteId = this.deps.resolveExistingId(path);
			if (noteId === null) continue;
			// Only a resident doc can be flushed. Guard so we never materialize a fresh
			// EMPTY doc for a torn-down path and clobber its file with "".
			if (!this.deps.manager.hasDoc(noteId)) continue;
			const content = this.deps.manager.residentText(noteId).text.toJSON();
			flushes.push(
				Promise.resolve(this.deps.flushToDisk(path, content)).catch((e) =>
					this.deps.onReleaseError?.(path, e),
				),
			);
		}
		return Promise.all(flushes).then(() => {});
	}
}
