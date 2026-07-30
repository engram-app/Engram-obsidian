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
import { fromB64, MESSAGE_SYNC, toB64 } from "./wire";

/** What a frame is FOR, so a transport can gate the two classes differently.
 *  Deliberately mirrors the backend's own lanes (`frame_class_b64` in
 *  crdt_channel.ex, which buckets syncStep1 and a small syncStep2 as
 *  `:handshake` and everything else as `:edit`):
 *
 *  - `"handshake"` — protocol traffic tied to a doc the PEER has already
 *    vouched for. Either syncStep1 (a bare state vector, no content) or the
 *    syncStep2 written in reply to an inbound syncStep1. The server only ever
 *    sends us a syncStep1 for a doc_id it validated through `note_in_vault?`
 *    FIRST (crdt_channel.ex `resolve_note_id`), so by the time we reply, the
 *    row provably exists.
 *  - `"op"` — a local edit this device originated, unsolicited.
 *
 *  The create-before-edit gate holds `"op"` ONLY. It exists to keep content for
 *  a not-yet-created note off the wire, and neither handshake frame can be
 *  that: gating the pull left a note that missed its fan-out permanently deaf
 *  (#1130), and gating the reply pinned the healed doc resident forever (its
 *  buffer never drains, so `isFullySynced` stays false and `closeDoc` can never
 *  evict it). */
export type FrameKind = "handshake" | "op";

/** Transport: hand a base64 y-protocols frame to the wire. Returns false when
 *  the frame could NOT be delivered (socket not joined) so the provider holds it
 *  and flushes on reconnect — mirroring Relay's `wsconnected` buffer gate. */
export type ProviderSend = (frame: string, kind: FrameKind) => boolean;

export interface NoteProviderOpts {
	send?: ProviderSend;
	/** Fired the first time an inbound syncStep2 lands (Relay's `provider.synced`
	 *  transition) — op-level proof the doc holds the peer's content. */
	onSynced?: () => void;
	/** Start MUTED: the doc's update handler ignores local updates until activate()
	 *  is called. The registry sets this so the IndexedDB replay (y-indexeddb applies
	 *  stored updates with no origin, which otherwise reads as a fresh local edit) is
	 *  NOT re-broadcast to the server — the replayed state is already covered by the
	 *  syncStep1 the provider sends on connect. Canonical y-websocket + y-indexeddb
	 *  ordering: hydrate local persistence FIRST, then start network sync. Direct
	 *  (no-persistence) callers omit this and broadcast immediately. */
	deferActivation?: boolean;
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
	/** False while local persistence is still replaying into the doc: the update
	 *  handler drops those (already-persisted) updates instead of broadcasting them.
	 *  Flipped true by activate() once IndexedDB has finished loading. */
	private active: boolean;
	private send: ProviderSend;
	private readonly onSynced?: () => void;
	/** Frames produced while the transport was down; flushed on reconnect. Each
	 *  keeps its own kind: a buffered frame must be re-offered under the SAME
	 *  classification it was produced with, or the flush would re-gate a
	 *  handshake reply as an op and strand it in the buffer forever. */
	private readonly buffer: { frame: string; kind: FrameKind }[] = [];
	private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;

	constructor(doc: Y.Doc, opts: NoteProviderOpts = {}) {
		this.doc = doc;
		this.send = opts.send ?? (() => false);
		this.onSynced = opts.onSynced;
		this.active = !opts.deferActivation;
		// Relay's _updateHandler: a LOCAL edit (origin !== this) becomes a sync
		// UPDATE frame; a remote-applied op (origin === this, set by
		// readSyncMessage below) is NOT re-sent — that's the echo guard. While
		// inactive (IndexedDB still replaying), drop the update too: the replay is
		// already-persisted state the server has, and re-broadcasting it forks the
		// lineage into a non-converging storm (the file-switch wedge).
		this.updateHandler = (update, origin) => {
			if (origin === this) return;
			if (!this.active) {
				// IndexedDB replay (or any pre-hydration update) is dropped instead of
				// broadcast: it is already-persisted state the syncStep1 covers.
				return;
			}
			const encoder = encoding.createEncoder();
			encoding.writeVarUint(encoder, MESSAGE_SYNC);
			syncProtocol.writeUpdate(encoder, update);
			// A local edit — the one frame class the create-ack gate exists to hold.
			this.broadcast(toB64(encoding.toUint8Array(encoder)), "op");
		};
		this.doc.on("update", this.updateHandler);
	}

