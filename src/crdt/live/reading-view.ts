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

	constructor(deps: ReadingViewDeps) {
		this.deps = deps;
	}

	async attach(view: unknown, path: string): Promise<void> {
		if (typeof view !== "object" || view === null) return;
		// Idempotency guard (also closes the concurrent-attach race): reserve the
		// slot synchronously before awaiting so a second call that arrives before
		// getYText resolves sees the placeholder and returns early. If getYText
		// rejects, remove the placeholder so a later refresh can retry.
		if (this.observers.has(view as object)) return;
		this.observers.set(view as object, () => {}); // placeholder, replaced below
		const ytext = await this.deps.getYText(path).catch((err: unknown) => {
			rlog().error("crdt-reading-view", `getYText failed for ${path}: ${String(err)}`);
			this.observers.delete(view as object); // allow retry on next refresh
			return null;
		});
		if (!ytext) return;
		const handler = () => {
			if (!this.deps.isReadingMode(view)) return;
			setPreviewRendered(view, ytext.toJSON());
		};
		ytext.observe(handler);
		this.observers.set(view as object, () => ytext.unobserve(handler)); // replace placeholder
	}

	detach(view: unknown): void {
		if (typeof view !== "object" || view === null) return;
		const off = this.observers.get(view);
		if (off) {
			off();
			this.observers.delete(view);
		}
	}
}
