// tests/sim/model-server.ts
//
// ============================================================================
// THIS IS A **MODEL** OF THE ELIXIR BACKEND.
//
// It exists to test CLIENT logic (a real SyncEngine + NoteChannel driven by the
// sim tier). It must NEVER be cited as evidence of SERVER correctness. Server-
// side #285-class bugs (non-transactional diffIntoYText, stale-snapshot revert
// races, adopt-collision two-lineage merges) live in the REAL server and are
// covered by the P2 server-property tier plan
// (docs/superpowers/plans/2026-07-22-server-property-headless-tier.md).
//
// DIVERGENCES FROM THE REAL BACKEND (T1 disclosure):
//   1. HEAD DERIVATION. `head = base64(Y.encodeStateVector(doc))`. The real
//      backend hashes the encoded doc STATE with a keyed HMAC. The model head is
//      an unkeyed base64 of the CRDT state vector. Contract kept: it changes iff
//      the set of integrated ops changes (i.e. iff the doc state changes), and
//      two docs that converged on the same op-set share a head. It is NOT a
//      content digest — two independently authored identical bodies (different
//      client clocks) can show different heads. Fine for the sim: heads are
//      keyed per note_id and only compared for a single note's own before/after.
//   2. REST MERGE. POST /notes replaces the body Y.Text transactionally (full
//      delete+insert). The real backend does a character-level diffIntoYText to
//      preserve concurrent edits — reproducing THAT (and its bugs) is the P2
//      tier's job, not this model's.
//   3. FAN-OUT. Every content change fans out as ONE `note_yjs_update` (the
//      modern CRDT path). The model does NOT emit `note_changed` / `notes.batch`
//      (the real backend emits those on the legacy REST fastlane). The sim's
//      client is CRDT-enabled, so it converges on the yjs-update path.
//   4. SCOPE. Only the note + CRDT convergence surface is implemented (see the
//      route table in `http`). Attachments, search, vaults, folders, /me plan
//      state, and per-crdt_msg acks are out of scope (the client does not need
//      them to converge markdown notes); unknown routes return 404.
//   5. BODY ONLY. The server Y.Doc tracks only the body Y.Text (CONTENT_KEY);
//      the frontmatter map/order shared types are ignored.
//   6. FOLDERS (Engram#2523 S4). Folder rows are modeled only far enough to
//      test the plugin's folder-op protocol: ids, parent/name, `folder_op`
//      move/create with the conflict/cycle/not_found refusals, the S3 staging
//      cascade (per-note `note_changed` moves, toggled by `cascadeBroadcasts`),
//      `folder_changed`, and the manifest `folders` list. A `crdt_create` for a
//      LIVE id at a new path relocates it (genesis_relocate_live) with the
//      same upsert-new-then-delete-old broadcast pair the real backend sends.
// ============================================================================
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
// Import the SAME encode helpers the real client uses, so a frame the model
// builds is byte-identical to one NoteChannel/CrdtChannel would.
import { toB64 } from "../../src/crdt/wire";
import type { Scheduler } from "./scheduler";

/** y-protocols outer message-type tag — mirrors crdt/channel.ts MESSAGE_SYNC. */
const MESSAGE_SYNC = 0;
/** Y.Doc body text key — mirrors src/crdt/manager.ts CONTENT_KEY. */
const CONTENT_KEY = "content";
/** Transaction origin for server-applied ops, so the doc `update` listener can
 *  tell an apply-from-client update apart and fan it out. */
const APPLY_ORIGIN = Symbol("model-server-apply");

/** A Phoenix-v2 wire frame: [join_ref, ref, topic, event, payload]. */
type Frame = [string | null, string | null, string, string, Record<string, unknown>];

/** The socket a Replica (Task 5) adapts to a WebSocket. Client→server via
 *  `send`; server→client via `onmessage` (routed through the scheduler). */
export interface SimSocket {
	readonly clientId: string;
	/** Client → server: a serialized Phoenix-v2 frame (JSON array string). */
	send(raw: string): void;
	/** Server → client sink, set by the adapter. Receives serialized frames. */
	onmessage: ((raw: string) => void) | null;
	close(): void;
}

/** A requestUrl-shaped request. `body` is a JSON string (as src/api.ts sends). */
export interface SimRequest {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string;
}

/** A requestUrl-shaped response. The Task-5 requestUrl handler maps a non-2xx
 *  status to a thrown error (Obsidian's default throw-on-4xx/5xx behaviour). */
export interface SimResponse {
	status: number;
	json: unknown;
	text: string;
}

interface Note {
	id: string;
	path: string;
	doc: Y.Doc;
	version: number;
	seq: number;
	deleted: boolean;
	createdAt: string;
	updatedAt: string;
}

interface FolderRow {
	id: string;
	parent_id: string | null;
	name: string;
	deleted: boolean;
	seq: number;
}

interface ClientRec {
	sock: SimSocket;
	syncTopic: string | null;
	crdtTopic: string | null;
	drop: number;
}

