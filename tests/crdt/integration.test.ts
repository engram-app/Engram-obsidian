/**
 * End-to-end integration: two CrdtManager + CrdtChannel pairs wired through an
 * in-memory relay (standing in for the backend SharedDoc fan-out), proving:
 *
 *  1. A note seeded on device A propagates to device B after the handshake.
 *  2. Concurrent offline edits on A and B converge with no lost/duplicated text.
 *  3. The flush-to-disk callback fires on the receiving side with merged content.
 *  4. An inbound remote update is NOT echoed back as a local push (origin guard).
 *
 * Uses the real y-protocols framing (lib0 + y-protocols/sync) — no codec mocks.
 */
import { expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { CrdtChannel } from "../../src/crdt/channel";
import { CrdtManager } from "../../src/crdt/manager";

test("two devices via an in-memory relay converge end-to-end", async () => {
	const diskA: Record<string, string> = {};
	const diskB: Record<string, string> = {};

	// Keep track of how many frames each side pushes — proves no echo storm.
	const pushCount = { A: 0, B: 0 };

	// Box pattern: closures capture the box reference; channels fill it after creation.
	// This avoids `let` declarations that biome would flag as eligible for `const`.
	const box = {
		chA: null as unknown as CrdtChannel,
		chB: null as unknown as CrdtChannel,
	};

	// Task 6: `docId` (the wire doc_id + in-memory docs-map key) is now always
	// the bare note_id, matching the backend's bare-UUID crdt_msg/crdt_doc_ready
	// — both "devices" reference the SAME note_id here, exactly as two real
	// devices syncing the same note would. dbPrefix now namespaces ONLY the
	// physical IndexedDB store (see CrdtManagerOptions.dbPrefix), so mgrA/mgrB
	// don't cross-contaminate each other's local storage the way two real
	// devices' separate browser origins never would.
	const noteId = "integration-n";
	const mgrA = new CrdtManager({
		dbPrefix: "device-A",
		onUpdate: (id, u) => box.chA.sendUpdateRaw(id, u),
		onFlushToDisk: async (p, c) => {
			diskA[p] = c;
		},
	});
	const mgrB = new CrdtManager({
		dbPrefix: "device-B",
		onUpdate: (id, u) => box.chB.sendUpdateRaw(id, u),
		onFlushToDisk: async (p, c) => {
			diskB[p] = c;
		},
	});

	// Relay: forward each frame from one side to the other (the role the backend
	// SharedDoc plays — fan-out to all other connected peers). docId is already
	// the bare note_id (Task 6), so no path extraction is needed.
	const relay = (from: "A" | "B", id: string, frame: string) => {
		if (from === "A") void box.chB.handleFrame(id, frame);
		else void box.chA.handleFrame(id, frame);
	};

	box.chA = new CrdtChannel({
		manager: mgrA,
		send: (id, f) => {
			pushCount.A++;
			relay("A", id, f);
		},
	});
	box.chB = new CrdtChannel({
		manager: mgrB,
		send: (id, f) => {
			pushCount.B++;
			relay("B", id, f);
		},
	});

	// ── Assertion 1: seed on A propagates to B after handshake ──────────────
	// Seed A without LCA (first write ever for this doc).
	// markSynced required before seeding (audit P0-1 fix): in a real flow A's
	// markSynced fires when its STEP2 arrives; in this test A is the originator
	// so we mark it directly to simulate an already-established lineage on A.
	mgrA.markSynced(noteId);
	await mgrA.applyLocalEdit(noteId, "genesis", false);

	// B starts the handshake. A's STEP2 reply carries the missing state.
	await box.chB.startSync(noteId);
	await new Promise((r) => setTimeout(r, 20));

	expect(await mgrB.getText(noteId)).toBe("genesis");

	// ── Assertion 3: flush-to-disk fired on B (remote update triggered it) ──
	// diskB[noteId] is written by mgrB's onFlushToDisk when it applies A's STEP2.
	expect(diskB[noteId]).toBe("genesis");

	// ── Assertion 2: concurrent offline edits converge ────────────────────────
	// Simulate "offline on both devices simultaneously" by writing directly into
	// the Y.Doc on each side within the same synchronous block — the cross-wire
	// deliveries are enqueued as microtasks before either resolves, exactly as in
	// the channel unit test. This mirrors the real scenario: both devices edit
	// the same note while disconnected and then reconnect.
	const docA = await mgrA.getDoc(noteId);
	const docB = await mgrB.getDoc(noteId);

	// Concurrent mutations in the same sync turn — relay delivers cross-wise
	// as floating microtasks, producing a true concurrent-edit scenario.
	docA.getText("content").insert(docA.getText("content").length, " + A");
	docB.getText("content").insert(0, "B + ");

	await new Promise((r) => setTimeout(r, 20));

	const a = await mgrA.getText(noteId);
	const b = await mgrB.getText(noteId);

	// Both peers must have converged to the same text.
	expect(a).toBe(b);
	// Both contributions are present.
	expect(a).toContain("A");
	expect(a).toContain("B");
	// "genesis" appears exactly once — no duplication from double-seeding.
	expect(a.match(/genesis/g)?.length).toBe(1);

	// ── Assertion 4: no echo storm (local updates are not re-sent after flush) ──
	// Total wire traffic must be finite and bounded (not growing after convergence).
	// A sends STEP1 + update frames; B replies with STEP2 + its own update. There
	// is no further frame after convergence because the remote-origin guard
	// suppresses re-broadcast of inbound updates.
	const totalFrames = pushCount.A + pushCount.B;
	expect(totalFrames).toBeGreaterThan(0);
	expect(totalFrames).toBeLessThan(20); // generous upper bound; storm = 100+

	await mgrA.destroy();
	await mgrB.destroy();
});
