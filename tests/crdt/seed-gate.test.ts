/**
 * Tests: handshake-gated seeding (audit P0-1 — double-seed body duplication).
 *
 * Verifies that applyLocalEdit DECLINES to seed an empty doc until markSynced
 * has been called for the path (i.e. the server's STEP2 has been applied).
 * This prevents fresh-IndexedDB devices from minting a second local lineage
 * before the server's lineage arrives, which would merge into duplicated body
 * text vault-wide.
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

describe("handshake-gated seeding", () => {
	it("declines to seed an empty doc before markSynced", async () => {
		const m = makeManager();
		const consumed = await m.applyLocalEdit("a.md", "hello world");
		expect(consumed).toBe(false);
		expect(await m.getText("a.md")).toBe(""); // nothing seeded
		await m.destroy();
	});

	it("seeds after markSynced when the doc is still empty", async () => {
		const m = makeManager();
		m.markSynced("a.md");
		const consumed = await m.applyLocalEdit("a.md", "hello world");
		expect(consumed).toBe(true);
		expect(await m.getText("a.md")).toBe("hello world");
		await m.destroy();
	});

	it("diffs into a populated doc even without markSynced (remote lineage established)", async () => {
		const m = makeManager();
		m.markSynced("a.md");
		await m.applyLocalEdit("a.md", "hello world");
		await m.destroy();

		// New manager session for the same store simulates restart: doc has history.
		const m2 = makeManagerSameStore(m);
		// No markSynced — but the doc is non-empty, so the gate must let the diff through.
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

	it("hasLca=true bypasses the seed gate", async () => {
		// hasLca=true means "another device established the base", so seedOnce skips
		// and the gate check (`e.text.length === 0 && !lca && !this.isSynced(path)`)
		// is not triggered. The diff path runs unconditionally — consumed === true.
		const m = makeManager();
		// No markSynced; hasLca=true means the caller knows history exists elsewhere.
		const consumed = await m.applyLocalEdit("f.md", "some content", true);
		// hasLca=true → gate not triggered → diff path runs → consumed
		expect(consumed).toBe(true);
		await m.destroy();
	});

	it("declining is side-effect-free: no frontmatter write, no update emitted", async () => {
		const updates: Uint8Array[] = [];
		const m = new CrdtManager({
			dbPrefix: `sfx-${Math.random().toString(36).slice(2)}`,
			onUpdate: (_id, u) => updates.push(u),
			onFlushToDisk: async () => {},
		});
		// No markSynced — should decline without emitting any updates.
		const consumed = await m.applyLocalEdit("g.md", "---\ntitle: T\n---\nbody");
		expect(consumed).toBe(false);
		expect(updates).toHaveLength(0); // no onUpdate calls
		expect(await m.getText("g.md")).toBe(""); // Y.Text still empty
		await m.destroy();
	});
});
