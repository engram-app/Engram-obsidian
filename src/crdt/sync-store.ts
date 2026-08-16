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

	/** Locally-cached identity from `data.json`. Read-only fallback: consulted
	 *  LAST, never staged, never published.
	 *
	 *  Seeding the cache through `set()` was a data-loss bug. A Y.Map is
	 *  last-write-wins by causality with no notion of "cache" versus "claim", so
	 *  republishing a stale cache on every launch either overwrote a fresher
	 *  claim from another device or — via id-keyed removal — published a DELETE
	 *  of the path that claim lived at. The cache is evidence about the past; it
	 *  is not a claim, and it must not be able to make one. */
	private readonly cache = new Map<string, FileMeta>();

	/** note_ids that have been displaced from their path by a later claim. They
	 *  must stop answering `pathForId`, or a late frame for a dead lineage
	 *  resolves to a live file. Cleared when the id is claimed again. */
	private readonly evicted = new Set<string>();

	/** Rename sources this store actually held an entry for — the only keys
	 *  `commit()` may delete. A redirect recorded for an unknown path is for
	 *  resolution only and must never publish a deletion. */
	private readonly renamedAway = new Set<string>();

	/** Whether some staged entry already claims `id` at a path.
	 *
	 *  Guards the eviction below. A cross-wire repair (`A→Y, B→X` corrected to
	 *  `A→X, B→Y`) sets both paths in turn, and the second `set` sees B's
	 *  COMMITTED id — `X` — as displaced, even though the first `set` just
	 *  re-claimed `X` at `A.md`. Evicting on that reading dropped `X` entirely,
	 *  so `reconcileNoteIdMapFromManifest`, whose whole purpose is repairing a
	 *  cross-wire, unclaimed one of the two notes it was fixing. */
	private stagedHolds(id: string): boolean {
		for (const meta of this.overlay.values()) if (meta.note_id === id) return true;
		return false;
	}

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
		// A path that has been renamed AWAY is gone, and `get`/`has` must say so.
		// Callers ask this to mean "is there a note here?", and answering yes for
		// a path the user just moved off breaks the delete/ignore decisions built
		// on it.
		//
		// The rename layer is NOT about keeping the old path alive to readers —
		// it is about not MINTING a second id for it. That distinction lives in
		// `getOrMint`, which resolves through the redirect on purpose.
		if (this.renames.has(path)) return null;
		if (this.deleteSet.has(path)) return null;
		// Cache LAST: anything the shared doc knows outranks a local memory of it.
		return this.overlay.get(path) ?? this.map.get(path) ?? this.cache.get(path) ?? null;
	}

	/** Warm the local cache from `data.json`. Never staged and never published —
	 *  it lets ids resolve offline, before the room has synced, without asserting
	 *  anything to other devices. */
	seed(path: string, meta: FileMeta): void {
		if (!path || path === "null" || path === "undefined" || !meta?.note_id) return;
		this.cache.set(path, meta);
		this.reverse = null;
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

		// Resolve through the rename redirect FIRST. This is the anti-resurrection
		// half: a folder rename fires one event per descendant, and anything that
		// touches an old path mid-cascade must find the SAME id rather than mint a
		// new one and resurrect the old path on every device.
		const existing = this.getMeta(this.resolvePath(path))?.note_id ?? null;
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

		// ID-KEYED REMOVAL. An entry naming this note at some OTHER path is stale
		// the moment we claim it here — a claim is a MOVE, not a copy. This is the
		// same rule the server applies in `Identity.mutate`, and it has to hold on
		// both sides or the two disagree about what a claim means.
		//
		// Without it, two paths resolve to one id and `pathForId` answers with
		// whichever was written last, which is how inbound CRDT content for a note
		// gets flushed onto the wrong file.
		const prior = this.pathForId(meta.note_id);
		if (prior && prior !== resolved) {
			this.overlay.delete(prior);
			this.deleteSet.add(prior);
		}

		// The OTHER eviction, which `origin/main`'s NoteIdMap had and the first
		// version of this store dropped: if `resolved` currently holds a
		// DIFFERENT id, that id no longer lives anywhere and its reverse entry
		// must go. Without it `pathForId(displaced)` kept answering `resolved`,
		// so a late frame for the dead lineage resolved to a real file and
		// flushed the wrong content onto it — and `reconcileNoteIdMapFromManifest`,
		// whose whole job is repairing a cross-wire, became a way to publish a
		// delete of a path it had just claimed.
		const displaced = this.overlay.get(resolved)?.note_id ?? this.map.get(resolved)?.note_id;
		if (displaced && displaced !== meta.note_id && !this.stagedHolds(displaced)) {
			this.evicted.add(displaced);
		}
		this.evicted.delete(meta.note_id);

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

		// An unknown path still records the REDIRECT — that is what stops a folder
		// cascade minting a second id for a descendant this device never opened.
		// What it must NOT do is schedule a delete: `commit()` used to remove
		// every rename key unconditionally, so renaming a path this store had
		// never seen published a bare DELETE of it and claimed nothing at the new
		// path, silently unclaiming a note that exists on other devices.
		if (!meta) {
			this.renames.set(from, newPath);
			this.reverse = null;
			return;
		}

		// Only a rename we actually hold an entry for removes the old key.
		this.renamedAway.add(from);

		// The target may be staged for deletion (rename-over-an-existing-file, or
		// a delete+rename pair in one batch). Leaving it there made the
		// destination read as unclaimed, so anything resolving it re-minted — the
		// resurrection window this layer exists to remove, on the target side.
		this.deleteSet.delete(newPath);

		// The id displaced from the target is no longer anywhere.
		const displaced = this.overlay.get(newPath)?.note_id ?? this.map.get(newPath)?.note_id;
		if (displaced && displaced !== meta.note_id && !this.stagedHolds(displaced)) {
			this.evicted.add(displaced);
		}

		this.overlay.set(newPath, meta);
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
			// Cache first so committed/overlay overwrite it — but ONLY where they
			// know the same id. The index is keyed by ID, so a committed entry
			// does not displace a cache entry whose path was reassigned to a
			// different note; the stale id kept resolving onto the new note's
			// file, which is the wrong-mint cross-file overwrite shape.
			for (const [path, meta] of this.cache) {
				if (this.deleteSet.has(path)) continue;
				const live = this.overlay.get(path)?.note_id ?? this.map.get(path)?.note_id;
				if (live && live !== meta.note_id) continue;
				index.set(meta.note_id, path);
			}
			// Committed first, overlay second: overlay is the newer truth, so it
			// must win where both know the id.
			this.map.forEach((meta, path) => {
				if (!this.deleteSet.has(path)) index.set(meta.note_id, path);
			});
			for (const [path, meta] of this.overlay) {
				if (!this.deleteSet.has(path)) index.set(meta.note_id, path);
			}
			// A path renamed away no longer holds its id at the OLD key.
			for (const from of this.renames.keys()) {
				const meta = this.map.get(from) ?? this.cache.get(from);
				if (meta && index.get(meta.note_id) === from) index.delete(meta.note_id);
			}
			for (const id of this.evicted) index.delete(id);
			this.reverse = index;
		}

		return this.reverse.get(note_id) ?? null;
	}

	/** Every live entry, committed + staged, with deletions applied. The
	 *  snapshot `data.json` persistence and any full-vault reconcile read. */
	entries(): [string, FileMeta][] {
		const out = new Map<string, FileMeta>();
		// Cache first, so committed/overlay outrank it — same precedence as reads.
		for (const [path, meta] of this.cache) {
			if (!this.deleteSet.has(path)) out.set(path, meta);
		}
		// (committed/overlay below overwrite by PATH, which is the right key here)
		this.map.forEach((meta, path) => {
			if (!this.deleteSet.has(path)) out.set(path, meta);
		});
		for (const [path, meta] of this.overlay) {
			if (!this.deleteSet.has(path)) out.set(path, meta);
		}
		// A path renamed away is gone; enumerating it would cache two paths for
		// one id, which the next launch would republish as two claims.
		for (const from of this.renames.keys()) out.delete(from);
		return [...out];
	}

	/** Drop everything, staged and committed.
	 *
	 *  LOCAL ONLY, deliberately. Deleting the committed keys published a wipe of
	 *  the vault's entire authoritative index to whichever room the socket was
	 *  still joined to — the OLD vault on a switch, or the NEW one if the frame
	 *  was buffered and flushed after the rejoin. Neither vault asked for it.
	 *
	 *  Dropping a vault's identity state is done by REPLACING the room (a fresh
	 *  Y.Doc), not by emptying the shared one: a doc nobody is looking at emits
	 *  nothing, and reusing one across vaults strands every later claim as a
	 *  pending struct anyway (its clock is ahead of the new room's). See
	 *  `IndexRoom` and main.ts's vault-change teardown. */
	clear(): void {
		this.overlay.clear();
		this.deleteSet.clear();
		this.renames.clear();
		this.renamedAway.clear();
		this.pendingUpload.clear();
		this.cache.clear();
		this.evicted.clear();
		this.reverse = null;
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
			for (const from of this.renamedAway) this.map.delete(from);
			for (const path of this.deleteSet) this.map.delete(path);
			for (const [path, meta] of this.overlay) this.map.set(path, meta);
		}, origin);

		this.overlay.clear();
		this.deleteSet.clear();
		this.renames.clear();
		this.renamedAway.clear();
		// Eviction is bookkeeping for the STAGED window only. Once the commit
		// lands, a displaced id genuinely has no entry anywhere, so the set is
		// redundant — and keeping it is pure blindness: a peer that re-claims
		// that id at another path would never be visible to `pathForId` again,
		// leaving inbound frames for the note with no disk path to resolve to.
		this.evicted.clear();
		this.reverse = null;
	}

	/** Drop all staged state without publishing it. For a failed operation the
	 *  caller has already rolled back on disk. */
	rollback(): void {
		this.overlay.clear();
		this.deleteSet.clear();
		this.renames.clear();
		this.renamedAway.clear();
		// Nothing was published, so nothing was displaced.
		this.evicted.clear();
		this.reverse = null;
	}
}
