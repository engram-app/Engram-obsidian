/**
 * Offline queue — persists failed sync operations for retry when connectivity returns.
 *
 * Deduplicates by composite key "{vaultId}:{path}" (or just "{path}" if no vaultId).
 * Entries are flushed by priority, then oldest-first within a priority.
 * Persistence is debounced to avoid O(n²) serialization during rapid enqueues.
 *
 * ponytail (#359): this queue was NOT rewritten. Relay's BackgroundSync is 2450
 * lines of groups, progress snapshots and cancellation, but most of what it adds
 * we already had — dedup, a persisted retry cap (`attempts`), oldest-first
 * ordering. Only three things were genuinely missing, and they are here:
 * priority, an explicit synchronous `cancel`, and `queuedReason`. Rewriting a
 * battle-tested persisted component to reach parity with a design we do not
 * need would have been the expensive way to get those.
 */
import { errMsg } from "./error-util";
import { rlog } from "./remote-log";
import type { QueueEntry } from "./types";

/**
 * Flush order. Lower runs sooner.
 *
 * Numeric rather than a string union so ordering is the comparison itself, and
 * so a persisted entry from before this existed sorts as `Normal` via `??`
 * rather than sinking below background work.
 */
export const QueuePriority = {
	/** The note the user currently has open. */
	OpenNote: 0,
	/** Ordinary edit-driven sync. The default. */
	Normal: 10,
	/** Bulk work: initial import, full push, resync sweeps. */
	Background: 20,
} as const;

export type QueuePriorityValue = (typeof QueuePriority)[keyof typeof QueuePriority];

export interface QueueGateState {
	queued: number;
	inFlight: number;
	offline: boolean;
	syncBlocked: boolean;
}

export type QueuedReason = "offline" | "sync-blocked" | "in-progress" | "waiting";

/**
 * Why is this queue not draining?
 *
 * Ported from Relay's `queuedReasonForSnapshot`. Cheap, and it removes a whole
 * class of support ticket: today a held queue is an unexplained spinner, and
 * "waiting" in particular names the case that currently looks like a hang —
 * online, unblocked, nothing in flight, work still sitting there.
 *
 * Offline outranks sync-blocked because it is the one the user can act on and
 * the one that resolves itself.
 */
export function queuedReason(state: QueueGateState): QueuedReason | null {
	if (state.queued === 0) return null;
	if (state.offline) return "offline";
	if (state.syncBlocked) return "sync-blocked";
	if (state.inFlight > 0) return "in-progress";
	return "waiting";
}

/** Build the composite dedup key: "{vaultId}:{path}" or just "{path}" if no vaultId. */
function dedupKey(entry: QueueEntry): string;
function dedupKey(path: string, vaultId?: string): string;
function dedupKey(pathOrEntry: string | QueueEntry, vaultId?: string): string {
	if (typeof pathOrEntry === "object") {
		return pathOrEntry.vaultId
			? `${pathOrEntry.vaultId}:${pathOrEntry.path}`
			: pathOrEntry.path;
	}
	return vaultId ? `${vaultId}:${pathOrEntry}` : pathOrEntry;
}

export class OfflineQueue {
	private entries: Map<string, QueueEntry> = new Map();
	private persistFn: ((entries: QueueEntry[]) => Promise<void>) | null = null;
	private persistTimer: number | null = null;
	private persistDelayMs: number;

	constructor(persistDelayMs = 1000) {
		this.persistDelayMs = persistDelayMs;
	}

	/** Register a callback to persist queue state. */
	onPersist(fn: (entries: QueueEntry[]) => Promise<void>): void {
		this.persistFn = fn;
	}

	/** Load previously persisted entries (call once on startup). */
	load(entries: QueueEntry[]): void {
		this.entries.clear();
		for (const entry of entries) {
			this.entries.set(dedupKey(entry), entry);
		}
	}

	/** Add or replace a queued change for a path. Persistence is debounced. */
	async enqueue(entry: QueueEntry): Promise<void> {
		this.entries.set(dedupKey(entry), entry);
		this.schedulePersist();
	}

	/** Remove a path from the queue (after successful sync). Persists immediately. */
	async dequeue(path: string, vaultId?: string): Promise<void> {
		this.entries.delete(dedupKey(path, vaultId));
		await this.persistNow();
	}

	/** True when a not-yet-synced DELETE is queued for this path. Catch-up uses
	 *  this to avoid recreating a note the user deleted locally while offline. */
	hasPendingDelete(path: string, vaultId?: string): boolean {
		return this.entries.get(dedupKey(path, vaultId))?.action === "delete";
	}

	/** Remove a path's queued work immediately, without waiting on a persist
	 *  round trip. `dequeue` awaits persistence, which is right after a
	 *  successful sync but wrong for a rename or a vault switch: the caller needs
	 *  the entry gone before the flush loop can pick up work for a path that no
	 *  longer exists. Returns whether anything was removed. */
	cancel(path: string, vaultId?: string): boolean {
		const removed = this.entries.delete(dedupKey(path, vaultId));
		if (removed) this.schedulePersist();
		return removed;
	}

	/** Get all entries in flush order: priority first, then oldest-first within
	 *  a priority. An entry with no `priority` (persisted before the field
	 *  existed) counts as Normal, so an upgrade never demotes pending work. */
	all(): QueueEntry[] {
		return Array.from(this.entries.values()).sort(
			(a, b) =>
				(a.priority ?? QueuePriority.Normal) - (b.priority ?? QueuePriority.Normal) ||
				a.timestamp - b.timestamp,
		);
	}

	/** Number of queued entries. */
	get size(): number {
		return this.entries.size;
	}

	/** Clear all entries. Persists immediately. */
	async clear(): Promise<void> {
		this.entries.clear();
		await this.persistNow();
	}

	/** Cancel any pending persist timer. Call on plugin unload. */
	destroy(): void {
		if (this.persistTimer) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
	}

	/** Schedule a debounced persist — coalesces rapid enqueues into one write. */
	private schedulePersist(): void {
		if (this.persistTimer) return;
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			// A failed data.json write means queued work silently vanishes on the
			// next reload; persistNow propagates the same failure to its caller,
			// so the debounced path must at least leave a trace.
			void this.persistFn?.(this.all()).catch((e) => {
				rlog().warn("queue", `debounced persist failed: ${errMsg(e)}`);
			});
		}, this.persistDelayMs);
	}

	/** Persist immediately (cancels any pending debounced persist). */
	private async persistNow(): Promise<void> {
		if (this.persistTimer) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		await this.persistFn?.(this.all());
	}
}