export class ModelServer {
	private readonly scheduler: Scheduler;
	private readonly genesisEmptyDoc: boolean;
	private readonly byId = new Map<string, Note>();
	private readonly byPath = new Map<string, string>();
	private readonly clients = new Map<string, ClientRec>();
	/** Attachments by path: just enough for a push to land and a server-side
	 *  delete to be announced. Bytes are not modeled. */
	private readonly attachments = new Map<string, { size: number; hash: string }>();
	private vaultSeq = 0;
	private readonly folders = new Map<string, FolderRow>();
	private folderSeq = 0;
	/** `features.folder_ops` on the user-topic join reply, and the `folder_op`
	 *  handler. Off = an older server: `folder_op` replies `unknown_event`. */
	folderOps: boolean;
	/** The S3 staging cascade: a folder move also announces every moved note
	 *  as its own `note_changed` pair. Off = S5, `folder_changed` only. */
	cascadeBroadcasts: boolean;
	/** Stage-1 server: the folder_ops wire only, no manifest `folders`, no
	 *  `folder_id` in the `crdt_create` reply. */
	manifestFolders: boolean;
	/** Count of every client wire call, by socket event or `METHOD /route`.
	 *  What the "1 op per folder rename" property reads. */
	readonly wireCounts = new Map<string, number>();

	constructor(opts: {
		scheduler: Scheduler;
		genesisEmptyDoc?: boolean;
		folderOps?: boolean;
		cascadeBroadcasts?: boolean;
		manifestFolders?: boolean;
	}) {
		this.scheduler = opts.scheduler;
		this.genesisEmptyDoc = opts.genesisEmptyDoc ?? true;
		this.folderOps = opts.folderOps ?? false;
		this.cascadeBroadcasts = opts.cascadeBroadcasts ?? true;
		this.manifestFolders = opts.manifestFolders ?? true;
	}

	/** Wire calls of `key` so far (see `wireCounts`). */
	count(key: string): number {
		return this.wireCounts.get(key) ?? 0;
	}

	private tally(key: string): void {
		this.wireCounts.set(key, this.count(key) + 1);
	}

	/** Every live note id, one entry per row (a duplicate id would be a bug in
	 *  the model; duplicate NOTES show up as two ids). */
	liveNoteIds(): string[] {
		return [...this.byId.values()].filter((n) => !n.deleted).map((n) => n.id);
	}

	/** Live folder rows' derived paths (sorted). */
	folderPaths(): string[] {
		return [...this.folders.values()]
			.filter((f) => !f.deleted)
			.map((f) => this.folderPath(f.id) ?? "?")
			.sort();
	}

	folderIdFor(path: string): string | null {
		for (const f of this.folders.values()) {
			if (!f.deleted && this.folderPath(f.id) === path) return f.id;
		}
		return null;
	}

	hasAttachmentAt(path: string): boolean {
		return this.attachments.has(path);
	}

	// -------------------------------------------------------------------------
	// Introspection (Task 6 oracle reads this)
	// -------------------------------------------------------------------------

	state(): {
		notes: Map<string, { id: string; content: string; version: number; seq: number }>;
		heads: Map<string, string>;
	} {
		const notes = new Map<
			string,
			{ id: string; content: string; version: number; seq: number }
		>();
		const heads = new Map<string, string>();
		for (const n of this.byId.values()) {
			heads.set(n.id, this.head(n));
			if (n.deleted) continue;
			notes.set(n.path, {
				id: n.id,
				content: this.text(n),
				version: n.version,
				seq: n.seq,
			});
		}
		return { notes, heads };
	}

	// -------------------------------------------------------------------------
	// Fault injection
	// -------------------------------------------------------------------------

	/** Drop the NEXT server→client send to `clientId` (one-shot, cumulative). */
	dropNext(clientId: string): void {
		const c = this.clients.get(clientId);
		if (c) c.drop += 1;
	}

	/** Clear all pending drop faults on every client. The random suite calls this
	 *  before its final quiescence assertion: a residual (unconsumed) dropNext
	 *  would drop a catch-up delivery during convergence and manufacture a FALSE
	 *  divergence — an active fault, not a convergence bug. Convergence is only
	 *  asserted AFTER all faults cease. */
	clearDrops(): void {
		for (const c of this.clients.values()) c.drop = 0;
	}

	// -------------------------------------------------------------------------
	// Server-side mutations (MCP / REST / web-app actions no replica performs)
	// -------------------------------------------------------------------------

	/** Delete a note server-side (an MCP or web-app delete): tombstone it at a
	 *  fresh seq and broadcast `note_changed` delete to every device. */
	serverDeleteNote(id: string): void {
		const n = this.byId.get(id);
		if (!n || n.deleted) return;
		n.deleted = true;
		this.byPath.delete(n.path);
		this.bump(n);
		this.broadcastNoteChanged({ event_type: "delete", kind: "note", id, path: n.path });
	}

	/** Restore a deleted note under its SAME id (backend safer delete,
	 *  Engram#2233): live again at a fresh seq, announced by an upsert broadcast
	 *  carrying the body, exactly as `restore_deleted` does. */
	serverRestoreNote(id: string): void {
		const n = this.byId.get(id);
		if (!n?.deleted) return;
		n.deleted = false;
		this.byPath.set(n.path, id);
		this.bump(n);
		this.broadcastNoteChanged({
			event_type: "upsert",
			kind: "note",
			id,
			path: n.path,
			content: this.text(n),
			content_hash: this.head(n),
			version: n.version,
			updated_at: n.updatedAt,
		});
	}

	/** Delete an attachment server-side and broadcast it. */
	serverDeleteAttachment(path: string): void {
		if (!this.attachments.delete(path)) return;
		this.vaultSeq += 1;
		this.broadcastNoteChanged({ event_type: "delete", kind: "attachment", path });
	}

	hasAttachment(path: string): boolean {
		return this.attachments.has(path);
	}

	private broadcastNoteChanged(payload: Record<string, unknown>): void {
		for (const [id, c] of this.clients) {
			if (c.syncTopic) this.deliver(id, [null, null, c.syncTopic, "note_changed", payload]);
		}
	}

