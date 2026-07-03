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

function makeManager() {
	return new CrdtManager({
		dbPrefix: `seed-gate-${Math.random().toString(36).slice(2)}`,
		onUpdate: () => {},
		onFlushToDisk: async () => {},
	});
}

/**
 * Return a second CrdtManager that shares the SAME dbPrefix as `m`, simulating
 * a session restart where IndexedDB already holds history written by `m`.
 *
 * `fake-indexeddb/auto` patches the global IDBFactory; all managers with the
 * same dbPrefix share the same in-memory stores in the test process, so this
 * correctly models cross-session persistence rehydration.
 */
function makeManagerSameStore(m: CrdtManager) {
	// Extract the dbPrefix embedded in docId for an arbitrary path.
	// docId = `${dbPrefix}/a.md`, so strip the trailing "/a.md".
	const rawId = m.docId("a.md");
	const dbPrefix = rawId.slice(0, rawId.length - "/a.md".length);
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
		const m = makeManager();
		m.markSynced("a.md");
		await m.applyLocalEdit("a.md", "hello world");
		await m.destroy();

		// New manager session for the same store simulates restart: doc has history.
		const m2 = makeManagerSameStore(m);
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
