/**
 * Tests: IndexRoom — the client half of the per-vault index room (#362).
 *
 * Two IndexRooms wired to each other stand in for two devices with the server
 * relaying between them. That is the property worth pinning: a claim made on
 * one device reaches the other through the real sync protocol, not through a
 * hand-rolled fake of it.
 */
import { describe, expect, test } from "bun:test";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { FILEMETA_MAP, IndexRoom } from "../src/crdt/index-room";
import { fromB64, MESSAGE_SYNC, toB64 } from "../src/crdt/wire";

/** Wire two rooms together directly. The server is a relay for these frames,
 *  so device-to-device is the honest shape of the test. */
function pair(): { a: IndexRoom; b: IndexRoom } {
	let a: IndexRoom;
	let b: IndexRoom;

	// Deliver synchronously, but only once both ends exist.
	let ready = false;

	a = new IndexRoom({
		send: (frame) => {
			if (ready) b.receive(frame);
			return true;
		},
	});
	b = new IndexRoom({
		send: (frame) => {
			if (ready) a.receive(frame);
			return true;
		},
	});

	ready = true;
	a.connect();
	b.connect();

	return { a, b };
}

describe("two devices converge", () => {
	test("a committed claim reaches the other device", () => {
		const { a, b } = pair();

		a.store.set("a.md", { note_id: "id-a" });
		a.store.commit();

		expect(b.store.get("a.md")).toBe("id-a");
	});

	test("staged state does NOT reach the other device", () => {
		const { a, b } = pair();

		a.store.set("secret.md", { note_id: "id-secret" });

		expect(a.store.get("secret.md")).toBe("id-secret");
		expect(b.store.get("secret.md")).toBeNull();
	});

	test("a rename lands as a move, not a duplicate", () => {
		const { a, b } = pair();
		a.store.set("Old/a.md", { note_id: "id-a" });
		a.store.commit();
		expect(b.store.get("Old/a.md")).toBe("id-a");

		a.store.rename("Old/a.md", "New/a.md");
		a.store.commit();

		expect(b.store.get("New/a.md")).toBe("id-a");
		expect(b.store.get("Old/a.md")).toBeNull();
		expect(b.store.pathForId("id-a")).toBe("New/a.md");
	});

	test("a delete propagates", () => {
		const { a, b } = pair();
		a.store.set("gone.md", { note_id: "id-gone" });
		a.store.commit();

		a.store.delete("gone.md");
		a.store.commit();

		expect(b.store.get("gone.md")).toBeNull();
	});

	// Both devices claiming different paths must MERGE, not clobber. This is the
	// property a REST manifest could not give us and the whole reason the index
	// is a CRDT.
	test("concurrent claims from both devices merge", () => {
		const { a, b } = pair();

		a.store.set("from-a.md", { note_id: "id-a" });
		b.store.set("from-b.md", { note_id: "id-b" });
		a.store.commit();
		b.store.commit();

		for (const room of [a, b]) {
			expect(room.store.get("from-a.md")).toBe("id-a");
			expect(room.store.get("from-b.md")).toBe("id-b");
		}
	});
});

describe("offline behaviour", () => {
	// A claim made offline is not a cosmetic loss: under map-authority it IS the
	// commit, so dropping it silently is the failure the server's tail log exists
	// to prevent on its side of the wire.
	test("a claim made while disconnected is delivered on reconnect", () => {
		const frames: string[] = [];
		let connected = false;

		const a = new IndexRoom({
			send: (frame) => {
				if (!connected) return false;
				frames.push(frame);
				return true;
			},
		});
		a.setConnected(false);

		a.store.set("offline.md", { note_id: "id-offline" });
		a.store.commit();
		expect(frames.length).toBe(0);

		connected = true;
		a.setConnected(true);

		expect(frames.length).toBeGreaterThan(0);
	});
});

describe("the map name is the wire contract", () => {
	// A typo here syncs an empty doc forever without ever erroring, so it is
	// asserted against the literal the server uses.
	test("is filemeta_v0", () => {
		const a = new IndexRoom({ send: () => true });
		a.store.set("x.md", { note_id: "id-x" });
		a.store.commit();

		expect(a.doc.getMap("filemeta_v0").get("x.md")).toEqual({ note_id: "id-x" });
	});
});

