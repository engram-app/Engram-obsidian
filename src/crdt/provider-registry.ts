// The Relay-model engine: one persistent NoteProvider (+ IndexeddbPersistence)
// per note, keyed by the bare note_id. Replaces CrdtManager + CrdtChannel +
// CrdtEnrollment. The registry OUTLIVES the socket — a reconnect calls
// setConnected(true), which re-advertises every resident doc via syncStep1 (a
// state-vector diff, NEVER a full re-push, so no lineage doubling). Convergence
// is the provider's readSyncMessage; there is NO text-verify gate.
//
// It exposes the CrdtManager/CrdtEnrollment/CrdtChannel call surface (getDoc,
// applyLocalEdit, applyRemoteUpdate, projectedText, closeDoc, enroll, receive,
// …) so the SyncEngine + CrdtLiveViews route through it unchanged. Methods that
// only made sense for the old churny lifecycle (hibernation, flatten, gap
// re-handshake) become no-ops the persistent doc doesn't need.
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { Lifetime } from "../lifetime";
import { projectCanvas, seedCanvasInto } from "./canvas-codec";
import { isDestroyedError, NoteDestroyedError } from "./destroyed-error";
import {
	CONTENT_KEY,
	frontmatterOf,
	projectNote,
	rawFrontmatterOf,
	splitFrontmatter,
} from "./frontmatter-codec";
import { mergeDiskOntoDoc } from "./lca-merge";
import { type FrameKind, NoteProvider } from "./note-provider";
import { docHasAnyHistory, docHasHistory, seedContentInto, seedFrontmatterInto } from "./note-seed";

export type DocKind = "note" | "canvas";

/** Applied to remote merges so the provider suppresses re-send AND the registry
 *  flush listener writes them to disk. The NoteProvider stamps itself as the
 *  origin on readSyncMessage; a raw applyRemoteUpdate (vault-channel fan-out)
 *  uses this shared marker so the same listener fires. */
const REMOTE = Symbol("remote");

interface Entry {
	doc: Y.Doc;
	provider: NoteProvider;
	persistence: IndexeddbPersistence;
	text: Y.Text;
	kind: DocKind;
	ready: Promise<void>;
	/** Ticks on every remote merge — the stale-snapshot guard in applyLocalEdit
	 *  uses it to detect a merge that interleaved a disk reread. */
	remoteSeq: number;
	/** The frontmatter block as of the last flush, so the next one can say
	 *  whether the frontmatter CHANGED. `null` means "no block". */
	lastFlushedFm: string | null;
	/** In-flight disk-flush from the last remote merge; applyRemoteUpdate awaits
	 *  it so a write failure can leave crdtHead unadvanced (#235). */
	pendingFlush: Promise<void> | null;
	/** Ownership window for this doc. Ended the instant removeDoc/destroy begins
	 *  (before doc.destroy()), so an in-flight operation that captured this entry
	 *  across an await is ABANDONED rather than resuming onto a dead doc
	 *  (delete-note resurrection). `lifetime.guard(...)` races the await against
	 *  the end; `lifetime.active` is the cheap synchronous check. */
	lifetime: Lifetime;
}

