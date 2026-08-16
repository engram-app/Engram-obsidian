import type * as Y from "yjs";
import { uuid7 } from "./uuid7";

/** One entry in `filemeta_v0`: what the vault knows about a path.
 *
 * Matches the server's shape (`Engram.Notes.CrdtIndexDoc`) and Relay's
 * (`SyncStore.ts:20`) on purpose — the map is the wire format, so a mismatch
 * here is a mismatch with every other client. */
export interface FileMeta {
	note_id: string;
	type?: string;
	hash?: string;
}

/** Layered view over the shared `filemeta_v0` map.
 *
 * `NoteIdMap` is a plain `Map<path, id>` plus a reverse index. That cannot
 * express the thing this replaces it for: **local state that is true now but
 * not yet agreed**. Writing it straight into the shared doc publishes a guess
 * to every device; keeping it outside means reads do not see it. Relay solves
 * this by layering, and so does this (`SyncStore.ts:20`):
 *
 * * `committed` — the Y.Map itself, the only layer other devices can see
 * * `overlay` — locally known meta not yet promoted
 * * `deleteSet` — paths deleted locally, not yet promoted
 * * `renames` — old path -> new path, so the OLD path keeps resolving to the
 *   same id until Obsidian's vault rename event lands
 * * `pendingUpload` — ids minted here that the server has not confirmed
 *
 * Reads (`get` / `getMeta` / `has`) consult every layer, so optimistic local
 * state is visible immediately without polluting the shared doc. `commit()`
 * promotes the lot in ONE Yjs transaction, which is what makes a folder move —
 * N renames — arrive at observers as a single update instead of N.
 *
 * ## Why the rename layer is not a convenience
 *
 * `folder-rename-mint-resurrection` is a documented bug of ours: a folder
 * rename lands as delete+add per descendant, and anything resolving the old
 * path in that window mints a NEW id, resurrecting the old path on both
 * devices. A guard against it is a race with a smaller window. The rename
 * layer removes the window: the old path still resolves, to the same id, until
 * the rename is promoted. There is nothing to re-mint.
 */
export class SyncStore {
	private readonly overlay = new Map<string, FileMeta>();
	private readonly deleteSet = new Set<string>();
	/** old path -> new path. */
	private readonly renames = new Map<string, string>();
	/** note_ids minted locally whose note the server has not acknowledged. */
	private readonly pendingUpload = new Set<string>();

	/** id -> path, over committed + overlay. Rebuilt on demand rather than
	 *  maintained per write: a folder move touches N paths, and paying N reverse
	 *  updates per mutation to serve a lookup that may never happen is the wrong
	 *  trade. Invalidated by every mutation and by remote updates. */
	private reverse: Map<string, string> | null = null;

	constructor(private readonly map: Y.Map<FileMeta>) {
		// A remote update invalidates the reverse index just as a local one does.
		// Without this a path learned from another device answers `pathForId`
		// with a stale answer, or none.
		this.map.observe(() => {
			this.reverse = null;
		});
	}

	/** Follow the rename chain to the path an entry lives at NOW.
	 *
	 *  Chained because two renames can land before either is promoted (a folder
	 *  move followed by a second move of the same subtree). Bounded by the number
	 *  of pending renames, and self-referential input cannot loop it. */
	private resolvePath(path: string): string {
		let current = path;
		const seen = new Set<string>([current]);

		while (this.renames.has(current)) {
			const next = this.renames.get(current) as string;
			if (seen.has(next)) break;
			seen.add(next);
			current = next;
		}

		return current;
	}

	/** Meta for `path`, consulting every layer, or null if this store has no
	 *  entry for it (or it is pending deletion). */
	getMeta(path: string): FileMeta | null {
		const resolved = this.resolvePath(path);
		if (this.deleteSet.has(resolved)) return null;
		return this.overlay.get(resolved) ?? this.map.get(resolved) ?? null;
	}

	/** The note_id for `path`, or null. The `NoteIdMap.get` replacement. */
	get(path: string): string | null {
		return this.getMeta(path)?.note_id ?? null;
	}

	has(path: string): boolean {
		return this.getMeta(path) !== null;
	}

