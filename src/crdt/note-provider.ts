// A faithful port of Relay's YSweetProvider sync core (../relay/Relay/src/
// client/provider.ts), adapted to a pluggable string-frame transport (our
// Phoenix crdt: topic instead of Relay's raw WebSocket).
//
// THE MODEL (why this replaces our bespoke CrdtManager/convergence machinery):
//   - ONE persistent Y.Doc per note. The provider NEVER tears the doc down on a
//     transport reconnect — it just re-advertises via syncStep1.
//   - Convergence IS `syncProtocol.readSyncMessage`. No text-equality gate, no
//     staged "commit deferred", no seed gate. Yjs merges; we trust it.
//   - (Re)connect sends syncStep1 — a compact STATE VECTOR, never a full-state
//     re-push. The peer replies syncStep2 with only the ops we lack. This is
//     what kills the lineage-doubling wedge: a reconnect (or even a fresh
//     plugin instance that rehydrated the doc from IndexedDB) advertises a state
//     vector, so the server sends back only the diff.
//   - Local edits are buffered while the transport is down and flushed on
//     reconnect (Relay's broadcastMessage buffer + onopen flush).
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";
import { MESSAGE_SYNC, fromB64, toB64 } from "./wire";

/** Transport: hand a base64 y-protocols frame to the wire. Returns false when
 *  the frame could NOT be delivered (socket not joined) so the provider holds it
 *  and flushes on reconnect — mirroring Relay's `wsconnected` buffer gate. */
export type ProviderSend = (frame: string) => boolean;

export interface NoteProviderOpts {
	send?: ProviderSend;
	/** Fired the first time an inbound syncStep2 lands (Relay's `provider.synced`
	 *  transition) — op-level proof the doc holds the peer's content. */
	onSynced?: () => void;
}

export class NoteProvider {
	readonly doc: Y.Doc;
	/** True once an inbound syncStep2 has been applied (Relay parity). */
	synced = false;
	private connected = false;
	/** True when this note has an OPEN room — it advertises syncStep1 (the
	 *  down-sync PULL request) on connect + reconnect. A note that only SENDS
	 *  (a cold edit to a closed note) or only RECEIVES (vault-channel fan-out)
	 *  stays un-advertised: it delivers/merges ops WITHOUT opening a room, so an
	 *  idle note never contributes to the server room fan-out (the connect-storm
	 *  the fan-out design avoids). Set via setAdvertised on enroll. */
	private advertised = false;
	private send: ProviderSend;
	private readonly onSynced?: () => void;
	/** Frames produced while the transport was down; flushed on reconnect. */
	private readonly buffer: string[] = [];
	private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;

	constructor(doc: Y.Doc, opts: NoteProviderOpts = {}) {
		this.doc = doc;
		this.send = opts.send ?? (() => false);
		this.onSynced = opts.onSynced;
		// Relay's _updateHandler: a LOCAL edit (origin !== this) becomes a sync
		// UPDATE frame; a remote-applied op (origin === this, set by
		// readSyncMessage below) is NOT re-sent — that's the echo guard.
		this.updateHandler = (update, origin) => {
			if (origin === this) return;
			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, MESSAGE_SYNC);
			syncProtocol.writeUpdate(encoder, update);
			this.broadcast(toB64(encoding.toUint8Array(encoder)));
		};
		this.doc.on("update", this.updateHandler);
	}

	/** Swap the transport (e.g. after a socket reconnect built a fresh channel).
	 *  The doc + buffer are untouched. */
	setSend(send: ProviderSend): void {
		this.send = send;
	}

	/** Relay's broadcastMessage: send now if connected, else buffer for the next
	 *  onopen flush. A refused send (transport down mid-flight) also buffers. */
	private broadcast(frame: string): void {
		if (this.connected && this.send(frame)) return;
		this.buffer.push(frame);
	}

	/** Relay's onopen: (re)connect the transport. */
	connect(): void {
		this.setConnected(true);
	}

	/** Open (true) or close (false) this note's room. Advertising sends syncStep1
	 *  on connect + every reconnect (the down-sync pull). Un-advertising stops the
	 *  re-advertise but leaves the transport connected — SEND/RECEIVE of ops still
	 *  work (idle notes converge over the fan-out without a room). */
	setAdvertised(advertised: boolean): void {
		this.advertised = advertised;
		if (advertised && this.connected) this.sendSyncStep1();
	}

	setConnected(connected: boolean): void {
		if (!connected) {
			this.connected = false;
			return;
		}
		this.connected = true;
		// syncStep1 (state vector) — ONLY when this note holds an open room. A
		// connect that isn't advertised just flushes: a cold SEND / fan-out RECEIVE
		// must not open a room ("STEP1 is only the down-sync pull, never required
		// to SEND" — sync.ts). NEVER a full-state push.
		if (this.advertised) this.sendSyncStep1();
		// Flush anything buffered while offline; re-buffer whatever is still refused.
		const pending = this.buffer.splice(0);
		for (const frame of pending) {
			if (!this.send(frame)) this.buffer.push(frame);
		}
	}

	private sendSyncStep1(): void {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, MESSAGE_SYNC);
		syncProtocol.writeSyncStep1(encoder, this.doc);
		this.send(toB64(encoding.toUint8Array(encoder)));
	}

	/** Relay's messageHandlers[messageSync]: apply an inbound frame and, for an
	 *  inbound syncStep1, reply with syncStep2. The reply is sent ONLY when it
	 *  carries a sub-message (length > 1) — a syncStep2/update yields an empty
	 *  reply, so there's no STEP1 echo loop. `this` is the apply origin so the
	 *  updateHandler above suppresses re-sending remote-applied ops. */
	receive(frameB64: string): void {
		const decoder = decoding.createDecoder(fromB64(frameB64));
		if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
		const reply = encoding.createEncoder();
		encoding.writeVarUint(reply, MESSAGE_SYNC);
		const syncType = syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
		if (encoding.length(reply) > 1) {
			this.broadcast(toB64(encoding.toUint8Array(reply)));
		}
		if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
			this.synced = true;
			this.onSynced?.();
		}
	}

	/** Detach the update listener. Call ONLY when the note truly closes / on
	 *  unload — NOT on a transport reconnect (Relay's provider.destroy). */
	destroy(): void {
		this.doc.off("update", this.updateHandler);
	}
}
