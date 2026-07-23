import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { rlog } from "../remote-log";
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
/**
 * Y.Doc shared-type key for the out-of-band raw-passthrough map: DEGRADED
 * frontmatter keys (ones the backend could not parse as YAML) mapped to their
 * verbatim source spans. Kept separate from FRONTMATTER_KEY so a normal
 * client-written value is never mis-read as a raw-passthrough marker. Mirrors
 * the backend CrdtBridge `@raw_frontmatter_name`.
 */
export const RAW_FRONTMATTER_KEY = "frontmatter_raw";
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

/**
 * Read the out-of-band degraded-key raw spans from a Y.Doc.
 * Returns `{}` for a doc with no degraded keys. Mirrors the backend
 * CrdtBridge.raw_frontmatter_of/1.
 */
export function rawFrontmatterOf(doc: Y.Doc): Record<string, string> {
	return doc.getMap<string>(RAW_FRONTMATTER_KEY).toJSON();
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
	onFlushToDisk: (noteId: string, content: string) => Promise<void>;
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
	onPersistError?: (noteId: string, err: unknown) => void;
	/**
	 * Adopt-first seed gate (backend #846 lineage doubling). Returns true when
	 * `content` is byte-identical to the last content synced for that note (the
	 * SyncEngine's per-path hash, resolved from `noteId`). A history-less doc
	 * must NOT seed such
	 * content: the server already holds it on its own Yjs lineage, and a
	 * client re-encoding it produces concurrent "same text" ops Yjs cannot
	 * dedup — the note body doubles once the two lineages union. Instead the
	 * doc stays empty and adopts the server lineage from the first STEP2.
	 * Content that DIFFERS from the last-synced hash (real offline edits)
	 * seeds as before, so nothing local is ever dropped. If omitted, the gate
	 * is off (every history-less doc seeds — the pre-gate behavior).
	 */
	isUnchangedSynced?: (path: string, content: string) => boolean;
	/**
	 * Return false to HOLD a local update (the note's server row doesn't exist
	 * yet — its `crdt_create` hasn't been acked). The edit stays safe in the
	 * Y.Doc (never lost) and is not forwarded to `onUpdate`; the caller resends
	 * once acked (see `entry()`'s local-update listener). Default: always send
	 * (matches pre-gate behavior — every existing test is unaffected).
	 */
	canSendLive?: (docId: string) => boolean;
	/**
	 * Fix wave 1 (single-path D3 review): called from `markSynced` — i.e. every
	 * time `CrdtChannel.handleFrame` applies an inbound sync frame that leaves
	 * the doc's text non-empty. This is op-level proof the doc actually holds
	 * server content, unlike a text-equality guess. Wired to
	 * `SyncEngine.commitCrdtConvergence`, which commits any staged
	 * `pendingConvergence` entry for this note_id. Fires on every non-empty
	 * frame (STEP2 or a later live update), not just the first — the commit
	 * side is idempotent (no-op when nothing is staged), so this is cheap.
	 */
	onSynced?: (noteId: string) => void;
}

interface Entry {
	doc: Y.Doc;
	persistence: IndexeddbPersistence;
	text: Y.Text;
	/** Resolves once IndexeddbPersistence has replayed stored updates. */
	ready: Promise<void>;
	/** Ticks on every REMOTE_ORIGIN apply (applyRemoteUpdate AND the room's
	 *  readSyncMessage — both land on the same doc listener). Lets
	 *  applyLocalEdit detect that a disk snapshot predates a remote merge. */
	remoteSeq: number;
	/** True once the body Y.Text has EVER been observed non-empty (any update,
	 *  either direction, or IDB hydration). Gates the remote-merge flush of an
	 *  empty body (#288): empty + never-had-content is an unseeded genesis, not
	 *  a delete-all — a genuine remote delete-all requires content first. */
	hadContent: boolean;
}

export class CrdtManager {
	private readonly opts: CrdtManagerOptions;
	/** Keyed by docId (= the bare note_id — see `docId`). Every public method
	 *  below takes a `noteId` parameter; since Task 6, callers pass the note's
	 *  stable note_id (resolved via `NoteIdMap`), not its vault path, so a
	 *  rename (which changes the path but not the id) never disturbs the entry
	 *  here. The manager itself never interprets the string, it only forwards
	 *  it to callbacks. */
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