export interface ProviderRegistryOpts {
	dbPrefix?: string;
	/** Transport: base64 frame → wire for `noteId`. False when the socket isn't
	 *  joined (provider buffers + flushes on rejoin). Read the CURRENT socket at
	 *  call time so a reconnect is transparent. `kind` separates peer-vouched
	 *  `"handshake"` traffic from an originated `"op"` so the create-ack gate
	 *  holds ops only. */
	send: (noteId: string, frame: string, kind: FrameKind) => boolean;
	/** Write a REMOTE-merged doc back to disk (echo-suppressed). Returns false /
	 *  throws on a real write failure so applyRemoteUpdate can propagate it. */
	onFlushToDisk: (
		noteId: string,
		content: string,
		/** Did THIS update change the frontmatter block, as opposed to the body?
		 *  The bound-path flush needs it: while a note is open the editor owns
		 *  the body, but nothing in the editor represents frontmatter, so only a
		 *  frontmatter change justifies writing under a live editor. */
		fmChanged: boolean,
	) => Promise<boolean | undefined> | boolean | undefined;
	/** Adopt-first gate: content byte-identical to the last-synced content must
	 *  NOT seed (would fork a second lineage → #846 doubling). */
	isUnchangedSynced?: (noteId: string, content: string) => boolean;
	/** Fired on the first inbound syncStep2 for a note. */
	onSynced?: (noteId: string) => void;
	/** Fired when the first inbound syncStep2 leaves the doc EMPTY — the server's
	 *  authoritative "genuinely empty note" signal (materialize off the handshake,
	 *  #547). */
	onEmptyStep2?: (noteId: string) => void;
	docKind?: (noteId: string) => DocKind;
	onPersistError?: (noteId: string, err: unknown) => void;
	/** Last-synced content for this note — the merge base (#357). Backed by
	 *  `BaseStore`, which already persists exactly this and calls it "the common
	 *  ancestor for 3-way merge". Null when none is recorded (a note that has
	 *  never completed a sync), which falls back to the pre-LCA path. */
	lcaFor?: (noteId: string) => string | null;
	/** Called when a merge could not apply every hunk. The content is still
	 *  written, but the caller may want to record an issue — a dirty merge is the
	 *  honest conflict signal that the two-way diff never produced. */
	onDirtyMerge?: (noteId: string) => void;
}

export class ProviderRegistry {
	private readonly entries = new Map<string, Entry>();
	/** Tombstones for notes torn down via removeDoc (delete). A late fan-out
	 *  update or a stray edit for a deleted note must NOT re-materialize + re-flush
	 *  it (resurrection). A note_id is minted once and never reused, so a permanent
	 *  tombstone is safe; cleared on destroyAll (stack teardown). */
	private readonly removed = new Set<string>();
	private connected = false;
	/** note_ids with an OPEN room — those advertising syncStep1 (the down-sync
	 *  pull). Only enroll/startSync adds; a cold SEND or fan-out RECEIVE never
	 *  does. Mirrors the old CrdtEnrollment.enrolled set; exposed via `enrolled`
	 *  so the e2e introspection (get_enrolled_note_ids) reads it unchanged. */
	private readonly enrolledIds = new Set<string>();

	constructor(private readonly opts: ProviderRegistryOpts) {}

	/** The set of note_ids holding an open CRDT room (STEP1-advertised). Read by
	 *  the e2e `get_enrolled_note_ids` helper — a note absent here is room-free. */
	get enrolled(): Set<string> {
		return this.enrolledIds;
	}

	/** Resident docs by note_id. `.has(id)` is the e2e `is_crdt_doc_resident`
	 *  probe; the persistent-doc model never frees an entry on reconnect, so this
	 *  only drops on a true delete/rename (removeDoc) or unload (destroyAll). */
	get docs(): Map<string, Entry> {
		return this.entries;
	}

	/** note_ids tombstoned by removeDoc. Exposed for the invariant checker, which
	 *  asserts a removed note holds neither a resident doc nor an open room. */
	get removedIds(): ReadonlySet<string> {
		return this.removed;
	}

	/** Wire key == note_id (matches the backend's bare-UUID crdt_msg). */
	docId(noteId: string): string {
		return noteId;
	}

	private storeName(noteId: string): string {
		return this.opts.dbPrefix ? `${this.opts.dbPrefix}/${noteId}` : noteId;
	}

	private project(e: Entry): string {
		if (e.kind === "canvas") return projectCanvas(e.doc);
		const { order, values } = frontmatterOf(e.doc);
		return projectNote(order, values, e.text.toJSON(), rawFrontmatterOf(e.doc));
	}

	/** Relay parity (`Document.isDocumentAlive`): a tombstoned note is dead for
	 *  good — a note_id is minted once and never reused, so this never rejects a
	 *  legitimate access. Cleared only by destroyAll (stack teardown). */
	private assertAlive(noteId: string): void {
		if (this.removed.has(noteId)) throw new NoteDestroyedError(noteId);
	}

