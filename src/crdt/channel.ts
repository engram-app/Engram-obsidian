import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { type CrdtManager, REMOTE_ORIGIN } from "./manager";

/** Outer y-protocols message-type tag — we only speak `messageSync`. */
const MESSAGE_SYNC = 0;

export interface CrdtChannelOptions {
	manager: CrdtManager;
	/** Transport: send a base64-encoded y-protocols frame for `docId` (the bare
	 *  note_id — see `CrdtManager.docId`). */
	send: (docId: string, frame: string) => void;
	/**
	 * Called when an inbound STEP2 leaves the doc EMPTY — the server's
	 * authoritative signal that the note is genuinely empty (an empty note has no
	 * content-bearing update, so nothing else creates its file on disk). Wired to
	 * `SyncEngine.materializeEmptyDiscovered` (via a note_id -> path lookup — see
	 * main.ts) so the empty file is written off the handshake rather than a
	 * wall-clock timer (the #547 down-sync race).
	 */
	onEmptyStep2?: (noteId: string) => void;
}

function toB64(bytes: Uint8Array): string {
	// Avoid spread-into-String.fromCharCode which stack-overflows on large updates.
	return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

function fromB64(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export class CrdtChannel {
	private readonly mgr: CrdtManager;
	private readonly transport: (docId: string, frame: string) => void;
	private readonly onEmptyStep2?: (noteId: string) => void;
	/**
	 * Per-doc guard: each doc advertises STEP1 at most once per session, so two
	 * empty peers cannot ping-pong STEP1 forever. Mirrors the y-websocket/Relay
	 * pattern of sending the opening STEP1 exactly once on connect. Reset on
	 * reconnect via `resetSync` to allow a fresh handshake.
	 */
	private readonly initiated = new Set<string>();

	constructor(opts: CrdtChannelOptions) {
		this.mgr = opts.manager;
		this.transport = opts.send;
		this.onEmptyStep2 = opts.onEmptyStep2;
	}

	/**
	 * Begin the handshake for `noteId`: advertise our state via a `messageSync`
	 * `writeSyncStep1` frame. Sent at most once per doc — the receiver replies
	 * with a STEP2 (not another STEP1), so there is no echo loop.
	 */
	async startSync(noteId: string): Promise<void> {
		const id = this.mgr.docId(noteId);
		if (this.initiated.has(id)) return;
		this.initiated.add(id);
		const doc = await this.mgr.getDoc(noteId);
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, MESSAGE_SYNC);
		syncProtocol.writeSyncStep1(encoder, doc);
		this.transport(id, toB64(encoding.toUint8Array(encoder)));
	}

	/**
	 * Allow a fresh handshake after a WS reconnect — clears the once-per-doc
	 * guard so `startSync` will send STEP1 again.
	 */
	resetSync(noteId: string): void {
		this.initiated.delete(this.mgr.docId(noteId));
	}

	/**
	 * Forward a local Y.Doc update as a `messageSync` update frame. Called by
	 * `CrdtManager.onUpdate` with the already-encoded update bytes + docId.
	 * Origin filtering is handled by the manager; by the time this fires the
	 * update is guaranteed to be local (not REMOTE_ORIGIN).
	 */
	sendUpdateRaw(docId: string, update: Uint8Array): void {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, MESSAGE_SYNC);
		syncProtocol.writeUpdate(encoder, update);
		this.transport(docId, toB64(encoding.toUint8Array(encoder)));
	}

	/**
	 * Dispatch an inbound frame. `readSyncMessage` applies STEP2/UPDATE bytes to
	 * the doc with REMOTE_ORIGIN (so CrdtManager suppresses re-send and flushes
	 * to disk), and for an inbound STEP1 writes the missing diff (STEP2) into
	 * `replyEncoder`. The reply is sent ONLY if it carries a sub-message
	 * (`length > 1`) — a STEP2/UPDATE produces an empty reply, so there is no
	 * automatic STEP1 back and thus no handshake storm. Mirrors the
	 * `encoding.length(encoder) > 1` gate in Relay's `onmessage` handler.
	 *
	 * After the frame is applied we call `manager.markSynced(path)` ONLY when the
	 * doc's body text is non-empty after the frame. An empty STEP2 (server has no
	 * history yet) must NOT mark the path synced — marking on an empty reply opened
	 * two duplication races:
	 *   (i)  A stale mark surviving reconnect while another device had since filled
	 *        the note: the next `applyLocalEdit` would believe the handshake had
	 *        completed and seed a second local lineage, which merges with the
	 *        server's lineage into duplicated body text.
	 *   (ii) The decline→legacy-POST flow racing its own empty STEP2: the empty
	 *        STEP2 would mark the path synced before the legacy POST result returned,
	 *        causing the next save to route through CRDT and seed a second lineage
	 *        on top of the REST-merged server doc.
	 *
	 * With non-empty-only marking, a note's first content ALWAYS travels the legacy
	 * path (backend merges convergently via PR #846), and CRDT seeding only ever
	 * happens for paths the server has confirmed have content. New-note content
	 * enters via legacy push; the CRDT doc adopts the server lineage once the
	 * server's next STEP2 delivers the merged body.
	 *
	 * An empty STEP2 IS delivered (the server does not suppress it at the `length > 1`
	 * gate for STEP2 replies — only the client drops empty replies to inbound STEP1).
	 * It integrates zero ops into the doc, produces no doc-update event, no flush,
	 * and leaves text.length === 0, so the non-empty guard correctly declines to mark.
	 */
	async handleFrame(noteId: string, b64: string): Promise<void> {
		const doc = await this.mgr.getDoc(noteId);
		const decoder = decoding.createDecoder(fromB64(b64));
		const messageType = decoding.readVarUint(decoder);
		if (messageType !== MESSAGE_SYNC) return;

		const replyEncoder = encoding.createEncoder();
		encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
		const syncType = syncProtocol.readSyncMessage(decoder, replyEncoder, doc, REMOTE_ORIGIN);

		const textLen = (await this.mgr.getText(noteId)).length;

		// Mark synced only when the doc has content after applying the frame.
		// An empty STEP2 integrates no ops and must not mark — see JSDoc above.
		if (textLen > 0) {
			this.mgr.markSynced(noteId);
		} else if (syncType === syncProtocol.messageYjsSyncStep2) {
			// A STEP2 that leaves the doc empty is the server's authoritative
			// "this note is genuinely empty" reply to our discovery STEP1: an empty
			// note produces no content-bearing update, so the update→flush path
			// never creates the file. Materialize it here, off the handshake.
			//
			// This replaces the former wall-clock timer (#547): the timer guessed
			// emptiness from absence-of-frame, and under load a merely-slow content
			// STEP2 let a premature EMPTY file race onto disk before the real body
			// arrived. Keying off the STEP2 message type removes the race — a
			// non-empty note's first STEP2 always carries its full content
			// (textLen > 0, handled above), and a STEP1 frame is not a STEP2, so
			// neither can reach this branch.
			this.onEmptyStep2?.(noteId);
		}

		if (encoding.length(replyEncoder) > 1) {
			this.transport(this.mgr.docId(noteId), toB64(encoding.toUint8Array(replyEncoder)));
		}
	}
}
