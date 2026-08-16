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

	/** Feed an inbound `crdt_index_msg` frame. */
	receive(b64: string): void {
		this.provider.receive(b64);
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
