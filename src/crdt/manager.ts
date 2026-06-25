import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { diffIntoYText, seedOnce } from "./bridge";

/**
 * Transaction origin stamped on remotely-applied updates. Updates carrying
 * this origin are NOT re-broadcast (the server already has them) and ARE
 * flushed to disk via `onFlushToDisk`. `CrdtChannel` (Task 4) imports this
 * constant and passes it as the origin when applying inbound server bytes via
 * `y-protocols/sync.readSyncMessage`, so channel and manager agree on a single
 * marker without magic strings at the call sites.
 */
export const REMOTE_ORIGIN = "remote";

export interface CrdtManagerOptions {
	/** Namespaces IndexedDB store names and doc ids per vault. */
	dbPrefix: string;
	/**
	 * Emitted on every local Y.Doc update (origin !== REMOTE_ORIGIN). The
	 * channel layer (Task 4) forwards these as Yjs `update` messages to the
	 * server.
	 */
	onUpdate: (docId: string, update: Uint8Array, origin: unknown) => void;
	/**
	 * Called after a remote update merges, with the merged plaintext, so the
	 * SyncEngine can write the new content to disk (echo-suppressed: the edit
	 * came from the server, so it must NOT be re-sent).
	 */
	onFlushToDisk: (path: string, content: string) => Promise<void>;
}

interface Entry {
	doc: Y.Doc;
	persistence: IndexeddbPersistence;
	text: Y.Text;
	/** Resolves once IndexeddbPersistence has replayed stored updates. */
	ready: Promise<void>;
}

export class CrdtManager {
	private readonly opts: CrdtManagerOptions;
	/** Keyed by docId (= `dbPrefix/path`). */
	private readonly docs = new Map<string, Entry>();

	constructor(opts: CrdtManagerOptions) {
		this.opts = opts;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** Stable, vault-scoped doc id — used for the IndexedDB store name AND the
	 *  channel topic key so the two subsystems resolve to the same note. */
	docId(path: string): string {
		return `${this.opts.dbPrefix}/${path}`;
	}

	/** Returns (or opens + rehydrates from IndexedDB) the Y.Doc for `path`. */
	async getDoc(path: string): Promise<Y.Doc> {
		return (await this.entry(path)).doc;
	}

	/**
	 * Apply a disk-read content string into the doc's Y.Text.
	 *
	 * - First call ever for this path (no CRDT history): `seedOnce` enrolls the
	 *   text into the shared type exactly once.
	 * - Subsequent calls (`hasLca = true`, or the doc already has content):
	 *   `diffIntoYText` patches only the changed characters, preserving the
	 *   CRDT authorship graph.
	 *
	 * Both code paths run with the default (`undefined`) origin so the resulting
	 * update IS forwarded to the server via `onUpdate`.
	 */
	async applyLocalEdit(path: string, diskContent: string, hasLca?: boolean): Promise<void> {
		const e = await this.entry(path);
		const lca = hasLca ?? this.textHasHistory(e.text);
		if (seedOnce(e.text, diskContent, lca)) return;
		diffIntoYText(e.text, diskContent);
	}

	/**
	 * Apply a binary Yjs update received from the server.
	 * Stamped with `REMOTE_ORIGIN` so the `doc.on("update")` listener does NOT
	 * re-send it to the server, but DOES flush the merged content to disk.
	 */
	async applyRemoteUpdate(path: string, update: Uint8Array): Promise<void> {
		const e = await this.entry(path);
		Y.applyUpdate(e.doc, update, REMOTE_ORIGIN);
	}

	/** Encode the current state vector (for the channel handshake sync step). */
	async encodeStateVector(path: string): Promise<Uint8Array> {
		return Y.encodeStateVector((await this.entry(path)).doc);
	}

	/**
	 * Encode the full document state as a v1 update.
	 * Pass `sv` (a peer's state vector) to get only the delta they're missing.
	 */
	async encodeStateAsUpdate(path: string, sv?: Uint8Array): Promise<Uint8Array> {
		return Y.encodeStateAsUpdate((await this.entry(path)).doc, sv);
	}

	/** Return the plain text content of the note. */
	async getText(path: string): Promise<string> {
		return (await this.entry(path)).text.toJSON();
	}

	/**
	 * Close and clean up a single doc entry (destroys the Y.Doc and the
	 * IndexeddbPersistence instance). Use when a note is closed in the editor.
	 */
	closeDoc(path: string): void {
		const id = this.docId(path);
		const e = this.docs.get(id);
		if (!e) return;
		e.doc.destroy();
		void e.persistence.destroy();
		this.docs.delete(id);
	}

	/** Tear down all open docs. Call on plugin unload. */
	async destroy(): Promise<void> {
		for (const [id, e] of this.docs) {
			e.doc.destroy();
			await e.persistence.destroy();
			this.docs.delete(id);
		}
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/**
	 * Return a cached Entry, or open a new Y.Doc + IndexeddbPersistence and
	 * await `whenSynced` so all stored updates are replayed before the caller
	 * reads or writes.
	 *
	 * Two `doc.on("update")` listeners are registered — one per direction — so
	 * the origin check (`=== REMOTE_ORIGIN`) routes each update to exactly one
	 * side effect and never both:
	 *
	 *   local update  → forwarded to server via `onUpdate`; NOT flushed to disk
	 *   remote update → flushed to disk via `onFlushToDisk`; NOT forwarded
	 */
	private async entry(path: string): Promise<Entry> {
		const id = this.docId(path);
		const cached = this.docs.get(id);
		if (cached) {
			await cached.ready;
			return cached;
		}

		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(id, doc);
		const text = doc.getText("content");

		// Local-edit path: forward update to the channel; skip remote-origin updates.
		doc.on("update", (update: Uint8Array, origin: unknown) => {
			if (origin === REMOTE_ORIGIN) return;
			this.opts.onUpdate(id, update, origin);
		});

		// Remote-merge path: flush merged content to disk; skip local-origin updates.
		doc.on("update", (_u: Uint8Array, origin: unknown) => {
			if (origin !== REMOTE_ORIGIN) return;
			void this.opts.onFlushToDisk(path, text.toJSON());
		});

		const ready: Promise<void> = persistence.whenSynced.then(() => undefined);
		const entry: Entry = { doc, persistence, text, ready };
		this.docs.set(id, entry);
		await ready;
		return entry;
	}

	/**
	 * Returns true when the Y.Text already carries CRDT history (content
	 * length > 0 after IDB rehydration), meaning another session established
	 * the shared base and `seedOnce` must not run again.
	 */
	private textHasHistory(text: Y.Text): boolean {
		return text.length > 0;
	}
}
