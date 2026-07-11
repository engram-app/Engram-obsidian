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
 */
import { describe, expect, it } from "bun:test";
import "fake-indexeddb/auto";
import { CrdtManager } from "../../src/crdt/manager";

// ---------------------------------------------------------------------------
// Helpers — mirror the makeManager / makeManagerSameStore pattern from
// manager.test.ts so the helpers are self-contained here.
// ---------------------------------------------------------------------------

// Task 6: `docId` (the wire/map key) is always bare — it no longer encodes
// dbPrefix, so a same-store manager can't be reconstructed by string-slicing
// docId's return value anymore. Instead each `makeManager()` call takes an
// explicit dbPrefix (which now only namespaces the physical IndexedDB store,
// per CrdtManagerOptions.dbPrefix), defaulting to a fresh random one so
// unrelated tests never share state; callers who WANT to share a store just
// pass the same dbPrefix to both calls.
function makeManager(dbPrefix = `seed-gate-${Math.random().toString(36).slice(2)}`) {
	return new CrdtManager({
		dbPrefix,
		onUpdate: () => {},
		onFlushToDisk: async () => {},
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seed lifecycle", () => {
	it("seeds an empty doc on first local edit", async () => {
		const m = makeManager();
		const consumed = await m.applyLocalEdit("a.md", "hello world");
		expect(consumed).toBe(true);
		expect(await m.getText("a.md")).toBe("hello world");
		await m.destroy();
	});

	it("seeds an empty doc even after markSynced", async () => {
		const m = makeManager();
		m.markSynced("a.md");
		const consumed = await m.applyLocalEdit("a.md", "hello world");
		expect(consumed).toBe(true);
		expect(await m.getText("a.md")).toBe("hello world");
		await m.destroy();
	});

	it("diffs into a populated doc (remote lineage established)", async () => {
		const sharedPrefix = `seed-gate-restart-${Math.random().toString(36).slice(2)}`;
		const m = makeManager(sharedPrefix);
		m.markSynced("a.md");
		await m.applyLocalEdit("a.md", "hello world");
		await m.destroy();

		// New manager session for the same store simulates restart: doc has history.
		const m2 = makeManager(sharedPrefix);
		// No markSynced — the doc is non-empty, so the diff must land on it.
		const consumed = await m2.applyLocalEdit("a.md", "hello brave world");
		expect(consumed).toBe(true);
		expect(await m2.getText("a.md")).toBe("hello brave world");
		await m2.destroy();
	});

	it("markSynced / isSynced round-trips correctly", () => {
		const m = makeManager();
		expect(m.isSynced("b.md")).toBe(false);
		m.markSynced("b.md");
		expect(m.isSynced("b.md")).toBe(true);
	});

	it("closeDoc clears the synced mark for the path", async () => {
		const m = makeManager();
		m.markSynced("c.md");
		expect(m.isSynced("c.md")).toBe(true);
		// Ensure the doc entry exists before closeDoc (entry is opened lazily).
		await m.getDoc("c.md");
		m.closeDoc("c.md");
		expect(m.isSynced("c.md")).toBe(false);
		await m.destroy();
	});

	it("closeDoc frees the doc but PRESERVES the IndexedDB store (re-hydrates on re-open)", async () => {
		// The whole no-data-loss argument for the doc-lifecycle frees rests on
		// closeDoc using destroy() (in-memory teardown) and NOT clearData() (wipe).
		// This pins that: content written before closeDoc must survive a re-open.
		const m = makeManager(`seed-gate-close-persist-${Math.random().toString(36).slice(2)}`);
		m.markSynced("cp.md");
		await m.applyLocalEdit("cp.md", "durable content");
		expect(await m.getText("cp.md")).toBe("durable content");

		m.closeDoc("cp.md"); // free the in-memory doc — must NOT wipe IDB

		// Re-open on the SAME manager (mirrors the channel re-mint / re-open path):
		// entry() re-materializes the doc from the preserved IDB store.
		expect(await m.getText("cp.md")).toBe("durable content");
		await m.destroy();
	});

	it("destroy clears all synced marks", async () => {
		const m = makeManager();
		m.markSynced("d.md");
		m.markSynced("e.md");
		await m.destroy();
		expect(m.isSynced("d.md")).toBe(false);
		expect(m.isSynced("e.md")).toBe(false);
	});

	it("hasLca=true seeds via the diff path", async () => {
		// hasLca=true means "another device established the base", so seedOnce skips
		// and the diff path runs unconditionally — consumed === true.
		const m = makeManager();
		const consumed = await m.applyLocalEdit("f.md", "some content", true);
		expect(consumed).toBe(true);
		await m.destroy();
	});
});
