/**
 * Tests: seed lifecycle + markSynced bookkeeping.
 *
 * NOTE: the original "handshake gate" (applyLocalEdit declining to seed an empty
 * doc until markSynced) was REMOVED. It was redundant with the adopt-first seed
 * gate (#161, isUnchangedSynced), which prevents lineage doubling (#846) by
 * ADOPTING the server's existing lineage rather than refusing to seed. The
 * handshake gate additionally dropped the legitimate base when offline-capture
 * (0f9155e) retired the legacy markdown path, so it was a live-sync regression.
 * These tests now assert the surviving behaviour: seeding an empty doc proceeds,
 * populated docs diff, and the markSynced/isSynced lifecycle round-trips.
 *
 * Ported to the Relay-model ProviderRegistry. The provider owns `synced`, so
 * markSynced/clearSynced are the mark API and closeDoc is a no-op (the doc is
 * persistent across reconnect — see ProviderRegistry).
 */
import { describe, expect, it } from "bun:test";
import "fake-indexeddb/auto";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

// Each makeManager() call takes an explicit dbPrefix (which namespaces the
// physical IndexedDB store), defaulting to a fresh random one so unrelated tests
// never share state; callers who WANT to share a store pass the same dbPrefix.
function makeManager(dbPrefix = `seed-gate-${Math.random().toString(36).slice(2)}`) {
	return new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: async () => {},
	});
}

describe("seed lifecycle", () => {
	it("seeds an empty doc on first local edit", async () => {
		const m = makeManager();
		const consumed = await m.applyLocalEdit("a.md", "hello world");
		expect(consumed).not.toBeNull();
		expect(await m.getText("a.md")).toBe("hello world");
		await m.destroyAll();
	});

	it("seeds an empty doc even after markSynced", async () => {
		const m = makeManager();
		m.markSynced("a.md");
		const consumed = await m.applyLocalEdit("a.md", "hello world");
		expect(consumed).not.toBeNull();
		expect(await m.getText("a.md")).toBe("hello world");
		await m.destroyAll();
	});

	it("diffs into a populated doc (remote lineage established)", async () => {
		const sharedPrefix = `seed-gate-restart-${Math.random().toString(36).slice(2)}`;
		const m = makeManager(sharedPrefix);
		m.markSynced("a.md");
		await m.applyLocalEdit("a.md", "hello world");
		// destroyAll frees the in-memory docs WITHOUT wiping IDB (clearData=false),
		// so the shared store survives for the restart below.
		await m.destroyAll();

		// New manager session for the same store simulates restart: doc has history.
		const m2 = makeManager(sharedPrefix);
		// No markSynced — the doc is non-empty, so the diff must land on it.
		const consumed = await m2.applyLocalEdit("a.md", "hello brave world");
		expect(consumed).not.toBeNull();
		expect(await m2.getText("a.md")).toBe("hello brave world");
		await m2.destroyAll();
	});

	it("isSynced reflects the provider's synced flag; clearSynced resets it", async () => {
		// Relay model: the provider owns `synced` and sets it on the first inbound
		// syncStep2. markSynced is a no-op trigger (fires onSynced), NOT the flag —
		// so isSynced stays false until a real handshake. Drive the flag directly to
		// stand in for that syncStep2, then verify clearSynced resets it.
		const m = makeManager();
		expect(m.isSynced("b.md")).toBe(false); // no entry yet
		await m.getDoc("b.md");
		expect(m.isSynced("b.md")).toBe(false); // entry exists, no syncStep2 yet
		(m as unknown as { entries: Map<string, { provider: { synced: boolean } }> }).entries.get(
			"b.md",
		)!.provider.synced = true;
		expect(m.isSynced("b.md")).toBe(true);
		m.clearSynced();
		expect(m.isSynced("b.md")).toBe(false);
		await m.destroyAll();
	});

	it("closeDoc is a no-op — the persistent doc keeps its content (re-reads on re-open)", async () => {
		// Relay model: closeDoc NEVER tears the doc down (that was the re-mint/
		// re-push doubling). Content written before closeDoc must still be readable.
		const m = makeManager(`seed-gate-close-persist-${Math.random().toString(36).slice(2)}`);
		m.markSynced("cp.md");
		await m.applyLocalEdit("cp.md", "durable content");
		expect(await m.getText("cp.md")).toBe("durable content");

		m.closeDoc("cp.md"); // no-op in the Relay model

		expect(await m.getText("cp.md")).toBe("durable content");
		await m.destroyAll();
	});

	it("hasLca=true seeds via the diff path", async () => {
		// hasLca=true means "another device established the base", so seedOnce skips
		// and the diff path runs unconditionally — consumed === true.
		const m = makeManager();
		const consumed = await m.applyLocalEdit("f.md", "some content", true);
		expect(consumed).not.toBeNull();
		await m.destroyAll();
	});
});
