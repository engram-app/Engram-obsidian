import { expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { CrdtChannel } from "../../src/crdt/channel";
import { CrdtManager } from "../../src/crdt/manager";

let _pairSeq = 0;

/** Wire two CrdtChannels back-to-back through synchronous in-memory transports.
 *  `count` tallies every frame put on the wire so a handshake storm is visible.
 *  Each call uses a unique dbPrefix so fake-indexeddb state doesn't leak across tests. */
function pair() {
	const pfx = `test-${_pairSeq++}`;
	const count = { a: 0, b: 0 };
	// Box pattern: closures capture the box reference, channels fill it after creation.
	const box = { a: null as unknown as CrdtChannel, b: null as unknown as CrdtChannel };

	const mgrA = new CrdtManager({
		dbPrefix: `${pfx}-A`,
		onUpdate: (id, u) => box.a.sendUpdateRaw(id, u),
		onFlushToDisk: async () => {},
	});
	const mgrB = new CrdtManager({
		dbPrefix: `${pfx}-B`,
		onUpdate: (id, u) => box.b.sendUpdateRaw(id, u),
		onFlushToDisk: async () => {},
	});

	box.a = new CrdtChannel({
		manager: mgrA,
		send: (_id, frame) => {
			count.a++;
			void box.b.handleFrame("note.md", frame);
		},
	});
	box.b = new CrdtChannel({
		manager: mgrB,
		send: (_id, frame) => {
			count.b++;
			void box.a.handleFrame("note.md", frame);
		},
	});
	return { mgrA, mgrB, chanA: box.a, chanB: box.b, count };
}

function flush() {
	return new Promise((r) => setTimeout(r, 10));
}

test("step1 handshake transfers state to a fresh peer (real y-protocols frames)", async () => {
	const { mgrA, mgrB, chanB } = pair();
	// markSynced required before seeding (audit P0-1 fix): the gate must be
	// cleared before applyLocalEdit will seed content into an empty doc.
	mgrA.markSynced("note.md");
	await mgrA.applyLocalEdit("note.md", "alpha content", false);

	// B starts empty, asks A for state via step1. A replies step2; B applies it.
	await chanB.startSync("note.md");
	await flush();

	expect(await mgrB.getText("note.md")).toBe("alpha content");
	await mgrA.destroy();
	await mgrB.destroy();
});

test("handshake terminates — no step1 ping-pong storm between two empty peers", async () => {
	// Two empty docs. If startSync's STEP1 made the receiver unconditionally fire
	// its OWN STEP1 back (the bug), these two would ping-pong forever. The codec
	// gate (reply only when length > 1) + the once-per-doc startSync guard must
	// make the wire go quiet after a bounded number of frames.
	const { chanA, count, mgrA, mgrB } = pair();
	await chanA.startSync("note.md");
	await flush();
	await flush();
	const total = count.a + count.b;
	// A sends STEP1 → B's STEP2 reply is empty for a fresh doc → gate drops it.
	expect(total).toBeLessThan(4);
	await mgrA.destroy();
	await mgrB.destroy();
});

// ---------------------------------------------------------------------------
// Review finding 1+2 (mark-synced semantics): non-empty-only marking rule
// ---------------------------------------------------------------------------

test("handleFrame: inbound frame that populates the doc marks isSynced true", async () => {
	// A's doc has content; B is empty. After B applies the STEP2 from A, B's doc
	// should be non-empty and B's manager must mark the path as synced.
	const { mgrA, mgrB, chanB } = pair();

	// Seed A so B gets non-empty content via STEP2.
	mgrA.markSynced("note.md");
	await mgrA.applyLocalEdit("note.md", "hello world", false);

	// B sends STEP1 → A sends STEP2 with "hello world" → B's handleFrame fires.
	await chanB.startSync("note.md");
	await flush();

	// B received a content-bearing STEP2 — must be marked synced.
	expect(mgrB.isSynced("note.md")).toBe(true);

	await mgrA.destroy();
	await mgrB.destroy();
});

test("handleFrame: inbound frame that leaves the doc empty does NOT mark isSynced", async () => {
	// Both peers start empty. B sends STEP1 to A; A replies with an empty STEP2
	// (it has no history). Applying an empty STEP2 integrates zero ops — the doc
	// stays at text.length === 0 — so the non-empty guard must decline to mark.
	const { mgrA, mgrB, chanB } = pair();

	// Neither side has content — empty-vs-empty handshake.
	await chanB.startSync("note.md");
	await flush();

	// A's empty STEP2 should NOT have marked B as synced.
	expect(mgrB.isSynced("note.md")).toBe(false);

	await mgrA.destroy();
	await mgrB.destroy();
});

test("concurrent edits on both peers converge", async () => {
	const { mgrA, mgrB } = pair();

	// Seed the same base independently on both sides (no channel routing for seeds).
	// Both docs get "shared" as their starting text via their own IDB-backed docs.
	// markSynced required before seeding on each side (audit P0-1 fix).
	mgrA.markSynced("note.md");
	mgrB.markSynced("note.md");
	await mgrA.applyLocalEdit("note.md", "shared", false);
	await mgrB.applyLocalEdit("note.md", "shared", false);
	await flush();
	await flush();

	// Make truly concurrent edits: mutate both docs in the same synchronous block
	// so both update frames are queued before either handleFrame runs. Because
	// onUpdate → sendUpdateRaw → void chanX.handleFrame() fires synchronously
	// inside each Y.Text mutation, both cross-wire deliveries are enqueued as
	// microtasks before either resolves.
	const aDoc = await mgrA.getDoc("note.md");
	const bDoc = await mgrB.getDoc("note.md");

	aDoc.getText("content").insert(aDoc.getText("content").length, " + A");
	bDoc.getText("content").insert(0, "B ");

	// Let the cross-wired handleFrames settle.
	await flush();
	await flush();

	const a = await mgrA.getText("note.md");
	const b = await mgrB.getText("note.md");
	expect(a).toBe(b); // convergence
	expect(a).toContain("A");
	expect(a).toContain("B");
	await mgrA.destroy();
	await mgrB.destroy();
});
