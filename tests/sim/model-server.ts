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
	/** Virtual ms of the delete, for the delete-wins window. */
	deletedAt?: number;
	createdAt: string;
	updatedAt: string;
}

interface ClientRec {
	sock: SimSocket;
	syncTopic: string | null;
	crdtTopic: string | null;
	drop: number;
	/** Next N server->client frames delivered twice (a duplicated reply). */
	dup: number;
	/** Next N server->client frames moved to a side lane, so later frames can
	 *  overtake them (a reordered broadcast). */
	late: number;
	/** Next N client->server frames lost before the server sees them. */
	dropIn: number;
	/** Next N `phx_reply` frames to this client lost (the reply to a request,
	 *  not a broadcast). */
	dropReply: number;
	/** Notes this client holds a server room open on: every `crdt_msg` frame
	 *  routes through the backend's `ensure_room`, and `crdt_release` (or the
	 *  socket going away) leaves it. */
	rooms: Map<string, Room>;
}

/** A server room this client is in. `handshake`: opened by a syncStep1 (the
 *  backend's `room_start{source="handshake"}`), else by an op frame. */
interface Room {
	handshake: boolean;
	lastAt: number;
}

/** A room nobody sends to for this long drains on its own (the backend's
 *  idle exit). */
const ROOM_IDLE_MS = 5 * 60_000;

/** The backend's delete-wins window (`@delete_tombstone_window_seconds`). */
const DELETE_WINDOW_MS = 60_000;

interface Attachment {
	size: number;
	hash: string;
	b64: string;
	mime: string;
	seq: number;
	deleted: boolean;
	updatedAt: string;
}

export class ModelServer {
	private readonly scheduler: Scheduler;
	private readonly genesisEmptyDoc: boolean;
	private readonly byId = new Map<string, Note>();
	private readonly byPath = new Map<string, string>();
	private readonly clients = new Map<string, ClientRec>();
	/** Attachments by path: just enough for a push to land and a server-side
	 *  delete to be announced. Bytes are not modeled. */
	private readonly attachments = new Map<string, Attachment>();
	private vaultSeq = 0;
	/** Called when a client OPENS a room on a note (its first `crdt_msg` for a
	 *  note it is not already in the room of). The fuzz suite's room-budget
	 *  invariant reads this; the real server's `room_start{source="handshake"}`
	 *  surge alert counts the same event. */
	onRoomStart: ((clientId: string, docId: string, handshake: boolean) => void) | null = null;
	/** Virtual time, for room idle expiry. */
	private readonly now: () => number;

	constructor(opts: { scheduler: Scheduler; genesisEmptyDoc?: boolean; now?: () => number }) {
		this.scheduler = opts.scheduler;
		this.now = opts.now ?? (() => Date.now());
		this.genesisEmptyDoc = opts.genesisEmptyDoc ?? true;
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
		for (const c of this.clients.values()) {
			c.drop = 0;
			c.dup = 0;
			c.late = 0;
			c.dropIn = 0;
			c.dropReply = 0;
		}
	}

	// -------------------------------------------------------------------------
	// Server-side mutations (MCP / REST / web-app actions no replica performs)
	// -------------------------------------------------------------------------

	/** Delete a note server-side (an MCP or web-app delete): tombstone it at a
	 *  fresh seq and broadcast `note_changed` delete to every device. The
	 *  broadcast carries the tombstone seq (Engram#2233) and, for a device's own
	 *  delete, its device id (#970). */
	serverDeleteNote(id: string, deviceId?: string): void {
		const n = this.byId.get(id);
		if (!n || n.deleted) return;
		n.deleted = true;
		n.deletedAt = this.now();
		this.byPath.delete(n.path);
		this.bump(n);
		this.broadcastNoteChanged({
			event_type: "delete",
			kind: "note",
			id,
			path: n.path,
			seq: n.seq,
			...(deviceId ? { device_id: deviceId } : {}),
		});
	}

