import type { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { MarkdownView as MdView } from "obsidian";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import * as YDoc from "yjs";
import type { CrdtEnrollment } from "../enrollment";
import type { CrdtManager } from "../manager";
import { EditorController } from "./editor-controller";
import { CrdtFrontmatterHook } from "./frontmatter-hook";
import { getEditorViewForLeaf, getMarkdownFilePath } from "./obsidian-internals";
import { CrdtReadingView } from "./reading-view";

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

	constructor(deps: CrdtLiveViewsDeps) {
		this.deps = deps;
		this.refcount = new ViewerRefcount((path) => {
			// Last viewer left: persist the current Y.Text to disk now.
			const noteId = this.deps.resolveId(path);
			void this.deps.manager.getText(noteId).then((t) => this.deps.flushToDisk(path, t));
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

	destroy(): void {
		// Release all editor controllers (sets their released flag, clears compartments).
		for (const [cm, ctrl] of this.controllers) {
			ctrl.release(cm);
		}
		this.controllers.clear();
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
