// e2e test_107 offline-edit-then-folder-rename: the peer kept an EMPTY old
// folder forever. After the server moved OLD -> NEW, the peer recorded OLD as
// moved away, then materialized a note at its stale path under OLD. That
// create made a folder under OLD through the engine's own ensureFolder, and
// Obsidian's folder `create` event (handleFolderCreate) read it as the user
// re-making the folder: the moved-away record was cleared, the folder was
// POSTed back to the server as explicit, and the emptied OLD was never
// removed. Only a user-made folder may clear the record or reach the server.
import { afterEach, expect, mock, test } from "bun:test";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { ExplicitFolders } from "../src/explicit-folders";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

class MemoryAdapter {
	files = new Map<string, string>();
	read(path: string): Promise<string> {
		const v = this.files.get(path);
		return v === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(v);
	}
	write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}
}

type Engine = {
	movedAwayFolders: Set<string>;
	ensureFolder(p: string): Promise<void>;
	removeEmptyFolders(p: string): Promise<void>;
	syncExplicitFolders(): Promise<void>;
	handleFolderCreate(f: { path: string }): Promise<void>;
};

const engines: SyncEngine[] = [];
afterEach(() => {
	for (const e of engines) e.destroy();
	engines.length = 0;
});

const OLD = "E2E/Old";
const NEW = "E2E/Old-done";

/** A folder tree that fires `create` for folders like main.ts wires it
 *  (inline, or held in `held` when `deferEvents`). */
async function setup(
	onDisk: string[],
	explicitPaths: string[],
	opts: {
		deferEvents?: boolean;
		createFolderError?: string;
		serverList?: string[];
		files?: string[];
		renameError?: string;
	} = {},
) {
	const tree = new Map<string, TFolder | TFile>();
	const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	let engine!: SyncEngine;
	const add = (p: string) => {
		const f = new TFolder(p, []);
		tree.set(p, f);
		(tree.get(parentOf(p)) as TFolder | undefined)?.children.push(f);
		return f;
	};
	for (const p of onDisk) add(p);
	for (const p of opts.files ?? []) {
		const f = new TFile(p);
		tree.set(p, f);
		(tree.get(parentOf(p)) as TFolder | undefined)?.children.push(f);
	}
	const trashed: string[] = [];
	const held: TFolder[] = [];
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: (p: string) => tree.get(p) ?? null,
			getFileByPath: (p: string) => {
				const f = tree.get(p);
				return f instanceof TFile ? f : null;
			},
			getName: () => "Vault",
			// A concurrent create of the target wins the race, then the rename throws.
			rename: async (_f: TFolder, to: string) => {
				if (!tree.has(to)) add(to);
				throw new Error(opts.renameError ?? "unexpected rename");
			},
			createFolder: async (p: string) => {
				if (opts.createFolderError) throw new Error(opts.createFolderError);
				const f = add(p);
				if (opts.deferEvents) held.push(f);
				else await engine.handleFolderCreate(f); // main.ts: vault.on("create")
			},
		},
		fileManager: {
			trashFile: async (f: TFolder) => {
				trashed.push(f.path);
				tree.delete(f.path);
				const parent = tree.get(parentOf(f.path)) as TFolder | undefined;
				if (parent) parent.children = parent.children.filter((c) => c !== f);
			},
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = {
		createFolder: mock().mockResolvedValue({ folders: [] }),
		listExplicitFolders: mock().mockResolvedValue(opts.serverList ?? []),
	};
	const time = new ManualTimeProvider();
	engine = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		time,
	);
	engine.setReady();
	engines.push(engine);
	const explicit = new ExplicitFolders(new MemoryAdapter(), "f.json");
	await explicit.load();
	for (const p of explicitPaths) await explicit.add(p);
	engine.explicitFolders = explicit;
	/** A per-note move took this file out of its folder. */
	const moveOut = (p: string) => {
		const f = tree.get(p);
		tree.delete(p);
		const parent = tree.get(parentOf(p)) as TFolder | undefined;
		if (parent) parent.children = parent.children.filter((c) => c !== f);
	};
	return { e: engine as unknown as Engine, engine, trashed, explicit, api, held, time, moveOut };
}

test("a sync-driven create UNDER a moved-away folder keeps the record: both are removed", async () => {
	const { e, trashed, api } = await setup(["E2E", NEW, OLD], [OLD]);
	e.movedAwayFolders.add(OLD);
	// The stale-path note materializes at OLD/sub/b.md, then moves on.
	await e.ensureFolder(`${OLD}/sub`);
	await e.removeEmptyFolders(`${OLD}/sub/b.md`);
	expect(trashed).toEqual([`${OLD}/sub`, OLD]);
	// Never sent back as a user's explicit folder (it would rebuild OLD everywhere).
	expect(api.createFolder).not.toHaveBeenCalled();
});