	/** Ingest ONLY the frontmatter of a disk read into `noteId`'s doc.
	 *
	 *  The live-bound path (#483 defect 1, outbound half). `sync.ts` skips the
	 *  disk-driven CRDT route entirely while a note is open, so the binding owns
	 *  the body — and the binding drops frontmatter keystrokes, so frontmatter
	 *  typed into an open note reached the doc by no route at all.
	 *
	 *  Awaits `entry()`, never `ensureEntrySync`: writing into a doc that has not
	 *  finished its IndexedDB replay mints ops on an empty doc and forks the
	 *  lineage, which is the trap the pre-handshake seed gate exists for. */
	async ingestFrontmatter(noteId: string, content: string): Promise<void> {
		const e = await this.entry(noteId);
		seedFrontmatterInto(e.doc, content);
	}

	private async entry(noteId: string): Promise<Entry> {
		const e = this.ensureEntrySync(noteId);
		// Guarded, not a bare await: a removeDoc landing DURING IndexedDB
		// hydration abandons this continuation immediately (rejects with
		// NoteDestroyedError) instead of resuming to hand back a dead entry.
		await e.lifetime.guard(e.ready);
		return e;
	}

	/** Synchronously get-or-create the resident entry WITHOUT awaiting IndexedDB
	 *  hydration. The Y.Doc + Y.Text exist immediately (empty until hydrated);
	 *  `entry.ready` resolves once hydration completes and the provider activates.
	 *  Lets the live-editor ViewPlugin bind instantly and paint as the doc loads. */
	private ensureEntrySync(noteId: string): Entry {
		const cached = this.entries.get(noteId);
		if (cached) return cached;
		// Relay's contract (Document.commitDocumentState): a destroyed doc is not
		// re-creatable — touching it throws. This is the ONE choke point where a
		// doc comes into existence, so refusing here makes "a deleted note's room
		// silently rebuilt by a late frame" unrepresentable, rather than something
		// each inbound path has to remember to guard.
		this.assertAlive(noteId);
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(this.storeName(noteId), doc);
		const kind = this.opts.docKind?.(noteId) ?? "note";
		const text = doc.getText(CONTENT_KEY);
		const provider = new NoteProvider(doc, {
			// Start MUTED until IndexedDB replay finishes (activate() below): the
			// replayed persisted state must NOT be re-broadcast as a fresh local edit
			// (it forks the lineage → non-converging storm → the file-switch wedge).
			// syncStep1 on connect advertises the hydrated state instead.
			deferActivation: true,
			// The registry owns NO gate of its own. The create-before-edit gate lives
			// in exactly ONE place — the `send` closure in wiring.ts, which is what
			// production runs and what tests/crdt/wiring.test.ts pins. A duplicate
			// here could silently drift from the shipped one (it did: the suite
			// exercised only the duplicate, so #1130 could regress green).
			send: (frame, kind) => {
				return this.opts.send(noteId, frame, kind);
			},
			onSynced: () => {
				this.opts.onSynced?.(noteId);
				// A first syncStep2 that left the doc empty = the server's "genuinely
				// empty note" signal (materialize off the handshake, #547).
				if (text.length === 0) this.opts.onEmptyStep2?.(noteId);
			},
		});
		persistence.on("error", (err: unknown) => this.opts.onPersistError?.(noteId, err));
		const entry: Entry = {
			doc,
			provider,
			persistence,
			text,
			kind,
			ready: Promise.resolve(),
			remoteSeq: 0,
			lastFlushedFm: null,
			pendingFlush: null,
			lifetime: new Lifetime(),
		};
		// Disk-flush listener: a REMOTE merge (origin === provider from
		// readSyncMessage, or REMOTE from applyRemoteUpdate) writes back to disk.
		// Local edits (editor/default origin) and IndexedDB replay do NOT flush.
		doc.on("update", (_u: Uint8Array, origin: unknown) => {
			if (!entry.lifetime.active) return; // deleted mid-flight — never flush a dead doc
			if (origin !== provider && origin !== REMOTE) return;
			entry.remoteSeq += 1;
			const projected = this.project(entry);
			// Compare the BLOCK against what the last flush projected, not against
			// the editor. The editor is the wrong oracle: in Live Preview the CM
			// document is body-only, so it never carries a fence, and comparing
			// against it reported "frontmatter differs" for EVERY note that has
			// any — turning the bound-path nudge into a direct write under a live
			// editor on Obsidian's default mode.
			const fmBlock = splitFrontmatter(projected).fmBlock;
			const fmChanged = fmBlock !== entry.lastFlushedFm;
			entry.lastFlushedFm = fmBlock;
			const flush = Promise.resolve(
				this.opts.onFlushToDisk(noteId, projected, fmChanged),
			).then((ok) => {
				if (ok === false) throw new Error(`flushFromCrdt write failure for ${noteId}`);
			});
			entry.pendingFlush = flush;
			// Clear pendingFlush once it SETTLES (success or failure) so it only ever
			// reflects an in-flight flush. The room path (readSyncMessage) has no
			// applyRemoteUpdate caller to consume it, so without this a single
			// rejected room-path flush would stay pending forever and poison every
			// later applyLocalEdit's stale-snapshot guard (test_83 poison case).
			// Guarded by identity so a newer flush (or applyRemoteUpdate's null) wins.
			void flush
				.catch(() => undefined)
				.finally(() => {
					if (entry.pendingFlush === flush) entry.pendingFlush = null;
				});
		});
		entry.ready = persistence.whenSynced.then(() => {
			// IndexedDB replay is done: the doc holds the persisted state and the
			// replay updates were dropped (provider was muted). NOW start broadcasting
			// local edits, then connect — setConnected sends syncStep1 (the state
			// vector of the hydrated doc), so the server returns only the diff.
			provider.activate();
			if (this.connected) provider.setConnected(true);
		});
		this.entries.set(noteId, entry);
		return entry;
	}

