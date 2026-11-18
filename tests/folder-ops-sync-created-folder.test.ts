// e2e test_107 offline-edit-then-folder-rename: the peer kept an EMPTY old
// folder forever. After the server moved OLD -> NEW, the peer recorded OLD as
// moved away, then materialized a note at its stale path under OLD. That
// create made a folder under OLD through the engine's own ensureFolder, and
// Obsidian's folder `create` event (handleFolderCreate) read it as the user
// re-making the folder: the moved-away record was cleared and the emptied,
// explicit OLD was never removed. Only a user-made folder may clear it.
import { afterEach, expect, mock, test } from "bun:test";
import { TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { ExplicitFolders } from "../src/explicit-folders";
import { SyncEngine } from "../src/sync";
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
};

const engines: SyncEngine[] = [];
afterEach(() => {
	for (const e of engines) e.destroy();
	engines.length = 0;
});

/** A folder tree that fires `create` for folders like main.ts wires it. */
async function setup(onDisk: string[], explicitPaths: string[]) {
	const tree = new Map<string, TFolder>();
	const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	let engine!: SyncEngine;
	const add = (p: string) => {
		const f = new TFolder(p, []);
		tree.set(p, f);
		tree.get(parentOf(p))?.children.push(f);
		return f;
	};
	for (const p of onDisk) add(p);
	const trashed: string[] = [];
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: (p: string) => tree.get(p) ?? null,
			getFileByPath: () => null,
			getName: () => "Vault",
			createFolder: async (p: string) => {
				const f = add(p);
				await engine.handleFolderCreate(f); // main.ts: vault.on("create")
			},
		},
		fileManager: {
			trashFile: async (f: TFolder) => {
				trashed.push(f.path);
				tree.delete(f.path);
				const parent = tree.get(parentOf(f.path));
				if (parent) parent.children = parent.children.filter((c) => c !== f);
			},
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = { createFolder: mock().mockResolvedValue({ folders: [] }) };
	engine = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engines.push(engine);
	const explicit = new ExplicitFolders(new MemoryAdapter(), "f.json");
	await explicit.load();
	for (const p of explicitPaths) await explicit.add(p);
	engine.explicitFolders = explicit;
	return { e: engine as unknown as Engine, trashed, explicit };
}

test("a sync-driven create UNDER a moved-away folder keeps the record: both are removed", async () => {
	const { e, trashed } = await setup(["E2E", "E2E/Old-done", "E2E/Old"], ["E2E/Old"]);
	e.movedAwayFolders.add("E2E/Old");
	// The stale-path note materializes at E2E/Old/sub/b.md, then moves on.
	await e.ensureFolder("E2E/Old/sub");
	await e.removeEmptyFolders("E2E/Old/sub/b.md");
	expect(trashed).toEqual(["E2E/Old/sub", "E2E/Old"]);
});

test("a sync-driven create AT the moved-away folder keeps the record", async () => {
	const { e, trashed } = await setup(["E2E", "E2E/Old-done"], ["E2E/Old"]);
	e.movedAwayFolders.add("E2E/Old");
	await e.ensureFolder("E2E/Old");
	await e.removeEmptyFolders("E2E/Old/a.md");
	expect(trashed).toEqual(["E2E/Old"]);
});

test("a USER-made folder at the old path clears the record and is kept", async () => {
	const { e, trashed, explicit } = await setup(["E2E", "E2E/Old-done", "E2E/Old"], ["E2E/Old"]);
	e.movedAwayFolders.add("E2E/Old");
	await (e as unknown as SyncEngine).handleFolderCreate(new TFolder("E2E/Old", []));
	await e.removeEmptyFolders("E2E/Old/a.md");
	expect(trashed).toEqual([]);
	expect(explicit.has("E2E/Old")).toBe(true);
});

test("a USER-made subfolder under the old path clears the record too", async () => {
	const { e, trashed } = await setup(["E2E", "E2E/Old", "E2E/Old/mine"], ["E2E/Old"]);
	e.movedAwayFolders.add("E2E/Old");
	await (e as unknown as SyncEngine).handleFolderCreate(new TFolder("E2E/Old/mine", []));
	await e.removeEmptyFolders("E2E/Old/mine/a.md");
	expect(trashed).toEqual([]);
});