test("a sync-driven create AT the moved-away folder keeps the record", async () => {
	const { e, trashed, api } = await setup(["E2E", NEW], [OLD]);
	e.movedAwayFolders.add(OLD);
	await e.ensureFolder(OLD);
	await e.removeEmptyFolders(`${OLD}/a.md`);
	expect(trashed).toEqual([OLD]);
	expect(api.createFolder).not.toHaveBeenCalled();
});

test("a USER-made folder at the old path clears the record and is kept", async () => {
	const { e, trashed, explicit, api } = await setup(["E2E", NEW, OLD], [OLD]);
	e.movedAwayFolders.add(OLD);
	await e.handleFolderCreate(new TFolder(OLD, []));
	await e.removeEmptyFolders(`${OLD}/a.md`);
	expect(trashed).toEqual([]);
	expect(explicit.has(OLD)).toBe(true);
	expect(api.createFolder).not.toHaveBeenCalled(); // already explicit: no re-POST
});

test("a USER-made subfolder under the old path clears the record and is pushed", async () => {
	const { e, trashed, api } = await setup(["E2E", OLD, `${OLD}/mine`], [OLD]);
	e.movedAwayFolders.add(OLD);
	await e.handleFolderCreate(new TFolder(`${OLD}/mine`, []));
	await e.removeEmptyFolders(`${OLD}/mine/a.md`);
	expect(trashed).toEqual([]);
	expect(api.createFolder).toHaveBeenCalledWith(`${OLD}/mine`);
});

test("a folder the server lists again at the old path is never trashed", async () => {
	// A user re-made an empty OLD in the web app after the move.
	const { e, trashed, explicit } = await setup(["E2E", NEW], [], { serverList: [OLD] });
	e.movedAwayFolders.add(OLD);
	await e.syncExplicitFolders();
	await e.removeEmptyFolders(`${OLD}/a.md`);
	expect(trashed).toEqual([]);
	expect(explicit.has(OLD)).toBe(true);
});

test("a server-listed PARENT does not clear the moved-away record under it", async () => {
	const { e, trashed } = await setup(["E2E", NEW, OLD], [OLD], { serverList: ["E2E", OLD] });
	e.movedAwayFolders.add(OLD);
	e.movedAwayFolders.add("E2E/Gone");
	await e.syncExplicitFolders();
	expect(e.movedAwayFolders.has("E2E/Gone")).toBe(true);
	expect(trashed).toEqual([]);
});

test("a create event later than the marker's lifetime reads as user-made (fails safe)", async () => {
	const { e, trashed, held, time } = await setup(["E2E", NEW], [OLD], { deferEvents: true });
	e.movedAwayFolders.add(OLD);
	await e.ensureFolder(OLD);
	time.advance(5001);
	for (const f of held) await e.handleFolderCreate(f);
	await e.removeEmptyFolders(`${OLD}/a.md`);
	expect(trashed).toEqual([]); // kept, never wrongly trashed
});

test("the folder rename losing a race to a create of the target still removes OLD and OLD/sub", async () => {
	// e2e run 44234736582: B saw no target, A's concurrent folder create made
	// it, and B's vault.rename threw "Destination file already exists!".
	const { e, engine, trashed, moveOut } = await setup(
		["E2E", OLD, `${OLD}/sub`],
		[OLD, `${OLD}/sub`],
		{
			files: [`${OLD}/a.md`, `${OLD}/sub/b.md`],
			renameError: "Destination file already exists!",
		},
	);
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fo", parent_id: "fE", name: "Old" },
		{ id: "fs", parent_id: "fo", name: "sub" },
	]);
	await (e as any).followFolderMoveOnDisk({ id: "fo", parent_id: "fE", name: "Old-done" });
	expect(engine.folderOps.index.pathFor("fo")).toBe(NEW);
	// The per-note moves then empty OLD.
	moveOut(`${OLD}/a.md`);
	await e.removeEmptyFolders(`${OLD}/a.md`);
	moveOut(`${OLD}/sub/b.md`);
	await e.removeEmptyFolders(`${OLD}/sub/b.md`);
	expect(trashed).toEqual([`${OLD}/sub`, OLD]);
});

test("a failed engine create leaves no mark: a user create right after still clears the record", async () => {
	// createFolder rejects ("already exists" from a racing sibling, or a real
	// error): nothing was made, so the engineCreated mark must go with it, or a
	// user making the folder within the 5 s window would read as the engine.
	const { e, trashed } = await setup(["E2E", NEW], [OLD], {
		createFolderError: "Folder already exists.",
	});
	e.movedAwayFolders.add(OLD);
	await e.ensureFolder(OLD); // swallowed: the race outcome is "the folder is there"
	await e.handleFolderCreate(new TFolder(OLD, []));
	expect(e.movedAwayFolders.has(OLD)).toBe(false);
	expect(trashed).toEqual([]);
});
