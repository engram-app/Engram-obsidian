// e2e test_107 offline-edit case (feed off; backend runs 44553084558 and
// 44559711575, 2 of 5 repeats): B followed A's folder move while its own
// CRDT flush of the edited note created the target folder, so the folder's
// `vault.rename` threw "Destination file already exists!". The failure path
// put every descendant's id back at the OLD path and that publication undid
// the server's move (the index is authoritative: projection repathed the
// sibling note back, and A then rewrote it at the old path). The server has
// moved the folder, so a failed rename must keep the new paths and move the
// files one by one.
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

const OLD = "E2E/Edit107";
const NEW = "E2E/Edit107-done";

interface Opts {
	/** The target folder exists before the follow, holding these files (path -> note id). */
	before?: Record<string, string>;
	/** File renames that throw. */
	failing?: string[];
}

async function setup(opts: Opts = {}) {
	const tree = new Map<string, TFolder | TFile>();
	const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	const attach = (f: TFolder | TFile) => {
		tree.set(f.path, f);
		(tree.get(parentOf(f.path)) as TFolder | undefined)?.children.push(f);
	};
	const detach = (p: string) => {
		const node = tree.get(p);
		tree.delete(p);
		const parent = tree.get(parentOf(p)) as TFolder | undefined;
		if (parent) parent.children = parent.children.filter((c) => c !== node);
	};
	for (const p of ["E2E", OLD, `${OLD}/sub`]) attach(new TFolder(p, []));
	attach(new TFile(`${OLD}/a.md`));
	attach(new TFile(`${OLD}/sub/b.md`));
	if (opts.before) {
		attach(new TFolder(NEW, []));
		for (const p of Object.keys(opts.before)) attach(new TFile(p));
	}
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: (p: string) => tree.get(p) ?? null,
			getFileByPath: (p: string) => {
				const f = tree.get(p);
				return f instanceof TFile ? f : null;
			},
			getName: () => "Vault",
			// The device's own flush created the target mid-follow: the folder
			// rename is refused, single files still move.
			rename: async (f: TFolder | TFile, to: string) => {
				if (f instanceof TFolder || tree.has(to)) {
					throw new Error("Destination file already exists!");
				}
				if (opts.failing?.includes(f.path)) throw new Error("EBUSY");
				detach(f.path);
				(f as { path: string }).path = to;
				attach(f);
			},
			createFolder: async (p: string) => {
				if (tree.has(p)) throw new Error("Folder already exists.");
				attach(new TFolder(p, []));
			},
		},
		fileManager: {
			trashFile: async (f: TFolder | TFile) => detach(f.path),
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const engine = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	engine.setReady();
	const ids = new NoteIdMap();
	ids.set(`${OLD}/a.md`, "na");
	ids.set(`${OLD}/sub/b.md`, "nb");
	for (const [p, id] of Object.entries(opts.before ?? {})) ids.set(p, id);
	ids.flushNow();
	engine.setCrdtPorts({ noteIdMap: ids });
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fD", parent_id: "fE", name: "Edit107" },
	]);
	await engine.setFolderOpsEnabled(true);
	// The race: the target exists by the time the rename runs.
	const ensure = (engine as any).ensureFolder.bind(engine);
	let raced = false;
	(engine as any).ensureFolder = async (p: string) => {
		await ensure(p);
		if (p === "E2E" && !raced && !opts.before) {
			raced = true;
			await app.vault.createFolder(NEW);
		}
	};
	return { engine, ids, tree };
}

test("a folder rename refused by a taken target keeps the server's paths and moves the files", async () => {
	const { engine, ids, tree } = await setup();
	await engine.onFolderChanged({ id: "fD", parent_id: "fE", name: "Edit107-done", seq: 9 });
	ids.flushNow();
	const shared = ids.store.doc!.getMap<any>("filemeta_v0");
	expect(shared.has(`${OLD}/sub/b.md`)).toBe(false);
	expect(shared.has(`${OLD}/a.md`)).toBe(false);
	expect(ids.pathForId("nb")).toBe(`${NEW}/sub/b.md`);
	expect(tree.has(`${NEW}/sub/b.md`)).toBe(true);
	expect(tree.has(`${NEW}/a.md`)).toBe(true);
	expect(tree.has(OLD)).toBe(false);
	expect(engine.folderOps.index.pathFor("fD")).toBe(NEW);
});

// Review @ 5d066bc1 HIGH: a target that exists BEFORE the follow, holding a
// DIFFERENT note at the same name. Re-keying onto it evicted that note's id
// from the shared index and handed its file to the moved note.
test("a different note already at the new name keeps its id; the moved note lands as a conflict copy", async () => {
	const { engine, ids, tree } = await setup({ before: { [`${NEW}/a.md`]: "nY" } });
	await engine.onFolderChanged({ id: "fD", parent_id: "fE", name: "Edit107-done", seq: 9 });
	ids.flushNow();
	expect(ids.pathForId("nY")).toBe(`${NEW}/a.md`);
	expect(ids.get(`${NEW}/a.md`)).toBe("nY");
	const copy = ids.pathForId("na");
	expect(copy).toMatch(/^E2E\/Edit107-done\/a \(conflict .+\)\.md$/);
	expect(tree.has(copy!)).toBe(true);
	expect(ids.pathForId("nb")).toBe(`${NEW}/sub/b.md`);
	expect(tree.has(`${NEW}/sub/b.md`)).toBe(true);
	expect(tree.has(OLD)).toBe(false);
});

// Review @ 5d066bc1 MEDIUM: an id must not run ahead of its file. A file whose
// move throws keeps its id where the file is, and no old path is published.
test("a file whose move throws keeps its id where the file is", async () => {
	const { engine, ids, tree } = await setup({ before: {}, failing: [`${OLD}/sub/b.md`] });
	await engine.onFolderChanged({ id: "fD", parent_id: "fE", name: "Edit107-done", seq: 9 });
	ids.flushNow();
	expect(tree.has(`${OLD}/sub/b.md`)).toBe(true);
	expect(ids.pathForId("nb")).toBe(`${OLD}/sub/b.md`);
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
	expect(tree.has(`${NEW}/a.md`)).toBe(true);
});