	/** Enable broadcasting of local doc updates. Call ONLY after local persistence
	 *  has finished replaying (IndexedDB whenSynced), so the replayed state is not
	 *  re-broadcast — syncStep1 on connect already advertises it. No-op if the
	 *  provider started active (a direct, no-persistence caller). */
	activate(): void {
		this.active = true;
	}

	/** True when the server holds our latest state: connected, we have seen at
	 *  least one inbound syncStep2, and nothing is waiting in the offline send
	 *  buffer. Idle eviction (ProviderRegistry.closeDoc) is data-safe ONLY then — an
	 *  offline/unsynced/buffered doc must stay resident so its edits re-advertise on
	 *  reconnect (the switch-away recovery guarantee; evicting it would reintroduce
	 *  the "moving between files, only some make it" data-loss class). */
	isFullySynced(): boolean {
		return this.connected && this.synced && this.buffer.length === 0;
	}

	/** Swap the transport (e.g. after a socket reconnect built a fresh channel).
	 *  The doc + buffer are untouched. */
	setSend(send: ProviderSend): void {
		this.send = send;
	}

	/** Relay's broadcastMessage: send now if connected, else buffer for the next
	 *  onopen flush. A refused send (transport down mid-flight) also buffers. */
	private broadcast(frame: string, kind: FrameKind): void {
		const sent = this.connected && this.send(frame, kind);
		if (sent) return;
		this.buffer.push({ frame, kind });
	}

	/** Relay's onopen: (re)connect the transport. */
	connect(): void {
		this.setConnected(true);
	}

	/** Open (true) or close (false) this note's room. Advertising sends syncStep1
	 *  on the false->true EDGE only (the down-sync pull). Un-advertising stops the
	 *  re-advertise but leaves the transport connected — SEND/RECEIVE of ops still
	 *  work (idle notes converge over the fan-out without a room).
	 *
	 *  Transition-guarded: a redundant setAdvertised(true) on an ALREADY-advertised
	 *  note must NOT re-fire syncStep1. The server answers every inbound syncStep1
	 *  with a fresh [syncStep2, syncStep1] pair, so a re-enroll on every
	 *  `crdt_doc_ready` announce (which the server also sends to the sender) turned
	 *  into an endless re-handshake storm. Relay sends syncStep1 once per
	 *  connection; a real re-handshake goes reset()->enroll() (advertised flips
	 *  false then true, so this edge fires again). */
	setAdvertised(advertised: boolean): void {
		if (this.advertised === advertised) return; // no edge -> no redundant step1
		this.advertised = advertised;
		if (advertised && this.connected) this.sendSyncStep1();
	}

	setConnected(connected: boolean): void {
		if (!connected) {
			this.connected = false;
			return;
		}
		const wasConnected = this.connected;
		this.connected = true;
		// syncStep1 (state vector) ONLY on the disconnected->connected EDGE, and only
		// when advertised. A connect that isn't advertised just flushes; a REDUNDANT
		// setConnected(true) (already connected — e.g. flushHeldState re-flushing the
		// create-ack buffer, or a re-enroll) must NOT re-fire syncStep1 (that fed the
		// re-handshake storm). The buffer flush below still runs unconditionally so
		// held frames always deliver. NEVER a full-state push.
		if (this.advertised && !wasConnected) this.sendSyncStep1();
		// Flush anything buffered while offline; re-buffer whatever is still refused.
		// Each frame keeps the kind it was produced with — re-offering a buffered
		// handshake reply as an "op" would hand it to the create-ack gate, which
		// refuses it, which re-buffers it, forever (and a never-draining buffer
		// pins the doc resident via isFullySynced/closeDoc).
		const pending = this.buffer.splice(0);
		for (const held of pending) {
			if (!this.send(held.frame, held.kind)) this.buffer.push(held);
		}
	}

	private sendSyncStep1(): void {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, MESSAGE_SYNC);
		syncProtocol.writeSyncStep1(encoder, this.doc);
		this.send(toB64(encoding.toUint8Array(encoder)), "handshake");
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
			// readSyncMessage writes a reply for an inbound syncStep1 ONLY, and the
			// server sends one only for a doc_id it already resolved through
			// `note_in_vault?`. The row provably exists, so this syncStep2 is
			// handshake traffic, not gated content.
			this.broadcast(toB64(encoding.toUint8Array(reply)), "handshake");
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
