/**
 * Tests: IndexRoom — the client half of the per-vault index room (#362).
 *
 * Two IndexRooms wired to each other stand in for two devices with the server
 * relaying between them. That is the property worth pinning: a claim made on
 * one device reaches the other through the real sync protocol, not through a
 * hand-rolled fake of it.
 */
import { describe, expect, test } from "bun:test";
import { IndexRoom } from "../src/crdt/index-room";

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
	// asserted against the literal the server and Relay both use.
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

	test("a requeued frame is held, then re-sent by drain()", () => {
		const { room, sent, refuse, allow } = refusable();
		sent.length = 0;

		// The channel accepted this one on the wire, so the provider does NOT
		// buffer it; only the server's later error reply says it was refused.
		// set() stages into the overlay; commit() is what publishes a frame.
		room.store.set("Notes/claim.md", { note_id: "note-1" });
		room.store.commit();
		const delivered = sent.pop();
		expect(delivered).toBeDefined();
		expect(room.hasBuffered).toBe(false);

		room.requeue(delivered as string);
		expect(room.hasBuffered).toBe(true);

		// Drain on a socket that is already up. Without this the frame waits for
		// a rejoin, which is exactly the recovery requeue was meant to beat.
		room.drain();
		expect(sent).toContain(delivered);
		expect(room.hasBuffered).toBe(false);

		refuse();
		allow();
	});

	test("a drain that is still refused keeps the frame rather than dropping it", () => {
		const { room, sent, refuse, allow } = refusable();
		room.store.set("Notes/claim2.md", { note_id: "note-2" });
		room.store.commit();
		const delivered = sent.pop() as string;

		room.requeue(delivered);
		refuse();
		room.drain();
		// Still held: a refused re-offer must not silently consume the claim.
		expect(room.hasBuffered).toBe(true);

		allow();
		room.drain();
		expect(room.hasBuffered).toBe(false);
		expect(sent).toContain(delivered);
	});
});