	/** An MCP / web-app edit: `edit` maps the current body to the new one, and
	 *  the change lands as a MINIMAL diff (common prefix and suffix kept), the
	 *  way the backend's diffIntoYText writes a REST body, so a concurrent edit
	 *  on another line merges instead of colliding with a full-body replace. */
	serverEditNote(id: string, edit: (body: string) => string): void {
		const n = this.byId.get(id);
		if (!n || n.deleted) return;
		const updates: Uint8Array[] = [];
		const onUpdate = (u: Uint8Array, origin: unknown) => {
			if (origin === APPLY_ORIGIN) updates.push(u);
		};
		n.doc.on("update", onUpdate);
		Y.transact(
			n.doc,
			() => {
				const t = n.doc.getText(CONTENT_KEY);
				const cur = t.toString();
				const next = edit(cur);
				let pre = 0;
				while (pre < cur.length && pre < next.length && cur[pre] === next[pre]) pre++;
				let suf = 0;
				while (
					suf < cur.length - pre &&
					suf < next.length - pre &&
					cur[cur.length - 1 - suf] === next[next.length - 1 - suf]
				)
					suf++;
				if (cur.length - pre - suf > 0) t.delete(pre, cur.length - pre - suf);
				if (next.length - pre - suf > 0) t.insert(pre, next.slice(pre, next.length - suf));
			},
			APPLY_ORIGIN,
		);
		n.doc.off("update", onUpdate);
		if (updates.length === 0) return;
		this.bump(n);
		this.fanoutUpdate("__rest__", n, Y.mergeUpdates(updates));
	}

	/** The note's full CRDT state, for a later `rollback`. */
	snapshotNote(id: string): Uint8Array | null {
		const n = this.byId.get(id);
		return n && !n.deleted ? Y.encodeStateAsUpdate(n.doc) : null;
	}

	/** Restore a note's stored state to an earlier snapshot (a database
	 *  restore). Ops written since are GONE server-side and nothing is
	 *  broadcast; the row takes a fresh seq, so catch-up re-announces it. Only
	 *  devices still holding those ops can bring them back. */
	rollback(id: string, snap: Uint8Array): void {
		const n = this.byId.get(id);
		if (!n || n.deleted) return;
		const doc = new Y.Doc();
		doc.getText(CONTENT_KEY);
		Y.applyUpdate(doc, snap);
		n.doc = doc;
		this.bump(n);
		// A restore drops the live rooms too; every device re-handshakes.
		for (const c of this.clients.values()) c.rooms.delete(id);
	}

	/** Every note id the server holds, live or tombstoned. */
	noteIds(): { id: string; path: string; deleted: boolean }[] {
		return [...this.byId.values()].map((n) => ({ id: n.id, path: n.path, deleted: n.deleted }));
	}

	/** The live note at `path`, if any. */
	noteIdAt(path: string): string | undefined {
		return this.byPath.get(path);
	}

	/** Server-side kill of a client's socket (the OS suspended the app; the
	 *  server's side times the socket out). The client is not told. */
	killClient(clientId: string): void {
		this.clients.delete(clientId);
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
	serverDeleteAttachment(path: string, deviceId?: string): void {
		const a = this.attachments.get(path);
		if (!a || a.deleted) return;
		a.deleted = true;
		a.seq = ++this.vaultSeq;
		a.updatedAt = nowIso();
		this.broadcastNoteChanged({
			event_type: "delete",
			kind: "attachment",
			path,
			seq: a.seq,
			...(deviceId ? { device_id: deviceId } : {}),
		});
	}

	hasAttachment(path: string): boolean {
		const a = this.attachments.get(path);
		return a !== undefined && !a.deleted;
	}

	/** Paths of every live attachment. */
	attachmentPaths(): string[] {
		return [...this.attachments].filter(([, a]) => !a.deleted).map(([p]) => p);
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
			// A closed (or superseded) socket reaches nothing: a frame a dead
			// process sends must not arrive as if from the client's next socket.
			send: (raw: string) => {
				if (this.clients.get(clientId)?.sock === sock) this.onFrame(clientId, raw);
			},
			close: () => {
				if (this.clients.get(clientId)?.sock === sock) this.clients.delete(clientId);
			},
		};
		this.clients.set(clientId, {
			sock,
			syncTopic: null,
			crdtTopic: null,
			drop: 0,
			dup: 0,
			late: 0,
			dropIn: 0,
			dropReply: 0,
			rooms: new Map(),
		});
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
		if (c.dropReply > 0 && frame[3] === "phx_reply") {
			c.dropReply -= 1;
			return;
		}
		const raw = JSON.stringify(frame);
		// Delivered to THIS socket only: a frame queued for a socket that has
		// since closed must not reach the client's next socket.
		const sock = c.sock;
		const send = () => {
			if (this.clients.get(clientId)?.sock === sock) sock.onmessage?.(raw);
		};
		let lane = `net:${clientId}`;
		if (c.late > 0) {
			c.late -= 1;
			lane = `net-late:${clientId}`;
		}
		this.scheduler.enqueue(lane, send);
		if (c.dup > 0) {
			c.dup -= 1;
			this.scheduler.enqueue(lane, send);
		}
	}

