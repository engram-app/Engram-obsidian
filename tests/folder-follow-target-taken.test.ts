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

const OLD = "E2E/Edit107";
const NEW = "E2E/Edit107-done";

interface Opts {
	/** The target folder exists before the follow, holding these files (path -> note id). */
	before?: Record<string, string>;
	/** File renames that throw. */
	failing?: string[];
	/** Sync rows present at load (path -> hash), as data.json restores them. */
	rows?: Record<string, number>;
	/** Rename targets that throw (any source). */
	failingTo?: string[];
	/** The race lands a FILE (same note, this content) at the new a.md, not
	 *  just the folder (review @ b09792ed MEDIUM). */
	raceFile?: string;
	/** Start from a saved folder-index snapshot instead of following a move. */
	restore?: unknown;
	/** The id map as saved (path -> id), instead of both notes at the old paths. */
	ids?: Record<string, string>;
	/** data.json's cached ids (path -> id), read last. */
	seed?: Record<string, string>;
	/** File contents overriding the defaults (path -> text). */
	bodies?: Record<string, string>;
	/** Extra files at the old paths (path -> content), e.g. an attachment. */
	extra?: Record<string, string>;
}

async function setup(opts: Opts = {}) {
	const tree = new Map<string, TFolder | TFile>();
	const bodies = new Map<string, string>([
		[`${OLD}/a.md`, "alpha"],
		[`${OLD}/sub/b.md`, "beta"],
		...Object.entries(opts.extra ?? {}),
		...Object.entries(opts.bodies ?? {}),
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
	for (const p of Object.keys(opts.extra ?? {})) attach(new TFile(p));
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
				if (opts.failingTo?.includes(to)) throw new Error("EBUSY");
				detach(f.path);
				bodies.set(to, bodies.get(f.path) ?? "");
				bodies.delete(f.path);
				(f as { path: string }).path = to;
				attach(f);
			},
			read: async (f: TFile) => bodies.get(f.path) ?? "",
			readBinary: async (f: TFile) =>
				new TextEncoder().encode(bodies.get(f.path) ?? "").buffer,
			getFiles: () => [...tree.values()].filter((f): f is TFile => f instanceof TFile),
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
		pushAttachment: mock().mockResolvedValue({}),
	};
	const engine = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	for (const [p, hash] of Object.entries(opts.rows ?? {}))
		(engine as any).syncState.set(p, { hash });
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

// Review @ 5d066bc1 MEDIUM, as revised in round 4 (the id map is the
// authority): a file whose move throws still has its id at the server's path,
// is recorded as a stuck move, is refused for push, and follows on retry.
test("contract: a failed file move: the id follows the server; the file catches up via the stuck record", async () => {
	const failing = [`${OLD}/sub/b.md`];
	const { engine, ids, tree } = await setup({ before: {}, failing });
	await engine.onFolderChanged({ id: "fD", parent_id: "fE", name: "Edit107-done", seq: 9 });
	ids.flushNow();
	expect(tree.has(`${OLD}/sub/b.md`)).toBe(true);
	expect(ids.pathForId("nb")).toBe(`${NEW}/sub/b.md`);
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
	expect(engine.exportFolderIndex().stuck?.map((m) => m.from)).toEqual([`${OLD}/sub/b.md`]);
	expect(await (engine as any).pushFile(tree.get(`${OLD}/sub/b.md`), true)).toBe(false);
	failing.length = 0;
	await (engine as any).retryStuckMoves();
	expect(tree.has(`${NEW}/sub/b.md`)).toBe(true);
	expect(tree.has(OLD)).toBe(false);
	expect(engine.exportFolderIndex().stuck).toEqual([]);
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

test("something else landing at the new name before the retry gets a conflict copy, never a claim", async () => {
	const { engine, ids, tree, bodies, app } = await setup({ failing: [`${OLD}/sub/b.md`] });
	await engine.onFolderChanged(move);
	// A file the user made lands at the new name in between.
	await app.vault.create(`${NEW}/sub/b.md`, "other");
	await (engine as any).retryStuckMoves();
	await settle();
	expect(bodies.get(`${NEW}/sub/b.md`)).toBe("other");
	expect(tree.has(`${OLD}/sub/b.md`)).toBe(false);
	const copies = [...tree.keys()].filter((p) => p.startsWith(`${NEW}/sub/b (conflict `));
	expect(copies.length).toBe(1);
	expect(bodies.get(copies[0])).toBe("beta");
	expect(ids.pathForId("nb")).toBe(`${NEW}/sub/b.md`);
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

// Review @ f642fd0c HIGH: the server moves the folder AGAIN before the retry.
// The target is read from the id map at retry time, so the file lands at the
// latest path and the moved-away folder is not recreated.
test("a second server move before the retry: the file lands at the latest path", async () => {
	const failing = [`${OLD}/sub/b.md`];
	const { engine, ids, tree } = await setup({ before: {}, failing });
	await (engine as any).followFolderMoveOnDisk(move);
	const LATEST = "E2E/Edit107-x";
	// The server's next re-key, arriving as a REMOTE index update.
	ids.flushNow();
	const doc = ids.store.doc!;
	const server = new Y.Doc();
	Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
	const sm = server.getMap<any>("filemeta_v0");
	server.transact(() => {
		for (const [k, v] of [...sm.entries()]) {
			if (k.startsWith(`${NEW}/`) || k.startsWith(`${OLD}/`)) {
				sm.delete(k);
				sm.set(k.replace(/^E2E\/Edit107(-done)?\//, `${LATEST}/`), v);
			}
		}
	});
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)), "remote");
	failing.length = 0;
	await (engine as any).retryStuckMoves();
	expect(tree.has(`${LATEST}/sub/b.md`)).toBe(true);
	expect(tree.has(`${NEW}/sub/b.md`)).toBe(false);
	expect(ids.pathForId("nb")).toBe(`${LATEST}/sub/b.md`);
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

// Review @ f642fd0c LOW: an edit typed into the old file just before it is
// trashed is kept as a conflict copy, not lost.
test("the old file changing just before its trash is kept as a conflict copy", async () => {
	const { engine, tree, bodies, app } = await setup({ raceFile: "alpha" });
	await (engine as any).followFolderMoveOnDisk(move);
	const read = app.vault.read;
	let reads = 0;
	app.vault.read = async (f: TFile) => {
		if (f.path === `${OLD}/a.md` && ++reads === 2) bodies.set(f.path, "edited");
		return read(f);
	};
	await (engine as any).retryStuckMoves();
	expect(tree.has(`${OLD}/a.md`)).toBe(false);
	expect(bodies.get(`${NEW}/a.md`)).toBe("alpha");
	const copies = [...tree.keys()].filter((p) => p.startsWith(`${NEW}/a (conflict `));
	expect(copies.map((p) => bodies.get(p))).toEqual(["edited"]);
});

// Review @ f642fd0c LOW: no silent forever-refusal. After the retry cap the
// old file's content becomes a conflict copy and the record is cleared.
test("a move that keeps failing ends in a conflict copy after the retry cap", async () => {
	const { engine, tree, bodies } = await setup({ before: {}, failing: [`${OLD}/sub/b.md`] });
	await (engine as any).followFolderMoveOnDisk(move);
	for (let i = 0; i < 6; i++) await (engine as any).retryStuckMoves();
	expect(engine.exportFolderIndex().stuck).toEqual([]);
	const copies = [...tree.keys()].filter((p) => p.startsWith(`${NEW}/sub/b (conflict `));
	expect(copies.map((p) => bodies.get(p))).toEqual(["beta"]);
	expect(tree.has(`${OLD}/sub/b.md`)).toBe(false);
});

// Review @ f642fd0c LOW: a restored record whose old file no longer matches
// (the user replaced it while the plugin was off) is dropped, file untouched.
test("a restored record is dropped when the old file was replaced", async () => {
	const first = await setup({ before: {}, failing: [`${OLD}/sub/b.md`] });
	await (first.engine as any).followFolderMoveOnDisk(move);
	const saved = JSON.parse(JSON.stringify(first.engine.exportFolderIndex()));
	expect(saved.stuck.length).toBe(1);
	const second = await setup({
		restore: saved,
		ids: { [`${NEW}/a.md`]: "na", [`${NEW}/sub/b.md`]: "nb" },
		bodies: { [`${OLD}/sub/b.md`]: "a new file the user made" },
	});
	await (second.engine as any).retryStuckMoves();
	expect(second.tree.has(`${OLD}/sub/b.md`)).toBe(true);
	expect(second.tree.has(`${NEW}/sub/b.md`)).toBe(false);
	expect(second.engine.exportFolderIndex().stuck).toEqual([]);
});

// Review @ 271b37ef MEDIUM: an attachment (no note id) stranded at the old
// path by a failed move keeps its row at the new path only. Untracked at the
// old path, a push sweep uploaded it there: the same duplicate as e2e test_108.
// It must be recorded as stuck, never pushed, and follow on retry.
test("an attachment stranded by a failed move is not uploaded at the old path, and follows on retry", async () => {
	const IMG = `${OLD}/sub/img.png`;
	const failing = [IMG];
	const { engine, tree, api } = await setup({ before: {}, failing, extra: { [IMG]: "PNG" } });
	const { fnv1aBase64 } = await import("../src/content-hash");
	(engine as any).syncState.set(IMG, {
		hash: fnv1aBase64(new TextEncoder().encode("PNG").buffer),
	});
	await engine.onFolderChanged(move);
	expect(tree.has(IMG)).toBe(true);
	await (engine as any).pushModifiedFiles();
	expect(api.pushAttachment).not.toHaveBeenCalled();
	failing.length = 0;
	await (engine as any).retryStuckMoves();
	expect(tree.has(`${NEW}/sub/img.png`)).toBe(true);
	expect(tree.has(IMG)).toBe(false);
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

// Review @ d03d54c0: the stuck-attachment branches. IMG is stranded at the old
// path (its move throws), its row is at the new path.
const IMG = `${OLD}/sub/img.png`;
const IMG_NEW = `${NEW}/sub/img.png`;
const isCopy = (p: string) => /^E2E\/Edit107-done\/sub\/img \(conflict .+\)\.png$/.test(p);

async function strandImage(opts: Opts = {}) {
	const failing = opts.failing ?? [IMG];
	const env = await setup({ before: {}, ...opts, failing, extra: { [IMG]: "PNG" } });
	const { fnv1aBase64 } = await import("../src/content-hash");
	(env.engine as any).syncState.set(IMG, {
		hash: fnv1aBase64(new TextEncoder().encode("PNG").buffer),
	});
	await env.engine.onFolderChanged(move);
	expect(env.tree.has(IMG)).toBe(true);
	return { ...env, failing };
}

test("stuck attachment: the same bytes already at the target delete the old copy", async () => {
	const { engine, tree, bodies, app, failing } = await strandImage();
	await app.vault.create(IMG_NEW, "PNG");
	failing.length = 0;
	await (engine as any).retryStuckMoves();
	expect(tree.has(IMG)).toBe(false);
	expect(bodies.get(IMG_NEW)).toBe("PNG");
	expect([...tree.keys()].some(isCopy)).toBe(false);
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

test("stuck attachment: other bytes at the target keep the old copy as an image conflict copy", async () => {
	const { engine, tree, bodies, app, failing } = await strandImage();
	await app.vault.create(IMG_NEW, "OTHER");
	failing.length = 0;
	await (engine as any).retryStuckMoves();
	expect(tree.has(IMG)).toBe(false);
	expect(bodies.get(IMG_NEW)).toBe("OTHER");
	const copies = [...tree.keys()].filter((p) => p.startsWith(`${NEW}/sub/img (conflict `));
	expect(copies.length).toBe(1);
	expect(isCopy(copies[0])).toBe(true);
	expect(bodies.get(copies[0])).toBe("PNG");
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

test("stuck attachment: at the retry cap the old copy becomes an image conflict copy", async () => {
	const { engine, tree, bodies } = await strandImage({ failing: [], failingTo: [IMG_NEW] });
	for (let i = 0; i < 6; i++) await (engine as any).retryStuckMoves();
	expect(tree.has(IMG)).toBe(false);
	const copies = [...tree.keys()].filter(isCopy);
	expect(copies.map((p) => bodies.get(p))).toEqual(["PNG"]);
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

test("stuck attachment: a rename that keeps throwing advances tries and raises a Sync Center issue, never an upload", async () => {
	const { engine, tree, app, api } = await strandImage();
	await app.vault.create(IMG_NEW, "OTHER");
	for (let i = 0; i < 6; i++) await (engine as any).retryStuckMoves();
	expect(tree.has(IMG)).toBe(true);
	expect(engine.issues.get(IMG)?.category).toBe("conflict");
	expect(engine.exportFolderIndex().stuck?.[0]?.tries).toBeGreaterThanOrEqual(5);
	await (engine as any).pushModifiedFiles();
	// The user's other file at the new path may sync; the old path never does.
	const sent = api.pushAttachment.mock.calls.map((c: unknown[]) => c[0]);
	expect(sent).not.toContain(IMG);
});

test("stuck attachment: the record survives a restart with no id and its row path", async () => {
	const first = await strandImage();
	const saved = JSON.parse(JSON.stringify(first.engine.exportFolderIndex()));
	expect(saved.stuck).toEqual([expect.objectContaining({ from: IMG, id: null, to: IMG_NEW })]);
	const second = await setup({
		restore: saved,
		ids: { [`${NEW}/a.md`]: "na", [`${NEW}/sub/b.md`]: "nb" },
		extra: { [IMG]: "PNG" },
		rows: { [IMG_NEW]: 1 },
	});
	(second.engine as any).ensureFolder = async (p: string) => {
		if (!second.tree.has(p)) await second.app.vault.createFolder(p);
	};
	await (second.engine as any).retryStuckMoves();
	expect(second.tree.has(IMG_NEW)).toBe(true);
	expect(second.tree.has(IMG)).toBe(false);
	expect(second.engine.exportFolderIndex().stuck).toEqual([]);
});

test("stuck attachment: a later move of its row carries the record's target", async () => {
	const { engine, tree, failing } = await strandImage();
	const LATER = "E2E/Later/sub/img.png";
	(engine as any).renamePath(IMG_NEW, LATER, "remote");
	expect(engine.exportFolderIndex().stuck?.[0]?.to).toBe(LATER);
	failing.length = 0;
	await (engine as any).retryStuckMoves();
	expect(tree.has(LATER)).toBe(true);
	expect(tree.has(IMG)).toBe(false);
});

// Review delta 2 LOW: the "could not move" card must not outlive its stuck
// file. A user delete or rename of the old file drops the record, and the
// card with it; so does a retry that finds the file gone.
async function capStuckImage() {
	const env = await strandImage();
	await env.app.vault.create(IMG_NEW, "OTHER");
	for (let i = 0; i < 6; i++) await (env.engine as any).retryStuckMoves();
	expect(env.engine.issues.get(IMG)?.category).toBe("conflict");
	return env;
}

test("stuck attachment: a user delete of the old file clears its Sync Center card", async () => {
	const { engine, tree, app } = await capStuckImage();
	const file = tree.get(IMG) as TFile;
	await app.fileManager.trashFile(file);
	await engine.handleDelete(file);
	expect(engine.issues.get(IMG)).toBeUndefined();
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

test("stuck attachment: a user rename of the old file clears its Sync Center card", async () => {
	const { engine, tree, failing } = await capStuckImage();
	const file = tree.get(IMG) as TFile;
	failing.length = 0;
	const elsewhere = `${NEW}/kept.png`;
	await (engine as any).app.vault.rename(file, elsewhere);
	await engine.handleRename(file, IMG);
	expect(engine.issues.get(IMG)).toBeUndefined();
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});

test("stuck attachment: a retry that finds the old file gone clears its Sync Center card", async () => {
	const { engine, tree, app } = await capStuckImage();
	// Gone without a delete event reaching the engine (removed while off).
	await app.fileManager.trashFile(tree.get(IMG) as TFile);
	await (engine as any).retryStuckMoves();
	expect(engine.issues.get(IMG)).toBeUndefined();
	expect(engine.exportFolderIndex().stuck).toEqual([]);
});
