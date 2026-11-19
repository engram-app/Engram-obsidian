// e2e test_108 on plugin 1.40.0 (backend runs 44474537599, 44485920547,
// 44490135527): a folder created over REST never reached this device's folder
// index (only crdt_create replies and a manifest `folders` list teach ids).
// When the server moved it, `folder_changed` named an id the index did not
// know, so followFolderMoveOnDisk learned the row at its new place and moved
// nothing. The 1.40.0 plugin gets no moved-folder feed, so the note stayed at
// its old path for good. The folder's local path must be resolved from the
// manifest (a known note id listed at the new path) and the folder moved.
import { afterEach, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile, TFolder } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const engines: SyncEngine[] = [];
afterEach(() => {
	for (const e of engines) e.destroy();
	engines.length = 0;
});

const ROOT = "E2E/Att108";

async function setup(getManifest: () => Promise<unknown>, wire: "test" | "prod" = "test") {
	const tree = new Map<string, TFolder | TFile>();
	const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	const attach = (f: TFolder | TFile) => {
		tree.set(f.path, f);
		(tree.get(parentOf(f.path)) as TFolder | undefined)?.children.push(f);
	};
	for (const p of ["E2E", ROOT, `${ROOT}/src`]) attach(new TFolder(p, []));
	attach(new TFile(`${ROOT}/src/n.md`));
	attach(new TFile(`${ROOT}/src/img.png`));
	const renames: [string, string][] = [];
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: (p: string) => tree.get(p) ?? null,
			getFileByPath: (p: string) => {
				const f = tree.get(p);
				return f instanceof TFile ? f : null;
			},
			getName: () => "Vault",
			rename: async (f: TFolder, to: string) => {
				const from = f.path;
				renames.push([from, to]);
				for (const [p, node] of [...tree]) {
					if (p === from || p.startsWith(`${from}/`)) {
						tree.delete(p);
						const np = to + p.slice(from.length);
						(node as { path: string }).path = np;
						tree.set(np, node);
					}
				}
			},
			createFolder: async (p: string) => attach(new TFolder(p, [])),
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = { getManifest: mock(getManifest) };
	const engine = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	engine.setReady();
	const ids = new NoteIdMap();
	ids.set(`${ROOT}/src/n.md`, "n1");
	// "prod": the way main.ts hands the map over (setCrdtPorts), not the
	// test-only setNoteIdMap.
	if (wire === "prod") engine.setCrdtPorts({ noteIdMap: ids });
	else engine.setNoteIdMap(ids);
	await engine.setFolderOpsEnabled(true);
	return { engine, renames, api, tree };
}

const FOLDERS = [
	{ id: "fE", parent_id: null, name: "E2E" },
	{ id: "fR", parent_id: "fE", name: "Att108" },
	{ id: "fD", parent_id: "fR", name: "dst" },
];

test("folder_changed for a folder the index never learned moves it on disk", async () => {
	const { engine, renames, tree } = await setup(async () => ({
		notes: [{ id: "n1", path: `${ROOT}/dst/n.md`, content_hash: "h" }],
		attachments: [{ path: `${ROOT}/dst/img.png`, content_hash: "a" }],
		total_notes: 1,
		total_attachments: 1,
		folders: FOLDERS,
	}));
	await engine.onFolderChanged({ id: "fD", parent_id: "fR", name: "dst", seq: 9 });
	expect(renames).toEqual([[`${ROOT}/src`, `${ROOT}/dst`]]);
	expect(tree.has(`${ROOT}/dst/n.md`)).toBe(true);
	expect(tree.has(`${ROOT}/dst/img.png`)).toBe(true);
	expect(engine.folderOps.index.pathFor("fD")).toBe(`${ROOT}/dst`);
});

test("the manifest pass moves a folder the index never learned", async () => {
	const { engine, renames } = await setup(async () => null);
	await (engine as any).syncManifestFolders({
		notes: [{ id: "n1", path: `${ROOT}/dst/n.md`, content_hash: "h" }],
		attachments: [],
		total_notes: 1,
		total_attachments: 0,
		folders: FOLDERS,
	});
	expect(renames).toEqual([[`${ROOT}/src`, `${ROOT}/dst`]]);
	expect(engine.folderOps.index.pathFor("fD")).toBe(`${ROOT}/dst`);
});

test("a failed manifest fetch keeps today's behaviour: the row is learned, nothing moves", async () => {
	const { engine, renames } = await setup(async () => {
		throw new Error("offline");
	});
	await engine.onFolderChanged({ id: "fD", parent_id: "fR", name: "dst", seq: 9 });
	expect(renames).toEqual([]);
});

test("a known folder still moves from the index without a manifest fetch", async () => {
	const { engine, renames, api } = await setup(async () => null);
	engine.learnFolders([...FOLDERS.slice(0, 2), { id: "fD", parent_id: "fR", name: "src" }]);
	await engine.onFolderChanged({ id: "fD", parent_id: "fR", name: "dst", seq: 9 });
	expect(renames).toEqual([[`${ROOT}/src`, `${ROOT}/dst`]]);
	expect(api.getManifest).not.toHaveBeenCalled();
});