	/** Sync handle for the live-editor ViewPlugin: the resident Y.Text now (empty
	 *  until hydrated) + a ready promise that resolves after IndexedDB hydration.
	 *  The editor binds immediately and the doc paints in as it loads — Relay's
	 *  async model, where the open never blocks on the doc. */
	residentText(noteId: string): { text: Y.Text; ready: Promise<void> } {
		const e = this.ensureEntrySync(noteId);
		return { text: e.text, ready: e.ready };
	}

	// --- Doc access (editor + sync engine) --------------------------------------

	async getDoc(noteId: string): Promise<Y.Doc> {
		return (await this.entry(noteId)).doc;
	}

	/** Note body as a string (frontmatter excluded) — matches CrdtManager.getText. */
	async getText(noteId: string): Promise<string> {
		return (await this.entry(noteId)).text.toJSON();
	}

	/** Full reconstructed file (frontmatter + body, or canvas JSON). */
	async projectedText(noteId: string): Promise<string> {
		return this.project(await this.entry(noteId));
	}

	/** `projectedText` for an ALREADY-RESIDENT doc, synchronously.
	 *
	 *  Teardown only. `CrdtLiveViews.destroy()` must capture content BEFORE it
	 *  returns, because its caller may destroy the manager immediately after —
	 *  an awaited projection would then run `toJSON()` on a dead doc. Callers
	 *  must gate on `hasDoc(noteId)`: this uses `ensureEntrySync`, which would
	 *  otherwise materialize a fresh EMPTY doc and flush "" over the file. */
	residentProjection(noteId: string): string {
		return this.project(this.ensureEntrySync(noteId));
	}

	async hasHistory(noteId: string): Promise<boolean> {
		const e = await this.entry(noteId);
		return docHasHistory(e.doc, e.kind);
	}

	/** Whole-document (body + frontmatter) history check — see
	 *  `docHasAnyHistory`'s docstring. Only for a raw `Y.applyUpdate` site's own
	 *  history gate (#1409's genesis local-apply); `hasHistory` above stays
	 *  the one every other caller (the `lca` seed-strategy decision) uses. */
	async hasAnyHistory(noteId: string): Promise<boolean> {
		const e = await this.entry(noteId);
		return docHasAnyHistory(e.doc, e.kind);
	}

