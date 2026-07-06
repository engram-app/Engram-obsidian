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
	/**
	 * Optional IndexedDB store namespace. Task 6 (note_id-keyed CRDT rework)
	 * changed `docId` to return the bare note_id, unprefixed, so the WIRE
	 * `doc_id` matches the backend's bare-UUID `crdt_msg`/`crdt_doc_ready`
	 * exactly — note_ids are globally unique, so no per-caller namespace is
	 * needed there. `dbPrefix`, if given, is used ONLY for the IndexedDB store
	 * name (never for `docId`/the wire), so two `CrdtManager` instances that
	 * happen to reference the same note_id (e.g. two "devices" in a test, both
	 * running against the one shared `fake-indexeddb` process) don't
	 * cross-contaminate each other's local storage. Real devices don't need
	 * this — each has its own physical browser storage origin regardless of
	 * naming — so production callers can omit it.
	 */
	dbPrefix?: string;
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
	/**
	 * Adopt-first seed gate (backend #846 lineage doubling). Returns true when
	 * `content` is byte-identical to the last content synced for `path` (the
	 * SyncEngine's per-path hash). A history-less doc must NOT seed such
	 * content: the server already holds it on its own Yjs lineage, and a
	 * client re-encoding it produces concurrent "same text" ops Yjs cannot
	 * dedup — the note body doubles once the two lineages union. Instead the
	 * doc stays empty and adopts the server lineage from the first STEP2.
	 * Content that DIFFERS from the last-synced hash (real offline edits)
	 * seeds as before, so nothing local is ever dropped. If omitted, the gate
	 * is off (every history-less doc seeds — the pre-gate behavior).
	 */
	isUnchangedSynced?: (path: string, content: string) => boolean;
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
	/** Keyed by docId (= the bare note_id — see `docId`). Every public method
	 *  below that takes a `path`-shaped string parameter is actually keyed by
	 *  whatever opaque string the caller passes; since Task 6, callers pass the
	 *  note's stable note_id (resolved via `NoteIdMap`), not its vault path, so
	 *  a rename (which changes the path but not the id) never disturbs the
	 *  entry here. Parameter names below still say "path" in a few older
	 *  comments/tests where the distinction doesn't matter — the manager itself
	 *  never interprets the string, it only forwards it to callbacks. */
	private readonly docs = new Map<string, Entry>();
	/**
	 * Per-session set of doc IDs for which at least one inbound server sync
	 * frame has been applied (i.e. the STEP2 handshake has completed for the
	 * path). Keyed by docId — same key space as `docs`.
	 *
	 * Seeding is gated on membership here: a fresh-IDB device must NOT insert
	 * local content into a Y.Text before the server's STEP2 arrives, because
	 * doing so mints a second lineage that merges with the server's history into
	 * duplicated body text (audit P0-1). Once a STEP2 is applied, an empty doc
	 * is a genuine server-side empty note and seeding is safe.
	 *
	 * Cleared by `closeDoc`, `clearSynced`, and `destroy` to prevent stale marks
	 * across doc lifecycle events. (`removeDoc` is forward-looking — cleared by
	 * closeDoc/destroy and clearSynced; see Task 5.)
	 */
	private readonly synced = new Set<string>();

	constructor(opts: CrdtManagerOptions) {
		this.opts = opts;
	}

	// ---------------------------------------------------------------------------
	// Handshake-gate API
	// ---------------------------------------------------------------------------

	/**
	 * Mark `path` as having completed its server handshake (STEP2 received).
	 * Called by `CrdtChannel.handleFrame` after any inbound sync frame is applied
	 * to the doc. Idempotent — safe to call on every inbound frame.
	 */
	markSynced(path: string): void {
		this.synced.add(this.docId(path));
	}

	/**
	 * Returns true if `path`'s handshake has completed this session (i.e.
	 * `markSynced` has been called for it). Used by `applyLocalEdit` to guard
	 * seeding of empty docs.
	 */
	isSynced(path: string): boolean {
		return this.synced.has(this.docId(path));
	}

	/**
	 * Clear ALL synced marks for this session. Call on WebSocket disconnect so
	 * that stale marks cannot survive a reconnect: a mark means "doc reflected
	 * server state at some past time" — a disconnect invalidates that guarantee
	 * because another device may have written content while we were offline. The
	 * next reconnect fires a fresh STEP1 handshake per enrolled path, and
	 * `markSynced` is re-established only when a non-empty STEP2 arrives.
	 */
	clearSynced(): void {
		this.synced.clear();
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/** The doc id used to key the in-memory `docs` map AND the wire `doc_id`
	 *  sent to the backend. Task 6: returns the given key bare/unprefixed —
	 *  callers are expected to pass the note's stable note_id (a UUID), which
	 *  the backend's `crdt_msg`/`crdt_doc_ready` frames also carry bare, with no
	 *  vault or path embedded. Renaming a note never changes its note_id, so
	 *  this key (and the doc entry filed under it) is untouched by renames.
	 *  NOT necessarily the physical IndexedDB store name — see `storeName`. */
	docId(noteId: string): string {
		return noteId;
	}

	/** Physical IndexedDB store name for `noteId` — bare (same as `docId`)
	 *  unless `dbPrefix` is set, in which case it's namespaced. This is a
	 *  strictly local-storage concern, decoupled from `docId`/the wire: two
	 *  managers can legitimately reference the same note_id (two real devices
	 *  syncing the same note) while needing separate physical storage — real
	 *  devices get that for free (separate browser origins); `dbPrefix` exists
	 *  so a test simulating multiple "devices" against one shared
	 *  `fake-indexeddb` process can get the same isolation. */
	private storeName(noteId: string): string {
		return this.opts.dbPrefix ? `${this.opts.dbPrefix}/${noteId}` : noteId;
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
	 *
	 * **Returns** `true` — the CRDT layer always consumes the edit (seeded,
	 * diffed, or adopted). The one non-writing path is the adopt-first gate
	 * below, which still returns `true` ("handled, nothing to push") so the
	 * caller never mass-re-pushes known-synced files via the legacy path on a
	 * fresh-IndexedDB cold start; the server's lineage arrives via STEP2.
	 */
	async applyLocalEdit(path: string, diskContent: string, hasLca?: boolean): Promise<boolean> {
		const e = await this.entry(path);
		const lca = hasLca ?? this.textHasHistory(e.text);

		// Adopt-first seed gate (#161): a history-less doc whose disk content is
		// byte-identical to the last-synced content has nothing local to
		// preserve — seeding it would re-encode server-known content on this
		// client's lineage (the #846 doubling). Leave the doc empty (body AND
		// frontmatter) and let the first STEP2 populate it on the server's
		// lineage; later real edits diff in on that shared history. Returns
		// `true` ("handled, nothing to push") — a legacy fallback here would
		// mass re-push every known-synced file on a fresh-IDB cold start.
		if (!lca && this.opts.isUnchangedSynced?.(path, diskContent)) {
			return true;
		}

		const { fmBlock, body: splitBody } = splitFrontmatter(diskContent);
		const parsed = fmBlock === null ? null : parseFrontmatter(fmBlock);
		const order = parsed ? parsed.order : [];
		const values = parsed ? parsed.values : {};
		// Malformed/absent frontmatter: treat the whole raw string as body.
		const body = parsed !== null ? splitBody : diskContent;

		// Apply frontmatter into Y.Map + Y.Array inside a single transaction.
		this.applyFrontmatterInto(e.doc, order, values);

		// Route body through the existing seed-once + minimal-diff gate.
		if (seedOnce(e.text, body, lca)) return true;
		diffIntoYText(e.text, body);
		return true;
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
	 * Also clears the synced mark so a future `openDoc` + `startSync` begins a
	 * fresh handshake.
	 */
	closeDoc(path: string): void {
		const id = this.docId(path);
		const e = this.docs.get(id);
		if (!e) return;
		e.doc.destroy();
		void e.persistence.destroy();
		this.docs.delete(id);
		this.synced.delete(id);
	}

	/**
	 * Permanently remove the Y.Doc and its IndexedDB store for `path`.
	 *
	 * Call when a note is deleted or renamed (old path) so the ghost lineage
	 * does not resurrect stale content if the note is later recreated at the
	 * same path. Mirrors the teardown sequence in `flattenIfBloated`:
	 *   doc.destroy() → persistence.clearData() → persistence.destroy()
	 *   → docs.delete() → synced.delete()
	 *
	 * **Never-opened paths (IDB-only ghost):** if no in-memory entry exists for
	 * the path, `indexedDB.deleteDatabase(storeName)` clears the IDB store
	 * directly. This covers the case where another session wrote to IDB but the
	 * current session never opened the doc. The database name matches what
	 * `entry()` uses when constructing IndexeddbPersistence (y-indexeddb uses
	 * that name as the database name) — bare `path` unless dbPrefix is set (see
	 * `storeName`). Resolves without throwing regardless of whether the DB
	 * existed.
	 */
	async removeDoc(path: string): Promise<void> {
		const id = this.docId(path);
		const e = this.docs.get(id);
		if (e) {
			// In-memory entry exists: mirror flattenIfBloated's teardown sequence.
			e.doc.destroy();
			await e.persistence.clearData();
			await e.persistence.destroy();
			this.docs.delete(id);
		} else {
			// No in-memory entry — the doc may still exist in IDB from a previous
			// session. Delete the database directly by name to prevent ghost
			// resurrection on the next open. This is the same pattern that
			// ensureDocSchema uses for the one-time schema wipe (schema.ts).
			await new Promise<void>((resolve) => {
				const req = indexedDB.deleteDatabase(this.storeName(path));
				req.onsuccess = () => resolve();
				req.onerror = () => resolve(); // non-fatal — DB may not exist
				req.onblocked = () => resolve(); // resolve even if another tab has it open
			});
		}
		// Clear the synced mark regardless of which branch ran. A recreated note
		// at the same path must go through the full STEP2 handshake before seeding.
		this.synced.delete(id);
	}

	/** Tear down all open docs. Call on plugin unload. */
	async destroy(): Promise<void> {
		for (const [id, e] of this.docs) {
			e.doc.destroy();
			await e.persistence.destroy();
			this.docs.delete(id);
		}
		this.synced.clear();
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
		// The physical IndexedDB store name may be namespaced by dbPrefix (see
		// CrdtManagerOptions.dbPrefix) — but `id` (bare, no prefix) is still what
		// goes on the wire and keys the in-memory `docs` map.
		const persistence = new IndexeddbPersistence(this.storeName(path), doc);
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
