import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { type CrdtManager, REMOTE_ORIGIN } from "./manager";

/** Outer y-protocols message-type tag — we only speak `messageSync`. */
const MESSAGE_SYNC = 0;

export interface CrdtChannelOptions {
	manager: CrdtManager;
	/** Transport: send a base64-encoded y-protocols frame for `docId`. */
	send: (docId: string, frame: string) => void;
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
	}

	/**
	 * Begin the handshake for `path`: advertise our state via a `messageSync`
	 * `writeSyncStep1` frame. Sent at most once per doc — the receiver replies
	 * with a STEP2 (not another STEP1), so there is no echo loop.
	 */
	async startSync(path: string): Promise<void> {
		const id = this.mgr.docId(path);
		if (this.initiated.has(id)) return;
		this.initiated.add(id);
		const doc = await this.mgr.getDoc(path);
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, MESSAGE_SYNC);
		syncProtocol.writeSyncStep1(encoder, doc);
		this.transport(id, toB64(encoding.toUint8Array(encoder)));
	}

	/**
	 * Allow a fresh handshake after a WS reconnect — clears the once-per-doc
	 * guard so `startSync` will send STEP1 again.
	 */
	resetSync(path: string): void {
		this.initiated.delete(this.mgr.docId(path));
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
	 */
	async handleFrame(path: string, b64: string): Promise<void> {
		const doc = await this.mgr.getDoc(path);
		const decoder = decoding.createDecoder(fromB64(b64));
		const messageType = decoding.readVarUint(decoder);
		if (messageType !== MESSAGE_SYNC) return;

		const replyEncoder = encoding.createEncoder();
		encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
		syncProtocol.readSyncMessage(decoder, replyEncoder, doc, REMOTE_ORIGIN);

		if (encoding.length(replyEncoder) > 1) {
			this.transport(this.mgr.docId(path), toB64(encoding.toUint8Array(replyEncoder)));
		}
	}
}
