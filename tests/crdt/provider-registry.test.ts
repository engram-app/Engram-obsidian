import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as YDoc from "yjs";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

// Two "devices", each its own ProviderRegistry with an isolated IndexedDB store
// (dbPrefix). An in-memory relay routes every frame one device sends for a
// note_id to the other device's `receive`, exercising the full Relay exchange
// (syncStep1/2 + updates) with no server double.
function twoDevices() {
	const flushedA: Record<string, string> = {};
	const flushedB: Record<string, string> = {};
	let up = true;
	// mutually referential wiring — assigned below, not at declaration
	let A: ProviderRegistry;
	let B: ProviderRegistry;
	A = new ProviderRegistry({
		dbPrefix: "devA",
		send: (id, frame) => {
			if (up) queueMicrotask(() => void B.receive(id, frame));
			return up;
		},
		onFlushToDisk: (id, content) => {
			flushedA[id] = content;
		},
	});
	B = new ProviderRegistry({
		dbPrefix: "devB",
		send: (id, frame) => {
			if (up) queueMicrotask(() => void A.receive(id, frame));
			return up;
		},
		onFlushToDisk: (id, content) => {
			flushedB[id] = content;
		},
	});
	return {
		A,
		B,
		flushedA,
		flushedB,
		setUp: (v: boolean) => {
			up = v;
		},
	};
}

const flush = () => new Promise<void>((r) => setTimeout(r, 15));

/** Poll until `cond` holds. The STEP1/STEP2 handshake spans several async turns
 *  — two `IndexeddbPersistence.whenSynced` resolutions plus the relay's
 *  queueMicrotask hops — so the fixed `flush()` sleep above is racy for anything
 *  that waits on the handshake COMPLETING (measured ~15% failure under parallel
 *  load, pre-existing on main: `synced` was still false when closeDoc ran, so
 *  isFullySynced refused to evict). Same helper, same reason, as the sibling
 *  wiring.test.ts. Use this — not a bigger sleep — for handshake preconditions. */
async function waitFor(cond: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (cond()) return;
		await new Promise<void>((r) => setTimeout(r, 5));
	}
	throw new Error(`waitFor timed out: ${label}`);
}

describe("ProviderRegistry destroyed-doc guard", () => {
	function oneDevice() {
		const flushed: Record<string, string> = {};
		const reg = new ProviderRegistry({
			dbPrefix: "devGuard",
			send: () => true,
			onFlushToDisk: (id, content) => {
				flushed[id] = content;
			},
		});
		return { reg, flushed };
	}

	test("applyLocalEdit on a removed note bails (does not resurrect)", async () => {
		const { reg } = oneDevice();
		await reg.applyLocalEdit("gone.md", "original"); // materialize
		await flush();
		await reg.removeDoc("gone.md"); // delete
		// A late edit for the just-deleted note must not re-create + re-seed it.
		const result = await reg.applyLocalEdit("gone.md", "resurrected");
		expect(result).toBeNull();
		expect(reg.hasDoc("gone.md")).toBe(false);
	});

	test("applyRemoteUpdate on a removed note does not flush it back to disk", async () => {
		const { reg, flushed } = oneDevice();
		await reg.applyLocalEdit("gone.md", "original");
		await flush();
		await reg.removeDoc("gone.md");
		// A late fan-out update for the deleted note must not resurrect the file.
		const scratch = new YDoc.Doc();
		scratch.getText("content").insert(0, "resurrected body");
		await reg.applyRemoteUpdate("gone.md", YDoc.encodeStateAsUpdate(scratch));
		await flush();
		expect(flushed["gone.md"]).toBeUndefined();
		expect(reg.hasDoc("gone.md")).toBe(false);
	});

	test("closeDoc evicts a FULLY-SYNCED idle doc; content rehydrates on next access", async () => {
		const { A, B } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);
		await A.applyLocalEdit("idle.md", "persistent content");
		await A.startSync("idle.md"); // advertise -> B replies syncStep2 -> A.synced
		await waitFor(() => A.isSynced("idle.md"), "A synced with B");
		expect(A.hasDoc("idle.md")).toBe(true);
		A.closeDoc("idle.md"); // fully synced -> safe to evict
		await flush();
		expect(A.hasDoc("idle.md")).toBe(false);
		// Not tombstoned — re-access rehydrates from IndexedDB (no data loss).
		expect(await A.getText("idle.md")).toBe("persistent content");
		expect(A.hasDoc("idle.md")).toBe(true);
		await A.destroyAll();
		await B.destroyAll();
	});

	test("closeDoc does NOT evict a doc with unsent offline edits (switch-away durability)", async () => {
		const { A } = twoDevices(); // A never connects
		await A.applyLocalEdit("offline.md", "offline edit");
		await A.startSync("offline.md"); // buffers (not connected -> not synced)
		await flush();
		A.closeDoc("offline.md");
		await flush();
		// Stays resident so the buffered edit re-advertises on reconnect.
		expect(A.hasDoc("offline.md")).toBe(true);
		await A.destroyAll();
	});
});

