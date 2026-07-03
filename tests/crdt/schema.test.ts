/**
 * Tests: one-time v1-doc IndexedDB wipe on schema upgrade (schema marker).
 *
 * Pre-1.10 (proto-1) local docs carry the frontmatter fence inside the body
 * Y.Text under the SAME IndexedDB store names as v2. The server heals
 * fence-in-body on shared lineages (normalize_doc), but a v1 doc whose server
 * state was wiped re-merges as an independent lineage → duplication.
 *
 * Verifies ensureDocSchema detects missing/stale schema marker, wipes ONLY
 * the ${vaultId}/ -prefixed IndexedDB databases, and sets the marker to "2".
 * Un-pushed local edits survive on DISK (disk is the source the reconcile
 * pushes).
 */
import { describe, expect, it } from "bun:test";

// Import the function we're testing (will fail until we implement it).
import { ensureDocSchema } from "../../src/crdt/schema";

function makeFakeStorage() {
	const data: Record<string, string> = {};
	return {
		getItem(key: string) {
			return data[key] ?? null;
		},
		setItem(key: string, value: string) {
			data[key] = value;
		},
	};
}

function makeFakeIndexedDB() {
	const state = { dbs: {} as Record<string, boolean> };
	return {
		get dbs() {
			return state.dbs;
		},
		set dbs(value: Record<string, boolean>) {
			state.dbs = value;
		},
		async list() {
			return Object.keys(state.dbs).map((name) => ({ name }));
		},
		async drop(name: string) {
			delete state.dbs[name];
		},
	};
}

describe("ensureDocSchema", () => {
	it("absent marker → drops exactly the ${vaultId}/ -prefixed DBs and sets marker", async () => {
		const storage = makeFakeStorage();
		const idb = makeFakeIndexedDB();
		idb.dbs = {
			"vault-A/a.md": true,
			"vault-A/b.md": true,
			"vault-A/frontmatter": true,
			"vault-B/c.md": true,
			"unrelated-db": true,
		};

		const wiped = await ensureDocSchema("vault-A", storage, idb);

		// Should return true (a wipe ran).
		expect(wiped).toBe(true);
		// Only vault-A/ prefixed DBs should be dropped.
		expect(idb.dbs).toEqual({
			"vault-B/c.md": true,
			"unrelated-db": true,
		});
		// Marker should be set to "2".
		expect(storage.getItem("engram-crdt-doc-schema/vault-A")).toBe("2");
	});

	it("marker '2' → drops nothing, returns false", async () => {
		const storage = makeFakeStorage();
		storage.setItem("engram-crdt-doc-schema/vault-A", "2");
		const idb = makeFakeIndexedDB();
		idb.dbs = {
			"vault-A/a.md": true,
			"vault-A/b.md": true,
		};

		const wiped = await ensureDocSchema("vault-A", storage, idb);

		// Should return false (no wipe).
		expect(wiped).toBe(false);
		// DBs should NOT be dropped.
		expect(idb.dbs).toEqual({
			"vault-A/a.md": true,
			"vault-A/b.md": true,
		});
	});

	it("marker set AFTER drops complete (order)", async () => {
		const storage = makeFakeStorage();
		const idb = makeFakeIndexedDB();
		idb.dbs = {
			"vault-A/x.md": true,
			"vault-A/y.md": true,
		};

		// Track the order: marker should not be set before drop is called.
		const operations: string[] = [];
		const originalDrop = idb.drop;
		idb.drop = async (name: string) => {
			operations.push(`drop:${name}`);
			return originalDrop.call(idb, name);
		};

		const originalSetItem = storage.setItem;
		storage.setItem = (key: string, value: string) => {
			operations.push(`setItem:${key}`);
			return originalSetItem.call(storage, key, value);
		};

		await ensureDocSchema("vault-A", storage, idb);

		// All drops should happen before the setItem.
		const setItemIndex = operations.findIndex((op) => op.startsWith("setItem:"));
		const allDropsBefore = operations
			.slice(0, setItemIndex)
			.every((op) => op.startsWith("drop:"));
		expect(allDropsBefore).toBe(true);
	});

	it("no-op when marker already set to '2'", async () => {
		const storage = makeFakeStorage();
		storage.setItem("engram-crdt-doc-schema/vault-B", "2");
		const idb = makeFakeIndexedDB();
		idb.dbs = {
			"vault-B/doc1": true,
			"vault-B/doc2": true,
		};

		const wiped = await ensureDocSchema("vault-B", storage, idb);

		expect(wiped).toBe(false);
		expect(idb.dbs).toEqual({
			"vault-B/doc1": true,
			"vault-B/doc2": true,
		});
	});

	it("marker '1' (any non-'2' value) → drops DBs, returns true, upgrades to '2'", async () => {
		const storage = makeFakeStorage();
		storage.setItem("engram-crdt-doc-schema/vault-B", "1");
		const idb = makeFakeIndexedDB();
		idb.dbs = {
			"vault-B/doc1": true,
			"vault-B/doc2": true,
		};

		const wiped = await ensureDocSchema("vault-B", storage, idb);

		expect(wiped).toBe(true);
		expect(idb.dbs).toEqual({});
		expect(storage.getItem("engram-crdt-doc-schema/vault-B")).toBe("2");
	});

	it("handles empty IDB (no DBs to drop)", async () => {
		const storage = makeFakeStorage();
		const idb = makeFakeIndexedDB();
		idb.dbs = {};

		const wiped = await ensureDocSchema("vault-C", storage, idb);

		expect(wiped).toBe(true);
		expect(idb.dbs).toEqual({});
		expect(storage.getItem("engram-crdt-doc-schema/vault-C")).toBe("2");
	});

	it("drops multiple DBs when marker is absent", async () => {
		const storage = makeFakeStorage();
		const idb = makeFakeIndexedDB();
		idb.dbs = {
			"vault-D/doc1": true,
			"vault-D/doc2": true,
			"vault-D/doc3": true,
			"vault-D/frontmatter": true,
			"vault-D/updates": true,
			"vault-E/other": true,
		};

		await ensureDocSchema("vault-D", storage, idb);

		// All vault-D/ prefixed DBs should be dropped.
		expect(idb.dbs).toEqual({
			"vault-E/other": true,
		});
		expect(storage.getItem("engram-crdt-doc-schema/vault-D")).toBe("2");
	});
});
