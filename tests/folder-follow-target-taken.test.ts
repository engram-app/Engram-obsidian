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
	/** The race lands a FILE (same note, this content) at the new a.md, not
	 *  just the folder (review @ b09792ed MEDIUM). */
	raceFile?: string;
	/** Start from a saved folder-index snapshot instead of following a move. */
	restore?: unknown;
	/** The id map as saved (path -> id), instead of both notes at the old paths. */
	ids?: Record<string, string>;
	/** data.json's cached ids (path -> id), read last. */
	seed?: Record<string, string>;
}

async function setup(opts: Opts = {}) {
	const tree = new Map<string, TFolder | TFile>();
	const bodies = new Map<string, string>([
		[`${OLD}/a.md`, "alpha"],
		[`${OLD}/sub/b.md`, "beta"],
	]);
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
		for (const p of Object.keys(opts.before)) {
			attach(new TFile(p));
			bodies.set(p, bodies.get(p.replace(NEW, OLD)) ?? "");
		}
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
				bodies.set(to, bodies.get(f.path) ?? "");
				bodies.delete(f.path);
				(f as { path: string }).path = to;
				attach(f);
			},
			read: async (f: TFile) => bodies.get(f.path) ?? "",
			cachedRead: async (f: TFile) => bodies.get(f.path) ?? "",
			create: async (p: string, text: string) => {
				if (tree.has(p)) throw new Error("File already exists.");
				const f = new TFile(p);
				attach(f);
				bodies.set(p, text);
				return f;
			},
			modify: async (f: TFile, text: string) => {
				bodies.set(f.path, text);
			},
			createFolder: async (p: string) => {
				if (tree.has(p)) throw new Error("Folder already exists.");
				attach(new TFolder(p, []));
			},
		},
		fileManager: {
			trashFile: async (f: TFolder | TFile) => {
				detach(f.path);
				bodies.delete(f.path);
			},
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = {
		createNote: mock().mockResolvedValue({}),
		pushNote: mock().mockResolvedValue({}),
	};
	const engine = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	engine.setReady();
	const ids = new NoteIdMap();
	for (const [p, id] of Object.entries(
		opts.ids ?? { [`${OLD}/a.md`]: "na", [`${OLD}/sub/b.md`]: "nb" },
	))
		ids.set(p, id);
	for (const [p, id] of Object.entries(opts.before ?? {})) ids.set(p, id);
	ids.seed(opts.seed);
	ids.flushNow();
	engine.setCrdtPorts({ noteIdMap: ids });
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fD", parent_id: "fE", name: "Edit107" },
	]);
	if (opts.restore) engine.restoreFolderIndex(opts.restore as any);
	await engine.setFolderOpsEnabled(true);
	// The race: the target exists by the time the rename runs.
	const ensure = (engine as any).ensureFolder.bind(engine);
	let raced = false;
	(engine as any).ensureFolder = async (p: string) => {
		await ensure(p);
		if (p === "E2E" && !raced && !opts.before && !opts.restore) {
			raced = true;
			await app.vault.createFolder(NEW);
			if (opts.raceFile !== undefined) {
				attach(new TFile(`${NEW}/a.md`));
				bodies.set(`${NEW}/a.md`, opts.raceFile);
			}
		}
	};
	return { engine, ids, tree, bodies, api, app };
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

const move = { id: "fD", parent_id: "fE", name: "Edit107-done", seq: 9 };
const settle = async () => {
	for (let i = 0; i < 30; i++) await Promise.resolve();
};

// Review @ b09792ed MEDIUM: the race alone strands a file. Its id is already at
// the new path, its old file has no id and no sync row, and a later push sweep
// would upload it as a NEW note. It must be resolved (same note, same bytes:
// the old copy goes) and never pushed meanwhile.
test("a file stranded by the race is never pushed as a new note, and is resolved", async () => {
	const { engine, ids, tree, api } = await setup({ raceFile: "alpha" });
	await (engine as any).followFolderMoveOnDisk(move);
	const stranded = tree.get(`${OLD}/a.md`) as TFile;
	expect(stranded).toBeDefined();
	expect(await (engine as any).pushFile(stranded, true)).toBe(false);
	await (engine as any).retryStuckMoves();
	await settle();
	expect(tree.has(`${OLD}/a.md`)).toBe(false);
	expect(tree.has(OLD)).toBe(false);
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
	expect(api.createNote).not.toHaveBeenCalled();
});

test("a stranded file survives a restart and the reconnect retry moves it", async () => {
	const first = await setup({ failing: [`${OLD}/sub/b.md`] });
	await first.engine.onFolderChanged(move);
	first.ids.flushNow();
	expect(first.tree.has(`${OLD}/sub/b.md`)).toBe(true);
	const saved = JSON.parse(JSON.stringify(first.engine.exportFolderIndex()));
	// Same disk, new session: the map already has the server's paths.
	const second = await setup({
		restore: saved,
		ids: { [`${NEW}/a.md`]: "na", [`${NEW}/sub/b.md`]: "nb" },
	});
	(second.engine as any).ensureFolder = async (p: string) => {
		if (!second.tree.has(p)) await second.app.vault.createFolder(p);
	};
	await second.engine.setFolderOpsEnabled(true);
	await settle();
	expect(second.tree.has(`${NEW}/sub/b.md`)).toBe(true);
	expect(second.tree.has(`${OLD}/sub/b.md`)).toBe(false);
	expect(second.engine.exportFolderIndex().stuck ?? []).toEqual([]);
});

test("another note taking the new name before the retry gets a conflict copy, never a claim", async () => {
	const { engine, ids, tree, bodies, app } = await setup({ failing: [`${OLD}/sub/b.md`] });
	await engine.onFolderChanged(move);
	// Someone else's note lands at the new name in between.
	await app.vault.create(`${NEW}/sub/b.md`, "other");
	ids.set(`${NEW}/sub/b.md`, "nZ");
	ids.flushNow();
	await (engine as any).retryStuckMoves();
	await settle();
	expect(ids.pathForId("nZ")).toBe(`${NEW}/sub/b.md`);
	expect(bodies.get(`${NEW}/sub/b.md`)).toBe("other");
	expect(tree.has(`${OLD}/sub/b.md`)).toBe(false);
	const copies = [...tree.keys()].filter((p) => p.startsWith(`${NEW}/sub/b (conflict `));
	expect(copies.length).toBe(1);
	expect(bodies.get(copies[0])).toBe("beta");
});

// Review @ b09792ed LOW: the SAME note at both names is not a clash with
// itself: with identical bytes the old copy goes, no conflict copy.
test("the same note at both names is deduped, not copied", async () => {
	const { engine, ids, tree } = await setup({
		ids: { [`${OLD}/sub/b.md`]: "nb" },
		before: { [`${NEW}/a.md`]: "na" },
		seed: { [`${OLD}/a.md`]: "na" },
	});
	await engine.onFolderChanged(move);
	await settle();
	ids.flushNow();
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
	expect([...tree.keys()].some((p) => p.includes("(conflict "))).toBe(false);
});
