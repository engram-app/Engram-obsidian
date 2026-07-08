import { uuid7 } from "./uuid7";

/** Path -> note_id sidecar (Task 4 of the note_id-keyed CRDT rework).
 *
 * The CRDT document is being re-keyed by stable `note_id` instead of vault
 * path, because a rename currently looks like a delete+create to the CRDT
 * layer. This map is the plugin-side bridge: it remembers which note_id a
 * given path was last known to correspond to, and survives renames without
 * losing the id. Persisted in data.json (see main.ts PluginData.noteIds) so
 * it outlives a plugin reload.
 *
 * Later tasks (5, 6) use this to mint ids for new notes, learn ids from
 * pull responses, and key the CRDT manager by note_id.
 *
 * Task 6 adds the REVERSE direction (`pathForId`): the CRDT wire (channel
 * frames, `crdt_doc_ready` announces) is keyed by bare note_id, but disk I/O
 * is keyed by path — so inbound traffic needs id->path just as much as
 * outbound traffic needs path->id. The reverse map is maintained internally
 * by `set`/`delete`/`rename` so the two directions never drift apart.
 */
/** A vault path that may legitimately key this map. Rejects the garbage a
 *  nullish caller produces after string coercion — a literal "null" key was
 *  found minted + CRDT-enrolled in a prod data.json (2026-07-07 incident). */
function isValidPath(path: string): boolean {
	return !!path && path !== "null" && path !== "undefined";
}

export class NoteIdMap {
	private readonly byPath = new Map<string, string>();
	/** Reverse index (note_id -> path), kept in sync by set/delete/rename. */
	private readonly byId = new Map<string, string>();

	get(path: string): string | null {
		return this.byPath.get(path) ?? null;
	}

	/** Resolve `path`'s id, minting + storing a fresh UUIDv7 if this is the
	 *  first time this path has been seen. Centralizes the mint-or-reuse
	 *  pattern (previously inlined separately in pushFile and duplicated for
	 *  the live-editor binding), so a concurrent "first touch" from either
	 *  seam (first save vs. first open) always converges on one id. */
	getOrMint(path: string): string {
		if (!isValidPath(path)) {
			// Loud on purpose: minting an id for a garbage path binds a real CRDT
			// doc to a phantom file. The caller has a null-path bug — surface it.
			throw new Error(`NoteIdMap.getOrMint: invalid path ${JSON.stringify(path)}`);
		}
		const existing = this.get(path);
		if (existing) return existing;
		const id = uuid7();
		this.set(path, id);
		return id;
	}

	/** Reverse lookup: the path last known to correspond to `id`, or null if
	 *  this device has never learned/minted a mapping for it (e.g. a
	 *  `crdt_doc_ready` announce for a note created on another device that
	 *  hasn't reached this device via a regular sync pull yet). */
	pathForId(id: string): string | null {
		return this.byId.get(id) ?? null;
	}

	set(path: string, id: string): void {
		// Defense-in-depth vs. getOrMint's throw: set() arrives from more callers
		// (pull feeds, push responses) — refuse to store garbage, don't crash them.
		if (!isValidPath(path) || !id) return;
		// A path can only ever point at one id — if it previously pointed at a
		// DIFFERENT id, that stale reverse entry must go, or pathForId(oldId)
		// would keep resolving to this path after it's been reassigned.
		const oldId = this.byPath.get(path);
		if (oldId !== undefined && oldId !== id) {
			this.byId.delete(oldId);
		}
		// ...and if `id` previously lived at a DIFFERENT path, evict that stale
		// forward entry too. Otherwise both paths keep resolving to `id` (two
		// paths -> one id) and pathForId(id) points at whichever was set last —
		// letting inbound CRDT content for `id` flush onto the wrong file.
		const oldPath = this.byId.get(id);
		if (oldPath !== undefined && oldPath !== path) {
			this.byPath.delete(oldPath);
		}
		this.byPath.set(path, id);
		this.byId.set(id, path);
	}

	delete(path: string): void {
		const id = this.byPath.get(path);
		if (id !== undefined) this.byId.delete(id);
		this.byPath.delete(path);
	}

	rename(oldPath: string, newPath: string): void {
		const id = this.byPath.get(oldPath);
		if (id === undefined) return;
		// Mirror set()'s cleanup: if newPath already pointed at a DIFFERENT id,
		// that id's reverse entry must go, or pathForId(displacedId) would keep
		// resolving to newPath after it's been overwritten here.
		const displacedId = this.byPath.get(newPath);
		if (displacedId !== undefined && displacedId !== id) {
			this.byId.delete(displacedId);
		}
		this.byPath.delete(oldPath);
		this.byPath.set(newPath, id);
		this.byId.set(id, newPath);
	}

	/** Drop every mapping. Used on vault change: the map is per-vault identity
	 *  state — carrying ids across vaults routes CRDT frames to another
	 *  vault's notes (plugin #200). Mutates in place so every holder of the
	 *  instance (main, sync engine, live views) sees the wipe. */
	clear(): void {
		this.byPath.clear();
		this.byId.clear();
	}

	toJSON(): Record<string, string> {
		return Object.fromEntries(this.byPath);
	}

	static fromJSON(o: Record<string, string> | undefined): NoteIdMap {
		const m = new NoteIdMap();
		for (const [p, id] of Object.entries(o ?? {})) m.set(p, id);
		return m;
	}
}
