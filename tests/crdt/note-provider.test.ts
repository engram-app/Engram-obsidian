import { describe, expect, test } from "bun:test";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { NoteProvider } from "../../src/crdt/note-provider";
import { fromB64, MESSAGE_SYNC } from "../../src/crdt/wire";

/**
 * Rebuild-copying-Relay tests. The provider is a faithful port of Relay's
 * YSweetProvider sync core (src/client/provider.ts): one persistent Y.Doc,
 * `syncStep1` on every (re)connect, `readSyncMessage` applies convergence (NO
 * text-verify gate), local updates buffered while disconnected and flushed on
 * connect. The doc is NEVER torn down on reconnect — so a reconnect is a clean
 * state-vector diff, never a full re-push that doubles the lineage.
 *
 * An in-memory two-peer relay stands in for the server + a second device: every
 * frame one peer sends is delivered to the other's `receive`.
 */

/** Wire two providers so each one's outbound frames reach the other. Returns a
 *  toggle to simulate the transport going down (frames are dropped, mirroring a
 *  socket that isn't joined) and back up. */
function link(a: NoteProvider, b: NoteProvider) {
	let up = true;
	a.setSend((frame) => {
		if (up) queueMicrotask(() => b.receive(frame));
		return up;
	});
	b.setSend((frame) => {
		if (up) queueMicrotask(() => a.receive(frame));
		return up;
	});
	return {
		up: () => up,
		setUp: (v: boolean) => {
			up = v;
		},
	};
}

const flush = () => new Promise<void>((r) => setTimeout(r, 5));

describe("NoteProvider (Relay model)", () => {
	test("syncStep1/syncStep2 converges two peers with NO text-verify gate", async () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const a = new NoteProvider(docA);
		const b = new NoteProvider(docB);
		link(a, b);

		docA.getText("content").insert(0, "hello from A");
		a.connect();
		b.connect();
		await flush();

		// B converged to A's content purely via the sync protocol — no equality
		// check, no staged "commit deferred": readSyncMessage applied it.
		expect(docB.getText("content").toString()).toBe("hello from A");
		a.destroy();
		b.destroy();
	});

	test("reconnect re-syncs on the SAME doc and does NOT double the content", async () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const a = new NoteProvider(docA);
		const b = new NoteProvider(docB);
		const wire = link(a, b);
		a.connect();
		b.connect();

		docA.getText("content").insert(0, "base");
		await flush();
		expect(docB.getText("content").toString()).toBe("base");

		// Transport drops (socket not joined). An edit lands while offline — held.
		wire.setUp(false);
		a.setConnected(false);
		docA.getText("content").insert(4, " + offline edit");
		await flush();
		// B hasn't seen it yet (transport down).
		expect(docB.getText("content").toString()).toBe("base");

		// Reconnect: the provider re-runs syncStep1 on the SAME doc and flushes the
		// buffered update. Convergence must NOT double "base" or the offline edit.
		wire.setUp(true);
		a.setConnected(true);
		b.setConnected(true);
		await flush();

		expect(docA.getText("content").toString()).toBe("base + offline edit");
		expect(docB.getText("content").toString()).toBe("base + offline edit");
		a.destroy();
		b.destroy();
	});

	test("an ADVERTISED note reconnects via syncStep1 (state vector), never a full-state re-push", async () => {
		const doc = new Y.Doc();
		doc.getText("content").insert(0, "x".repeat(5000)); // a big doc
		const sent: number[] = [];
		const p = new NoteProvider(doc);
		p.setSend((frame) => {
			sent.push(frame.length);
			return true;
		});

		p.setAdvertised(true); // open a room — this note advertises syncStep1
		p.connect(); // fresh connect
		p.setConnected(false);
		sent.length = 0;
		p.setConnected(true); // RECONNECT — must be a compact syncStep1, not 5000+ bytes

		// The reconnect's first frame is a state-vector syncStep1: tiny, independent
		// of doc size. A full-state re-push (the doubling bug) would be >5000 bytes.
		expect(sent.length).toBeGreaterThan(0);
		expect(Math.max(...sent)).toBeLessThan(200);
		p.destroy();
	});

	test("a connected-but-UN-advertised note sends NO syncStep1 (cold-send / fan-out room-free invariant)", async () => {
		const doc = new Y.Doc();
		const sent: string[] = [];
		const p = new NoteProvider(doc);
		p.setSend((frame) => {
			sent.push(frame);
			return true;
		});

		// Connect WITHOUT advertising: a cold SEND or a fan-out RECEIVE must not
		// open a room. No syncStep1 goes out on connect...
		p.connect();
		expect(sent.length).toBe(0);

		// ...but a LOCAL edit still ships (send works without a room).
		doc.getText("content").insert(0, "cold edit");
		await flush();
		expect(sent.length).toBe(1); // the update frame, no preceding syncStep1

		// Reconnect stays room-free too — still no syncStep1.
		p.setConnected(false);
		sent.length = 0;
		p.setConnected(true);
		expect(sent.length).toBe(0);
		p.destroy();
	});

	test("an EMPTY syncStep2 still fires onSynced (#484)", async () => {
		// #484 theorised that a re-handshake whose syncStep2 carries no ops yields
		// no inbound frame, so `commitCrdtConvergence` never runs and catch-up
		// re-fires forever. It does not: `receive` classifies the frame BEFORE any
		// size check, and the `length > 1` gate suppresses only the OUTBOUND reply.
		// A handshake that carries nothing back still commits — correctly, since
		// "nothing to send" means the doc already holds the peer's state.
		const docA = new Y.Doc();
		docA.getText("content").insert(0, "same");
		// Seed B from A's actual STATE, not by re-typing the same characters: two
		// independently-typed "same"s are a disjoint lineage that merges to
		// "samesame", and B's reply would carry 24 bytes of ops. Sharing the
		// lineage is what makes the reply genuinely empty. Seeded BEFORE the
		// provider exists so the applyUpdate isn't broadcast as a local edit.
		const docB = new Y.Doc();
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

		let synced = 0;
		const a = new NoteProvider(docA, { onSynced: () => synced++ });
		const b = new NoteProvider(docB);
		const fromB: Uint8Array[] = [];
		a.setSend((frame) => {
			queueMicrotask(() => b.receive(frame));
			return true;
		});
		b.setSend((frame) => {
			fromB.push(fromB64(frame));
			queueMicrotask(() => a.receive(frame));
			return true;
		});

		a.setAdvertised(true);
		a.connect();
		b.connect();
		await flush();

		// B sent exactly one frame: a syncStep2 whose update is the 2-byte EMPTY
		// update. Decoded rather than length-checked so a future change that makes
		// it carry ops fails here instead of silently voiding this test.
		expect(fromB.length).toBe(1);
		const decoder = decoding.createDecoder(fromB[0] as Uint8Array);
		expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
		expect(decoding.readVarUint(decoder)).toBe(syncProtocol.messageYjsSyncStep2);
		expect(Array.from(decoding.readVarUint8Array(decoder))).toEqual([0, 0]);

		// That empty frame still flipped `synced` and fired the callback.
		expect(a.synced).toBe(true);
		expect(synced).toBe(1);
		expect(docA.getText("content").toString()).toBe("same"); // no doubling
		a.destroy();
		b.destroy();
	});
});