describe("ProviderRegistry (Relay-model engine)", () => {
	test("genesis edit on A syncs to B and flushes B's disk (no text-verify)", async () => {
		const { A, B, flushedB } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);

		// A is the origin of a brand-new note: applyLocalEdit seeds (empty doc).
		await A.applyLocalEdit("n1", "hello from A");
		await A.startSync("n1"); // advertise (a live edit normally rides an open note)
		await flush();

		// B adopted A's lineage via syncStep2 (never seeded); the remote merge
		// flushed to B's disk.
		expect(await B.getText("n1")).toBe("hello from A");
		expect(flushedB.n1).toContain("hello from A");
		await A.destroyAll();
		await B.destroyAll();
	});

	test("reconnect re-advertises via syncStep1 and does NOT double content", async () => {
		const dev = twoDevices();
		const { A, B } = dev;
		A.setConnected(true);
		B.setConnected(true);
		await A.applyLocalEdit("n2", "base");
		await A.startSync("n2");
		await flush();
		expect(await B.getText("n2")).toBe("base");

		// Socket drops on A. A edits offline (held in the provider buffer).
		dev.setUp(false);
		A.setConnected(false);
		const aDoc = await A.getDoc("n2");
		aDoc.getText("content").insert(4, " + offline");
		await flush();
		expect(await B.getText("n2")).toBe("base"); // B hasn't seen it

		// Reconnect: syncStep1 + buffered flush. Convergence must NOT double.
		dev.setUp(true);
		A.setConnected(true);
		B.setConnected(true);
		await flush();

		expect(await A.getText("n2")).toBe("base + offline");
		expect(await B.getText("n2")).toBe("base + offline");
		await A.destroyAll();
		await B.destroyAll();
	});

	test("adopt-first: a note whose disk bytes are already synced is NOT re-seeded", async () => {
		let synced = false;
		const reg = new ProviderRegistry({
			dbPrefix: "devAdopt",
			send: () => true,
			onFlushToDisk: () => {},
			isUnchangedSynced: (_id, content) => synced && content === "server body",
		});
		reg.setConnected(true);
		// The server already holds "server body"; the adopt-first gate must decline
		// to seed a second lineage — the doc stays empty (adopts via STEP2).
		synced = true;
		const consumed = await reg.applyLocalEdit("n3", "server body");
		expect(consumed).toBe("server body"); // "handled, nothing to push"
		expect(await reg.hasHistory("n3")).toBe(false); // never seeded
		await reg.destroyAll();
	});

	test("reset clears the synced mark so a re-handshake re-confirms (heal-room release)", async () => {
		// The diverged-cold-note heal is reset+enroll; its release fires from
		// onSynced on the re-handshake's syncStep2. The provider fires onSynced only
		// on the FIRST syncStep2, so reset must clear synced or the heal room never
		// releases (e2e wait_for_room_free timeout).
		const { A, B } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);
		await A.applyLocalEdit("n4", "base");
		await A.startSync("n4");
		await B.startSync("n4"); // B enrolls → syncStep1/2 → synced
		await waitFor(() => B.isSynced("n4"), "B synced with A");
		expect(B.isSynced("n4")).toBe(true);

		B.reset("n4");
		expect(B.isSynced("n4")).toBe(false); // the fix: reset invalidates the mark

		await B.startSync("n4"); // re-handshake
		await waitFor(() => B.isSynced("n4"), "B re-synced after reset");
		expect(B.isSynced("n4")).toBe(true); // re-confirmed → onSynced re-fired
		await A.destroyAll();
		await B.destroyAll();
	});
});