	// -------------------------------------------------------------------------
	// WebSocket surface
	// -------------------------------------------------------------------------

	connect(clientId: string): SimSocket {
		const sock: SimSocket = {
			clientId,
			onmessage: null,
			send: (raw: string) => this.onFrame(clientId, raw),
			close: () => this.clients.delete(clientId),
		};
		this.clients.set(clientId, { sock, syncTopic: null, crdtTopic: null, drop: 0 });
		return sock;
	}

	/** Server → client, via the scheduler so it decides delivery order. Honors
	 *  the per-client dropNext knob (a dropped frame never reaches the wire). */
	private deliver(clientId: string, frame: Frame): void {
		const c = this.clients.get(clientId);
		if (!c) return;
		if (c.drop > 0) {
			c.drop -= 1;
			return;
		}
		const raw = JSON.stringify(frame);
		this.scheduler.enqueue(`net:${clientId}`, () => {
			const cur = this.clients.get(clientId);
			cur?.sock.onmessage?.(raw);
		});
	}

	private onFrame(clientId: string, raw: string): void {
		let msg: Frame;
		try {
			msg = JSON.parse(raw) as Frame;
		} catch {
			return;
		}
		const [joinRef, ref, topic, event, payload] = msg;
		const c = this.clients.get(clientId);
		if (!c) return;

		if (event === "phx_join") {
			if (topic.startsWith("sync:")) c.syncTopic = topic;
			if (topic.startsWith("crdt:")) c.crdtTopic = topic;
			// sync join advertises the reconnect jitter window (channel.ts reads
			// response.reconnect_jitter_max_ms); the user topic carries features
			// (folder_ops); crdt replies carry an empty response.
			const response = topic.startsWith("sync:")
				? { reconnect_jitter_max_ms: 5000 }
				: topic.startsWith("user:")
					? { features: { folder_ops: this.folderOps } }
					: {};
			this.reply(clientId, joinRef, ref, topic, "ok", response);
			return;
		}
		if (event !== "heartbeat") this.tally(event);

		if (event === "heartbeat" && topic === "phoenix") {
			this.deliver(clientId, [
				null,
				ref,
				"phoenix",
				"phx_reply",
				{ status: "ok", response: {} },
			]);
			return;
		}

		if (event === "crdt_msg") {
			this.handleCrdtMsg(clientId, ref, topic, payload);
			return;
		}
		if (event === "crdt_create") {
			this.handleCrdtCreate(clientId, joinRef, ref, topic, payload);
			return;
		}
		if (event === "crdt_create_batch") {
			this.handleCrdtCreateBatch(clientId, joinRef, ref, topic, payload);
			return;
		}
		if (event === "crdt_delete") {
			const docId = payload.doc_id as string;
			const n = this.byId.get(docId);
			if (n) {
				n.deleted = true;
				this.byPath.delete(n.path);
			}
			this.reply(clientId, joinRef, ref, topic, "ok", { doc_id: docId });
			return;
		}
		if (event === "folder_op") {
			this.handleFolderOp(clientId, joinRef, ref, topic, payload);
			return;
		}
		if (event === "crdt_catchup_since") {
			this.handleCatchup(clientId, joinRef, ref, topic, payload);
			return;
		}
		if (event === "crdt_doc_state") {
			// Room-free full-state read, as the live CrdtChannel serves it.
			const n = this.byId.get(payload.doc_id as string);
			if (!n || n.deleted) {
				this.reply(clientId, joinRef, ref, topic, "error", { reason: "note_not_found" });
				return;
			}
			const b64 = toB64(Y.encodeStateAsUpdate(n.doc));
			this.reply(clientId, joinRef, ref, topic, "ok", { b64, head: this.head(n) });
			return;
		}
		// Unknown WS event: ignore (the real client never sends others).
	}

	private reply(
		clientId: string,
		joinRef: string | null,
		ref: string | null,
		topic: string,
		status: "ok" | "error",
		response: Record<string, unknown>,
	): void {
		this.deliver(clientId, [joinRef, ref, topic, "phx_reply", { status, response }]);
	}

