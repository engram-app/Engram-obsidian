import * as Y from "yjs";
import { FILEMETA_MAP } from "./index-room";
import { SyncStore } from "./sync-store";

/** Path <-> note_id identity for a vault.
 *
 * As of #362 this is an ADAPTER over `SyncStore`, not a pair of Maps. The
 * public surface is unchanged on purpose — every call site (sync engine, live
 * views, main, channel) keeps working — but the truth now lives in the shared
 * `filemeta_v0` doc rather than in `data.json`.
 *
 * That is the whole point of engram-app/Engram#1146. Identity used to live in
 * three places that had to agree — this map, the REST manifest, and the seq
 * cursor — and `relay-pattern-audit.md` traces every drift incident we have had
 * to that split. One CRDT, synced through the same channel as content, has no
 * such class of bug because there is nothing to disagree with.
 *
 * ## Why the API did not change
 *
 * Rewriting ~5 call sites across sync/wiring/main/channel in the same change
 * that moves the storage would make a behaviour regression indistinguishable
 * from a refactor mistake. The layered semantics are additive here: `get` still
 * answers immediately, mutations still take effect immediately, and the only
 * new thing is that they also reach other devices.
 *
 * ## Committing
 *
 * Mutations auto-commit, so a caller that knew nothing about layering behaves
 * as before. `batch(fn)` defers the commit so a folder move — N renames —
 * publishes as ONE update instead of N. Use it wherever a loop mutates.
 */
export class NoteIdMap {
	readonly store: SyncStore;
	private batching = false;

	/** Pass the live index room's store to sync identity with the vault. The
	 *  default is a detached doc: `fromJSON` and any test that just wants a map
	 *  still work, they simply have no peers. */
	constructor(store?: SyncStore) {
		this.store = store ?? new SyncStore(new Y.Doc().getMap(FILEMETA_MAP));
	}

	private flush(): void {
		if (!this.batching) this.store.commit();
	}

	/** Run `fn` with commits deferred, then publish once.
	 *
	 *  A folder move stages a rename per descendant. Committing each one
	 *  separately reaches observers as N updates — N chances to see a half-moved
	 *  folder — which is the shape of the folder-rename bugs we have had. */
	batch(fn: () => void): void {
		const outer = this.batching;
		this.batching = true;
		try {
			fn();
		} finally {
			this.batching = outer;
			this.flush();
		}
	}

	get(path: string): string | null {
		return this.store.get(path);
	}

	/** Resolve `path`'s id, minting a fresh UUIDv7 if this is the first time it
	 *  has been seen. Throws on a garbage path — see `SyncStore.getOrMint`. */
	getOrMint(path: string): string {
		const id = this.store.getOrMint(path);
		this.flush();
		return id;
	}

	pathForId(id: string): string | null {
		return this.store.pathForId(id);
	}

	/** Learn a mapping. Unlike `getOrMint` this refuses garbage quietly rather
	 *  than throwing: it arrives from pull feeds and push responses, where one
	 *  bad row must not take down the batch. */
	set(path: string, id: string): void {
		if (!path || path === "null" || path === "undefined" || !id) return;
		this.store.set(path, { note_id: id });
		this.flush();
	}

	delete(path: string): void {
		this.store.delete(path);
		this.flush();
	}

	rename(oldPath: string, newPath: string): void {
		// Unchanged contract: renaming a path this map has never seen is a no-op
		// for the CALLER's purposes. The store still records the redirect, which
		// is what stops a folder move minting a second id for the same file.
		this.store.rename(oldPath, newPath);
		this.flush();
	}

	clear(): void {
		this.store.clear();
	}

	toJSON(): Record<string, string> {
		return Object.fromEntries(this.store.entries().map(([path, meta]) => [path, meta.note_id]));
	}

	static fromJSON(o: Record<string, string> | undefined): NoteIdMap {
		const m = new NoteIdMap();
		m.batch(() => {
			for (const [p, id] of Object.entries(o ?? {})) m.set(p, id);
		});
		return m;
	}
}
