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
		// A path can only ever point at one id — if it previously pointed at a
		// DIFFERENT id, that stale reverse entry must go, or pathForId(oldId)
		// would keep resolving to this path after it's been reassigned.
		const oldId = this.byPath.get(path);
		if (oldId !== undefined && oldId !== id) {
			this.byId.delete(oldId);
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

	toJSON(): Record<string, string> {
		return Object.fromEntries(this.byPath);
	}

	static fromJSON(o: Record<string, string> | undefined): NoteIdMap {
		const m = new NoteIdMap();
		for (const [p, id] of Object.entries(o ?? {})) m.set(p, id);
		return m;
	}
}