	/** `hasAnyHistory` that leaves residency exactly as it found it.
	 *
	 *  `entry()` is the choke point where a doc COMES INTO EXISTENCE, and this
	 *  registry has no LRU (see `protect`/`unprotect` below) — a doc is resident
	 *  until an idle hibernate or a delete frees it. That is fine for every
	 *  caller that goes on to USE the doc, and a leak for a caller that only
	 *  wants the predicate: #1409's genesis gate asks this about every note in a
	 *  first sync, so on a large vault the plain `hasAnyHistory` pinned one
	 *  Y.Doc + one open IndexedDB connection PER NOTE and OOM'd the renderer.
	 *
	 *  A doc that was already resident is answered in place and left alone
	 *  (it may be live-bound). One materialized here is torn down with
	 *  `clearData: false`, which frees the doc/provider/IndexedDB handle while
	 *  leaving the persisted bytes untouched — the next `entry()` rehydrates
	 *  the identical state, so this is observationally pure.
	 *
	 *  CALLER CONTRACT: only for a note the caller knows is not live-bound
	 *  (`eligibleForGenesisFrame` checks exactly that before the genesis gate
	 *  calls this). A bind that lands DURING hydration would be torn down here
	 *  — the registry exposes no bind signal to check for, and inventing one
	 *  for a path whose caller already excludes open editors buys nothing. */
	async hasAnyHistoryTransient(noteId: string): Promise<boolean> {
		const wasResident = this.entries.has(noteId);
		const e = await this.entry(noteId);
		const has = docHasAnyHistory(e.doc, e.kind);
		if (!wasResident) await this.destroy(noteId, false);
		return has;
	}

	hasDoc(noteId: string): boolean {
		return this.entries.has(noteId);
	}

	// --- Local edits (disk → doc) -----------------------------------------------

	/** Ingest disk content into the doc (frontmatter + body). Returns the content
	 *  the doc consumed, or null when NOT consumed (caller's REST path owns it).
	 *  Ports CrdtManager.applyLocalEdit: stale-snapshot guard + adopt-first gate +
	 *  the shared seedContentInto codec. */
	async applyLocalEdit(
		noteId: string,
		diskContent: string,
		hasLca?: boolean,
		reread?: () => Promise<string>,
	): Promise<string | null> {
		if (this.removed.has(noteId)) return null; // deleted — don't resurrect
		const e = await this.entry(noteId);
		if (!e.lifetime.active) return null; // destroyed while we awaited hydration
		let content = diskContent;

		// LCA path (#357). With a merge base we apply the disk's delta RELATIVE TO
		// THE BASE, so a remote op that landed after the disk read survives by
		// construction. That removes the reason for the retry loop below: there is
		// no stale-snapshot race left to detect, because we are no longer forcing
		// the doc to equal the snapshot.
		//
		// Gated on the doc HAVING history. A history-less doc holds no remote work
		// for the merge to protect, and routing it here would bypass the adopt-first
		// gate below: `mergeDiskOntoDoc` short-circuits base===disk to the doc's own
		// projection, which for a fresh doc is empty — and the caller records
		// fnv1a(returned) as the last-synced baseline, so an empty return poisons
		// isUnchangedSynced for a note that actually has content (#846 doubling).
		const base = (hasLca ?? docHasHistory(e.doc, e.kind)) ? this.opts.lcaFor?.(noteId) : null;
		if (base !== null && base !== undefined && e.kind === "note") {
			const merged = mergeDiskOntoDoc(base, diskContent, this.project(e));
			if (merged.clean) {
				seedContentInto(e.doc, e.text, merged.text, docHasHistory(e.doc, e.kind));
				return merged.text;
			}
			// Dirty merge: overlapping edits to the same region. Fall through to the
			// pre-LCA path rather than writing content we know is mangled — the
			// existing guards are conservative and will decline rather than revert.
			this.opts.onDirtyMerge?.(noteId);
		}

		// Stale-snapshot revert guard (e2e test_83): diskContent was read before
		// this resolved; a remote merge in that window is absent from it, and
		// diffing would DELETE the remote ops. Re-read across a doc-stable window.
		// Still the path when no base is recorded yet, the doc is a canvas, or the
		// merge came back dirty.
		if (reread) {
			let stable = false;
			for (let attempt = 0; attempt < 3 && !stable; attempt++) {
				const seq = e.remoteSeq;
				let flushOk = true;
				if (e.pendingFlush) {
					try {
						// Guarded: a removeDoc landing mid-flush abandons this edit
						// instead of resuming to seed a destroyed doc.
						await e.lifetime.guard(e.pendingFlush);
					} catch {
						flushOk = false;
					}
				}
				try {
					// Guarded for the same reason — reread() is caller-supplied disk
					// I/O and is exactly where a delete has time to land.
					content = await e.lifetime.guard(reread());
				} catch {
					// Cap-exceeded / unreadable / note destroyed — REST owns it, and a
					// dead doc must never be diffed against stale disk content.
					return null;
				}
				stable = flushOk && e.remoteSeq === seq;
			}
			if (!stable) return null; // live remote storm — skip the stale diff
		}

		const lca = hasLca ?? docHasHistory(e.doc, e.kind);

		// Adopt-first: history-less doc whose disk bytes == last-synced content has
		// nothing local to preserve; leave it empty and let STEP2 populate it on the
		// server's lineage (avoids the #846 doubling). "Consumed, nothing to push".
		if (!lca && this.opts.isUnchangedSynced?.(noteId, content)) return content;

		// `lca` decides the seed strategy — history vs no history — and getting
		// that wrong is the #846 lineage-doubling class.

		if (e.kind === "canvas") {
			return seedCanvasInto(e.doc, content) ? content : null;
		}
		seedContentInto(e.doc, e.text, content, lca);
		return content;
	}