// #433 review finding: the four channel tests stopped at the callback, so
// neither `requeue` nor the drain that makes it mean anything was covered.
// This is the actual re-delivery path.
describe("requeue + drain (the re-offer path, #433)", () => {
	/** One room whose transport can be refused on demand, so a rejected frame
	 *  can be handed back the way the channel hands it back. */
	function refusable() {
		const sent: string[] = [];
		let accept = true;
		const room = new IndexRoom({
			send: (frame) => {
				if (!accept) return false;
				sent.push(frame);
				return true;
			},
		});
		room.connect();
		return {
			room,
			sent,
			refuse: () => {
				accept = false;
			},
			allow: () => {
				accept = true;
			},
		};
	}

	test("a requeued frame is re-offered on the next rejoin", () => {
		const { room, sent } = refusable();
		sent.length = 0;

		// The channel accepted this on the wire, so the provider does NOT buffer
		// it; only the server's later error reply says it was refused.
		room.store.set("Notes/claim.md", { note_id: "note-1" });
		room.store.commit();
		const delivered = sent.pop();
		expect(delivered).toBeDefined();

		room.requeue(delivered as string);
		sent.length = 0;

		// A REJOIN is what flushes it. Deliberately not a poll: forcing a flush
		// with setConnected(true) consumes the false->true edge, so the real
		// rejoin then skips its syncStep1 and the room goes write-only.
		room.setConnected(false);
		room.connect();
		expect(sent).toContain(delivered);
	});

	test("a rejoin that is still refused keeps the frame rather than dropping it", () => {
		const { room, sent, refuse, allow } = refusable();
		room.store.set("Notes/claim2.md", { note_id: "note-2" });
		room.store.commit();
		const delivered = sent.pop() as string;

		room.requeue(delivered);
		refuse();
		room.setConnected(false);
		room.connect();

		allow();
		sent.length = 0;
		room.setConnected(false);
		room.connect();
		// Still there to be re-offered: a refused rejoin must not consume the claim.
		expect(sent).toContain(delivered);
	});
});

describe("a clock gap is repaired, not lived with (CI run 39053943843)", () => {
	// A frame whose structs depend on an update this device never received is
	// parked by Yjs as pending, and every LATER frame from that peer parks behind
	// it. Nothing re-requested the gap, so the device stayed blind to that peer's
	// identity writes until the next reconnect. A syncStep1 is the protocol's own
	// "send me what I am missing".
	test("a frame that leaves structs pending re-sends syncStep1 and the gap fills", () => {
		const server = new Y.Doc();
		const peer = new Y.Doc();
		const sent: Uint8Array[] = [];
		const b = new IndexRoom({
			send: (frame) => {
				sent.push(fromB64(frame));
				return true;
			},
		});
		b.connect();
		// Answer B's syncStep1 the way the server does: with a syncStep2.
		const serve = () => {
			for (const frame of sent.splice(0)) {
				const dec = decoding.createDecoder(frame);
				decoding.readVarUint(dec);
				const reply = encoding.createEncoder();
				encoding.writeVarUint(reply, MESSAGE_SYNC);
				syncProtocol.readSyncMessage(dec, reply, server, null);
				if (encoding.length(reply) > 1) b.receive(toB64(encoding.toUint8Array(reply)));
			}
		};
		serve();

		peer.getMap(FILEMETA_MAP).set("first.md", { note_id: "id-1" });
		Y.applyUpdate(server, Y.encodeStateAsUpdate(peer)); // B misses this fan-out
		const sv = Y.encodeStateVector(peer);
		peer.getMap(FILEMETA_MAP).set("second.md", { note_id: "id-2" });
		const update = Y.encodeStateAsUpdate(peer, sv);
		Y.applyUpdate(server, update);
		const frame = encoding.createEncoder();
		encoding.writeVarUint(frame, MESSAGE_SYNC);
		syncProtocol.writeUpdate(frame, update);
		b.receive(toB64(encoding.toUint8Array(frame)));
		expect(b.doc.store.pendingStructs).not.toBeNull();

		serve();

		expect(b.doc.store.pendingStructs).toBeNull();
		expect(b.store.get("first.md")).toBe("id-1");
		expect(b.store.get("second.md")).toBe("id-2");
	});
});