	/** Resolve `path`'s id, minting one into the OVERLAY if this is the first
	 *  time it has been seen.
	 *
	 *  A minted id is also `pendingUpload`: it exists on this device and nowhere
	 *  else until the server confirms the note. That distinction is what stops a
	 *  second device treating an unacknowledged local id as authoritative.
	 *
	 *  Throws on a garbage path for the same reason `NoteIdMap.getOrMint` does —
	 *  a literal "null" key was found minted and CRDT-enrolled in a prod
	 *  data.json (2026-07-07). Minting for a phantom path binds a real doc to a
	 *  file that does not exist, so the caller's null-path bug must surface here
	 *  rather than downstream. */
	getOrMint(path: string): string {
		if (!path || path === "null" || path === "undefined") {
			throw new Error(`SyncStore.getOrMint: invalid path ${JSON.stringify(path)}`);
		}

		const existing = this.get(path);
		if (existing) return existing;

		const note_id = uuid7();
		this.set(path, { note_id });
		this.pendingUpload.add(note_id);
		return note_id;
	}

	/** Stage `meta` for `path`. Visible to reads immediately, invisible to other
	 *  devices until `commit()`. */
	set(path: string, meta: FileMeta): void {
		const resolved = this.resolvePath(path);
		this.overlay.set(resolved, meta);
		// A set UNDOES a pending delete of the same path: staging both and
		// promoting delete-then-set would otherwise depend on commit order.
		this.deleteSet.delete(resolved);
		this.reverse = null;
	}

	/** Stage a delete. The path stops resolving immediately. */
	delete(path: string): void {
		const resolved = this.resolvePath(path);
		this.deleteSet.add(resolved);
		this.overlay.delete(resolved);
		this.reverse = null;
	}

	/** Stage a rename. `oldPath` keeps resolving — to the same id — until this
	 *  is promoted and Obsidian's own rename event has landed.
	 *
	 *  A rename of a path this store has never seen is NOT a no-op: it records
	 *  the redirect anyway, so a subsequent `getOrMint(oldPath)` and
	 *  `getOrMint(newPath)` converge on ONE id instead of minting two. That
	 *  convergence is the whole point of the layer. */
	rename(oldPath: string, newPath: string): void {
		if (oldPath === newPath) return;

		const meta = this.getMeta(oldPath);
		const from = this.resolvePath(oldPath);

		if (meta) this.overlay.set(newPath, meta);
		this.renames.set(from, newPath);
		// The old path must not also be staged for deletion — `commit()` removes
		// it via the rename, and a deleteSet entry would race the set of the new
		// path if the two ever shared a key.
		this.deleteSet.delete(from);
		this.overlay.delete(from);
		this.reverse = null;
	}

	/** Whether `note_id` was minted here and is still unconfirmed. */
	isPendingUpload(note_id: string): boolean {
		return this.pendingUpload.has(note_id);
	}

	/** The server has acknowledged the note, so the id is no longer provisional.
	 *  NOT cleared by `commit()`: committing publishes the id to other devices,
	 *  which is a different fact from the server having stored the note. */
	confirmUpload(note_id: string): void {
		this.pendingUpload.delete(note_id);
	}

	/** Reverse lookup, over committed + overlay. */
	pathForId(note_id: string): string | null {
		if (!this.reverse) {
			const index = new Map<string, string>();
			// Committed first, overlay second: overlay is the newer truth, so it
			// must win where both know the id.
			this.map.forEach((meta, path) => {
				if (!this.deleteSet.has(path)) index.set(meta.note_id, path);
			});
			for (const [path, meta] of this.overlay) {
				if (!this.deleteSet.has(path)) index.set(meta.note_id, path);
			}
			this.reverse = index;
		}

		return this.reverse.get(note_id) ?? null;
	}

	/** True when there is staged state that `commit()` would publish. */
	get dirty(): boolean {
		return this.overlay.size > 0 || this.deleteSet.size > 0 || this.renames.size > 0;
	}

	/** Promote every staged layer into the shared doc in ONE transaction.
	 *
	 *  One transaction, not N: a folder move stages a rename per descendant, and
	 *  promoting them individually would reach observers as N separate updates —
	 *  N chances for another device to observe a half-moved folder. The server
	 *  fold and every peer see the move whole or not at all.
	 *
	 *  Removals are applied BEFORE additions so that a path which is both
	 *  deleted and re-added (delete then create, same tick) ends up present.
	 *  `pendingUpload` deliberately survives — see `confirmUpload`. */
	commit(origin?: unknown): void {
		if (!this.dirty) return;

		this.map.doc?.transact(() => {
			for (const from of this.renames.keys()) this.map.delete(from);
			for (const path of this.deleteSet) this.map.delete(path);
			for (const [path, meta] of this.overlay) this.map.set(path, meta);
		}, origin);

		this.overlay.clear();
		this.deleteSet.clear();
		this.renames.clear();
		this.reverse = null;
	}

	/** Drop all staged state without publishing it. For a failed operation the
	 *  caller has already rolled back on disk. */
	rollback(): void {
		this.overlay.clear();
		this.deleteSet.clear();
		this.renames.clear();
		this.reverse = null;
	}
}
