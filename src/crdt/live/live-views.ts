import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { MarkdownView as MdView } from "obsidian";
import type * as Y from "yjs";
import { diffIntoYText } from "../bridge";
import type { CrdtEnrollment } from "../enrollment";
import type { CrdtManager } from "../manager";
import { type BindingDeps, crdtEditorBinding } from "./editor-binding";
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
	/** The existing disk flush (SyncEngine.flushFromCrdt). Called on last release. */
	flushToDisk(path: string, content: string): Promise<void>;
}

export class CrdtLiveViews {
	private readonly deps: CrdtLiveViewsDeps;
	private readonly refcount: ViewerRefcount;
	private readonly frontmatter: CrdtFrontmatterHook;
	private readonly reading: CrdtReadingView;
	/** Maps an EditorView back to its path for the binding. */
	private readonly viewPaths = new WeakMap<EditorView, string>();

	constructor(deps: CrdtLiveViewsDeps) {
		this.deps = deps;
		this.refcount = new ViewerRefcount((path) => {
			// Last viewer left: persist the current Y.Text to disk now.
			void this.deps.manager.getText(path).then((t) => this.deps.flushToDisk(path, t));
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

	/** Map an EditorView to its note path for the editor binding. */
	resolvePath(view: EditorView): string | null {
		return this.viewPaths.get(view) ?? null;
	}

	/** Open (or get cached) the path's Y.Text from the CRDT manager. */
	async getYText(path: string): Promise<Y.Text> {
		return (await this.deps.manager.getDoc(path)).getText("content");
	}

	/** Refcount bind: a new editor pane opened this path. */
	onBind(path: string, viewId: string): void {
		this.refcount.bind(path, viewId);
	}

	/** Refcount release: an editor pane closed this path. */
	onRelease(path: string, viewId: string): void {
		this.refcount.release(path, viewId);
	}

	/** Seed editor content into Y.Text after async open (no-op if equal). */
	async seedFromEditor(path: string, editorText: string): Promise<void> {
		const ytext = await this.getYText(path);
		diffIntoYText(ytext, editorText);
	}

	/** @deprecated Use the stable BindingDeps wired in main.ts onload instead. */
	extension(): Extension {
		const bindingDeps: BindingDeps = {
			resolvePath: (view) => this.resolvePath(view),
			getYText: (path) => this.getYText(path),
			onBind: (path, viewId) => this.onBind(path, viewId),
			onRelease: (path, viewId) => this.onRelease(path, viewId),
			seedFromEditor: (path, editorText) => this.seedFromEditor(path, editorText),
		};
		return crdtEditorBinding(bindingDeps);
	}

	/** Re-evaluate open leaves: register EditorView->path, enroll, attach hooks. */
	refresh(): void {
		const leaves = this.deps.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (!(view instanceof MdView)) continue;
			const path = getMarkdownFilePath(view);
			if (!path || !path.endsWith(".md")) continue;
			const cm = getEditorViewForLeaf(view);
			if (cm) this.viewPaths.set(cm, path);
			this.deps.enrollment.enroll(path);
			this.frontmatter.attach(view);
			void this.reading.attach(view, path);
		}
	}

	destroy(): void {
		// Flush any paths that still have live viewers (mid-session settings save /
		// reconnect). Without this, content typed since the last onLastRelease flush
		// stays only in Y.Text and is never written to disk before the manager tears
		// down. The frontmatter hook and reading view hold only WeakMap-keyed
		// per-view state, which is GC-safe on view teardown with no explicit clear.
		for (const path of this.refcount.boundPaths()) {
			void this.deps.manager
				.getText(path)
				.then((content) => this.deps.flushToDisk(path, content));
		}
	}
}
