/**
 * #578: a CRDT discovery flush must never be re-read as a local edit.
 *
 * Shape (backend e2e test_49 rapid REST edits, "Version 35 of 5" on every
 * device): the note's local Y.Doc already holds server edits 1..2, but no file
 * exists yet. The discovery leg of applyChange writes the REST row's body
 * (edit 3) through flushFromCrdt. While that create is in flight the fan-out of
 * edit 3 lands; its drift capture reads the just-written disk against a
 * baseline that is only recorded AFTER the write, sees "drift", and diffs edit 3
 * into the doc as a CLIENT-authored copy. The server's own edit 3 then merges
 * next to it and later edits delete only the server's copy.
 *
 * Real ProviderRegistry so the corruption is a genuine Yjs merge, not mocked.
 */
import { expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "E2E/RapidEdits.md";
const ID = "id-rapid";
const body = (i: number) => `# Rapid Edit\nVersion ${i} of 5`;

/** The server's lineage: edit i rewrites the version digit, one update each. */
function serverEdits(): Uint8Array[] {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	const updates: Uint8Array[] = [];
	let sv = Y.encodeStateVector(doc);
	for (let i = 1; i <= 5; i++) {
		doc.transact(() => {
			text.delete(0, text.length);
			text.insert(0, body(i));
		});
		updates.push(Y.encodeStateAsUpdate(doc, sv));
		sv = Y.encodeStateVector(doc);
	}
	return updates;
}

async function scenario(dbPrefix: string) {
	const disk = new Map<string, string>();
	const map = new NoteIdMap();
	const box = { e: null as unknown as SyncEngine, onCreate: async () => {} };
	const sent: string[] = [];
	const mgr = new ProviderRegistry({
		dbPrefix,
		send: (_id, frame) => {
			sent.push(frame);
			return true;
		},
		// Production wiring: an unmapped id is not flushed (content stays in the doc).
		onFlushToDisk: async (id, content) => {
			const p = map.pathForId(id);
			if (p) await box.e.flushFromCrdt(p, content);
		},
	});
	const mockApp = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
			}),
			// The file is visible the moment it is written; the create promise
			// resolves later, after whatever the event loop ran in between.
			create: mock(async (p: string, c: string) => {
				disk.set(p, c);
				await box.onCreate();
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const e = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	box.e = e;
	e.setCrdtManager(mgr as never);
	e.setReady();
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => false);
	e.setCrdtEnrollment({ enroll: mock(), reset: mock() } as never);

	const updates = serverEdits();
	// Edits 1..2 reach the doc while the id is still unmapped: no file yet.
	await mgr.applyRemoteUpdate(ID, updates[0]);
	await mgr.applyRemoteUpdate(ID, updates[1]);
	expect(await mgr.getText(ID)).toBe(body(2));
	// The upsert learns the id, and an earlier fan-out already left a
	// head-only row for the path (hash 0: nothing recorded as synced yet).
	map.set(PATH, ID);
	(e as unknown as { setCrdtHead(p: string, h: string): void }).setCrdtHead(PATH, "h2");

	const discover = () =>
		e.applyChange({
			id: ID,
			path: PATH,
			title: "RapidEdits",
			content: body(3),
			folder: "E2E",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 3,
		} as never);
	return { e, mgr, disk, sent, box, updates, discover };
}

test("#578: a fan-out landing during the discovery write does not re-ingest the flushed body", async () => {
	const { e, mgr, disk, sent, box, updates, discover } = await scenario("disc-echo-1");
	const localEdit = spyOn(mgr, "applyLocalEdit");
	// The fan-out of edit 3 lands inside the discovery write's await.
	box.onCreate = async () => {
		await e.applyPushedNoteUpdate(ID, updates[2], "h3");
	};
	await discover();
	box.onCreate = async () => {};

	// Disk held exactly what the engine wrote: nothing local to capture.
	expect(localEdit).not.toHaveBeenCalled();
	expect(sent).toEqual([]);

	await e.applyPushedNoteUpdate(ID, updates[3], "h4");
	await e.applyPushedNoteUpdate(ID, updates[4], "h5");
	expect(await mgr.getText(ID)).toBe(body(5));
	expect(disk.get(PATH)).toBe(body(5));
	expect(localEdit).not.toHaveBeenCalled();
});

test("#578: a real user edit after the discovery flush still reaches applyLocalEdit", async () => {
	const { e, mgr, disk, box, updates, discover } = await scenario("disc-echo-2");
	box.onCreate = async () => {
		await e.applyPushedNoteUpdate(ID, updates[2], "h3");
	};
	await discover();
	box.onCreate = async () => {};
	const localEdit = spyOn(mgr, "applyLocalEdit");

	// The user edits the freshly materialized note before its push fires.
	const edited = `${disk.get(PATH)}\nuser line`;
	disk.set(PATH, edited);
	await e.applyPushedNoteUpdate(ID, updates[3], "h4");

	expect(localEdit).toHaveBeenCalledTimes(1);
	expect(localEdit.mock.calls[0][1]).toBe(edited);
	// Both survive the merge (where Yjs orders the concurrent inserts is not
	// what this test is about).
	const merged = await mgr.getText(ID);
	expect(merged).toContain(body(4));
	expect(merged).toContain("user line");
	expect(merged).not.toContain(body(3));
});
