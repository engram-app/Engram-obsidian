/**
 * Tests for the centralized syncState mutators (#376 prerequisite 1).
 *
 * The ~30 raw `syncState.set/delete` sites in sync.ts used subtly different
 * merge semantics (full replace vs merge-at-stamp-time vs merge-onto-stale-
 * snapshot). These lock in the two named policies every site now routes
 * through, so the semantics of each write are explicit and auditable:
 *
 *  - stampSyncedRow: REPLACE the row (a path's server lineage is (re)known
 *    wholesale — prior crdtHead/seq/version are deliberately dropped)
 *  - patchSyncedRow: MERGE onto the row read at stamp time (refresh named
 *    fields, preserve the rest)
 *  - recordCrdtBaseline(+markCreated): echo-baseline stamp via patch, with
 *    the genesis crdtHead sentinel flip
 *  - dropPath: delete the row (+ CAS base unless dropBase:false)
 */
import { describe, expect, mock, test } from "bun:test";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// Private-member access on purpose: the mutators are internal seams of the
// #376 split; the untyped view is how sync.ts's other private-seam tests
// reach them too.
type AnyEngine = Record<string, any>;

function makeEngine(): AnyEngine {
	return new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;
}

describe("stampSyncedRow (replace)", () => {
	test("replaces the whole row — stale crdtHead/seq do not survive", () => {
		const e = makeEngine();
		e.patchSyncedRow("a.md", { hash: 1, crdtHead: "h", seq: 7, version: 3 });
		e.stampSyncedRow("a.md", { hash: 2, version: 4, serverHash: "sh" });
		expect(e.exportSyncState()["a.md"]).toEqual({ hash: 2, version: 4, serverHash: "sh" });
	});

	test("creates the row when absent", () => {
		const e = makeEngine();
		e.stampSyncedRow("new.md", { hash: 9 });
		expect(e.exportSyncState()["new.md"]).toEqual({ hash: 9 });
	});
});

describe("patchSyncedRow (merge at stamp time)", () => {
	test("preserves fields the patch does not name", () => {
		const e = makeEngine();
		e.stampSyncedRow("a.md", { hash: 1, version: 3, serverHash: "sh", seq: 7 });
		e.patchSyncedRow("a.md", { hash: 2, crdtHead: "head" });
		expect(e.exportSyncState()["a.md"]).toEqual({
			hash: 2,
			version: 3,
			serverHash: "sh",
			seq: 7,
			crdtHead: "head",
		});
	});

	test("missing row: defaults hash to 0 (the `?? { hash: 0 }` sites)", () => {
		const e = makeEngine();
		e.patchSyncedRow("a.md", { crdtHead: "head" });
		expect(e.exportSyncState()["a.md"]).toEqual({ hash: 0, crdtHead: "head" });
	});
});

describe("recordCrdtBaseline", () => {
	test("stamps the content hash, preserving server bookkeeping", () => {
		const e = makeEngine();
		e.stampSyncedRow("a.md", { hash: 1, version: 3, serverHash: "sh" });
		e.recordCrdtBaseline("a.md", "body");
		const row = e.exportSyncState()["a.md"];
		expect(row.version).toBe(3);
		expect(row.serverHash).toBe("sh");
		expect(row.hash).not.toBe(1);
		expect(row.crdtHead).toBeUndefined();
	});

	test("markCreated flips the hasServerNote oracle via the sentinel head", () => {
		const e = makeEngine();
		e.recordCrdtBaseline("a.md", "body", { markCreated: true });
		expect(e.exportSyncState()["a.md"].crdtHead).toBeDefined();
		// Same sentinel setCrdtHead(path, CRDT_HEAD_CREATED) writes.
		e.setCrdtHead("b.md", e.exportSyncState()["a.md"].crdtHead);
		expect(e.exportSyncState()["b.md"].crdtHead).toBe(e.exportSyncState()["a.md"].crdtHead);
	});
});

describe("dropPath", () => {
	test("drops the row and the CAS base by default", () => {
		const e = makeEngine();
		const dropped: string[] = [];
		e.baseStore = { delete: (p: string) => dropped.push(p) };
		e.stampSyncedRow("a.md", { hash: 1 });
		e.dropPath("a.md");
		expect(e.exportSyncState()["a.md"]).toBeUndefined();
		expect(dropped).toEqual(["a.md"]);
	});

	// The local-delete path used to pass dropBase:false, so deleting a note left
	// its full text in sync-bases.json — inside .obsidian/, which people commit
	// and sync — until LRU eviction happened to reach it at 50MB. The default
	// (drop it) is what the delete path now uses.
	test("the default drops the base, so a deleted note keeps no body on disk", () => {
		const e = makeEngine();
		const dropped: string[] = [];
		e.baseStore = { delete: (p: string) => dropped.push(p) };
		e.stampSyncedRow("Personal/Therapy.md", { hash: 1 });

		e.dropPath("Personal/Therapy.md");

		expect(dropped).toEqual(["Personal/Therapy.md"]);
	});

	test("dropBase:false leaves the CAS base alone (rename/echo-skip sites)", () => {
		const e = makeEngine();
		const dropped: string[] = [];
		e.baseStore = { delete: (p: string) => dropped.push(p) };
		e.stampSyncedRow("a.md", { hash: 1 });
		e.dropPath("a.md", { dropBase: false });
		expect(e.exportSyncState()["a.md"]).toBeUndefined();
		expect(dropped).toEqual([]);
	});

	test("no baseStore wired: still drops the row", () => {
		const e = makeEngine();
		e.stampSyncedRow("a.md", { hash: 1 });
		e.dropPath("a.md");
		expect(e.exportSyncState()["a.md"]).toBeUndefined();
	});
});
