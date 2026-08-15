/**
 * Installs the debug snapshot on `window.__engramDebug`.
 *
 * Gated on `diagnosticsEnabled`, NOT on `DEV_MODE`: the whole point is to
 * inspect a real user's install while they are looking at the broken note. A
 * dev-only handle would be absent in exactly the situation it exists for.
 *
 * Snapshots carry hashes and lengths, never note text. There is deliberately
 * no opt-in for content: the audience for this API is a user pasting its
 * output into a bug report, and "just pass true" is how note bodies end up in
 * public issues. A hash mismatch is what these investigations actually turn
 * on; if the text itself is needed, it is in the vault, and asking for it is
 * a conversation rather than a console flag.
 *
 * Usage from the developer console:
 *   await __engramDebug.note("notes/a.md")
 *   __engramDebug.vault()
 */

import type { SnapshotDeps, SnapshotRegistry } from "./debug-snapshot";
import { buildNoteSnapshot, buildVaultSnapshot } from "./debug-snapshot";

const GLOBAL_KEY = "__engramDebug";

export interface DebugApi {
	note(key: string): Promise<unknown>;
	vault(): unknown;
}

export interface DebugApiHost {
	registry: SnapshotRegistry;
	idForPath(path: string): string | null;
	pathForId(noteId: string): string | null;
	readDisk: SnapshotDeps["readDisk"];
	syncStateFor: SnapshotDeps["syncStateFor"];
	isLiveBound(path: string): boolean;
	pendingPromises(): { label: string; ageMs: number }[];
}

export function createDebugApi(host: DebugApiHost): DebugApi {
	const deps: SnapshotDeps = host;
	return {
		note: (key) => buildNoteSnapshot(key, deps),
		vault: () => buildVaultSnapshot(deps),
	};
}

export function installDebugApi(api: DebugApi): void {
	(window as unknown as Record<string, unknown>)[GLOBAL_KEY] = api;
}

export function uninstallDebugApi(): void {
	// Intentional cleanup of a debug global; biome 2 dropped lint/performance/noDelete.
	delete (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
}