	private handleCrdtCreate(
		clientId: string,
		joinRef: string | null,
		ref: string | null,
		topic: string,
		payload: Record<string, unknown>,
	): void {
		const docId = payload.doc_id as string;
		const path = payload.path as string;
		const b64 = payload.b64 as string | undefined;
		// ADOPT: if the path is already owned by a different live note, return that
		// note's id (the create-race / adopt-first behaviour the client remaps on).
		const owner = this.byPath.get(path);
		let effectiveId = docId;
		// #1409: seeded is true only for a genuine (non-adopt) genesis that carried
		// a b64 frame we actually applied — mirrors the real backend's contract
		// (`seeded: false` on adopt/no-frame/live-room/bad-frame), so a simulation
		// run exercises the client's `seeded`-gated local-apply path (sync.ts) same
		// as `handleCrdtCreateBatch` already does for the batch path.
		let seeded = false;
		const live = this.byId.get(docId);
		if (owner && owner !== docId) {
			effectiveId = owner;
		} else if (live && !live.deleted && live.path !== path) {
			// genesis_relocate_live: the create for a LIVE id at a new path IS the
			// move. Upsert the new path first, then the old path's delete leg.
			this.relocate(live, path);
		} else if (!this.byId.has(docId)) {
			// Genesis: an EMPTY body Y.Doc unless a genesis frame was sent, in which
			// case it's applied below (genesisEmptyDoc default true — the prod
			// adopt-first shape #288/#285 exploit; retained for the P2 exploit naming
			// and a future non-empty-genesis-by-default mode).
			void this.genesisEmptyDoc;
			const n = this.mint(docId, path);
			if (b64) {
				this.applyClientFrame(n, b64);
				seeded = true;
			}
		}
		// NOTE (P2 rename fidelity): a rename is client-modeled as crdt_delete(old id)
		// THEN crdt_create(new path, SAME id). The real backend hits the tombstone and
		// :announce_moved-resurrects the SAME row at the new path, AND broadcasts a
		// `note_changed` upsert that drives other devices' `moveIfIdRelocated`
		// (sync.ts:4030-4046) to rename the old path locally. This CRDT-only model
		// omits note_changed (divergence #3), so remote old-path cleanup can't happen
		// here — rename is a P2 server-tier concern and is excluded from the Task 8
		// random suite. See p1-task-8-report.md.
		const owned = this.byId.get(effectiveId);
		this.reply(clientId, joinRef, ref, topic, "ok", {
			doc_id: effectiveId,
			seeded,
			...(this.folderOps && this.manifestFolders && owned
				? { folder_id: this.folderIdFor(folderOf(owned.path)) }
				: {}),
		});
		// crdt_doc_ready is broadcast_from! — only OTHER devices see it (so an empty
		// note can be discovered + STEP1-enrolled without a note_yjs_update fan-out).
		this.broadcastOthers(
			clientId,
			(t) => [null, null, t, "crdt_doc_ready", { doc_id: effectiveId, path }],
			"crdt",
		);
	}

	private handleFolderOp(
		clientId: string,
		joinRef: string | null,
		ref: string | null,
		topic: string,
		payload: Record<string, unknown>,
	): void {
		if (!this.folderOps) {
			// An older crdt channel's catch-all for an unhandled event.
			this.reply(clientId, joinRef, ref, topic, "error", { reason: "bad_frame" });
			return;
		}
		const folderId = payload.folder_id as string;
		const parentId = (payload.parent_id as string | null) ?? null;
		const name = payload.name as string;
		const refuse = (reason: string) =>
			this.reply(clientId, joinRef, ref, topic, "error", { reason });
		const parent = parentId === null ? null : this.folders.get(parentId);
		if (parentId !== null && (!parent || parent.deleted)) {
			refuse("not_found");
			return;
		}
		const taken = [...this.folders.values()].some(
			(f) => !f.deleted && f.id !== folderId && f.parent_id === parentId && f.name === name,
		);
		const row = this.folders.get(folderId);
		if (payload.op === "create") {
			if (row && !row.deleted) {
				this.reply(clientId, joinRef, ref, topic, "ok", {
					folder_id: row.id,
					seq: row.seq,
				});
				return;
			}
			if (taken) {
				refuse("conflict");
				return;
			}
			const created: FolderRow = {
				id: folderId,
				parent_id: parentId,
				name,
				deleted: false,
				seq: ++this.vaultSeq,
			};
			this.folders.set(folderId, created);
			this.reply(clientId, joinRef, ref, topic, "ok", {
				folder_id: created.id,
				seq: created.seq,
			});
			this.broadcastFolderChanged(created, clientId);
			return;
		}
		if (!row || row.deleted) {
			refuse("not_found");
			return;
		}
		// Cycle: walk up from the new parent; meeting the moving id refuses.
		for (let at = parentId, depth = 0; at !== null && depth < 256; depth++) {
			if (at === folderId) {
				refuse("cycle");
				return;
			}
			at = this.folders.get(at)?.parent_id ?? null;
		}
		if (taken) {
			refuse("conflict");
			return;
		}
		const oldPath = this.folderPath(folderId) ?? "";
		row.parent_id = parentId;
		row.name = name;
		row.seq = ++this.vaultSeq;
		const newPath = this.folderPath(folderId) ?? "";
		this.reply(clientId, joinRef, ref, topic, "ok", { folder_id: row.id, seq: row.seq });
		if (newPath === oldPath) return; // a no-op move cascades nothing
		this.broadcastFolderChanged(row, clientId);
		// S3 staging: today's cascading rename behind the op. Every moved note
		// gets a fresh seq (catch-up sees it); its broadcast pair is optional.
		for (const n of this.byId.values()) {
			if (n.deleted || !n.path.startsWith(`${oldPath}/`)) continue;
			const to = `${newPath}${n.path.slice(oldPath.length)}`;
			if (this.cascadeBroadcasts) this.relocate(n, to);
			else {
				this.byPath.delete(n.path);
				n.path = to;
				this.byPath.set(to, n.id);
				this.bump(n);
			}
		}
		for (const [p, a] of [...this.attachments]) {
			if (!p.startsWith(`${oldPath}/`)) continue;
			this.attachments.delete(p);
			this.attachments.set(`${newPath}${p.slice(oldPath.length)}`, a);
		}
	}

	private broadcastFolderChanged(row: FolderRow, originClientId: string): void {
		this.broadcastNoteChangedEvent("folder_changed", {
			folder_id: row.id,
			parent_id: row.parent_id,
			name: row.name,
			seq: row.seq,
			deleted: row.deleted,
			device_id: originClientId,
		});
	}

