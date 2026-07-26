import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

// Two "devices", each its own ProviderRegistry with an isolated IndexedDB store
// (dbPrefix). An in-memory relay routes every frame one device sends for a
// note_id to the other device's `receive`, so this exercises the full Relay
// exchange (syncStep1/2 + updates) with no server double.
function twoDevices() {
	const flushedA: Record<string, string> = {};
	const flushedB: Record<string, string> = {};
	let up = true;
	// biome-ignore lint/style/useConst: mutually referential wiring
	let A: ProviderRegistry;
	// biome-ignore lint/style/useConst: mutually referential wiring
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

describe("ProviderRegistry (Relay model)", () => {
	test("genesis seed on device A syncs to B and flushes B's disk (no text-verify)", async () => {
		const { A, B, flushedB } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);

		// A is the origin of a brand-new note: seed (adoptFirst=false).
		await A.seedFromDisk("n1", "hello from A", false);
		await flush();

		// B never seeded; it adopted A's lineage via syncStep2, and the remote
		// merge flushed to B's disk.
		expect((await B.getText("n1")).toString()).toBe("hello from A");
		expect(flushedB.n1).toContain("hello from A");
		await A.destroyAll();
		await B.destroyAll();
	});

	test("reconnect re-advertises via syncStep1 and does NOT double content", async () => {
		const dev = twoDevices();
		const { A, B } = dev;
		A.setConnected(true);
		B.setConnected(true);
		await A.seedFromDisk("n2", "base", false);
		await flush();
		expect((await B.getText("n2")).toString()).toBe("base");

		// Socket drops on A. A edits offline (held in the provider buffer).
		dev.setUp(false);
		A.setConnected(false);
		const aText = await A.getText("n2");
		aText.insert(aText.length, " + offline");
		await flush();
		expect((await B.getText("n2")).toString()).toBe("base"); // B hasn't seen it

		// Reconnect: syncStep1 + buffered flush. Convergence must NOT double.
		dev.setUp(true);
		A.setConnected(true);
		B.setConnected(true);
		await flush();

		expect((await A.getText("n2")).toString()).toBe("base + offline");
		expect((await B.getText("n2")).toString()).toBe("base + offline");
		await A.destroyAll();
		await B.destroyAll();
	});

	test("a note the server already holds is ADOPTED, never re-seeded (adoptFirst)", async () => {
		const { A, B } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);
		// A creates it.
		await A.seedFromDisk("n3", "server content", false);
		await flush();
		// B already has the same bytes on disk (from a prior sync) and opens it
		// with adoptFirst=true → must NOT seed a second lineage; adopts A's.
		await B.seedFromDisk("n3", "server content", true);
		await flush();

		expect((await B.getText("n3")).toString()).toBe("server content"); // adopted, not doubled
		await A.destroyAll();
		await B.destroyAll();
	});
});
