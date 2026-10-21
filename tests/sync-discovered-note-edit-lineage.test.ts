/**
 * A fresh device's first edit to a DISCOVERED note must diff onto the server's
 * lineage, never seed a rival one.
 *
 * Staging 0.59.0, 8/8 (plugin e3747eb6): device D joins with an empty
 * IndexedDB, catch-up's discovery leg writes the row body c1 to disk and marks
 * the note server-known, but never touches the Y.Doc (cold note: no STEP1, no
 * crdt_doc_state). The user edits to c2. pushFile's server-known arm routes to
 * applyLocalEdit, which sees a history-less doc and seeds ALL of c2 under a new
 * clientID. The server unions that with its own c1 and stores c1+c2.
 *
 * Real ProviderRegistry so the outcome is a genuine Yjs merge, not mocked.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { reconcileColdStart, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "Notes/Fresh.md";
const ID = "id-fresh";
const C1 = "# fresh\n\nfirst body line.\n";
const C2 = "# fresh\n\nfirst body line.\nsecond line from a fresh device.\n";

async function scenario(dbPrefix: string, docState: "ok" | "unavailable" = "ok") {
	// The server's lineage: another device created c1.
	const server = new Y.Doc();
	server.getText("content").insert(0, C1);

	const disk = new Map<string, string>();
	const map = new NoteIdMap();
	let e!: SyncEngine;
	const mgr = new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: async (id, content) => {
			const p = map.pathForId(id);
			if (p) await e.flushFromCrdt(p, content);
		},
		isUnchangedSynced: (id, content) => {
			const p = map.pathForId(id);
			return p ? e.isUnchangedSynced(p, content) : false;
		},
		// Production wiring (src/crdt/wiring.ts).
		serverLineage: (id) => e.serverLineageFor(id),
	});
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => void disk.set(f.path, c)),
			create: mock(async (p: string, c: string) => {
				if (disk.has(p)) throw new Error("File already exists.");
				disk.set(p, c);
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	e = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(mgr as never);
	e.setReady();
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => false);
	e.setCrdtEnrollment({ enroll: mock(), reset: mock() } as never);
	const docStateCalls: string[] = [];
	e.setCrdtPorts({
		live: () => true,
		docState: async (id: string) => {
			docStateCalls.push(id);
			if (docState === "unavailable") throw new Error("rate_limited");
			return { b64: toB64(Y.encodeStateAsUpdate(server)), head: "h1" };
		},
	} as never);
	map.set(PATH, ID);

	// Catch-up discovery: the file is absent locally, the row carries c1.
	await e.applyChange({
		id: ID,
		path: PATH,
		title: "Fresh",
		content: C1,
		folder: "Notes",
		tags: [],
		mtime: Date.now() / 1000,
		updated_at: new Date().toISOString(),
		deleted: false,
		version: 1,
		content_hash: "hash-c1",
	} as never);

	/** What the server holds once it has merged everything this device has. */
	const serverAfterMerge = async () => {
		Y.applyUpdate(server, Y.encodeStateAsUpdate(await mgr.getDoc(ID)));
		return server.getText("content").toJSON();
	};
	return { e, mgr, disk, server, serverAfterMerge, docStateCalls };
}

test("discovery leaves the doc empty but the note server-known (the precondition)", async () => {
	const { e, mgr, disk } = await scenario("disc-lineage-pre");
	expect(disk.get(PATH)).toBe(C1);
	expect(e.hasServerNote(ID)).toBe(true);
	expect(await mgr.hasHistory(ID)).toBe(false);
});

test("first edit after discovery diffs onto the server lineage (no c1+c2)", async () => {
	const { e, disk, serverAfterMerge } = await scenario("disc-lineage-edit");
	disk.set(PATH, C2);
	await (e as any).pushFile(new TFile(PATH));
	expect(await serverAfterMerge()).toBe(C2);
	expect(disk.get(PATH)).toBe(C2);
});

test("cold-start reconcile of a discovered note also diffs onto the server lineage", async () => {
	const { mgr, disk, serverAfterMerge } = await scenario("disc-lineage-cold");
	disk.set(PATH, C2);
	await reconcileColdStart({ path: PATH, noteId: ID, diskContent: C2 }, mgr as never, () => {});
	expect(await serverAfterMerge()).toBe(C2);
});

test("lineage unavailable: the edit is declined, never seeded as a rival", async () => {
	const { e, mgr, disk, serverAfterMerge } = await scenario("disc-lineage-down", "unavailable");
	disk.set(PATH, C2);
	await (e as any).pushFile(new TFile(PATH));
	expect(await mgr.hasHistory(ID)).toBe(false);
	expect(await serverAfterMerge()).toBe(C1);
	// The edit is still on disk for the next attempt.
	expect(disk.get(PATH)).toBe(C2);
});

test("an unchanged discovered note costs no doc-state read", async () => {
	const { mgr, docStateCalls } = await scenario("disc-lineage-unchanged");
	expect(await mgr.applyLocalEdit(ID, C1)).toBe(C1);
	expect(docStateCalls).toEqual([]);
});

test("a note the server does not know yet still seeds (genesis is unaffected)", async () => {
	const { mgr, docStateCalls } = await scenario("disc-lineage-genesis");
	const fresh = "id-brand-new";
	expect(await mgr.applyLocalEdit(fresh, "new note")).toBe("new note");
	expect(await mgr.getText(fresh)).toBe("new note");
	expect(docStateCalls).toEqual([]);
});
