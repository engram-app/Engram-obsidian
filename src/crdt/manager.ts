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
	/**
	 * Called when IndexedDB persistence fails (e.g. iOS quota exceeded).
	 * Sync continues in-memory + over the WS; only local durability is
	 * degraded. If omitted, errors are silently swallowed (not thrown into the
	 * sync loop).
	 *
	 * **iOS note:** WKWebView IndexedDB is subject to a per-origin quota
	 * (historically ~50 MB, eviction under storage pressure). Normal vaults
	 * stay well under this; large vaults may hit eviction, in which case sync
	 * continues over the WS but offline durability degrades. Real-device
	 * testing (iOS + Android) is required before GA.
	 */
	onPersistError?: (path: string, err: unknown) => void;
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

	/**
	 * On note rename, drop the old-path doc entry (close + clear) so the new
	 * path opens a fresh doc that re-syncs from the server via enrollment.
	 * Keeping the old entry would leave it accumulating edits under a path the
	 * server no longer maps, and orphan its IndexedDB store.
	 */
	renameDoc(oldPath: string, newPath: string): void {
		if (oldPath === newPath) return;
		this.closeDoc(oldPath);
	}

	/** Tear down all open docs. Call on plugin unload. */
	async destroy(): Promise<void> {
		for (const [id, e] of this.docs) {
			e.doc.destroy();
			await e.persistence.destroy();
			this.docs.delete(id);
		}
	}

	/**
	 * Flatten the doc to a single-client-ID snapshot ONLY when both axes of the
	 * two-dimensional bloat threshold are crossed (spec §11 + backend AND gate):
	 *
	 *   - Encoded state > 500 KB  **AND**
	 *   - Distinct client-IDs > 1000
	 *
	 * A large single-author doc or a many-client but tiny doc is left alone.
	 * Flatten-on-bloat is a local-durability / IndexedDB-size guard, NOT the
	 * primary convergence mechanism. The plugin pushes the flattened state with a
	 * local origin so the server adopts the new lineage rather than re-expanding.
	 *
	 * **Correctness caveat:** flatten breaks CRDT lineage. A device that flattens
	 * and one that did not will re-merge as two distinct histories on the next
	 * handshake. The high threshold keeps flatten rare; the backend is the
	 * convergence authority (it also flattens per spec §4.2) and adopts the
	 * plugin's reset lineage when it receives the local-origin update.
	 *
	 * Returns true if the doc was flattened, false if the threshold was not met.
	 */
	async flattenIfBloated(path: string): Promise<boolean> {
		const e = await this.entry(path);
		const encoded = Y.encodeStateAsUpdate(e.doc);
		const clientIds = Y.decodeStateVector(Y.encodeStateVector(e.doc)).size;

		// AND gate: leave the doc alone unless it is BOTH big AND multi-client.
		if (
			encoded.length < CrdtManager.MAX_CONTENT_BYTES ||
			clientIds < CrdtManager.MAX_CLIENT_IDS
		) {
			return false;
		}

		const plaintext = e.text.toJSON();

		// Tear down the bloated entry entirely (clears both IDB and the in-memory
		// Y.Doc). We must reset the in-memory state — not just IDB — otherwise
		// applying the fresh update on top of the existing doc merges the two
		// histories and re-inflates the content.
		const id = this.docId(path);
		e.doc.destroy();
		await e.persistence.clearData();
		await e.persistence.destroy();
		this.docs.delete(id);

		// Re-open a clean entry for this path. `entry()` mints a new Y.Doc +
		// IndexeddbPersistence and awaits whenSynced (IDB is now empty).
		const fresh = await this.entry(path);

		// Seed the flattened plaintext with LOCAL origin so the update fires
		// onUpdate → CrdtChannel.sendUpdateRaw. CRITICAL: must NOT use REMOTE_ORIGIN
		// — the flattened state is a brand-new lineage the server has never seen and
		// must be sent. If we applied it as remote the observer would suppress it, the
		// server would keep its old pre-flatten state, and the next handshake would
		// re-merge the bloat right back (spec §4.2).
		fresh.text.insert(0, plaintext); // local origin → propagated to the server
		return true;
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/**
	 * Two-dimensional bloat threshold (spec §11 + backend AND gate).
	 * Both axes must be crossed; a large single-author doc or a many-client
	 * but tiny doc is left alone.
	 */
	private static readonly MAX_CONTENT_BYTES = 500_000;
	private static readonly MAX_CLIENT_IDS = 1000;

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

		// Surface IndexedDB quota / storage errors via onPersistError instead of
		// throwing into the sync loop. On iOS WKWebView the per-origin quota is
		// historically ~50 MB; eviction under storage pressure degrades local
		// durability but sync continues in-memory + over the WS.
		persistence.on("error", (err: unknown) => this.opts.onPersistError?.(path, err));

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