	/** Move a live note to `to`, announcing it as the real backend does: the
	 *  new path's upsert, then the old path's delete leg. */
	private relocate(n: Note, to: string): void {
		const from = n.path;
		this.byPath.delete(from);
		n.path = to;
		this.byPath.set(to, n.id);
		this.ensureFolderPath(folderOf(to));
		this.bump(n);
		this.broadcastNoteChanged({
			event_type: "upsert",
			kind: "note",
			id: n.id,
			path: to,
			content: this.text(n),
			content_hash: this.head(n),
			version: n.version,
			updated_at: n.updatedAt,
			seq: n.seq,
		});
		this.broadcastNoteChanged({ event_type: "delete", kind: "note", id: n.id, path: from });
	}

	/** Derived path of a folder row (parent chain + name), or null. */
	private folderPath(id: string): string | null {
		const parts: string[] = [];
		let at: string | null = id;
		for (let depth = 0; at !== null && depth < 256; depth++) {
			const row = this.folders.get(at);
			if (!row) return null;
			parts.unshift(row.name);
			at = row.parent_id;
		}
		return parts.join("/");
	}

	/** `Rows.ensure`: every writer that places a note creates its folder and
	 *  missing ancestors. Returns the leaf folder id (null = root). */
	private ensureFolderPath(path: string): string | null {
		if (!path) return null;
		let parent: string | null = null;
		const segs = path.split("/");
		for (let i = 0; i < segs.length; i++) {
			const sub = segs.slice(0, i + 1).join("/");
			const existing = this.folderIdFor(sub);
			if (existing) {
				parent = existing;
				continue;
			}
			const id = `fold-${++this.folderSeq}`;
			this.folders.set(id, {
				id,
				parent_id: parent,
				name: segs[i],
				deleted: false,
				seq: ++this.vaultSeq,
			});
			parent = id;
		}
		return parent;
	}

	private broadcastNoteChangedEvent(event: string, payload: Record<string, unknown>): void {
		for (const [id, c] of this.clients) {
			if (c.syncTopic) this.deliver(id, [null, null, c.syncTopic, event, payload]);
		}
	}

	private handleCrdtCreateBatch(
		clientId: string,
		joinRef: string | null,
		ref: string | null,
		topic: string,
		payload: Record<string, unknown>,
	): void {
		const creates = (payload.creates as { doc_id: string; path: string; b64?: string }[]) ?? [];
		const results = creates.map((cr) => {
			const owner = this.byPath.get(cr.path);
			if (owner && owner !== cr.doc_id) return { doc_id: owner, status: "ok" as const };
			const n = this.byId.get(cr.doc_id) ?? this.mint(cr.doc_id, cr.path);
			if (cr.b64) this.applyClientFrame(n, cr.b64);
			return { doc_id: cr.doc_id, status: "ok" as const };
		});
		this.reply(clientId, joinRef, ref, topic, "ok", { results });
	}

	private handleCrdtMsg(
		clientId: string,
		ref: string | null,
		_topic: string,
		payload: Record<string, unknown>,
	): void {
		const docId = payload.doc_id as string;
		const b64 = payload.b64 as string;
		const n = this.byId.get(docId);
		if (!n) {
			// #955: a crdt_msg for an unknown note_id. Reply an error carrying the
			// doc_id — channel.ts routes reason==="note_not_found" to onCrdtNoteNotFound.
			this.reply(clientId, null, ref, _topic, "error", {
				reason: "note_not_found",
				doc_id: docId,
			});
			return;
		}
		const { replyB64, changed, serverStep1B64 } = this.applyClientFrame(n, b64);
		// A STEP1 produces a STEP2 reply back to the SENDER only (a query answer).
		if (replyB64 !== null) {
			this.deliver(clientId, [
				null,
				null,
				n.crdtTopicKey(),
				"crdt_msg",
				{ doc_id: docId, b64: replyB64 },
			]);
		}
		// #299: on a client STEP1, also send the server's OWN STEP1 (mutual handshake),
		// so the sender replies STEP2 with any held structs the server lacks. Separate
		// frame, matching the real backend's two-frame [step2, step1] reply.
		if (serverStep1B64 !== null) {
			this.deliver(clientId, [
				null,
				null,
				n.crdtTopicKey(),
				"crdt_msg",
				{ doc_id: docId, b64: serverStep1B64 },
			]);
		}
		// A STEP2/UPDATE that changed the server doc fans out to OTHER devices.
		if (changed) this.fanoutUpdate(clientId, n, changed);
	}

