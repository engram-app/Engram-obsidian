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

async function setup(getManifest: () => Promise<unknown>) {
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
				renames.push([f.path, to]);
				for (const [p, node] of [...tree]) {
					if (p === f.path || p.startsWith(`${f.path}/`)) {
						tree.delete(p);
						const np = to + p.slice(f.path.length);
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
	engine.setNoteIdMap(ids);
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