	/**
	 * Per-docId count of mutating ops (applyLocalEdit / applyRemoteUpdate)
	 * currently in flight. Incremented SYNCHRONOUSLY at the very start of each
	 * mutating op — before its first `await entry(...)` yields — and decremented
	 * in a `finally`. `closeDoc` refuses to destroy a doc whose count is > 0:
	 * otherwise a concurrent hibernation (`closeDoc` from a fanned-out remote
	 * update) could `doc.destroy()` out from under an awaiting `applyLocalEdit`,
	 * clearing the update listeners so the resumed edit emits/persists nothing —
	 * a silent edit loss plus a poisoned synced baseline. Keyed by docId, the
	 * same key space as `docs`.
	 */
	private readonly inFlightOps = new Map<string, number>();

	/**
	 * Per-docId promise for the disk flush kicked off by the most recent
	 * REMOTE_ORIGIN doc update (the `onFlushToDisk` call in `entry()`'s
	 * remote-merge listener). `applyRemoteUpdate` awaits this after
	 * `Y.applyUpdate` so a FAILED flush rejects the apply instead of being
	 * fire-and-forgotten (#235). Set synchronously inside `Y.applyUpdate` (the
	 * listener fires synchronously), read + deleted by `applyRemoteUpdate`
	 * immediately after. Keyed by docId, same key space as `docs`.
	 */
	private readonly pendingFlush = new Map<string, Promise<void>>();

	constructor(opts: CrdtManagerOptions) {
		this.opts = opts;
	}

	/** Mark a mutating op as started for `id` (docId). Call synchronously before
	 *  the op's first await. */
	private beginOp(id: string): void {
		this.inFlightOps.set(id, (this.inFlightOps.get(id) ?? 0) + 1);
	}

	/** Mark a mutating op as finished for `id`. Call from a `finally`. */
	private endOp(id: string): void {
		const n = (this.inFlightOps.get(id) ?? 0) - 1;
		if (n > 0) this.inFlightOps.set(id, n);
		else this.inFlightOps.delete(id);
	}

	// ---------------------------------------------------------------------------
	// Handshake-gate API
	// ---------------------------------------------------------------------------

	/**
	 * Mark `noteId` as having completed its server handshake (STEP2 received).
	 * Called by `CrdtChannel.handleFrame` after any inbound sync frame is applied
	 * to the doc. Idempotent — safe to call on every inbound frame. Also fires
	 * `opts.onSynced` (fix wave 1) — this is the op-level "real ops landed"
	 * signal SyncEngine commits a staged live-bound convergence on.
	 */
	markSynced(noteId: string): void {
		this.synced.add(this.docId(noteId));
		this.opts.onSynced?.(noteId);
	}