	/** Decode a client `messageSync` frame, apply it to the note's doc, and (for
	 *  a STEP1) return the STEP2 reply bytes. `changed` is the raw update the
	 *  apply produced (to fan out), or null. `serverStep1B64` is the server's OWN
	 *  STEP1 sent back on a client STEP1 (see below). Mirrors CrdtChannel.handleFrame. */
	private applyClientFrame(
		n: Note,
		b64: string,
	): {
		replyB64: string | null;
		changed: Uint8Array | null;
		serverStep1B64: string | null;
	} {
		const decoder = decoding.createDecoder(fromB64(b64));
		const messageType = decoding.readVarUint(decoder);
		if (messageType !== MESSAGE_SYNC)
			return { replyB64: null, changed: null, serverStep1B64: null };

		const updates: Uint8Array[] = [];
		const onUpdate = (u: Uint8Array, origin: unknown) => {
			if (origin === APPLY_ORIGIN) updates.push(u);
		};
		n.doc.on("update", onUpdate);
		const replyEncoder = encoding.createEncoder();
		encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
		const syncType = syncProtocol.readSyncMessage(decoder, replyEncoder, n.doc, APPLY_ORIGIN);
		n.doc.off("update", onUpdate);

		const changed = updates.length > 0 ? Y.mergeUpdates(updates) : null;
		if (changed) this.bump(n);
		// Only send a reply that carries a sub-message (length > 1) — a STEP2/UPDATE
		// produces an empty reply, so no handshake storm (mirrors the client gate).
		const replyB64 =
			encoding.length(replyEncoder) > 1 ? toB64(encoding.toUint8Array(replyEncoder)) : null;

		// FIDELITY (#299): the real y_ex backend answers a client STEP1 with its OWN
		// STEP1 too, not just the STEP2 diff — encode_sync_step1_response_v1 emits the
		// full mutual handshake (verified against the live crdt_channel:
		// [:sync_step2, :sync_step1]). The client replies STEP2 to that STEP1 carrying
		// any structs the server lacks — its held offline edits. Omitting it made this
		// model PULL-ONLY, so it never solicited a rejoining client's held ops and
		// falsely "lost" offline edits the real backend recovers. Only a STEP1 gets a
		// STEP1 back (a STEP2/UPDATE does not), so the exchange terminates — no storm.
		let serverStep1B64: string | null = null;
		if (syncType === syncProtocol.messageYjsSyncStep1) {
			const step1Encoder = encoding.createEncoder();
			encoding.writeVarUint(step1Encoder, MESSAGE_SYNC);
			syncProtocol.writeSyncStep1(step1Encoder, n.doc);
			serverStep1B64 = toB64(encoding.toUint8Array(step1Encoder));
		}
		return { replyB64, changed, serverStep1B64 };
	}

	private fanoutUpdate(_fromClient: string, n: Note, update: Uint8Array): void {
		const b64 = toB64(update);
		const head = this.head(n);
		const seq = n.seq;
		// note_yjs_update fans out over the per-vault SYNC topic. FIDELITY (T1,
		// #282 seq-echo): the real backend's `update_v1/4` broadcasts to the
		// vault topic `sync:{user}:{vault}` INCLUDING the originator — a Phoenix
		// PubSub topic broadcast reaches every socket the user has on the vault,
		// the pushing device among them ("Self-echo is harmless: the client
		// applies with REMOTE_ORIGIN ... Yjs re-apply is a no-op",
		// crdt_persistence.ex:159-200 + comment 166-168). That self-echo carries
		// the post-push `seq`, and the client's `applyLiveOpWithSeq` advances the
		// PER-PATH high-water from ANY seq-bearing live op it applies
		// (sync.ts:1631-1648) — so a device's own push advances its own
		// FileSyncState.seq to the server's post-push seq. WITHOUT this echo the
		// pusher's high-water only ever moved on OTHER devices' rows, so a
		// later catch-up row (seq > the pusher's lagging high-water) always
		// applied and the equal-seq `<=` fence never decided the outcome — the
		// #282 gap the P1-Task-7 differential could not discriminate. Delivering
		// to ALL joined sync-topic clients (originator included) mirrors the real
		// broadcast; `__rest__` is not a real client, so a REST fan-out is
		// unchanged (still reaches everyone).
		for (const [id, c] of this.clients) {
			if (!c.syncTopic) continue;
			this.deliver(id, [
				null,
				null,
				c.syncTopic,
				"note_yjs_update",
				{ note_id: n.id, b64, head, seq },
			]);
		}
	}

	/** Deliver a frame (built per-recipient from its own topic) to every client
	 *  EXCEPT `fromClient` that has joined the given topic family. */
	private broadcastOthers(
		fromClient: string,
		build: (topic: string) => Frame,
		family: "sync" | "crdt",
	): void {
		for (const [id, c] of this.clients) {
			if (id === fromClient) continue;
			const t = family === "sync" ? c.syncTopic : c.crdtTopic;
			if (!t) continue;
			this.deliver(id, build(t));
		}
	}

	private handleCatchup(
		clientId: string,
		joinRef: string | null,
		ref: string | null,
		topic: string,
		payload: Record<string, unknown>,
	): void {
		const cursor = (payload.cursor_seq as number) ?? 0;
		const limit = (payload.limit as number | undefined) ?? Number.POSITIVE_INFINITY;
		const rows = [...this.byId.values()]
			.filter((n) => n.seq > cursor)
			.sort((a, b) => a.seq - b.seq);
		const page = rows.slice(0, limit === Number.POSITIVE_INFINITY ? rows.length : limit);
		const changes = page.map((n) => this.syncNoteChange(n));
		const hasMore = page.length < rows.length;
		const nextSeq = page.length > 0 ? page[page.length - 1].seq : null;
		this.reply(clientId, joinRef, ref, topic, "ok", {
			changes,
			has_more: hasMore,
			next_seq: nextSeq,
		});
	}

	// -------------------------------------------------------------------------
	// HTTP surface — only the note + CRDT convergence endpoints EngramApi calls.
	// -------------------------------------------------------------------------

