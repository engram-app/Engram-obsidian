/**
 * Per-file sync state, as an object rather than N parallel side tables.
 *
 * The shape this replaces (#358): `SyncEngine` carries 104 fields, ~19 of them
 * `Map`/`Set` containers keyed by path or note_id. Every one is a per-file field
 * hoisted into a global side table, which means there is no single place to ask
 * "what is the state of this file", and cleanup has to remember to touch all of
 * them. Relay models the same domain as objects with lifetimes (`IFile`, 15
 * lines, implemented by Document / SyncFile / SyncFolder).
 *
 * This is the first slice: the TTL marker family (`recentlyPushed`,
 * `recentlyFlushed`, `remotelyDeleted`). They all routed through one
 * `markWithTtl` helper plus a `.has()`, so the migration is mechanical and the
 * behaviour is pinned by tests. The remaining maps move in later passes — see
 * the follow-up list on #358.
 *
 * Teardown collapses too: the three maps each needed their own
 * clear-every-timer loop in `SyncEngine.destroy()`, and adding a fourth marker
 * meant remembering to add a fourth loop. `destroy()` here is one call that
 * cannot be forgotten.
 *
 * It also removes an entry once its last marker expires. The maps it replaces
 * deleted the key from each callback, which was equivalent; keeping that
 * property explicit matters more now that one entry can hold several markers.
 *
 * NOT included here: `recentlyDeleted`, which is keyed by note_id rather than
 * path. Folding an id-keyed set into a path-keyed file object would be the same
 * category error this class exists to fix.
 */

/** Timer functions, injected so TTL expiry is testable without sleeping.
 *  Matches the subset of `TimeProvider` the engine already passes around. */
export interface MarkerClock {
	setTimeout(cb: () => void, ms: number): number;
	clearTimeout(id: number): void;
}

/**
 * Why a path is currently being ignored by an event handler.
 *
 * - `pushed` — we just pushed it; suppress the WebSocket echo.
 * - `flushed` — we just wrote it from a CRDT merge; suppress the resulting
 *   vault modify/create event. Deliberately distinct from `pushed`: reusing one
 *   marker for both made `handleModify` drop real user edits inside the window.
 * - `remotelyDeleted` — deleted by a remote peer; suppress the local delete echo.
 * - `renamedAway` — the path is being trashed as the OLD leg of a remote
 *   rename. The note itself is ALIVE at a new path, so the vault delete event
 *   this trash fires must not touch anything keyed by note_id: no claim
 *   release, no delete-wins tombstone, and above all no CRDT teardown, because
 *   the room now belongs to the new path and the new-path upsert materializes
 *   from it. The delete branch knows all this and then loses it at the trash
 *   boundary — `handleDelete` sees an ordinary vault delete. This marker is how
 *   that knowledge survives the crossing.
 * - `remotelyRenamed` — moved on disk by the engine to follow a remote peer's
 *   rename. Obsidian fires a `rename` vault event for that move exactly as it
 *   would for a user drag, so without this the echo is pushed straight back to
 *   the server as a fresh rename. Marked on BOTH the old and new path: the
 *   event carries both, and which one a guard consults depends on the caller.
 */
export type FileMarker =
	| "pushed"
	| "flushed"
	| "remotelyDeleted"
	| "remotelyRenamed"
	| "renamedAway";

/** One file's live sync state. Currently just markers; later passes add the
 *  debounce timer, in-flight push state, and the per-path heal counters. */
class SyncedFile {
	/** Marker → pending expiry timer id. */
	readonly markers = new Map<FileMarker, number>();

	get empty(): boolean {
		return this.markers.size === 0;
	}
}

export class SyncedFileTable {
	private readonly files = new Map<string, SyncedFile>();

	constructor(private readonly clock: MarkerClock) {}

	get size(): number {
		return this.files.size;
	}

	/** Set `marker` on `path` for `ms`. Re-marking REPLACES the pending timer
	 *  rather than stacking a second one — two live timers for one marker means
	 *  the first expiry closes a window the second call had just extended. */
	mark(path: string, marker: FileMarker, ms: number): void {
		const file = this.files.get(path) ?? new SyncedFile();
		this.files.set(path, file);
		const existing = file.markers.get(marker);
		if (existing !== undefined) this.clock.clearTimeout(existing);
		file.markers.set(
			marker,
			this.clock.setTimeout(() => {
				file.markers.delete(marker);
				// Drop the entry once its last marker expires, so a long session does
				// not accumulate one empty object per path ever touched.
				//
				// Identity-checked, not just `files.delete(path)`. This closure captured
				// `path` at mark time, but rename() moves the same object to a different
				// key — so a timer armed before a rename would otherwise delete whatever
				// entry now sits at the OLD path, which may be a newer, unrelated file.
				// Silently dropping that entry loses its echo suppression.
				if (file.empty && this.files.get(path) === file) this.files.delete(path);
			}, ms),
		);
	}

	has(path: string, marker: FileMarker): boolean {
		return this.files.get(path)?.markers.has(marker) ?? false;
	}

	/** Drop `marker` now and cancel its pending expiry. */
	clearMarker(path: string, marker: FileMarker): void {
		const file = this.files.get(path);
		const timer = file?.markers.get(marker);
		if (!file || timer === undefined) return;
		this.clock.clearTimeout(timer);
		file.markers.delete(marker);
		if (file.empty) this.files.delete(path);
	}

	/** Move a path's state. Any state already at `newPath` is discarded, with its
	 *  timers cancelled — orphaning them would fire callbacks against an entry
	 *  no longer in the table. */
	rename(oldPath: string, newPath: string): void {
		const file = this.files.get(oldPath);
		if (!file) return;
		this.forget(newPath);
		this.files.delete(oldPath);
		this.files.set(newPath, file);
	}

	/** Drop a path entirely, cancelling its timers. */
	forget(path: string): void {
		const file = this.files.get(path);
		if (!file) return;
		for (const timer of file.markers.values()) this.clock.clearTimeout(timer);
		this.files.delete(path);
	}

	/** Cancel every outstanding timer. Call on teardown. */
	destroy(): void {
		for (const path of [...this.files.keys()]) this.forget(path);
	}
}
