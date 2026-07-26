import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { NoteProvider } from "../../src/crdt/note-provider";

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
});