	private expireRooms(c: ClientRec): void {
		const now = this.now();
		for (const [id, r] of c.rooms) if (now - r.lastAt > ROOM_IDLE_MS) c.rooms.delete(id);
	}

	/** Rooms `clientId` holds open now (idle ones drained). */
	openRooms(clientId: string): { docId: string; handshake: boolean }[] {
		const c = this.clients.get(clientId);
		if (!c) return [];
		this.expireRooms(c);
		return [...c.rooms].map(([docId, r]) => ({ docId, handshake: r.handshake }));
	}

	/** Lose the next reply to a request from `clientId`. */
	dropNextReply(clientId: string): void {
		const c = this.clients.get(clientId);
		if (c) c.dropReply += 1;
	}

	/** Deliver the next server->client frame to `clientId` twice. */
	duplicateNext(clientId: string): void {
		const c = this.clients.get(clientId);
		if (c) c.dup += 1;
	}

	/** Let later frames to `clientId` overtake the next one. */
	delayNext(clientId: string): void {
		const c = this.clients.get(clientId);
		if (c) c.late += 1;
	}

	/** Lose the next client->server frame from `clientId`. */
	dropNextInbound(clientId: string): void {
		const c = this.clients.get(clientId);
		if (c) c.dropIn += 1;
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
		if (c.dropIn > 0) {
			c.dropIn -= 1;
			return;
		}

		if (event === "phx_join") {
			if (topic.startsWith("sync:")) c.syncTopic = topic;
			if (topic.startsWith("crdt:")) c.crdtTopic = topic;
			// sync join advertises the reconnect jitter window (channel.ts reads
			// response.reconnect_jitter_max_ms); user/crdt replies carry an empty
			// response (crdt ack flips crdtJoined; user is best-effort).
			const response = topic.startsWith("sync:") ? { reconnect_jitter_max_ms: 5000 } : {};
			this.reply(clientId, joinRef, ref, topic, "ok", response);
			return;
		}

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
			// Tombstone at a fresh seq and tell every device, like a server delete
			// (the backend's socket delete broadcasts note_changed with the
			// caller's device id, which the caller drops as its own echo).
			this.serverDeleteNote(docId, clientId);
			c.rooms.delete(docId);
			this.reply(clientId, joinRef, ref, topic, "ok", { doc_id: docId });
			return;
		}
		if (event === "crdt_release") {
			c.rooms.delete(payload.doc_id as string);
			this.reply(clientId, joinRef, ref, topic, "ok", {});
			return;
		}
		if (event === "crdt_doc_update") {
			this.handleCrdtDocUpdate(clientId, joinRef, ref, topic, payload);
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
		// The reply's `genesis` says what the row holds, as the backend's
		// reply_created does (crdt_channel.ex): `stored` (our frame seeded a
		// fresh row), `absent` (the row is empty: push the body), `occupied`
		// (the row has a body: acquire its lineage, then send a diff; a blind
		// push would union two bodies, #476). `seeded` is the legacy lossy view.
		const respond = (id: string, genesis: "stored" | "absent" | "occupied") =>
			this.reply(clientId, joinRef, ref, topic, "ok", {
				doc_id: id,
				seeded: genesis === "stored",
				genesis,
			});
		const announceReady = (id: string) =>
			// crdt_doc_ready is broadcast_from!: only OTHER devices see it (so an
			// empty note can be discovered + STEP1-enrolled without a fan-out).
			this.broadcastOthers(
				clientId,
				(t) => [null, null, t, "crdt_doc_ready", { doc_id: id, path }],
				"crdt",
			);
		const owner = this.byPath.get(path);
		const n = this.byId.get(docId);
		if (owner && owner !== docId) {
			// ADOPT: the path is owned by a different live note; the client remaps
			// onto that id and transfers its body deliberately.
			respond(owner, "occupied");
			announceReady(owner);
			return;
		}
		if (!n) {
			const fresh = this.mint(docId, path);
			if (b64) this.applyClientFrame(fresh, b64);
			respond(docId, b64 ? "stored" : "absent");
			announceReady(docId);
			return;
		}
		const holds = (): "occupied" | "absent" =>
			this.text(n).length > 0 ? "occupied" : "absent";
		if (n.deleted) {
			// Delete-wins (#970): the same id re-created at its OWN path within the
			// 60 s delete window is a stale device un-deleting; refused. Otherwise
			// the tombstone resurrects with its prior body (genesis_resurrect).
			if (n.path === path && this.now() - (n.deletedAt ?? 0) < DELETE_WINDOW_MS) {
				this.reply(clientId, joinRef, ref, topic, "error", { reason: "recently_deleted" });
				return;
			}
			const renamed = n.path !== path;
			n.deleted = false;
			n.path = path;
			this.byPath.set(path, docId);
			this.bump(n);
			respond(docId, holds());
			if (renamed) this.announceMoved(clientId, n, null);
			else announceReady(docId);
			return;
		}
		if (n.path !== path) {
			// Rename-as-move (Phase E2): a create for a LIVE id at a new path
			// relocates the row in place (genesis_relocate_live -> move_note).
			const oldPath = n.path;
			this.byPath.delete(oldPath);
			n.path = path;
			this.byPath.set(path, docId);
			this.bump(n);
			respond(docId, holds());
			this.announceMoved(clientId, n, oldPath);
			return;
		}
		// Idempotent same-path create (a retry, or a device that lost track of
		// the row): an empty row takes the frame, a row with a body says so.
		if (holds() === "absent" && b64) {
			this.applyClientFrame(n, b64);
			respond(docId, "stored");
		} else respond(docId, holds());
		announceReady(docId);
	}

