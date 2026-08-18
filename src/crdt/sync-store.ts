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
	/** old path -> where it went, and WHICH entry moved.
	 *
	 *  Keyed by the moving entry's id, not by path alone. A path-keyed chain
	 *  crosses lineages whenever one rename's new path is another's old path —
	 *  a same-tick rotation (`b->c` then `a->b`) walked a->b->c and resolved
	 *  `a` onto c's id. `id` is null for a redirect recorded on a path this
	 *  store has never seen: that exists only so a folder cascade converges on
	 *  one id, and a chain must stop there rather than guess. */
	private readonly renames = new Map<string, { to: string; id: string | null }>();
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

	/** Paths forgotten LOCALLY. Hidden from reads here, never published, and
	 *  cleared the moment the path is learned again — which is what makes the
	 *  drift self-heal work: the mapping goes away on this device only, and the
	 *  next inbound edit re-learns it. */
	private readonly forgotten = new Set<string>();

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

	/** Notified when a claim MOVES a note: `(from, to, note_id)`. The store owns
	 *  identity, not the filesystem, so it reports the move and lets the engine
	 *  decide what to do about the bytes on disk. Optional so the store stays
	 *  usable headless (tests, the index room before the engine exists). */
	onRelocate?: (from: string, to: string, note_id: string) => void;

	constructor(private readonly map: Y.Map<FileMeta>) {
		// A remote update invalidates the reverse index just as a local one does.
		// Without this a path learned from another device answers `pathForId`
		// with a stale answer, or none.
		this.map.observe((event) => {
			// A forget is a bridge, not a verdict: every caller forgets a path
			// because some OTHER device has removed or moved it, and is covering
			// the window until that device's frame arrives. When the frame lands
			// and rewrites the key, the bridge has served its purpose — holding
			// it past that point is the permanent-blindness bug `evicted` had, one
			// indirection over: a peer re-claiming the path would never be visible
			// to `getMeta` or `pathForId` again, so `getOrMint` would mint a SECOND
			// id for a note that already has one and publish it over the live claim.
			//
			// `keysChanged` is `Set<any>` in yjs's types, so the key is narrowed
			// rather than asserted. A Y.Map key is always a string; the guard costs
			// one typeof per changed key and keeps the boundary honest.
			for (const key of event.keysChanged) {
				if (typeof key === "string") this.forgotten.delete(key);
			}
			this.reverse = null;
			this.cacheById = null;
		});
	}

	/** Follow the rename chain to the path an entry lives at NOW.
	 *
	 *  Chained because two renames can land before either is promoted (a folder
	 *  move followed by a second move of the same subtree). Bounded by the number
	 *  of pending renames, and self-referential input cannot loop it. */
	private resolvePath(path: string): string {
		const first = this.renames.get(path);
		if (!first) return path;

		// The first hop is id-guarded like the rest. A rotation leaves a redirect
		// on a path that a DIFFERENT note has since moved into, and following it
		// resolved the new occupant onto the previous one's id — two paths for one
		// id, the other note unclaimed, and an editor binding opening the wrong
		// doc.
		const occupant = this.overlay.get(path)?.note_id;
		if (occupant && first.id && occupant !== first.id) return path;

		let current = first.to;
		const seen = new Set<string>([path, current]);

		// Follow only while the SAME entry keeps moving. A hop belonging to a
		// different note is someone else's rename that happens to share this key.
		while (true) {
			const next = this.renames.get(current);
			// Stop only when crossing into a DIFFERENT known entry. An unknown
			// hop (id: null) is the folder-cascade case the chain exists for —
			// refusing to follow it minted a fresh id per hop, duplicating every
			// descendant of a twice-moved folder.
			if (!next || (next.id && first.id && next.id !== first.id)) break;
			// The chain closed back on where it started: the entry was moved away
			// and moved back in the same tick, so it is home. Stopping one hop
			// short here reported it at an intermediate path that nothing holds,
			// and the caller minted a second id for a note that already had one.
			if (next.to === path) return path;
			if (seen.has(next.to)) break;
			current = next.to;
			seen.add(current);
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
		// Renamed away means gone — UNLESS something has since been staged here.
		// A rotation (`b -> c`, then `a -> b`) makes `b` both a rename source and
		// a rename target in the same tick, and reporting it empty made the
		// second move re-mint for a note that already had an id.
		if (this.renames.has(path) && !this.overlay.has(path)) return null;
		if (this.deleteSet.has(path)) return null;
		if (this.forgotten.has(path) && !this.overlay.has(path)) return null;
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
		this.cacheById = null;
	}

	/** Every path this store has ever associated with `note_id`, newest source
	 *  first, EXCLUDING the one it resolves to now.
	 *
	 *  `pathForId` answers where a note is; this answers where it was. A claim is
	 *  a move, so `set` erases the old key the moment the new one is claimed --
	 *  after which nothing can say a rename happened rather than a note appearing
	 *  from nowhere. The seeded cache (data.json) is not erased by `set`, so it
	 *  outlives the move and can still be asked.
	 *
	 *  Callers must treat the answer as a HINT and verify it against the disk:
	 *  the cache is a snapshot from load time and may name a path that has since
	 *  been deleted, or reused by a different note. */
	priorPathsForId(note_id: string): string[] {
		// Indexed, not scanned. This is consulted once per materialized note, so a
		// linear pass over the cache would make a first sync quadratic in vault
		// size -- and the caller reaches it on every create, because the map is
		// already claimed at the target by the time anything is written.
		//
		// Built lazily and dropped by the same invalidation as `reverse`: the
		// cache only changes via `seed`, but `resolvePath` depends on the rename
		// chain, so a stale index would answer with pre-rename paths.
		if (!this.cacheById) {
			const index = new Map<string, string[]>();
			for (const [path, meta] of this.cache) {
				const at = index.get(meta.note_id);
				if (at) at.push(path);
				else index.set(meta.note_id, [path]);
			}
			this.cacheById = index;
		}
		const now = this.pathForId(note_id);
		const out: string[] = [];
		for (const path of this.cacheById.get(note_id) ?? []) {
			const resolved = this.resolvePath(path);
			if (resolved === now) continue;
			out.push(resolved);
		}
		return out;
	}

	/** note_id -> the cache paths naming it. See `priorPathsForId`. */
	private cacheById: Map<string, string[]> | null = null;

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
		const resolved = this.resolvePath(path);
		const existing = this.getMeta(resolved)?.note_id ?? null;
		// Deliberately does NOT stage a claim for an id known only from the cache.
		// That was tried and reverted: `set` runs id-keyed removal, so if another
		// device had already moved the note, `pathForId` answered with the LIVE
		// path and that path got staged for deletion — the cache publishing a
		// delete of the claim it was supposed to defer to. `main.ts`'s cold-start
		// loop calls this for EVERY markdown file before the room has synced, so
		// the blast radius was the whole vault on an offline start.
		//
		// The gap it tried to close is real but belongs elsewhere: an id known
		// only locally should be asserted once the room is SYNCED, where the
		// current claim is knowable, not guessed at from a stale cache.
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
			// THE RENAME, observed at the one moment both halves are known.
			//
			// A claim is a move, and this is where the store learns it: the note
			// was at `prior`, it is at `resolved` now. Nothing downstream can
			// reconstruct that pair -- once this returns, the map answers only
			// `resolved`, so every later consumer sees a note that has "always"
			// been there and a file that was never moved to match.
			//
			// That gap is what made a remote rename land as delete + recreate. The
			// map is moved early (the doc-ready announce, discovery), so by the
			// time the rename's upsert arrives `pathForId` already reports the new
			// location, the relocation check concludes there is nothing to do, and
			// the create branch -- finding the target empty -- makes a new file
			// while the rename's delete leg trashes the old one. The note keeps its
			// id and loses its file: open tabs, backlinks and creation date all
			// reset.
			//
			// Emitting here follows Relay, which derives one `rename` op from the
			// same observation rather than reconciling a delete against a create.
			this.onRelocate?.(prior, resolved, meta.note_id);
		}

		// A forgotten path is hidden from `pathForId`, so the removal above cannot
		// see a committed claim for this id sitting there — and the doc would keep
		// BOTH, two paths naming one note, which is the wrong-mint cross-file
		// overwrite shape on the client and an unconvergeable fixpoint on the
		// server. Claiming the id here is a genuine move, so publishing the old
		// key's removal is correct; it is not the local-hygiene case `forget()`
		// exists to protect.
		for (const path of this.forgotten) {
			if (path === resolved || this.map.get(path)?.note_id !== meta.note_id) continue;
			this.deleteSet.add(path);
			this.forgotten.delete(path);
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

		this.forgotten.delete(resolved);
		this.overlay.set(resolved, meta);
		// A set UNDOES a pending delete of the same path: staging both and
		// promoting delete-then-set would otherwise depend on commit order.
		this.deleteSet.delete(resolved);
		this.reverse = null;
	}

	/** Forget a mapping LOCALLY, without telling anyone.
	 *
	 *  `delete()` stages a deletion and publishes it, which is right when the
	 *  user deleted the note and wrong for local hygiene — dropping a stale
	 *  room-id mapping, or a reconcile clearing a bad entry. On `origin/main`
	 *  `NoteIdMap.delete` was purely local, so routing every caller through the
	 *  publishing variant silently upgraded local bookkeeping into a claim that
	 *  removed the path from every other device's index.
	 *
	 *  That is what broke `test_drifted_map_self_heals_on_inbound_edit`: the
	 *  drift injected on one device propagated to the other, so there was no
	 *  healthy peer left to heal from. */
	forget(path: string): void {
		// LITERAL path, deliberately unresolved. `delete()` resolves because it
		// publishes and the entry really did move; a forget that resolved reached
		// through a staged rename and dropped the overlay entry at the TARGET,
		// while `renamedAway` still had the source armed for removal — so
		// `commit()` published a bare deletion and every other device lost the
		// claim. That is the exact failure this method exists to prevent, so
		// resolving here made it violate its own invariant.
		this.overlay.delete(path);
		this.cache.delete(path);
		// The committed entry cannot be removed without publishing, so hide it.
		this.forgotten.add(path);
		this.reverse = null;
	}

	/** Stage a delete AND publish it. For a note the user actually deleted. */
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

		// A real note is moving INTO the target, so a local forget of it is now
		// stale — and left standing it hides the note from every read, which makes
		// `getOrMint` mint a duplicate id for a file that already has one. Cleared
		// on BOTH branches below (known and unknown source): the target becomes
		// occupied either way.
		this.forgotten.delete(newPath);

		const meta = this.getMeta(oldPath);
		const from = this.resolvePath(oldPath);

		// An unknown path still records the REDIRECT — that is what stops a folder
		// cascade minting a second id for a descendant this device never opened.
		// What it must NOT do is schedule a delete: `commit()` used to remove
		// every rename key unconditionally, so renaming a path this store had
		// never seen published a bare DELETE of it and claimed nothing at the new
		// path, silently unclaiming a note that exists on other devices.
		if (!meta) {
			this.renames.set(from, { to: newPath, id: null });
			// The target may be staged for deletion; leaving it there makes the
			// destination read as unclaimed and anything resolving it re-mints.
			this.deleteSet.delete(newPath);
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
		this.renames.set(from, { to: newPath, id: meta.note_id });
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
			for (const path of this.forgotten) {
				const meta = this.map.get(path) ?? this.cache.get(path);
				if (meta && index.get(meta.note_id) === path) index.delete(meta.note_id);
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
		for (const path of this.forgotten) if (!this.overlay.has(path)) out.delete(path);
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
		this.forgotten.clear();
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
