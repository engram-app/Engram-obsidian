// The provider-model engine: one persistent NoteProvider (+ IndexeddbPersistence)
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
import { fnv1a } from "../content-hash";
import { Lifetime } from "../lifetime";
import { seedCanvasInto } from "./canvas-codec";
import { isDestroyedError, NoteDestroyedError } from "./destroyed-error";
import type { DiscoveryBaseStore } from "./discovery-base-store";
import { CONTENT_KEY, splitFrontmatter } from "./frontmatter-codec";
import { decideReplay } from "./ingest-gate";
import { merge3, mergeDiskOntoDoc, overwritesConcurrentEdit } from "./lca-merge";
import { type FrameKind, NoteProvider } from "./note-provider";
import {
	docHasAnyHistory,
	docHasHistory,
	projectDoc,
	seedContentInto,
	seedFrontmatterInto,
} from "./note-seed";
import { type PendingEntry, PendingIngestStore } from "./pending-ingest-store";
import { canonText } from "./root-clients";

export type DocKind = "note" | "canvas";

export type IngestInput = {
	text: string;
	base: string | null;
	source: PendingEntry["source"];
	reread?: () => Promise<string>;
};
export type IngestResult = { consumed: string } | { pending: true };

/** Replay passes before a note that keeps moving is left pending. */
const MAX_REPLAY_PASSES = 3;

/** Applied to remote merges so the provider suppresses re-send AND the registry
 *  flush listener writes them to disk. The NoteProvider stamps itself as the
 *  origin on readSyncMessage; a raw applyRemoteUpdate (vault-channel fan-out)
 *  uses this shared marker so the same listener fires. */
