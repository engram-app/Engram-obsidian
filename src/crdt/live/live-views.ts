import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { MarkdownView as MdView } from "obsidian";
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

	private async getYText(path: string) {
		return (await this.deps.manager.getDoc(path)).getText("content");
	}

	extension(): Extension {
		const bindingDeps: BindingDeps = {
			resolvePath: (view) => this.viewPaths.get(view) ?? null,
			getYText: (path) => this.getYText(path),
			onBind: (path, viewId) => this.refcount.bind(path, viewId),
			onRelease: (path, viewId) => this.refcount.release(path, viewId),
			seedFromEditor: async (path, editorText) => {
				const ytext = await this.getYText(path);
				diffIntoYText(ytext, editorText); // no-op when already equal
			},
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
		// Hooks detach via WeakMap GC on view teardown; nothing global to clear here
		// beyond letting the CrdtManager own doc lifecycle.
	}
}