	/** Apply a raw Yjs update (vault-channel fan-out) as a remote merge, awaiting
	 *  its disk flush so a write failure can be surfaced (#235).
	 *
	 *  Returns whether the update actually reached a doc. The two refusals below
	 *  are correct but were INVISIBLE, and two callers read the resolved promise
	 *  as proof of a merge: `adoptServerLineage` then reported "adopted server
	 *  lineage" for a doc that never received it and pushed the body into an
	 *  empty doc — the #476 rival mint — while `convergeColdNoteRoomFree`
	 *  called `markSynced` and recorded a note as converged that had merged
	 *  nothing, so every later catch-up compared equal hashes and skipped it
	 *  forever. A dropped update is not a failure worth throwing over; it just
	 *  cannot be reported as success. */
	async applyRemoteUpdate(noteId: string, update: Uint8Array): Promise<boolean> {
		if (this.removed.has(noteId)) return false; // deleted — a late fan-out must not resurrect
		const e = await this.entry(noteId);
		if (!e.lifetime.active) return false; // destroyed while we awaited hydration
		// Apply with the PROVIDER as origin (NOT a distinct REMOTE symbol): the
		// provider's update handler suppresses its own origin, so a fanned-out update
		// is NOT re-broadcast to the server. Applying it as a foreign origin (the old
		// REMOTE symbol) made the handler re-send every received update -> the server
		// fanned it back -> an infinite echo storm. The disk-flush listener fires for
		// the provider origin too, so the merge still writes to disk. (Relay parity:
		// everything the sync machinery applies uses the provider as origin.)
		Y.applyUpdate(e.doc, update, e.provider);
		const flush = e.pendingFlush;
		if (flush) {
			e.pendingFlush = null;
			await flush;
		}
		return true;
	}

	// --- Yjs encoding helpers (handshake / genesis) -----------------------------

	async encodeStateVector(noteId: string): Promise<Uint8Array> {
		return Y.encodeStateVector((await this.entry(noteId)).doc);
	}

	async encodeStateAsUpdate(noteId: string, sv?: Uint8Array): Promise<Uint8Array> {
		return Y.encodeStateAsUpdate((await this.entry(noteId)).doc, sv);
	}

	/** Encode brand-new content as a standalone genesis update (throwaway doc, no
	 *  persistence / listeners) — byte-identical to a live seed via seedContentInto. */
	encodeGenesisUpdate(content: string, kind: DocKind = "note"): Uint8Array {
		const doc = new Y.Doc();
		try {
			if (kind === "canvas") seedCanvasInto(doc, content);
			else seedContentInto(doc, doc.getText(CONTENT_KEY), content, false);
			return Y.encodeStateAsUpdate(doc);
		} finally {
			doc.destroy();
		}
	}

	/** Create-ack flush: re-attempt the frames the create-gate (the `canSendLive`
	 *  check inside wiring.ts's `send` closure) held while the note had no server
	 *  row, now that it does. This is a SEND, not an enroll — a
	 *  newly-created note stays room-free (no syncStep1) exactly like a cold send;
	 *  it opens a room only when the editor binds it (enroll). setConnected re-runs
	 *  the buffered-frame flush without advertising. */
	async flushHeldState(noteId: string): Promise<void> {
		const e = await this.entry(noteId);
		if (this.connected) e.provider.setConnected(true);
	}