	http(req: SimRequest): SimResponse {
		const { path, query } = parseUrl(req.url);
		const method = req.method.toUpperCase();
		const body = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
		const route =
			path.startsWith("/attachments/") && method !== "POST" ? "/attachments/*" : path;
		this.tally(`${method} ${route}`);

		if (method === "GET" && path === "/health") return ok({ status: "ok" });
		if (method === "GET" && path === "/me") {
			return ok({ user: { id: "sim-user", email: "sim@example.com" } });
		}
		if (method === "POST" && path === "/logs") return ok({ ok: true });
		// `api.ping()` (fullSync / pushAll's auth check) is a GET /folders. The
		// model holds no folder rows; an empty list is all ping reads.
		if (method === "GET" && path === "/folders") return ok({ folders: [] });

		if (method === "POST" && path === "/notes") return this.restPushNote(body);
		if (method === "GET" && path === "/sync/manifest") return this.restManifest();
		if (method === "POST" && path === "/attachments") return this.restPushAttachment(body);
		if (method === "POST" && path === "/attachments/rename") {
			const from = body.old_path as string;
			const to = body.new_path as string;
			const a = this.attachments.get(from);
			if (!a) return { status: 404, json: { error: "not_found" }, text: "not found" };
			this.attachments.delete(from);
			this.attachments.set(to, a);
			this.ensureFolderPath(folderOf(to));
			this.vaultSeq += 1;
			this.broadcastNoteChanged({ event_type: "delete", kind: "attachment", path: from });
			this.broadcastNoteChanged({
				event_type: "upsert",
				kind: "attachment",
				path: to,
				content_hash: a.hash,
			});
			return ok({ renamed: true, old_path: from, new_path: to });
		}
		if (method === "DELETE" && path.startsWith("/attachments/")) {
			const p = decodePath(path.slice("/attachments/".length));
			this.serverDeleteAttachment(p);
			return ok({ deleted: true, path: p });
		}

		// /notes/:id/updates (id, not path-encoded — encodeURIComponent single seg)
		const upd = /^\/notes\/([^/]+)\/updates$/.exec(path);
		if (upd) {
			const id = decodeURIComponent(upd[1]);
			if (method === "GET") return this.restGetUpdates(id, query.get("since"));
			if (method === "POST") return this.restPostUpdate(id, body);
		}

		// /notes/:path (path-encoded per segment; slashes preserved)
		const noteMatch = /^\/notes\/(.+)$/.exec(path);
		if (noteMatch) {
			const notePath = decodePath(noteMatch[1]);
			if (method === "GET") return this.restGetNote(notePath);
			if (method === "DELETE") return this.restDeleteNote(notePath);
		}

		return { status: 404, json: { error: "not_found", path }, text: `not found: ${path}` };
	}

	private restPushNote(body: Record<string, unknown>): SimResponse {
		const path = body.path as string;
		const content = (body.content as string) ?? "";
		const id = body.id as string | undefined;
		let n = (id && this.byId.get(id)) || this.noteByPath(path);
		if (!n) n = this.mint(id ?? `srv-${this.byId.size + 1}`, path);
		this.setBody(n, content);
		// Modern CRDT fan-out: broadcast the resulting update to everyone (no
		// originating socket for a REST call, so all clients receive it).
		const upd = this.lastUpdate(n);
		if (upd) this.fanoutUpdate("__rest__", n, upd);
		return ok({ note: this.noteJson(n), chunks_indexed: 1 });
	}

	private restPushAttachment(body: Record<string, unknown>): SimResponse {
		const path = body.path as string;
		const b64 = (body.content_base64 as string) ?? "";
		const hash = `att-${b64.length}-${this.vaultSeq + 1}`;
		this.attachments.set(path, { size: b64.length, hash });
		this.ensureFolderPath(folderOf(path));
		this.vaultSeq += 1;
		const now = nowIso();
		return ok({
			attachment: {
				id: `att-${path}`,
				user_id: "sim-user",
				path,
				mime_type: (body.mime_type as string) ?? "application/octet-stream",
				size_bytes: b64.length,
				mtime: (body.mtime as number) ?? 0,
				content_hash: hash,
				created_at: now,
				updated_at: now,
			},
		});
	}

	private restGetNote(path: string): SimResponse {
		const n = this.noteByPath(path);
		if (!n) return { status: 404, json: { error: "not_found" }, text: "not found" };
		return ok(this.noteDetailJson(n));
	}

	private restDeleteNote(path: string): SimResponse {
		const n = this.noteByPath(path);
		if (n) {
			n.deleted = true;
			this.byPath.delete(n.path);
		}
		return ok({ deleted: true, path });
	}

	private restGetUpdates(id: string, since: string | null): SimResponse {
		const n = this.byId.get(id);
		if (!n) return { status: 404, json: { error: "not_found" }, text: "not found" };
		const sv = since ? fromB64(since) : undefined;
		const update = Y.encodeStateAsUpdate(n.doc, sv);
		return ok({ update: toB64(update), head: this.head(n) });
	}

	private restPostUpdate(id: string, body: Record<string, unknown>): SimResponse {
		const n = this.byId.get(id);
		if (!n) return { status: 404, json: { error: "not_found" }, text: "not found" };
		const raw = fromB64(body.update as string);
		const before = Y.encodeStateVector(n.doc);
		Y.applyUpdate(n.doc, raw, APPLY_ORIGIN);
		if (toB64(before) !== toB64(Y.encodeStateVector(n.doc))) {
			this.bump(n);
			this.fanoutUpdate("__rest__", n, raw);
		}
		return ok({ head: this.head(n) });
	}

	private restManifest(): SimResponse {
		const notes = [...this.byId.values()]
			.filter((n) => !n.deleted)
			.map((n) => ({
				id: n.id,
				path: n.path,
				content_hash: this.head(n),
				version: n.version,
				...(this.folderOps && this.manifestFolders
					? { folder_id: this.folderIdFor(folderOf(n.path)) }
					: {}),
			}));
		const attachments = [...this.attachments].map(([path, a]) => ({
			path,
			content_hash: a.hash,
			size_bytes: a.size,
		}));
		return ok({
			notes,
			attachments,
			total_notes: notes.length,
			total_attachments: attachments.length,
			change_seq: this.vaultSeq,
			...(this.folderOps && this.manifestFolders
				? {
						folders: [...this.folders.values()]
							.filter((f) => !f.deleted)
							.map((f) => ({ id: f.id, parent_id: f.parent_id, name: f.name })),
					}
				: {}),
		});
	}

