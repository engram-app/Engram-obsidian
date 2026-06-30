import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { diffIntoYText, seedOnce } from "./bridge";
import { parseFrontmatter, projectNote, splitFrontmatter } from "./frontmatter-codec";

/**
 * Transaction origin stamped on remotely-applied updates. Updates carrying
 * this origin are NOT re-broadcast (the server already has them) and ARE
 * flushed to disk via `onFlushToDisk`. `CrdtChannel` (Task 4) imports this
 * constant and passes it as the origin when applying inbound server bytes via
 * `y-protocols/sync.readSyncMessage`, so channel and manager agree on a single
 * marker without magic strings at the call sites.
 */
export const REMOTE_ORIGIN = "remote";

/** Y.Doc shared-type key for the frontmatter key-value map. */
export const FRONTMATTER_KEY = "frontmatter";
/** Y.Doc shared-type key for the ordered list of frontmatter keys. */
export const ORDER_KEY = "frontmatter_order";
/** Y.Doc shared-type key for the note body text. */
export const CONTENT_KEY = "content";

/**
 * Read the frontmatter structure from a Y.Doc.
 * Returns `{ order: [], values: {} }` for a fresh doc with no frontmatter data.
 */
export function frontmatterOf(doc: Y.Doc): { order: string[]; values: Record<string, string> } {
	const order = doc.getArray<string>(ORDER_KEY).toArray();
	const values = doc.getMap<string>(FRONTMATTER_KEY).toJSON() as Record<string, string>;
	return { order, values };
}

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
	 * Apply a disk-read content string into the doc's Y.Text and frontmatter
	 * Y.Map/Y.Array.
	 *
	 * Frontmatter is split from the raw disk content first:
	 * - Valid YAML frontmatter: Y.Map(FRONTMATTER_KEY) is upserted with parsed
	 *   key-value pairs (only changed keys written), missing keys deleted, and
	 *   Y.Array(ORDER_KEY) is replaced with the source-order key list.
	 * - Malformed or absent frontmatter: Y.Map and Y.Array are left empty and the
	 *   whole `diskContent` is treated as body (mirrors the backend `ingest_plaintext`
	 *   fallback).
	 *
	 * The body is routed through the existing two-guard seed/diff bridge:
	 * - First call ever for this path (no CRDT history): `seedOnce` enrolls the
	 *   body text into the shared type exactly once.
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

		const { fmBlock, body: splitBody } = splitFrontmatter(diskContent);
		const parsed = fmBlock === null ? null : parseFrontmatter(fmBlock);
		const order = parsed ? parsed.order : [];
		const values = parsed ? parsed.values : {};
		// Malformed/absent frontmatter: treat the whole raw string as body.
		const body = parsed !== null ? splitBody : diskContent;

		// Apply frontmatter into Y.Map + Y.Array inside a single transaction.
		this.applyFrontmatterInto(e.doc, order, values);

		// Route body through the existing seed-once + minimal-diff gate.
		if (seedOnce(e.text, body, lca)) return;
		diffIntoYText(e.text, body);
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

	/** Return the note body (frontmatter excluded). For the full file use projectedText. */
	async getText(path: string): Promise<string> {
		return (await this.entry(path)).text.toJSON();
	}

	/** Full reconstructed file (frontmatter fence + body) as it would be written to disk. */
	async projectedText(path: string): Promise<string> {
		const e = await this.entry(path);
		const { order, values } = frontmatterOf(e.doc);
		return projectNote(order, values, e.text.toJSON());
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
		const { order, values } = frontmatterOf(e.doc);

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

		// Seed the flattened state — both frontmatter and body — with LOCAL origin
		// inside a single transaction so the update fires onUpdate →
		// CrdtChannel.sendUpdateRaw. CRITICAL: must NOT use REMOTE_ORIGIN — the
		// flattened state is a brand-new lineage the server has never seen and must
		// be sent. If we applied it as remote the observer would suppress it, the
		// server would keep its old pre-flatten state, and the next handshake would
		// re-merge the bloat right back (spec §4.2).
		fresh.doc.transact(() => {
			this.applyFrontmatterInto(fresh.doc, order, values);
			fresh.text.insert(0, plaintext);
		}); // local origin → propagated to the server
		return true;
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/**
	 * Upsert changed frontmatter keys into Y.Map(FRONTMATTER_KEY), delete absent
	 * keys, and replace Y.Array(ORDER_KEY) — all in a single doc transaction.
	 *
	 * Semantics are identical to the original inlined block in `applyLocalEdit`:
	 * - Only keys whose value changed are written (idempotent for unchanged keys).
	 * - Keys present in the current map but absent from `values` are deleted.
	 * - The order array is always replaced wholesale (delete-all then insert).
	 *
	 * The body seed/diff gate lives OUTSIDE this helper and is not affected.
	 * Pass an empty `order` + `values` to clear frontmatter.
	 */
	private applyFrontmatterInto(
		doc: Y.Doc,
		order: string[],
		values: Record<string, string>,
	): void {
		const map = doc.getMap<string>(FRONTMATTER_KEY);
		const arr = doc.getArray<string>(ORDER_KEY);
		const current = map.toJSON() as Record<string, string>;
		doc.transact(() => {
			for (const [k, v] of Object.entries(values)) {
				if (current[k] !== v) map.set(k, v);
			}
			for (const k of Object.keys(current)) {
				if (!(k in values)) map.delete(k);
			}
			if (arr.length > 0) arr.delete(0, arr.length);
			if (order.length > 0) arr.insert(0, order);
		});
	}

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
		const text = doc.getText(CONTENT_KEY);

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
		// Reconstruct the full file (frontmatter fence + body) from the Y.Map/Y.Array
		// and body Y.Text so disk always gets a complete, valid markdown file.
		doc.on("update", (_u: Uint8Array, origin: unknown) => {
			if (origin !== REMOTE_ORIGIN) return;
			const { order, values } = frontmatterOf(doc);
			const body = text.toJSON();
			void this.opts.onFlushToDisk(path, projectNote(order, values, body));
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
