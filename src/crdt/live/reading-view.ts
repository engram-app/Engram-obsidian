// src/crdt/live/reading-view.ts
// Adapted from Relay src/plugins/PreviewRenderer.ts (No-Instructions/Relay).
import type * as Y from "yjs";
import { rlog } from "../../remote-log";
import { setPreviewRendered } from "./obsidian-internals";

export interface ReadingViewDeps {
	getYText(path: string): Promise<Y.Text>;
	/** True when the view is currently in reading (preview) mode. */
	isReadingMode(view: unknown): boolean;
}

export class CrdtReadingView {
	private readonly deps: ReadingViewDeps;
	private readonly observers = new WeakMap<object, () => void>();
	/** Strong-reference set so detachAll() can iterate all attached views.
	 *  The WeakMap alone is not iterable. */
	private readonly attached = new Set<object>();

	constructor(deps: ReadingViewDeps) {
		this.deps = deps;
	}

	async attach(view: unknown, path: string): Promise<void> {
		if (typeof view !== "object" || view === null) return;
		// Idempotency guard (also closes the concurrent-attach race): reserve the
		// slot synchronously before awaiting so a second call that arrives before
		// getYText resolves sees the placeholder and returns early. If getYText
		// rejects, remove the placeholder so a later refresh can retry.
		if (this.observers.has(view)) return;
		this.observers.set(view, () => {}); // placeholder, replaced below
		this.attached.add(view);
		const ytext = await this.deps.getYText(path).catch((err: unknown) => {
			rlog().error("crdt-reading-view", `getYText failed for ${path}: ${String(err)}`);
			this.observers.delete(view); // allow retry on next refresh
			this.attached.delete(view);
			return null;
		});
		if (!ytext) return;
		const handler = () => {
			if (!this.deps.isReadingMode(view)) return;
			setPreviewRendered(view, ytext.toJSON());
		};
		ytext.observe(handler);
		this.observers.set(view, () => ytext.unobserve(handler)); // replace placeholder
	}

	detach(view: unknown): void {
		if (typeof view !== "object" || view === null) return;
		const off = this.observers.get(view);
		if (off) {
			off();
			this.observers.delete(view);
			this.attached.delete(view);
		}
	}

	/** Detach all currently attached views. Called by CrdtLiveViews.destroy(). */
	detachAll(): void {
		for (const view of this.attached) {
			this.detach(view);
		}
		// attached is cleared entry-by-entry in detach(); belt-and-suspenders clear.
		this.attached.clear();
	}
}
