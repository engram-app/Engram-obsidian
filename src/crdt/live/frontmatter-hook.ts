// src/crdt/live/frontmatter-hook.ts
// Adapted from Relay src/plugins/ViewHookPlugin.ts (No-Instructions/Relay).
import type * as Y from "yjs";
import { rlog } from "../../remote-log"; // Correction 1: rlog is exported from src/remote-log.ts
import { diffIntoYText } from "../bridge";
import { patchFrontmatterSave } from "./obsidian-internals";

export interface FrontmatterHookDeps {
	getPath(view: unknown): string | null;
	getYText(path: string): Promise<Y.Text>;
}

export class CrdtFrontmatterHook {
	private readonly deps: FrontmatterHookDeps;
	private readonly uninstallers = new WeakMap<object, () => void>();

	constructor(deps: FrontmatterHookDeps) {
		this.deps = deps;
	}

	attach(view: unknown): void {
		const path = this.deps.getPath(view);
		if (!path || typeof view !== "object" || view === null) return;
		const uninstall = patchFrontmatterSave(view, (newText) => {
			void this.deps.getYText(path).then((ytext) => {
				// diffIntoYText is a no-op when content is unchanged, and patches only
				// the frontmatter range, leaving body Y.Text ops untouched.
				diffIntoYText(ytext, newText);
			});
		});
		if (!uninstall) {
			// Not patchable on this Obsidian build: frontmatter still syncs via the
			// disk path (bursty), never broken.
			rlog().info("crdt", `frontmatter hook unavailable for ${path}, using disk path`);
			return;
		}
		this.uninstallers.set(view as object, uninstall);
	}

	detach(view: unknown): void {
		if (typeof view !== "object" || view === null) return;
		const uninstall = this.uninstallers.get(view as object);
		if (uninstall) {
			uninstall();
			this.uninstallers.delete(view as object);
		}
	}
}