	/** The :announce_moved fan-out: an upsert at the NEW path, then (for a
	 *  move) a delete of the OLD one, both carrying the id and the caller's
	 *  device id. */
	private announceMoved(clientId: string, n: Note, oldPath: string | null): void {
		this.broadcastNoteChanged({
			event_type: "upsert",
			kind: "note",
			id: n.id,
			path: n.path,
			content: this.text(n),
			content_hash: this.head(n),
			version: n.version,
			updated_at: n.updatedAt,
			seq: n.seq,
			device_id: clientId,
		});
		if (oldPath === null) return;
		this.broadcastNoteChanged({
			event_type: "delete",
			kind: "note",
			id: n.id,
			path: oldPath,
			seq: n.seq,
			device_id: clientId,
		});
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
		const c = this.clients.get(clientId);
		if (c) {
			this.expireRooms(c);
			const room = c.rooms.get(docId);
			if (room) room.lastAt = this.now();
			else {
				const handshake = serverStep1B64 !== null;
				c.rooms.set(docId, { handshake, lastAt: this.now() });
				this.onRoomStart?.(clientId, docId, handshake);
			}
		}
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

	/** Room-free delivery of a device's ops (`crdt_doc_update`, #1493): a
	 *  sync_update only (a STEP1 here would need a room), merged, fanned out,
	 *  acked with the new head. No room is opened. */
	private handleCrdtDocUpdate(
		clientId: string,
		joinRef: string | null,
		ref: string | null,
		topic: string,
		payload: Record<string, unknown>,
	): void {
		const docId = payload.doc_id as string;
		const n = this.byId.get(docId);
		if (!n || n.deleted) {
			this.reply(clientId, joinRef, ref, topic, "error", {
				reason: "note_not_found",
				doc_id: docId,
			});
			return;
		}
		const decoder = decoding.createDecoder(fromB64(payload.b64 as string));
		if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
			this.reply(clientId, joinRef, ref, topic, "error", { reason: "not_sync_update" });
			return;
		}
		if (decoding.readVarUint(decoder) !== syncProtocol.messageYjsUpdate) {
			this.reply(clientId, joinRef, ref, topic, "error", { reason: "not_sync_update" });
			return;
		}
		const update = decoding.readVarUint8Array(decoder);
		const updates: Uint8Array[] = [];
		const onUpdate = (u: Uint8Array, origin: unknown) => {
			if (origin === APPLY_ORIGIN) updates.push(u);
		};
		n.doc.on("update", onUpdate);
		Y.applyUpdate(n.doc, update, APPLY_ORIGIN);
		n.doc.off("update", onUpdate);
		if (updates.length > 0) {
			this.bump(n);
			this.fanoutUpdate(clientId, n, Y.mergeUpdates(updates));
		}
		this.reply(clientId, joinRef, ref, topic, "ok", { head: this.head(n) });
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
		const rows: { seq: number; change: () => Record<string, unknown> }[] = [
			...[...this.byId.values()].map((n) => ({
				seq: n.seq,
				change: () => this.syncNoteChange(n),
			})),
			...[...this.attachments].map(([p, a]) => ({
				seq: a.seq,
				change: () => this.syncAttachmentChange(p, a),
			})),
		]
			.filter((r) => r.seq > cursor)
			.sort((a, b) => a.seq - b.seq);
		const page = rows.slice(0, limit === Number.POSITIVE_INFINITY ? rows.length : limit);
		const changes = page.map((r) => r.change());
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
		const deviceId = req.headers?.["X-Device-Id"];
		if (method === "POST" && path === "/attachments") {
			return this.restPushAttachment(body, deviceId);
		}
		const att = /^\/attachments\/(.+)$/.exec(path);
		if (att) {
			const attPath = decodePath(att[1]);
			const a = this.attachments.get(attPath);
			if (method === "DELETE") {
				this.serverDeleteAttachment(attPath, deviceId);
				return ok({ deleted: true, path: attPath });
			}
			if (method === "GET") {
				if (!a || a.deleted) return { status: 404, json: { error: "not_found" }, text: "" };
				return ok({
					path: attPath,
					content_base64: a.b64,
					mime_type: a.mime,
					size_bytes: a.size,
					mtime: a.seq,
					content_hash: a.hash,
					updated_at: a.updatedAt,
				});
			}
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

	private restPushAttachment(body: Record<string, unknown>, deviceId?: string): SimResponse {
		const path = body.path as string;
		const b64 = (body.content_base64 as string) ?? "";
		const hash = `att-${simpleHash(b64)}`;
		const mime = (body.mime_type as string) ?? "application/octet-stream";
		const seq = ++this.vaultSeq;
		const now = nowIso();
		const prev = this.attachments.get(path);
		this.attachments.set(path, {
			size: b64.length,
			hash,
			b64,
			mime,
			seq,
			deleted: false,
			updatedAt: now,
		});
		if (!prev || prev.deleted || prev.hash !== hash) {
			this.broadcastNoteChanged({
				event_type: "upsert",
				kind: "attachment",
				path,
				content_hash: hash,
				updated_at: now,
				seq,
				...(deviceId ? { device_id: deviceId } : {}),
			});
		}
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
			}));
		const attachments = [...this.attachments]
			.filter(([, a]) => !a.deleted)
			.map(([path, a]) => ({
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

	private syncAttachmentChange(path: string, a: Attachment): Record<string, unknown> {
		return {
			type: "attachment",
			id: `att-${path}`,
			seq: a.seq,
			path,
			mime_type: a.mime,
			size_bytes: a.size,
			mtime: a.seq,
			updated_at: a.updatedAt,
			deleted: a.deleted,
			content_hash: a.hash,
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

/** Deterministic content hash for attachment bytes (FNV-1a). */
function simpleHash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(16);
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
