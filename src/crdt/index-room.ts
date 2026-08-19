import * as Y from "yjs";
import { NoteProvider } from "./note-provider";
import { SyncStore } from "./sync-store";

/** The name of the shared map. Must match the server (`CrdtIndexDoc.map_name/0`)
 *  and Relay (`SyncStore.ts:20`) exactly — it is the wire contract, so a typo
 *  here syncs an empty doc forever without erroring. */
export const FILEMETA_MAP = "filemeta_v0";

export interface IndexRoomDeps {
	/** Hand a base64 y-protocols frame to the index room. Returns false when the
	 *  crdt: topic is not joined, so the provider buffers and flushes on rejoin. */
	send: (b64: string) => boolean;
	/** Fired once the room's state has landed (first inbound syncStep2). */
	onSynced?: () => void;
}

/** The client half of the per-vault index room (#362, engram-app/Engram#1146).
 *
 * One `Y.Doc` holding one map, bound to the channel's index transport by the
 * same `NoteProvider` that drives note rooms — the provider is transport
 * machinery (sync protocol, echo guard, offline buffer) with nothing
 * note-specific in it, so a second implementation would be a second set of
 * bugs.
 *
 * Reads and writes go through `store`, never the map directly. The layering is
 * the point: see `SyncStore`.
 */
export class IndexRoom {
	readonly doc: Y.Doc;
	readonly store: SyncStore;
	private readonly provider: NoteProvider;

	constructor(deps: IndexRoomDeps) {
		this.doc = new Y.Doc();
		this.store = new SyncStore(this.doc.getMap(FILEMETA_MAP));
		this.provider = new NoteProvider(this.doc, {
			// The provider classifies frames so a handshake reply is never gated
			// behind an op. The index room has no create-ack gate, so both classes
			// take the same path out.
			send: (frame) => deps.send(frame),
			onSynced: deps.onSynced,
		});

		// ADVERTISED. `NoteProvider` sends syncStep1 only when advertised, and it
		// defaults to false because a note room must be able to deliver ops
		// WITHOUT opening a room (the connect-storm the fan-out design avoids).
		// The index room is the opposite case: it has exactly one room per vault
		// and it must pull the vault's persisted state.
		//
		// Without this the room was WRITE-ONLY. It never asked for state, so a
		// device knew only what its own data.json cached, and `getOrMint` minted a
		// fresh id for any note the server already owned — a duplicate, which the
		// server's projection then repathed the row to match. Set in the
		// constructor rather than in `connect()` so it cannot be missed by a
		// caller that flips `setConnected` first and consumes the false->true
		// edge before advertising.
		this.provider.setAdvertised(true);
	}

	/** Advertise syncStep1 and start exchanging state. */
	connect(): void {
		this.provider.connect();
	}

	/** Transport up/down. Down buffers rather than drops — an index write made
	 *  offline is a claim, and losing it silently is the failure mode the server
	 *  tail log exists to prevent on the other side of the wire. */
	setConnected(connected: boolean): void {
		this.provider.setConnected(connected);
	}

	/** Re-buffer a frame the server refused (`rate_limited`,
	 *  `index_frame_rejected`) so it is re-offered on the next connect flush.
	 *
	 *  Kind is always "op": the index room has no create-ack gate, so handshake
	 *  and op frames take the same path out (see the provider wiring above) and
	 *  the classification cannot strand anything here the way it could on a note
	 *  room. Without this the claim waits for the next reconnect handshake to be
	 *  re-derived, and until then the server answers a path it does not own. */
	requeue(b64: string): void {
		this.provider.requeue(b64, "op");
	}

	/** Frames are waiting to go out. */
	get hasBuffered(): boolean {
		return this.provider.hasBuffered;
	}

	/** Re-offer buffered frames on a socket that is already up.
	 *
	 *  Without this, `requeue` was decorative: the buffer drains on the
	 *  disconnected->connected EDGE, which for the index room only happens on a
	 *  fresh crdt-topic join, so a rate-limited claim waited for exactly the
	 *  rejoin it would have recovered on anyway. */
	drain(): void {
		this.provider.drain();
	}

	/** Feed an inbound `crdt_index_msg` frame.
	 *
	 *  Returns false when the frame could not be applied. A malformed or hostile
	 *  frame must not throw out of the socket's message handler — the note path
	 *  makes the same guarantee ("never leak an unhandled rejection from the
	 *  inbound hot path") and has a regression test for it. Throwing here escaped
	 *  to window.onerror, which never reaches rlog() and so is invisible in Loki. */
	receive(b64: string): boolean {
		try {
			this.provider.receive(b64);
			return true;
		} catch {
			return false;
		}
	}

	/** True once the peer's state has landed. Reading the store before this is
	 *  legal but answers only from local layers — a caller that needs to know
	 *  the difference (do not mint an id for a path the server already knows)
	 *  must wait for it. */
	get synced(): boolean {
		return this.provider.synced;
	}

	destroy(): void {
		this.provider.destroy();
		this.doc.destroy();
	}
}