const REMOTE = Symbol("remote");

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

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
	/** Snapshot (state vector + delete set) the server last ACKED over
	 *  `crdt_doc_update` (#1493). The upward half of `synced`, which the
	 *  room-free write earns and the handshake flag cannot express. A snapshot
	 *  rather than a vector because a vector cannot see deletions. Undefined
	 *  until a delivery is acked. */
	deliveredReceipt?: Uint8Array;
	/** In-flight disk-flush from the last remote merge; applyRemoteUpdate awaits
	 *  it so a write failure can leave crdtHead unadvanced (#235). */
	pendingFlush: Promise<void> | null;
	/** Ownership window for this doc. Ended the instant removeDoc/destroy begins
	 *  (before doc.destroy()), so an in-flight operation that captured this entry
	 *  across an await is ABANDONED rather than resuming onto a dead doc
	 *  (delete-note resurrection). `lifetime.guard(...)` races the await against
	 *  the end; `lifetime.active` is the cheap synchronous check. */
	lifetime: Lifetime;
	/** In-flight onLineage replay, so arrivals that land mid-replay join it. */
	replay: Promise<void> | null;
	/** The first STEP2 left the doc empty: the server holds no lineage to
	 *  rival, so a pending edit may replay onto the empty doc. */
	serverEmpty: boolean;
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
	/** Called when a merge reported clean but the disk edit overwrote a
	 *  concurrent edit already in the doc (`overwritesConcurrentEdit`): the
	 *  doc's side is silently dropped. Measurement only; behaviour unchanged. */
	onLossyMerge?: (noteId: string) => void;
	/** @deprecated Task 5 wires `baselineHash` and drops this. Kept so the
	 *  unchanged-content shortcut in `ingest` works until then. */
	isUnchangedSynced?: (noteId: string, content: string) => boolean;

	// --- Single ingest gate --------------------------------------------------
	// Every option below may be absent; each default FAILS CLOSED (waits),
	// never seeds.

	/** Does the server hold this note? Absent = every note is server-known. */
	isServerKnown?: (noteId: string) => boolean;
	/** fnv1a of the content last synced for this note (the syncState hash). */
	baselineHash?: (noteId: string) => number | undefined;
	/** Durable queue of edits waiting for the server lineage. Default: in memory. */
	pending?: PendingIngestStore;
	/** Catch-up's body for a note: the replay base when the entry has none. */
	discoveryBase?: DiscoveryBaseStore;
	/** Ask the engine to fetch the server's lineage for this note. */
	requestLineage?: (noteId: string) => void;
	/** Keep-both: write `text` beside the note. Absent = cannot, so stay pending. */
	writeConflictCopy?: (noteId: string, text: string) => Promise<boolean>;
	/** The note's current disk text; the replay input when it is not bound. */
	readDisk?: (noteId: string) => Promise<string | null>;
	/** The bound editor's full text, or null when the note is not open. */
	editorText?: (noteId: string) => string | null;
	/** Repaint the bound editor after a replay. */
	paintEditor?: (noteId: string, text: string) => void;
	/** Path and vault stamped on a pending entry. */
	pathFor?: (noteId: string) => string | undefined;
	vaultId?: string;
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

	private readonly pending: PendingIngestStore;

	constructor(private readonly opts: ProviderRegistryOpts) {
		this.pending =
			opts.pending ??
			new PendingIngestStore(
				() => [],
				async () => {},
			);
	}

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
		return projectDoc(e.doc, e.kind);
	}

	/** Liveness: a tombstoned note is dead for
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
		// Frontmatter is local text too: an awaiting note queues it like a body
		// edit (the ORDER_KEY insert into a history-less doc doubles on merge).
		if (this.isAwaiting(noteId, e)) {
			await this.enqueue(noteId, e, {
				text: content,
				base: this.opts.lcaFor?.(noteId) ?? null,
				source: "disk",
			});
			return;
		}
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
		// The contract: a destroyed doc is not
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
				// Lineage arrival via the first STEP2 (the update handler below
				// already kicked it; this joins the same replay). An empty STEP2
				// is the server's word that it holds nothing to rival.
				if (!docHasAnyHistory(doc, kind)) entry.serverEmpty = true;
				void this.kickReplay(noteId, entry);
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
			replay: null,
			serverEmpty: false,
		};
		// Disk-flush listener: a REMOTE merge (origin === provider from
		// readSyncMessage, or REMOTE from applyRemoteUpdate) writes back to disk.
		// Local edits (editor/default origin) and IndexedDB replay do NOT flush.
		doc.on("update", (_u: Uint8Array, origin: unknown) => {
			if (!entry.lifetime.active) return; // deleted mid-flight — never flush a dead doc
			if (origin !== provider && origin !== REMOTE) return;
			entry.remoteSeq += 1;
			// A pending local edit is still only on disk: flushing S here would
			// overwrite it. The replay writes the merged result instead.
			if (this.pending.get(noteId)) {
				void this.kickReplay(noteId, entry);
				return;
			}
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
			// Lineage arrival via IndexedDB: the doc already held history.
			void this.kickReplay(noteId, entry);
		});
		this.entries.set(noteId, entry);
		return entry;
	}

	/** Sync handle for the live-editor ViewPlugin: the resident Y.Text now (empty
	 *  until hydrated) + a ready promise that resolves after IndexedDB hydration.
	 *  The editor binds immediately and the doc paints in as it loads — the async
	 *  model, where the open never blocks on the doc. */
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

	/** The ONE way local text enters a note's doc.
	 *
	 *  - local (the server does not hold the note): seed, as before.
	 *  - live (the doc holds history): LCA merge / stale-snapshot diff.
	 *  - awaiting (server-known and history-less, or an entry already
	 *    pending): queue a durable pending entry, ask for the lineage, return
	 *    pending. No text enters the doc until `onLineage` replays it as a diff
	 *    on top of the server's lineage. There is no fallback to seeding.
	 *
	 *  Throws NoteDestroyedError for a deleted note. */
	async ingest(noteId: string, input: IngestInput): Promise<IngestResult> {
		this.assertAlive(noteId);
		const e = await this.entry(noteId);
		if (!e.lifetime.active) throw new NoteDestroyedError(noteId);
		if (this.isAwaiting(noteId, e)) return this.enqueue(noteId, e, input);
		const r = await this.ingestLive(noteId, e, input, undefined);
		// Declined (remote storm, unreadable reread, unparseable canvas): the doc
		// has history, so the replay path is a safe retry.
		return r ?? this.enqueue(noteId, e, input);
	}

	/** @deprecated Shim over the gate for sync.ts/main.ts until Task 5: the
	 *  consumed text, or null when pending/declined (main's decline semantics). */
	async applyLocalEdit(
		noteId: string,
		diskContent: string,
		hasLca?: boolean,
		reread?: () => Promise<string>,
	): Promise<string | null> {
		if (this.removed.has(noteId)) return null; // deleted — don't resurrect
		try {
			const e = await this.entry(noteId);
			if (!e.lifetime.active) return null;
			const input: IngestInput = {
				text: diskContent,
				base: this.opts.lcaFor?.(noteId) ?? null,
				source: "disk",
				reread,
			};
			const r = this.isAwaiting(noteId, e)
				? await this.enqueue(noteId, e, input)
				: await this.ingestLive(noteId, e, input, hasLca);
			return r && "consumed" in r ? r.consumed : null;
		} catch (err) {
			if (isDestroyedError(err)) return null;
			throw err;
		}
	}

	/** Server-known and history-less, or already waiting. A pending entry keeps
	 *  the note awaiting even after the doc gains history, until replay ends. */
	private isAwaiting(noteId: string, e: Entry): boolean {
		if (this.pending.get(noteId)) return true;
		return !docHasAnyHistory(e.doc, e.kind) && (this.opts.isServerKnown?.(noteId) ?? true);
	}

	private async enqueue(noteId: string, e: Entry, input: IngestInput): Promise<IngestResult> {
		const prior = this.pending.get(noteId);
		// Byte-identical to what was last synced: nothing local to preserve.
		if (!prior && this.isUnchanged(noteId, input.text)) return { consumed: input.text };
		const put = this.pending.put({
			noteId,
			path: this.opts.pathFor?.(noteId) ?? "",
			vaultId: this.opts.vaultId ?? "",
			base: input.base,
			baseHash: input.base === null ? null : fnv1a(input.base),
			enqueuedAt: Date.now(),
			source: input.source,
			text:
				input.source === "editor" || input.source === "migration" ? input.text : undefined,
		});
		// put() set the entry synchronously, so an arrival from here on replays it.
		// Already holding the lineage (a refused replay, a declined live edit):
		// replay now. Otherwise ask for it, once per entry.
		if (this.hasLineage(e)) void this.kickReplay(noteId, e);
		else if (!prior) this.opts.requestLineage?.(noteId);
		await put;
		return { pending: true };
	}

	private isUnchanged(noteId: string, text: string): boolean {
		const h = this.opts.baselineHash?.(noteId);
		if (h !== undefined) return h === fnv1a(text);
		return this.opts.isUnchangedSynced?.(noteId, text) ?? false;
	}

	/** The local and live paths. Null = declined, nothing written. */
	private async ingestLive(
		noteId: string,
		e: Entry,
		input: IngestInput,
		hasLca: boolean | undefined,
	): Promise<IngestResult | null> {
		const diskContent = input.text;
		const reread = input.reread;
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
			const current = this.project(e);
			const merged = mergeDiskOntoDoc(base, diskContent, current);
			if (merged.clean) {
				if (overwritesConcurrentEdit(base, diskContent, current)) {
					this.opts.onLossyMerge?.(noteId);
				}
				seedContentInto(e.doc, e.text, merged.text, docHasHistory(e.doc, e.kind));
				return { consumed: merged.text };
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

		// The reread awaited: the note may have become awaiting meanwhile (a
		// create-ack made it server-known, or another ingest queued it).
		if (this.isAwaiting(noteId, e)) return this.enqueue(noteId, e, { ...input, text: content });

		// `lca` decides the seed strategy — history vs no history — and getting
		// that wrong is the #846 lineage-doubling class. A history-less doc here
		// is a local note the server does not hold, so seeding is correct.
		const lca = hasLca ?? docHasHistory(e.doc, e.kind);
		if (e.kind === "canvas") {
			return seedCanvasInto(e.doc, content) ? { consumed: content } : null;
		}
		seedContentInto(e.doc, e.text, content, lca);
		return { consumed: content };
	}

	// --- onLineage replay -------------------------------------------------------

	/** onLineage: start (or join) the replay of `noteId`'s pending edit, if it
	 *  has one and its doc now holds the server lineage. Never rejects: a failed
	 *  replay leaves the entry pending and asks for the lineage again. */
	private kickReplay(noteId: string, e: Entry): Promise<void> {
		if (e.replay) return e.replay;
		if (!e.lifetime.active || !this.pending.get(noteId) || !this.hasLineage(e)) {
			return Promise.resolve();
		}
		const run: Promise<void> = this.replay(noteId, e)
			.catch((err) => {
				if (!isDestroyedError(err)) this.opts.requestLineage?.(noteId);
			})
			.finally(() => {
				if (e.replay === run) e.replay = null;
			});
		e.replay = run;
		return run;
	}

	/** Replay the pending edit T onto the server state S now in the doc.
	 *  Disk is written BEFORE the doc is touched; a refused write leaves the
	 *  entry pending and the doc holding only S. A bound note runs
	 *  editorText -> decide -> diff -> paint with no await in between. */
	private async replay(noteId: string, e: Entry): Promise<void> {
		// Leave the Yjs update handler that kicked us before writing the doc.
		await Promise.resolve();
		// After a pass that wrote `out` to disk and doc, `out` is the base.
		let settled: string | null = null;
		for (let pass = 0; pass < MAX_REPLAY_PASSES; pass++) {
			const p = this.pending.get(noteId);
			if (!p || !e.lifetime.active || !this.hasLineage(e)) return;
			const base =
				settled ?? p.base ?? (await e.lifetime.guard(this.discoveryBaseFor(noteId)));
			const editor = this.opts.editorText?.(noteId) ?? null;

			if (editor === null) {
				const T = p.text ?? (await e.lifetime.guard(this.readDisk(noteId)));
				if (T === null) break; // nothing readable to replay: stay pending
				if ((this.opts.editorText?.(noteId) ?? null) !== null) continue; // bound meanwhile
				const S = this.project(e);
				const d = this.decide(noteId, e, S, T, base);
				const out = d.kind === "apply" ? d.text : S;
				if (d.kind === "keep-both" && !(await this.writeCopy(e, noteId, T))) break;
				if (!(await this.flushReplay(e, noteId, out))) break;
				if (this.pending.get(noteId) !== p || !e.lifetime.active) continue;
				if (this.project(e) !== S) {
					// The doc moved during the write. Disk holds `out`, derived from S,
					// so S is the base for the next pass.
					if (p.text === undefined) settled = S;
					continue;
				}
				this.writeInto(e, out);
				if (p.text === undefined) {
					// Re-read: an edit made during the write must not be dropped.
					const now = await e.lifetime.guard(this.readDisk(noteId));
					if (now !== out || this.project(e) !== out || this.pending.get(noteId) !== p) {
						settled = out;
						continue;
					}
				}
				await this.finishReplay(noteId);
				return;
			}

			// Bound: the editor holds T, and Obsidian's own save writes disk after
			// the paint.
			const S = this.project(e);
			const d = this.decide(noteId, e, S, editor, base);
			if (d.kind === "keep-both") {
				if (!(await this.writeCopy(e, noteId, editor))) break;
				if (this.opts.editorText?.(noteId) !== editor || this.project(e) !== S) continue;
				if (this.pending.get(noteId) !== p || !e.lifetime.active) continue;
				this.opts.paintEditor?.(noteId, S);
			} else {
				this.writeInto(e, d.text);
				this.opts.paintEditor?.(noteId, d.text);
			}
			await this.finishReplay(noteId);
			return;
		}
		// Refused, unreadable, or still moving after MAX_REPLAY_PASSES.
		this.opts.requestLineage?.(noteId);
	}

	/** The doc holds the server's lineage, or the server said it has none.
	 *  "Empty" is trusted only for the session that heard it: it expires with
	 *  the synced mark (reset / clearSynced) and on disconnect. */
	private hasLineage(e: Entry): boolean {
		return docHasAnyHistory(e.doc, e.kind) || (e.serverEmpty && e.provider.synced);
	}

	private decide(noteId: string, e: Entry, server: string, text: string, base: string | null) {
		return decideReplay(
			{ server, text, base, baselineHash: this.opts.baselineHash?.(noteId), kind: e.kind },
			(t) => canonText(t, e.kind),
		);
	}

	/** Diff replayed text into the doc as a LOCAL edit on top of the lineage. */
	private writeInto(e: Entry, text: string): void {
		if (e.kind === "canvas") seedCanvasInto(e.doc, text);
		else seedContentInto(e.doc, e.text, text, true);
	}

	private async discoveryBaseFor(noteId: string): Promise<string | null> {
		try {
			return (await this.opts.discoveryBase?.get(noteId)) ?? null;
		} catch {
			// Unreadable base = no provable base: decideReplay keeps both rather
			// than guessing, so this can only cost a conflict copy.
			return null;
		}
	}

	private async readDisk(noteId: string): Promise<string | null> {
		return (await this.opts.readDisk?.(noteId)) ?? null;
	}

	/** False on a refused or failed write; the caller stays pending. */
	private async flushReplay(e: Entry, noteId: string, out: string): Promise<boolean> {
		const fm = splitFrontmatter(out).fmBlock;
		try {
			const ok = await e.lifetime.guard(
				Promise.resolve(this.opts.onFlushToDisk(noteId, out, fm !== e.lastFlushedFm)),
			);
			if (ok === false) return false;
		} catch (err) {
			if (isDestroyedError(err)) throw err;
			return false;
		}
		e.lastFlushedFm = fm;
		return true;
	}

	private async writeCopy(e: Entry, noteId: string, text: string): Promise<boolean> {
		const write = this.opts.writeConflictCopy;
		if (!write) return false; // cannot keep both: stay pending
		try {
			return (await e.lifetime.guard(write(noteId, text))) === true;
		} catch (err) {
			if (isDestroyedError(err)) throw err;
			return false;
		}
	}

	private async finishReplay(noteId: string): Promise<void> {
		await this.pending.delete(noteId);
		await this.opts.discoveryBase?.delete(noteId);
	}

	/** Merge a disk edit made FROM `base` onto the doc, with no await between
	 *  the check and the seed. The doc must still project `expected` (what the
	 *  caller just applied); if a fan-out or autosave moved it since, return
	 *  null so the caller keeps both rather than merging against a doc it never
	 *  saw. Otherwise `merge3(base, disk, doc)`; `base === expected` is the
	 *  fast-forward and seeds `disk` as a minimal diff. Overlapping edits are
	 *  null too. `force` skips both refusals, possibly dirty or duplicated, for
	 *  when no copy can be written. Null when the note is gone or not a note. */
	async mergeLocalEditFromBase(
		noteId: string,
		base: string,
		expected: string,
		disk: string,
		force = false,
	): Promise<string | null> {
		if (this.removed.has(noteId)) return null;
		const e = await this.entry(noteId);
		if (!e.lifetime.active || e.kind !== "note") return null;
		// Never seed blind, even forced: a history-less doc of a server-known
		// note means the lineage did not land.
		if (!docHasAnyHistory(e.doc, e.kind) && (this.opts.isServerKnown?.(noteId) ?? true)) {
			return null;
		}
		const current = this.project(e);
		if (current !== expected && !force) return null;
		const merged = merge3(base, disk, current);
		if (!merged.clean && !force) return null;
		// Forced past a conflict: merge3 returns `current` untouched, so fall to
		// the fuzzy patch, which at least lands the disk edit.
		const text = merged.clean ? merged.text : mergeDiskOntoDoc(base, disk, current).text;
		seedContentInto(e.doc, e.text, text, true);
		return text;
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
		// the provider origin too, so the merge still writes to disk. (Invariant:
		// everything the sync machinery applies uses the provider as origin.)
		Y.applyUpdate(e.doc, update, e.provider);
		// A pending edit's replay stands in for the flush. It never rejects: a
		// refused write leaves the entry pending, which is the durable record.
		if (e.replay) await e.replay;
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

	/** The receipt for a room-free delivery (`markDelivered`) — a SNAPSHOT, which
	 *  is the state vector PLUS the delete set.
	 *
	 *  Not `encodeStateVector`, and this is the whole correctness argument. A
	 *  state vector encodes `clientID -> clock` of structs a client CREATED;
	 *  deletions advance no clock, so `Y.Text.delete` leaves it byte-identical
	 *  (measured). That is why `encodeStateAsUpdate` ships the full delete set
	 *  regardless of the vector handed to it. Using a vector as a completeness
	 *  receipt inherits the blindness: a delete-only edit after a delivery reads
	 *  as still-covered, the note takes the read-only converge path, and the
	 *  deletion is stamped in-sync and never transmitted. A snapshot flips on a
	 *  pure delete (also measured), so any local mutation invalidates it — which
	 *  is also the receipt's expiry, since nothing else clears it.
	 *
	 *  Capture it BEFORE the state you send, never after: taken first, the update
	 *  that follows is a superset, so an edit landing between the two makes the
	 *  receipt UNDER-claim (one wasted room). Taken after, it would cover an op
	 *  that was never sent, and strand it silently. */
	async encodeDeliveryReceipt(noteId: string): Promise<Uint8Array> {
		return Y.encodeSnapshot(Y.snapshot((await this.entry(noteId)).doc));
	}

	async encodeStateAsUpdate(noteId: string, sv?: Uint8Array): Promise<Uint8Array> {
		return Y.encodeStateAsUpdate((await this.entry(noteId)).doc, sv);
	}

	/** Record that the server acknowledged everything `sv` describes.
	 *
	 *  This is the UPWARD half of what `synced` means, on its own. It must never
	 *  touch `synced` or fire `onSynced`: those carry the DOWNWARD claim (we hold
	 *  the server's state), which a room-free write never earns, and committing
	 *  convergence on it is the deaf-note class.
	 *
	 *  `receipt` must come from `encodeDeliveryReceipt`, captured before the
	 *  state was encoded. Any local mutation invalidates it, and a remote one
	 *  does too (conservatively — an inbound edit needs no sending back, but it
	 *  moves the snapshot, so the note pays one room). Eviction also drops it
	 *  with the entry: a receipt-bearing note is an ordinary resident doc, and
	 *  opening it in the editor enrolls it, so a syncStep2 can set `synced` and
	 *  make it evictable. Every one of those is the safe direction. */
	markDelivered(noteId: string, receipt: Uint8Array): void {
		const e = this.entries.get(noteId);
		if (!e?.lifetime.active) return;
		e.deliveredReceipt = receipt;
	}

	/** The state vector of the last ACKED delivery: a lower bound of what the
	 *  server holds, so `encodeStateAsUpdate(noteId, it)` carries only what the
	 *  server can lack. This is syncStep2's rule (diff against the peer's
	 *  vector), with the handshake's advertised vector replaced by the one the
	 *  ack proved. The diff still ships the FULL delete set, so the vector's
	 *  blindness to deletions loses nothing here.
	 *
	 *  Undefined when no delivery was acked on this entry (first push, a doc
	 *  rehydrated after eviction, a reload): send the full state.
	 *
	 *  A server that DROPS a lineage it acked (the checkpoint flatten, a lost
	 *  doc) cannot apply the diff. Backend 0.59.0 refuses it, the refusal
	 *  calls `clearDelivered`, and the retry is full state; older backends ack
	 *  it unapplied, so SyncEngine only diffs once the server is known to be
	 *  >= 0.59.0 (`docUpdateDiffs`). */
	deliveredStateVector(noteId: string): Uint8Array | undefined {
		const e = this.entries.get(noteId);
		if (!e?.lifetime.active || !e.deliveredReceipt) return undefined;
		return Y.encodeStateVector(Y.decodeSnapshot(e.deliveredReceipt).sv);
	}

	/** Forget the acked delivery: a refused write may mean the server lacks the
	 *  base, so the next push falls back to the full state. Also voids the
	 *  receipt for `hasCurrentDeliveryReceipt`, which costs at most a room. */
	clearDelivered(noteId: string): void {
		const e = this.entries.get(noteId);
		if (e) e.deliveredReceipt = undefined;
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
		// appear enrolled. Throws NoteDestroyedError — enroll()
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
		for (const e of this.entries.values()) {
			if (!connected) e.serverEmpty = false;
			e.provider.setConnected(connected);
		}
	}

	// --- Synced bookkeeping -----------------------------------------------------
	// `markSynced` is NOT the setter for `isSynced` and never has been, whatever
	// the pairing suggests: `synced` is the provider's own flag, set on syncStep2,
	// and `isSynced` reads it. What `markSynced` does is fire `onSynced` ->
	// `commitCrdtConvergence`, which COMMITS a staged catch-up episode. That makes
	// it valid only for a caller that has already APPLIED the server's state
	// (`convergeColdNoteRoomFree`), and wrong for one that merely delivered its
	// own (see the note at the room-free write in `sync.ts`). Calling it "a no-op
	// kept for call-surface compatibility" — as this comment used to — is what
	// makes it look safe to call, or safe to delete.

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
	/** What `update` alone reconstructs for `noteId`, on a scratch doc that
	 *  touches nothing: the projected text, or null when it pends (an
	 *  incremental delta with no causal base). Lets a caller decide how to
	 *  apply an update BEFORE the apply's disk flush runs. */
	async previewUpdate(noteId: string, update: Uint8Array): Promise<string | null> {
		const e = await this.entry(noteId);
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, update);
			if ((doc.store as unknown as { pendingStructs: unknown }).pendingStructs != null) {
				return null;
			}
			return this.project({ ...e, doc, text: doc.getText(CONTENT_KEY) });
		} finally {
			doc.destroy();
		}
	}

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

	/** Whether a room-free delivery receipt still covers everything this doc
	 *  holds (#1493) — the UPWARD half of `synced`, which a `crdt_doc_update`
	 *  earns and the handshake flag cannot express.
	 *
	 *  SEPARATE from `hasUndeliveredOps` on purpose, rather than folded into it.
	 *  That predicate has three callers and two are DESTRUCTIVE: it is what
	 *  decides whether a drift teardown keeps a conflict copy, and whether an
	 *  empty placeholder may be overwritten wholesale. For those "would tearing
	 *  this down destroy something" is the question, and a receipt does not
	 *  answer it — the doc still holds the only copy of state the room path
	 *  would need to re-advertise. Only the room-free READ gate may consult
	 *  this, so relaxing it can cost a wasted room and never a file.
	 *
	 *  A buffered frame vetoes the receipt: `buffer.length > 0` is a hard fact
	 *  about frames that never reached the transport, not a handshake proxy. */
	hasCurrentDeliveryReceipt(noteId: string): boolean {
		const e = this.entries.get(noteId);
		if (!e?.lifetime.active || !e.deliveredReceipt) return false;
		if (e.provider.hasBufferedFrames()) return false;
		return eqBytes(Y.encodeSnapshot(Y.snapshot(e.doc)), e.deliveredReceipt);
	}

	// --- Lifecycle no-ops the persistent doc doesn't need -----------------------

	/** The doc is NEVER closed on a transport reconnect (that was the
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

	/** No structural flatten — the syncStep1 diff keeps the wire bounded
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