	/**
	 * Returns true if `noteId`'s handshake has completed this session (i.e.
	 * `markSynced` has been called for it). Used by `applyLocalEdit` to guard
	 * seeding of empty docs.
	 */
	isSynced(noteId: string): boolean {
		return this.synced.has(this.docId(noteId));
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

	/** Returns (or opens + rehydrates from IndexedDB) the Y.Doc for `noteId`. */
	async getDoc(noteId: string): Promise<Y.Doc> {
		return (await this.entry(noteId)).doc;
	}

	/** True when the doc is currently resident in memory. Used to prove an
	 *  orphaned mint doc was torn down (removeDoc) after a genesis adopt. */
	hasDoc(noteId: string): boolean {
		return this.docs.has(this.docId(noteId));
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
	 * **Returns** the exact content string the CRDT layer consumed (seeded,
	 * diffed, or adopted) — callers stamp their echo/dedup baselines from THIS
	 * value, never from their own pre-call disk snapshot, because with `reread`
	 * the consumed content can legitimately differ from the snapshot (a remote
	 * merge landed mid-guard). Returns `null` when the edit was NOT consumed
	 * (reread failed, or the stale-snapshot guard gave up under a live remote
	 * storm) — the caller's legacy/REST path owns the edit. The adopt-first
	 * gate below still consumes ("handled, nothing to push") so the caller
	 * never mass-re-pushes known-synced files via the legacy path on a
	 * fresh-IndexedDB cold start; the server's lineage arrives via STEP2.
	 *
	 * Contract: a caller applying DISK content MUST pass `reread` (a live read
	 * of the same file) so the stale-snapshot guard can retry against a moved
	 * doc. Omitting `reread` is reserved for callers deliberately injecting
	 * NON-disk content (drift-merge results, server-fetched bodies), where a
	 * disk reread would be wrong by construction.
	 */
	async applyLocalEdit(
		noteId: string,
		diskContent: string,
		hasLca?: boolean,
		reread?: () => Promise<string>,
	): Promise<string | null> {
		const id = this.docId(noteId);
		this.beginOp(id); // synchronous, before the first await — fences closeDoc
		try {
			return await this.applyLocalEditInner(noteId, diskContent, hasLca, reread);
		} finally {
			this.endOp(id);
		}
	}

	private async applyLocalEditInner(
		noteId: string,
		diskContent: string,
		hasLca?: boolean,
		reread?: () => Promise<string>,
	): Promise<string | null> {
		const e = await this.entry(noteId);
		let content = diskContent;

		// Stale-snapshot revert guard (e2e test_83 "v3 via Obsidian" -> "v via
		// Obsidian" corruption): `diskContent` was read from disk BEFORE this
		// call resolved the entry (debounce + the entry await above). A remote
		// update merged in that window is absent from the snapshot, so diffing
		// it in would surgically DELETE the remote ops from the doc — and the
		// deletion propagates to the server and every device. When the caller
		// can re-read, diff only a read the doc held still across: await any
		// pending remote flush (so disk reflects the merge), capture remoteSeq,
		// re-read, and accept only if no remote apply interleaved. The diff
		// itself is synchronous, so nothing can move the doc after the check.
		if (reread) {
			const id = this.docId(noteId);
			let stable = false;
			for (let attempt = 0; attempt < 3 && !stable; attempt++) {
				// Capture seq BEFORE awaiting the flush: a remote update landing
				// DURING that await ticks remoteSeq while its own disk flush is
				// still in flight — captured after, it would count as "stable"
				// against a reread that predates the merge (review manager.ts:318).
				const seq = e.remoteSeq;
				let flushOk = true;
				const flush = this.pendingFlush.get(id);
				if (flush) {
					try {
						await flush;
					} catch {
						// Disk may not reflect the merge; this attempt cannot be
						// trusted. The entry self-cleans on settle (see the update
						// listener), so the retry doesn't re-await the same failure.
						flushOk = false;
					}
				}
				try {
					content = await reread();
				} catch {
					// Cap-exceeded (routeModify's reread throws past
					// MAX_CRDT_NOTE_BYTES) or an unreadable file: never diff a
					// stale snapshot instead — NOT consumed, REST owns the edit.
					return null;
				}
				stable = flushOk && e.remoteSeq === seq;
			}
			if (!stable) {
				// ponytail: 3 consecutive mid-read remote merges = live storm.
				// Skip the (stale) diff rather than corrupt — and report NOT
				// consumed so the caller's REST fallback ships the edit and no
				// echo baseline is stamped for content that never entered the
				// doc (review manager.ts:322: "consumed" here silently lost the
				// edit when the storm's flushes were disk-identical).
				return null;
			}
		}

		const lca = hasLca ?? this.textHasHistory(e.text);

		// Adopt-first seed gate (#161): a history-less doc whose disk content is
		// byte-identical to the last-synced content has nothing local to
		// preserve — seeding it would re-encode server-known content on this
		// client's lineage (the #846 doubling). Leave the doc empty (body AND
		// frontmatter) and let the first STEP2 populate it on the server's
		// lineage; later real edits diff in on that shared history. Returns
		// `true` ("handled, nothing to push") — a legacy fallback here would
		// mass re-push every known-synced file on a fresh-IDB cold start.
		if (!lca && this.opts.isUnchangedSynced?.(noteId, content)) {
			return content;
		}

		this.seedContentInto(e.doc, e.text, content, lca);
		return content;
	}

	/**
	 * Ingest a disk-content string into a doc's Y.Text + frontmatter shared types
	 * inside ONE transaction (frontmatter split/parse, then the seed-once +
	 * minimal-diff body gate). Shared by `applyLocalEdit` (the note's live doc)
	 * and `encodeGenesisUpdate` (a throwaway doc) so both produce byte-identical
	 * CRDT ops for the same content — a divergent encoding would corrupt the note
	 * when the two lineages merge. ONE transaction so bare ops don't ship as
	 * separate updates that expose a truncated intermediate state (e2e test_83).
	 */
	private seedContentInto(doc: Y.Doc, text: Y.Text, content: string, lca: boolean): void {
		const { fmBlock, body: splitBody } = splitFrontmatter(content);
		const parsed = fmBlock === null ? null : parseFrontmatter(fmBlock);
		const order = parsed ? parsed.order : [];
		const values = parsed ? parsed.values : {};
		// Malformed/absent frontmatter: treat the whole raw string as body.
		const body = parsed !== null ? splitBody : content;
		doc.transact(() => {
			this.applyFrontmatterInto(doc, order, values);
			if (!seedOnce(text, body, lca)) diffIntoYText(text, body);
		});
	}

	/**
	 * Encode a brand-new note's initial content as a standalone Yjs v1 state
	 * update — no IndexedDB persistence, no update listeners, no wire side
	 * effects. The batch genesis path (`crdt_create_batch`) wraps this in a
	 * `messageSync` frame and sends it INLINE with the create, so the server has
	 * the content in one round-trip (unlike the single `crdt_create`, which makes
	 * an empty row then seeds the body over a follow-up `crdt_msg`).
	 *
	 * Reuses `seedContentInto` (the same seed the live doc uses), so a peer
	 * applying the frame reconstructs the note identically. The throwaway doc's
	 * client id becomes the note's genesis lineage; the sending device never
	 * seeds its OWN real doc from this content (the caller records a baseline hash
	 * so a later identical edit is skipped), so there is no second-lineage
	 * doubling (#846) — the real doc adopts the server lineage on its first
	 * handshake.
	 */
	encodeGenesisUpdate(content: string): Uint8Array {
		const doc = new Y.Doc();
		try {
			this.seedContentInto(doc, doc.getText(CONTENT_KEY), content, false);
			return Y.encodeStateAsUpdate(doc);
		} finally {
			doc.destroy();
		}
	}

	/**
	 * Apply a binary Yjs update received from the server.
	 * Stamped with `REMOTE_ORIGIN` so the `doc.on("update")` listener does NOT
	 * re-send it to the server, but DOES flush the merged content to disk.
	 */
	async applyRemoteUpdate(noteId: string, update: Uint8Array): Promise<void> {
		const id = this.docId(noteId);
		this.beginOp(id); // synchronous, before the first await — fences closeDoc
		try {
			const e = await this.entry(noteId);
			Y.applyUpdate(e.doc, update, REMOTE_ORIGIN);
			// Y.applyUpdate fired the remote-merge listener SYNCHRONOUSLY, which
			// recorded the disk-flush promise in `pendingFlush`. Await it so a flush
			// FAILURE rejects applyRemoteUpdate: the caller
			// (applyPushedNoteUpdate/coldReceive) then leaves crdtHead unadvanced and
			// retries, instead of marking a note "converged" that never reached disk
			// (#235). A no-op update integrates zero ops → no listener → no pending
			// flush → nothing to await (head may advance, which is correct for a
			// genuinely empty/already-applied update).
			const flush = this.pendingFlush.get(id);
			if (flush) {
				this.pendingFlush.delete(id);
				await flush;
			}
		} finally {
			this.endOp(id);
		}
	}

	/** Encode the current state vector (for the channel handshake sync step). */
	async encodeStateVector(noteId: string): Promise<Uint8Array> {
		return Y.encodeStateVector((await this.entry(noteId)).doc);
	}

	/** True when the doc holds PENDING structs: a remote update was applied that
	 *  references state this device is missing (updates it never saw — e.g. edits
	 *  another device made while this one was offline). Yjs parks such an update
	 *  in `store.pendingStructs` and does NOT integrate it until the missing deps
	 *  arrive, so the visible doc stays behind. The fan-out apply path checks this
	 *  to avoid advancing crdtHead over an unconverged doc (which would make
	 *  coldReceive's cost gate skip the note and the gap would never heal). */
	async hasPendingGap(noteId: string): Promise<boolean> {
		const doc = (await this.entry(noteId)).doc as unknown as {
			store?: { pendingStructs?: unknown };
		};
		return doc.store?.pendingStructs != null;
	}

	/**
	 * Encode the full document state as a v1 update.
	 * Pass `sv` (a peer's state vector) to get only the delta they're missing.
	 */
	async encodeStateAsUpdate(noteId: string, sv?: Uint8Array): Promise<Uint8Array> {
		return Y.encodeStateAsUpdate((await this.entry(noteId)).doc, sv);
	}

	/** Force-send `noteId`'s CURRENT full state via `onUpdate`, bypassing
	 *  `canSendLive` — the "caller resends once acked" half of that option's
	 *  contract. A note's `crdt_create` ack is the caller's cue: whatever local
	 *  edits landed in the Y.Doc while the gate held them (never lost, just
	 *  unsent) need one push now that the row exists. Reuses the exact transport
	 *  `onUpdate` already goes through (CrdtChannel.sendUpdateRaw in
	 *  production), so no separate send path is introduced. Lazily creates an
	 *  empty entry if none exists yet, so a note with nothing held still
	 *  resolves cleanly (sends a no-op-ish empty state, harmless to a peer). */
	async flushHeldState(noteId: string): Promise<void> {
		const id = this.docId(noteId);
		const update = await this.encodeStateAsUpdate(noteId);
		// origin is undefined (not REMOTE_ORIGIN): this is a genuine local send.
		// The production wiring's onUpdate ignores the origin arg anyway.
		this.opts.onUpdate(id, update, undefined);
	}

	/** Return the note body (frontmatter excluded). For the full file use projectedText. */
	async getText(noteId: string): Promise<string> {
		return (await this.entry(noteId)).text.toJSON();
	}

	/**
	 * True when `noteId`'s Y.Doc already carries CRDT history (its Y.Text holds
	 * content after IDB rehydration). A history-LESS doc — a feed-synced note
	 * whose content arrived via the cursor feed, so its IndexedDB store was never
	 * populated — must NOT seed disk drift before a remote merge (that mints a
	 * second lineage and DOUBLES the baseline, #234) and cannot be reconstructed
	 * from a bare incremental delta (missing causal base). Callers branch on this
	 * to adopt FULL server state for a history-less note instead. Opening the
	 * entry rehydrates from IDB first, so the answer reflects durable state, not a
	 * transiently-empty in-memory doc.
	 */
	async hasHistory(noteId: string): Promise<boolean> {
		return this.textHasHistory((await this.entry(noteId)).text);
	}

	/** Full reconstructed file (frontmatter fence + body) as it would be written to disk. */
	async projectedText(noteId: string): Promise<string> {
		const e = await this.entry(noteId);
		const { order, values } = frontmatterOf(e.doc);
		return projectNote(order, values, e.text.toJSON(), rawFrontmatterOf(e.doc));
	}

	/**
	 * Close and clean up a single doc entry (destroys the Y.Doc and the
	 * IndexeddbPersistence instance). Use when a note is closed in the editor.
	 * Also clears the synced mark so a future `openDoc` + `startSync` begins a
	 * fresh handshake.
	 */
	/** Shared entry teardown: destroy the Y.Doc (optionally wiping its IDB
	 *  store first) and drop the in-memory entry. Callers own their OWN
	 *  synced/pendingFlush bookkeeping — the four teardown sites deliberately
	 *  differ there (closeDoc/removeDoc clear both, flattenIfBloated keeps
	 *  them for the re-opened entry, destroy() clears in bulk). */
	private async teardownEntry(
		id: string,
		e: {
			doc: { destroy(): void };
			persistence: { clearData(): Promise<unknown>; destroy(): Promise<unknown> };
		},
		opts: { clearData: boolean },
	): Promise<void> {
		// Drop the in-memory entry SYNCHRONOUSLY, before any await — a caller
		// that fires this un-awaited (closeDoc) may be followed immediately by
		// an apply whose entry() must mint a FRESH doc, never see the dying one.
		this.docs.delete(id);
		e.doc.destroy();
		if (opts.clearData) await e.persistence.clearData();
		await e.persistence.destroy();
	}

	closeDoc(noteId: string): void {
		const id = this.docId(noteId);
		// In-flight guard: never destroy a doc while a mutating op (applyLocalEdit
		// / applyRemoteUpdate) is awaiting on it — destroying clears the update
		// listeners, so the resumed op emits/persists nothing and its edit is lost
		// (silent data loss + poisoned baseline). Leave the doc resident; a later
		// idle apply's hibernation frees it once no op is pending.
		if ((this.inFlightOps.get(id) ?? 0) > 0) return;
		const e = this.docs.get(id);
		if (!e) return;
		void this.teardownEntry(id, e, { clearData: false });
		this.synced.delete(id);
		this.pendingFlush.delete(id);
	}

	/**
	 * Permanently remove the Y.Doc and its IndexedDB store for `noteId`.
	 *
	 * Call when a note is deleted or renamed (old path) so the ghost lineage
	 * does not resurrect stale content if the note is later recreated at the
	 * same path. Shares `teardownEntry` (clearData: true) with
	 * `flattenIfBloated`.
	 *
	 * **Never-opened notes (IDB-only ghost):** if no in-memory entry exists for
	 * the noteId, `indexedDB.deleteDatabase(storeName)` clears the IDB store
	 * directly. This covers the case where another session wrote to IDB but the
	 * current session never opened the doc. The database name matches what
	 * `entry()` uses when constructing IndexeddbPersistence (y-indexeddb uses
	 * that name as the database name) — bare `noteId` unless dbPrefix is set
	 * (see `storeName`). Resolves without throwing regardless of whether the DB
	 * existed.
	 */
	async removeDoc(noteId: string): Promise<void> {
		const id = this.docId(noteId);
		const e = this.docs.get(id);
		if (e) {
			await this.teardownEntry(id, e, { clearData: true });
		} else {
			// No in-memory entry — the doc may still exist in IDB from a previous
			// session. Delete the database directly by name to prevent ghost
			// resurrection on the next open. This is the same pattern that
			// ensureDocSchema uses for the one-time schema wipe (schema.ts).
			await new Promise<void>((resolve) => {
				const req = indexedDB.deleteDatabase(this.storeName(noteId));
				req.onsuccess = () => resolve();
				req.onerror = () => resolve(); // non-fatal — DB may not exist
				req.onblocked = () => resolve(); // resolve even if another tab has it open
			});
		}
		// Clear the synced mark regardless of which branch ran. A recreated note
		// at the same path must go through the full STEP2 handshake before seeding.
		this.synced.delete(id);
		this.pendingFlush.delete(id);
	}

	/** Tear down all open docs. Call on plugin unload. */
	async destroy(): Promise<void> {
		for (const [id, e] of this.docs) {
			await this.teardownEntry(id, e, { clearData: false });
		}
		this.synced.clear();
		this.pendingFlush.clear();
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
	async flattenIfBloated(noteId: string): Promise<boolean> {
		const e = await this.entry(noteId);
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
		const raws = rawFrontmatterOf(e.doc);

		// Tear down the bloated entry entirely (clears both IDB and the in-memory
		// Y.Doc). We must reset the in-memory state — not just IDB — otherwise
		// applying the fresh update on top of the existing doc merges the two
		// histories and re-inflates the content.
		const id = this.docId(noteId);
		await this.teardownEntry(id, e, { clearData: true });

		// Re-open a clean entry for this note. `entry()` mints a new Y.Doc +
		// IndexeddbPersistence and awaits whenSynced (IDB is now empty).
		const fresh = await this.entry(noteId);

		// Seed the flattened state — both frontmatter and body — with LOCAL origin
		// inside a single transaction so the update fires onUpdate →
		// CrdtChannel.sendUpdateRaw. CRITICAL: must NOT use REMOTE_ORIGIN — the
		// flattened state is a brand-new lineage the server has never seen and must
		// be sent. If we applied it as remote the observer would suppress it, the
		// server would keep its old pre-flatten state, and the next handshake would
		// re-merge the bloat right back (spec §4.2).
		fresh.doc.transact(() => {
			this.applyFrontmatterInto(fresh.doc, order, values);
			// Carry the out-of-band degraded-key spans onto the fresh lineage too,
			// else flatten would strip them (data loss). Fresh doc → empty raw map,
			// so a plain set per key suffices (no delete pass needed).
			const rawMap = fresh.doc.getMap<string>(RAW_FRONTMATTER_KEY);
			for (const [k, v] of Object.entries(raws)) rawMap.set(k, v);
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
		const rawMap = doc.getMap<string>(RAW_FRONTMATTER_KEY);
		const current = map.toJSON() as Record<string, string>;
		doc.transact(() => {
			for (const [k, v] of Object.entries(values)) {
				if (current[k] !== v) map.set(k, v);
				// A locally-parsed GOOD value supersedes any stale raw span for the
				// same key. The plugin's parser is more lenient than the backend, so
				// a key the backend degraded into frontmatter_raw can re-ingest here
				// as a good value; without this delete, emitFrontmatter's
				// raws-precedence would re-emit the old span and silently revert the
				// user's edit (whole-branch review finding #1). Scoped to keys this
				// call writes as good values, so a raw key the parse did NOT
				// re-produce is left untouched (no data loss). Local ingest never
				// PRODUCES raws, so this only ever deletes stale entries.
				if (rawMap.has(k)) rawMap.delete(k);
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
	private async entry(noteId: string): Promise<Entry> {
		const id = this.docId(noteId);
		const cached = this.docs.get(id);
		if (cached) {
			await cached.ready;
			return cached;
		}

		const doc = new Y.Doc();
		// The physical IndexedDB store name may be namespaced by dbPrefix (see
		// CrdtManagerOptions.dbPrefix) — but `id` (bare, no prefix) is still what
		// goes on the wire and keys the in-memory `docs` map.
		const persistence = new IndexeddbPersistence(this.storeName(noteId), doc);
		const text = doc.getText(CONTENT_KEY);
		const ready: Promise<void> = persistence.whenSynced.then(() => undefined);
		// Created BEFORE the listeners below so they can tick entry.remoteSeq.
		const entry: Entry = { doc, persistence, text, ready, remoteSeq: 0, hadContent: false };

		// Surface IndexedDB quota / storage errors via onPersistError instead of
		// throwing into the sync loop. On iOS WKWebView the per-origin quota is
		// historically ~50 MB; eviction under storage pressure degrades local
		// durability but sync continues in-memory + over the WS.
		persistence.on("error", (err: unknown) => this.opts.onPersistError?.(noteId, err));

		// Local-edit path: forward update to the channel; skip remote-origin updates.
		doc.on("update", (update: Uint8Array, origin: unknown) => {
			if (text.length > 0) entry.hadContent = true; // also covers IDB-replay updates
			if (origin === REMOTE_ORIGIN) return;
			if (this.opts.canSendLive && !this.opts.canSendLive(id)) return; // HOLD: not create-acked
			this.opts.onUpdate(id, update, origin);
		});

		// Remote-merge path: flush merged content to disk; skip local-origin updates.
		// Reconstruct the full file (frontmatter fence + body) from the Y.Map/Y.Array
		// and body Y.Text so disk always gets a complete, valid markdown file.
		doc.on("update", (_u: Uint8Array, origin: unknown) => {
			if (text.length > 0) entry.hadContent = true;
			if (origin !== REMOTE_ORIGIN) return;
			entry.remoteSeq += 1;
			const { order, values } = frontmatterOf(doc);
			const raws = rawFrontmatterOf(doc);
			const body = text.toJSON();
			// Guard A (#288, e2e test_39): an unseeded genesis (structure ops only,
			// body never held content) must NOT flush empty over the creator's
			// just-written file — the wipe echo-skips on the empty hash and locks
			// in on both devices. Invariant (crdt-editor-bind-race-pollution.md,
			// #257 bind-path analog): empty + never-seeded is NEVER a legitimate
			// empty; a genuine remote delete-all had content first (hadContent
			// true) and still flushes below. Genuinely empty notes materialize via
			// sync.ts materializeEmptyDiscovered → flushFromCrdt, not this listener.
			if (body.length === 0 && !entry.hadContent) {
				rlog().warn(
					"crdt",
					`remote-merge flush SKIPPED for ${noteId}: empty body on never-seeded doc (#288 genesis guard)`,
				);
				return;
			}
			// Record the flush promise (do NOT fire-and-forget): applyRemoteUpdate
			// awaits it so a write failure rejects the apply and the caller leaves
			// crdtHead unadvanced (#235). Promise.resolve() normalizes a sync/void
			// return from a test double into an awaitable.
			const flush = Promise.resolve(
				this.opts.onFlushToDisk(noteId, projectNote(order, values, body, raws)),
			);
			this.pendingFlush.set(id, flush);
			// Room-path updates (crdt/channel readSyncMessage applies straight to
			// the doc) never consume this entry the way applyRemoteUpdate does —
			// self-clean on settle so ONE rejected flush can't sit in the map and
			// poison every later applyLocalEdit await for this note (review
			// manager.ts:317). The catch also marks the rejection handled;
			// applyRemoteUpdate re-awaits the same promise and still observes it.
			void flush
				.catch(() => undefined)
				.finally(() => {
					if (this.pendingFlush.get(id) === flush) this.pendingFlush.delete(id);
				});
		});

		this.docs.set(id, entry);
		await ready;
		// IDB hydration replayed stored updates above; a rehydrated non-empty body
		// counts as "has held content" (#288) even if no listener observed it.
		if (text.length > 0) entry.hadContent = true;
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