	// -------------------------------------------------------------------------
	// Note helpers
	// -------------------------------------------------------------------------

	private mint(id: string, path: string): Note {
		const doc = new Y.Doc();
		// Touch the body type so it exists as a shared type (no op until content).
		doc.getText(CONTENT_KEY);
		const n: Note & { crdtTopicKey(): string } = Object.assign(
			{
				id,
				path,
				doc,
				version: 0,
				seq: ++this.vaultSeq,
				deleted: false,
				createdAt: nowIso(),
				updatedAt: nowIso(),
			},
			{
				// The crdt topic to address a per-note frame at — all clients share the
				// same crdt topic string, so any joined client's works; pick the first.
				crdtTopicKey: () => {
					for (const c of this.clients.values()) if (c.crdtTopic) return c.crdtTopic;
					return "crdt:unknown";
				},
			},
		);
		this.byId.set(id, n);
		this.byPath.set(path, id);
		this.ensureFolderPath(folderOf(path));
		return n;
	}

	/** Transactionally replace the body text (see divergence #2). Captures the
	 *  produced update on `n.__lastUpdate` for REST fan-out. */
	private lastUpdateStore = new WeakMap<Note, Uint8Array | null>();

	private setBody(n: Note, content: string): void {
		const onUpdate = (u: Uint8Array, origin: unknown) => {
			if (origin === APPLY_ORIGIN) this.lastUpdateStore.set(n, u);
		};
		this.lastUpdateStore.set(n, null);
		n.doc.on("update", onUpdate);
		Y.transact(
			n.doc,
			() => {
				const t = n.doc.getText(CONTENT_KEY);
				if (t.toString() === content) return;
				if (t.length > 0) t.delete(0, t.length);
				if (content.length > 0) t.insert(0, content);
			},
			APPLY_ORIGIN,
		);
		n.doc.off("update", onUpdate);
		if (this.lastUpdateStore.get(n)) this.bump(n);
	}

	private lastUpdate(n: Note): Uint8Array | null {
		return this.lastUpdateStore.get(n) ?? null;
	}

	private bump(n: Note): void {
		n.version += 1;
		n.seq = ++this.vaultSeq;
		n.updatedAt = nowIso();
	}

	private text(n: Note): string {
		return n.doc.getText(CONTENT_KEY).toString();
	}

	/** head = base64(state vector) — see divergence #1. */
	private head(n: Note): string {
		return toB64(Y.encodeStateVector(n.doc));
	}

	private noteByPath(path: string): Note | undefined {
		const id = this.byPath.get(path);
		return id ? this.byId.get(id) : undefined;
	}

	private noteJson(n: Note): Record<string, unknown> {
		return {
			id: n.id,
			user_id: "sim-user",
			path: n.path,
			title: titleOf(n.path),
			folder: folderOf(n.path),
			tags: [],
			mtime: n.seq,
			created_at: n.createdAt,
			updated_at: n.updatedAt,
			version: n.version,
			content_hash: this.head(n),
			parse_status: "ok",
		};
	}

	private noteDetailJson(n: Note): Record<string, unknown> {
		return {
			path: n.path,
			title: titleOf(n.path),
			content: this.text(n),
			content_hash: this.head(n),
			folder: folderOf(n.path),
			tags: [],
			mtime: n.seq,
			created_at: n.createdAt,
			updated_at: n.updatedAt,
			version: n.version,
			parse_status: "ok",
		};
	}

	private syncNoteChange(n: Note): Record<string, unknown> {
		return {
			type: "note",
			id: n.id,
			seq: n.seq,
			path: n.path,
			title: titleOf(n.path),
			content: this.text(n),
			content_hash: this.head(n),
			folder: folderOf(n.path),
			tags: [],
			mtime: n.seq,
			updated_at: n.updatedAt,
			deleted: n.deleted,
			version: n.version,
			parse_status: "ok",
		};
	}
}

// crdtTopicKey lives on the note object (attached in mint); declare it so TS is
// happy about the call in handleCrdtMsg without widening the exported Note type.
interface Note {
	crdtTopicKey(): string;
}

// --- pure helpers ---

function fromB64(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function ok(json: unknown): SimResponse {
	return { status: 200, json, text: JSON.stringify(json) };
}

function nowIso(): string {
	return new Date().toISOString();
}

function titleOf(path: string): string {
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.md$/, "");
}

function folderOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

/** Split a requestUrl url into an /api-relative path + query params. Tolerates
 *  a bare path, a `.../api/...` url, or an absolute http(s) url. */
function parseUrl(url: string): { path: string; query: URLSearchParams } {
	let rest = url;
	const apiIdx = url.indexOf("/api/");
	if (apiIdx >= 0) rest = url.slice(apiIdx + 4);
	else if (url.startsWith("http")) rest = new URL(url).pathname + (new URL(url).search || "");
	const qIdx = rest.indexOf("?");
	const path = qIdx < 0 ? rest : rest.slice(0, qIdx);
	const query = new URLSearchParams(qIdx < 0 ? "" : rest.slice(qIdx + 1));
	return { path, query };
}

/** Decode a per-segment-encoded note path (src/api.ts encodePath inverse). */
function decodePath(encoded: string): string {
	return encoded.split("/").map(decodeURIComponent).join("/");
}
