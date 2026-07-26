// src/crdt/live/reading-view.ts
// Adapted from Relay src/plugins/PreviewRenderer.ts (No-Instructions/Relay).
import type * as Y from "yjs";
import { rlog } from "../../remote-log";
import { applyCmChangesToYText, textDiffToChangeSpec } from "./cm-yjs-bridge";
import { frontmatterPrefixLen } from "./live-binding-decisions";
import { patchPreviewEdit, setPreviewRendered } from "./obsidian-internals";

/** Transaction origin for a reading-view edit. Distinct from any LiveBindingValue
 *  instance, so an editor bound to the same note treats it as foreign and PAINTS
 *  it — which is how the toggle reaches that editor's buffer and, through
 *  Obsidian's own save, the disk. */
const READING_EDIT_ORIGIN = { source: "crdt-reading-view" };

export interface ReadingViewDeps {
	getYText(path: string): Promise<Y.Text>;
	/** True when the view is currently in reading (preview) mode. */
	isReadingMode(view: unknown): boolean;
	/** True while an editor pane holds this path — the only case where Obsidian's
	 *  own preview write is dropped, so the only case we take the edit over. */
	isBound(path: string): boolean;
	/** Nudge Obsidian to persist the bound editor after we painted into it. */
	onEditCaptured(path: string): void;
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
		const unpatch = patchPreviewEdit(view, (fullText) =>
			this.captureEdit(path, ytext, fullText),
		);
		this.observers.set(view, () => {
			ytext.unobserve(handler);
			unpatch?.();
		}); // replace placeholder
	}

	/** Route an in-preview edit (checkbox toggle) into the Y.Text. Only takes the
	 *  edit when an editor pane also holds the path: without one, Obsidian's own
	 *  write reaches disk and the ordinary modify path routes it, so intercepting
	 *  would be a second write path for no gain. `fullText` is the whole file, so
	 *  the frontmatter block is sliced off to reach the body-only Y.Text. */
	private captureEdit(path: string, ytext: Y.Text, fullText: string): boolean {
		if (!this.deps.isBound(path)) return false;
		const doc = ytext.doc;
		if (!doc) return false;
		const body = fullText.slice(frontmatterPrefixLen(fullText));
		const changes = textDiffToChangeSpec(ytext.toJSON(), body);
		if (changes.length > 0) {
			const mapped = changes.map((c) => ({ fromA: c.from, toA: c.to, insert: c.insert }));
			doc.transact(() => applyCmChangesToYText(ytext, mapped), READING_EDIT_ORIGIN);
			this.deps.onEditCaptured(path);
		}
		return true;
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