test("an unknown folder already where the server puts it needs no manifest fetch", async () => {
	const { engine, renames, api } = await setup(async () => null);
	await engine.onFolderChanged({ id: "fE", parent_id: null, name: "E2E", seq: 9 });
	expect(api.getManifest).not.toHaveBeenCalled();
	expect(renames).toEqual([]);
	expect(engine.folderOps.index.pathFor("fE")).toBe("E2E");
});

test("the followed move fences a stale row naming the old path", async () => {
	const { engine } = await setup(async () => ({
		notes: [{ id: "n1", path: `${ROOT}/dst/n.md`, content_hash: "h" }],
		attachments: [],
		total_notes: 1,
		total_attachments: 0,
		change_seq: 12,
		folders: FOLDERS,
	}));
	await engine.onFolderChanged({ id: "fD", parent_id: "fR", name: "dst", seq: 9 });
	const e = engine as any;
	expect(e.predatesFolderMove(`${ROOT}/src/n.md`, 8)).toBe(true);
	expect(e.predatesFolderMove(`${ROOT}/src/n.md`, 10)).toBe(false);
});

// Map/disk split (e2e run 44516034894): an inbound row claimed the moved
// note's id at its new path while the file stayed at the old one. The hook that
// moves the file when a claim moves (SyncStore.onRelocate) was wired only by the
// test-only setNoteIdMap; main.ts hands the map over through setCrdtPorts. Every
// claim goes through the store, so the claim itself stands in for whichever
// caller made it (pull row, announce, manifest reconcile).
test("an id claim moving to the moved folder moves the file with it (production wiring)", async () => {
	const { engine, tree } = await setup(async () => null, "prod");
	const ids = (engine as any).noteIdMap as NoteIdMap;
	ids.set(`${ROOT}/dst/n.md`, "n1");
	for (let i = 0; i < 20; i++) await Promise.resolve();
	expect(tree.has(`${ROOT}/dst/n.md`)).toBe(true);
	expect(tree.has(`${ROOT}/src/n.md`)).toBe(false);
	expect(ids.pathForId("n1")).toBe(`${ROOT}/dst/n.md`);
});

// e2e run 44533055015: the REST folder move re-keys the server's index, and
// that claim reaches this device as a REMOTE index update before
// `folder_changed`. The map then reports the note at the new path, so the
// unknown-folder resolver cannot place the folder, and the file stayed at the
// old path. A remote claim moving an id must move the file like a local one.
test("a remote index re-key of the moved note moves the file", async () => {
	const { engine, tree } = await setup(async () => null, "prod");
	const ids = (engine as any).noteIdMap as NoteIdMap;
	ids.flushNow();
	const doc = ids.store.doc!;
	const server = new Y.Doc();
	Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
	const sm = server.getMap<any>("filemeta_v0");
	server.transact(() => {
		sm.delete(`${ROOT}/src/n.md`);
		sm.set(`${ROOT}/dst/n.md`, { note_id: "n1" });
	});
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)), "remote");
	for (let i = 0; i < 20; i++) await Promise.resolve();
	expect(tree.has(`${ROOT}/dst/n.md`)).toBe(true);
	expect(tree.has(`${ROOT}/src/n.md`)).toBe(false);
});

// Review @ 44b05509 HIGH: a folder rename that fails puts every descendant's
// bookkeeping back at the old path. An id the server's index had already
// re-keyed to the new path was "put back" too, and the next commit published
// the old path as a claim, undoing the server's move.
test("a failed folder rename does not undo an id the server already re-keyed", async () => {
	const { engine, tree } = await setup(async () => null, "prod");
	const ids = (engine as any).noteIdMap as NoteIdMap;
	ids.flushNow();
	const doc = ids.store.doc!;
	const server = new Y.Doc();
	Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
	const sm = server.getMap<any>("filemeta_v0");
	const app = (engine as any).app;
	// Neither move lands: the target never appears, so the folder rename runs
	// and fails (the race where a concurrent create takes it mid-await).
	app.vault.createFolder = async () => {};
	const tried: string[] = [];
	app.vault.rename = async (f: { path: string }) => {
		tried.push(f.path);
		throw new Error("Destination file already exists!");
	};
	server.transact(() => {
		sm.delete(`${ROOT}/src/n.md`);
		sm.set(`${ROOT}/dst/n.md`, { note_id: "n1" });
	});
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)), "remote");
	engine.learnFolders([...FOLDERS.slice(0, 2), { id: "fD", parent_id: "fR", name: "src" }]);
	await engine.onFolderChanged({ id: "fD", parent_id: "fR", name: "dst", seq: 9 });
	ids.flushNow();
	expect(tried).toContain(`${ROOT}/src`);
	expect(tree.has(`${ROOT}/src/n.md`)).toBe(true);
	expect(ids.pathForId("n1")).toBe(`${ROOT}/dst/n.md`);
	expect(doc.getMap<any>("filemeta_v0").get(`${ROOT}/src/n.md`)).toBeUndefined();
});