	// --- Sync lifecycle (was CrdtChannel + CrdtEnrollment) ----------------------

	/** Route an inbound wire frame to its provider (creating it if a fan-out
	 *  announced a note this device hasn't opened). */
	async receive(noteId: string, frameB64: string): Promise<void> {
		(await this.entry(noteId)).provider.receive(frameB64);
	}

	/** Enroll: OPEN a room for this note — advertise syncStep1 (the down-sync
	 *  pull) now and on every reconnect. Only open/live-bound notes call this; a
	 *  cold SEND or fan-out RECEIVE stays room-free. (CrdtChannel.startSync +
	 *  CrdtEnrollment.enroll collapse to this.) */
	async startSync(noteId: string): Promise<void> {
		// Liveness FIRST, before any state mutation: a deleted note must not even
		// appear enrolled. Throws NoteDestroyedError (Relay contract) — enroll()
		// below is the fire-and-forget wrapper that absorbs it.
		this.assertAlive(noteId);
		this.enrolledIds.add(noteId);
		const e = await this.entry(noteId);
		e.provider.setAdvertised(true);
		if (this.connected) e.provider.setConnected(true);
	}

	enroll(noteId: string): void {
		if (this.removed.has(noteId)) return; // deleted — nothing to open
		this.enrolledIds.add(noteId); // sync mark so the room shows immediately
		// Fire-and-forget: absorb the destroyed-note rejection (a delete racing an
		// enroll is expected), but let any OTHER failure surface as it did before.
		void this.startSync(noteId).catch((e) => {
			if (!isDestroyedError(e)) throw e;
		});
	}

	/** Close the room: stop advertising syncStep1 on reconnect. SEND/RECEIVE of
	 *  ops still work (the note converges over the fan-out); the server room idles
	 *  out. reset+enroll = a fresh re-handshake. */
	reset(noteId: string): void {
		this.enrolledIds.delete(noteId);
		const e = this.entries.get(noteId);
		if (!e) return;
		e.provider.setAdvertised(false);
		// Invalidate the synced mark so a FOLLOWING re-handshake (enroll) re-fires
		// onSynced when its syncStep2 lands. The provider fires onSynced only on the
		// FIRST syncStep2 of a session; the diverged-cold-note heal (socketConverge
		// = reset+enroll) depends on that fire to run commitCrdtConvergence ->
		// releaseHealRoom, so without clearing it the transient heal room would
		// never release (e2e wait_for_room_free times out). The old CrdtChannel
		// fired convergence on every inbound frame, so this restores that behavior.
		e.provider.synced = false;
	}

	resetSync(noteId: string): void {
		this.reset(noteId);
	}

	resetAll(): void {
		for (const id of [...this.enrolledIds]) this.reset(id);
	}

	/** Socket (re)connected/dropped: fan out to every resident provider. On
	 *  connect each re-advertises via syncStep1 — the reason the doc layer
	 *  outlives the socket. */
	setConnected(connected: boolean): void {
		this.connected = connected;
		for (const e of this.entries.values()) e.provider.setConnected(connected);
	}

	// --- Synced bookkeeping -----------------------------------------------------
	// The provider owns its own `synced` flag (set on syncStep2), so markSynced is
	// a no-op kept for call-surface compatibility; isSynced reads the provider.

	markSynced(noteId: string): void {
		this.opts.onSynced?.(noteId);
	}

	isSynced(noteId: string): boolean {
		return this.entries.get(noteId)?.provider.synced ?? false;
	}

	clearSynced(): void {
		for (const e of this.entries.values()) e.provider.synced = false;
	}

	/** True when the doc holds Yjs pending structs — a delta whose causal deps are
	 *  missing. The syncStep1/2 handshake never leaves this set (it reconciles the
	 *  full state vector), but the vault-fan-out path (applyPushedNoteUpdate)
	 *  applies RAW incremental deltas outside that handshake, so an "incremental
	 *  delta arrived before its base" gap can still occur there. The caller defers
	 *  + fires a re-handshake so syncStep1/2 delivers the base and the pended ops
	 *  integrate (history-less fan-out convergence). */
	async hasPendingGap(noteId: string): Promise<boolean> {
		const e = this.entries.get(noteId);
		if (!e) return false;
		const store = e.doc.store as unknown as { pendingStructs: unknown };
		return store.pendingStructs != null;
	}

