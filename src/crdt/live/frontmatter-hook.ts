// src/crdt/live/frontmatter-hook.ts
// Adapted from Relay src/plugins/ViewHookPlugin.ts (No-Instructions/Relay).
import type * as Y from "yjs";
import { rlog } from "../../remote-log"; // Correction 1: rlog is exported from src/remote-log.ts
import { diffIntoYText } from "../bridge";
import { splitFrontmatter } from "../frontmatter-codec";
import { patchFrontmatterSave } from "./obsidian-internals";

export interface FrontmatterHookDeps {
	getPath(view: unknown): string | null;
	getYText(path: string): Promise<Y.Text>;
}

export class CrdtFrontmatterHook {
	private readonly deps: FrontmatterHookDeps;
	private readonly uninstallers = new WeakMap<object, () => void>();
	/** Strong-reference set so detachAll() can iterate all attached views.
	 *  The WeakMap alone is not iterable. */
	private readonly attached = new Set<object>();

	constructor(deps: FrontmatterHookDeps) {
		this.deps = deps;
	}

	attach(view: unknown): void {
		if (typeof view !== "object" || view === null) return;
		if (this.uninstallers.has(view)) return; // idempotent: already attached
		const path = this.deps.getPath(view);
		if (!path) return;
		const uninstall = patchFrontmatterSave(view, (newText) => {
			void this.deps
				.getYText(path)
				.then((ytext) => {
					// The CONTENT Y.Text is BODY-ONLY (note-seed strips the FM block into
					// the frontmatter Y.Maps), but view.text at saveFrontmatter time is the
					// FULL file text. Diff only the body slice in — diffing the full text
					// prepends the whole FM block to the body Y.Text and broadcasts it.
					// The FM block itself syncs via the disk-save path (routeModify ->
					// seedContentInto), same as the unpatchable fallback below. Usually a
					// no-op (a properties save doesn't touch the body).
					diffIntoYText(ytext, splitFrontmatter(newText).body);
				})
				.catch((err: unknown) =>
					rlog().error("crdt-frontmatter", `getYText failed for ${path}: ${String(err)}`),
				);
		});
		if (!uninstall) {
			// Not patchable on this Obsidian build: frontmatter still syncs via the
			// disk path (bursty), never broken.
			rlog().info("crdt", `frontmatter hook unavailable for ${path}, using disk path`);
			return;
		}
		this.uninstallers.set(view, uninstall);
		this.attached.add(view);
	}

	detach(view: unknown): void {
		if (typeof view !== "object" || view === null) return;
		const uninstall = this.uninstallers.get(view);
		if (uninstall) {
			uninstall();
			this.uninstallers.delete(view);
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
