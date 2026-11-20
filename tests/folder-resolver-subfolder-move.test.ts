// e2e test_108 test_rename_chain_reads_final_paths_everywhere (backend run
// 44656702109, plugin 7362b0fd, feed on): `c/sub` was moved under `other`,
// and BOTH devices ended with c's own note at `other/n1.md`. The manifest
// pass resolved the folder `other` (a folder this device never learned) from
// a note sharing a path tail: local `c/sub/n2.md` vs server `other/sub/n2.md`
// put `other` at `c`, and the follow then merged c (with n1) into other. The
// shared tail says `sub` moved, not that `c` is `other`: a note this device
// holds under `c` that the server lists OUTSIDE `other` disproves it.
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

const R = "E2E/Chain108";

async function setup(local: Record<string, string>) {
	const tree = new Map<string, TFolder | TFile>();
	const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
	const attach = (f: TFolder | TFile) => {
		tree.set(f.path, f);
		(tree.get(parentOf(f.path)) as TFolder | undefined)?.children.push(f);
	};
	const ensure = (p: string) => {
		if (!p || tree.has(p)) return;
		ensure(parentOf(p));
		attach(new TFolder(p, []));
	};
	for (const p of Object.keys(local)) {
		ensure(parentOf(p));
		attach(new TFile(p));
	}
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
			rename: async (f: TFolder | TFile, to: string) => {
				if (tree.has(to)) throw new Error("Destination file already exists!");
				const from = f.path;
				renames.push([from, to]);
				const parent = tree.get(parentOf(from)) as TFolder | undefined;
				if (parent) parent.children = parent.children.filter((c) => c !== f);
				for (const [p, node] of [...tree]) {
					if (p === from || p.startsWith(`${from}/`)) {
						tree.delete(p);
						(node as { path: string }).path = to + p.slice(from.length);
						tree.set(node.path, node);
					}
				}
				ensure(parentOf(to));
				(tree.get(parentOf(to)) as TFolder).children.push(f);
			},
			createFolder: async (p: string) => ensure(p),
		},
		fileManager: {
			trashFile: async (f: TFolder | TFile) => {
				tree.delete(f.path);
				const parent = tree.get(parentOf(f.path)) as TFolder | undefined;
				if (parent) parent.children = parent.children.filter((c) => c !== f);
			},
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
	for (const [p, id] of Object.entries(local)) ids.set(p, id);
	ids.flushNow();
	engine.setCrdtPorts({ noteIdMap: ids });
	await engine.setFolderOpsEnabled(true);
	return { engine, tree, renames };
}

test("a moved subfolder's shared path tail does not rename its old parent", async () => {
	const { engine, tree } = await setup({
		[`${R}/c/n1.md`]: "n1",
		[`${R}/c/sub/n2.md`]: "n2",
		[`${R}/other/o.md`]: "no",
	});
	// This device knows root, c and sub; `other` was made over REST.
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fR", parent_id: "fE", name: "Chain108" },
		{ id: "fC", parent_id: "fR", name: "c" },
		{ id: "fS", parent_id: "fC", name: "sub" },
	]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/c/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/other/sub/n2.md`, content_hash: "h2" },
			{ id: "no", path: `${R}/other/o.md`, content_hash: "h3" },
		],
		attachments: [],
		total_notes: 3,
		total_attachments: 0,
		folders: [
			{ id: "fE", parent_id: null, name: "E2E" },
			{ id: "fR", parent_id: "fE", name: "Chain108" },
			{ id: "fC", parent_id: "fR", name: "c" },
			{ id: "fO", parent_id: "fR", name: "other" },
			{ id: "fS", parent_id: "fO", name: "sub" },
		],
	});
	expect(tree.has(`${R}/c/n1.md`)).toBe(true);
	expect(tree.has(`${R}/other/n1.md`)).toBe(false);
	expect(tree.has(`${R}/other/sub/n2.md`)).toBe(true);
});

// The same inference with `other` not on this device at all: the shared tail
// alone must not rename c to other.
test("a nested match (c/sub vs other/sub) never learns c as other", async () => {
	const { engine, tree } = await setup({
		[`${R}/c/n1.md`]: "n1",
		[`${R}/c/sub/n2.md`]: "n2",
	});
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fR", parent_id: "fE", name: "Chain108" },
		{ id: "fC", parent_id: "fR", name: "c" },
		{ id: "fS", parent_id: "fC", name: "sub" },
	]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/c/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/other/sub/n2.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			{ id: "fE", parent_id: null, name: "E2E" },
			{ id: "fR", parent_id: "fE", name: "Chain108" },
			{ id: "fC", parent_id: "fR", name: "c" },
			{ id: "fO", parent_id: "fR", name: "other" },
			{ id: "fS", parent_id: "fO", name: "sub" },
		],
	});
	expect(tree.has(`${R}/c/n1.md`)).toBe(true);
	expect(tree.has(`${R}/other/n1.md`)).toBe(false);
});

// Ambiguous: the notes the server lists directly in `other` sit in two
// different local folders. Nothing is learned and nothing moves.
test("direct children in two local folders learn nothing", async () => {
	const { engine, tree, renames } = await setup({
		[`${R}/c/p1.md`]: "p1",
		[`${R}/d/p2.md`]: "p2",
	});
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fR", parent_id: "fE", name: "Chain108" },
	]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "p1", path: `${R}/other/p1.md`, content_hash: "h1" },
			{ id: "p2", path: `${R}/other/p2.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			{ id: "fE", parent_id: null, name: "E2E" },
			{ id: "fR", parent_id: "fE", name: "Chain108" },
			{ id: "fO", parent_id: "fR", name: "other" },
		],
	});
	expect(renames).toEqual([]);
	expect(tree.has(`${R}/c/p1.md`)).toBe(true);
	expect(tree.has(`${R}/d/p2.md`)).toBe(true);
});
