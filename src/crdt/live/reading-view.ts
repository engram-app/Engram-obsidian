// src/crdt/live/reading-view.ts
// Adapted from Relay src/plugins/PreviewRenderer.ts (No-Instructions/Relay).
import type * as Y from "yjs";
import { rlog } from "../../remote-log";
import { applyCmChangesToYText, textDiffToChangeSpec } from "./cm-yjs-bridge";
import { frontmatterPrefixLen, mergeTypedEdits } from "./live-binding-decisions";
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
	/** Per view, the body text the reading pane was last rendered from. This is the
	 *  LCA for a preview edit: `previewMode.edit` hands back that text plus the
	 *  user's toggle, so it is exactly "what the user was looking at when they
	 *  clicked" — which is NOT necessarily the current Y.Text. */
	private readonly rendered = new WeakMap<object, string>();

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
		const placeholder = () => {}; // identity token, replaced below
		this.observers.set(view, placeholder);
		this.attached.add(view);
		const ytext = await this.deps.getYText(path).catch((err: unknown) => {
			rlog().error("crdt-reading-view", `getYText failed for ${path}: ${String(err)}`);
			// Same identity rule as the success path: a detach + re-attach during
			// the await means these slots belong to the NEWER attach — a late
			// rejection must not cancel its reservation.
			if (this.observers.get(view) === placeholder) {
				this.observers.delete(view); // allow retry on next refresh
				this.attached.delete(view);
			}
			return null;
		});
		if (!ytext) return;
		// A detach()/detachAll() that ran during the await removed the
		// placeholder; installing anyway would leak an observer + preview patch
		// on a view the coordinator considers detached (detachAll can't find it).
		if (this.observers.get(view) !== placeholder) return;
		this.rendered.set(view, ytext.toJSON());
		const handler = () => {
			if (!this.deps.isReadingMode(view)) return;
			const text = ytext.toJSON();
			this.rendered.set(view, text);
			setPreviewRendered(view, text);
		};
		ytext.observe(handler);
		const unpatch = patchPreviewEdit(view, (fullText) =>
			this.captureEdit(view, path, ytext, fullText),
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
	 *  the frontmatter block is sliced off to reach the body-only Y.Text.
	 *
	 *  MERGED, never whole-text-diffed. `body` is the text the pane was RENDERED
	 *  from plus the toggle, so it lags any remote update that landed since that
	 *  render. Diffing it straight onto the live Y.Text would delete whatever
	 *  arrived in between — the same content-destroying shape decideReconcile was
	 *  hardened against. Instead patch only the toggle (rendered -> body) onto the
	 *  live text, exactly as the editor reconcile does. */
	private captureEdit(view: object, path: string, ytext: Y.Text, fullText: string): boolean {
		if (!this.deps.isBound(path)) return false;
		const doc = ytext.doc;
		if (!doc) return false;
		const base = this.rendered.get(view);
		if (base === undefined) return false; // never rendered -> no LCA, leave it to Obsidian
		const live = ytext.toJSON();
		const body = fullText.slice(frontmatterPrefixLen(fullText));
		const merged = mergeTypedEdits(base, body, live);
		if (merged === null) {
			// The toggle collides with a concurrent remote edit to the same region.
			// Refuse it and re-render from the doc, so the checkbox visibly springs
			// back rather than silently overwriting the other side.
			this.rendered.set(view, live);
			setPreviewRendered(view, live);
			return true;
		}
		const changes = textDiffToChangeSpec(live, merged);
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