	/** True when this doc holds local work the server has NOT received — the
	 *  handshake never completed, or frames sit in the provider's offline
	 *  buffer. The positive signal a destructive path needs before deciding
	 *  whether tearing the room down would lose anything.
	 *
	 *  NOT `hasPendingGap`: that is a RECEIVE-side causal gap (a delta landed
	 *  before its base), which says nothing about undelivered local edits.
	 *  NOT `!isFullySynced` either — that also demands a CURRENTLY-connected
	 *  transport, so a plain offline window would read as data-at-risk.
	 *
	 *  No resident entry → false: nothing is held locally, so nothing is at risk.
	 *  Conservative by construction — a never-handshook doc reads as
	 *  undelivered, so a caller preserving data errs toward preserving it. */
	hasUndeliveredOps(noteId: string): boolean {
		const e = this.entries.get(noteId);
		if (!e?.lifetime.active) return false;
		return e.provider.hasUndeliveredWork();
	}

	// --- Lifecycle no-ops the persistent doc doesn't need -----------------------

	/** Relay: the doc is NEVER closed on a transport reconnect (that was the
	 *  re-mint/re-push doubling). */
	/** Idle eviction: free the Y.Doc + provider + its open IndexedDB connection
	 *  WITHOUT clearing the persisted data, so ensureEntrySync rehydrates the full
	 *  prior state on next access (no data loss, no re-push doubling). Best-effort +
	 *  fire-and-forget: the caller (hibernateIfIdle) guards on !isLiveBound, so this
	 *  never frees a doc an editor is bound to. Bounds memory over a long session /
	 *  bulk cold-delta catch-up (the previously-neutered hibernate contract).
	 *
	 *  Evicts ONLY a fully-synced doc (provider.isFullySynced): a doc with unsent
	 *  offline edits, or one that never handshook, stays resident so a reconnect
	 *  re-advertises it — evicting such a doc would reintroduce the switch-away
	 *  data-loss class ("moving between files, only some make it"). */
	closeDoc(noteId: string): void {
		const e = this.entries.get(noteId);
		if (e?.lifetime.active && e.provider.isFullySynced()) void this.destroy(noteId, false);
	}

	/** No LRU eviction — the doc is persistent; protect/unprotect are no-ops. */
	protect(_noteId: string): void {}
	unprotect(_noteId: string): void {}

	/** No structural flatten — Relay's syncStep1 diff keeps the wire bounded
	 *  without re-pushing full state. */
	async flattenIfBloated(_noteId: string): Promise<boolean> {
		return false;
	}

	// --- True teardown (delete / rename / unload) -------------------------------

	async removeDoc(noteId: string): Promise<void> {
		this.removed.add(noteId); // tombstone: block any resurrection of a deleted note
		await this.destroy(noteId, true);
	}

	private async destroy(noteId: string, clearData: boolean): Promise<void> {
		// A destroyed doc has no room: clearing here (the choke point) upholds
		// removed-implies-not-enrolled without every caller pairing removeDoc
		// with reset() by hand — one missed pair left a tombstoned id enrolled
		// forever (invariant WARN every sweep, lying e2e `enrolled` probe).
		this.enrolledIds.delete(noteId);
		const e = this.entries.get(noteId);
		// End BEFORE any await so in-flight ops are abandoned, not merely checked.
		if (e) e.lifetime.end(new NoteDestroyedError(noteId));
		if (!e) {
			if (clearData) {
				await new Promise<void>((resolve) => {
					const req = indexedDB.deleteDatabase(this.storeName(noteId));
					req.onsuccess = req.onerror = req.onblocked = () => resolve();
				});
			}
			return;
		}
		this.entries.delete(noteId);
		e.provider.destroy();
		e.doc.destroy();
		if (clearData) await e.persistence.clearData();
		await e.persistence.destroy();
	}

	async destroyAll(): Promise<void> {
		for (const noteId of [...this.entries.keys()]) await this.destroy(noteId, false);
		this.removed.clear(); // fresh stack — tombstones do not outlive a teardown
		// Enrollments for never-materialized docs (enroll raced a teardown) have
		// no entries key above; a fresh stack starts with none either way.
		this.enrolledIds.clear();
	}
}
