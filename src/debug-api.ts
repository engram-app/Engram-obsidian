/**
 * Installs the debug snapshot on `window.__engramDebug`.
 *
 * Gated on `diagnosticsEnabled`, NOT on `DEV_MODE`: the whole point is to
 * inspect a real user's install while they are looking at the broken note. A
 * dev-only handle would be absent in exactly the situation it exists for.
 *
 * Usage from the developer console:
 *   await __engramDebug.note("notes/a.md")          // redacted
 *   await __engramDebug.note("notes/a.md", true)    // with content
 *   __engramDebug.vault()
 */

import type { SnapshotDeps, SnapshotRegistry } from "./debug-snapshot";
import { buildNoteSnapshot, buildVaultSnapshot } from "./debug-snapshot";
import { type SyncEvent, serializeTimeline } from "./sync-recorder";

const GLOBAL_KEY = "__engramDebug";

export interface DebugApi {
	note(key: string, includeContent?: boolean): Promise<unknown>;
	vault(): unknown;
	/** Recorded sync timeline (#356), optionally narrowed to one note. Returns
	 *  the JSON a replay fixture is made of — copy it out of the console, or
	 *  attach it to a bug report. */
	timeline(noteId?: string): string;
	clearTimeline(): void;
}

export interface DebugApiHost {
	registry: SnapshotRegistry;
	idForPath(path: string): string | null;
	pathForId(noteId: string): string | null;
	readDisk: SnapshotDeps["readDisk"];
	syncStateFor: SnapshotDeps["syncStateFor"];
	isLiveBound(path: string): boolean;
	pendingPromises(): { label: string; ageMs: number }[];
	recorder: { timeline(noteId?: string): SyncEvent[]; clear(): void };
}

export function createDebugApi(host: DebugApiHost): DebugApi {
	const deps: SnapshotDeps = host;
	return {
		note: (key, includeContent = false) => buildNoteSnapshot(key, deps, { includeContent }),
		vault: () => buildVaultSnapshot(deps),
		// Accepts a path as well as an id, matching `note()` — an investigation
		// starts from whichever the evidence contained.
		timeline: (noteId) =>
			serializeTimeline(host.recorder.timeline(noteId ? resolveId(host, noteId) : undefined)),
		clearTimeline: () => host.recorder.clear(),
	};
}

function resolveId(host: DebugApiHost, key: string): string {
	return host.idForPath(key) ?? key;
}

export function installDebugApi(api: DebugApi): void {
	(window as unknown as Record<string, unknown>)[GLOBAL_KEY] = api;
}

export function uninstallDebugApi(): void {
	// Intentional cleanup of a debug global; biome 2 dropped lint/performance/noDelete.
	delete (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
}
