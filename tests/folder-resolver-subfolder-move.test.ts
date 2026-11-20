// e2e test_108 test_rename_chain_reads_final_paths_everywhere (backend run
// 44656702109, plugin 7362b0fd, feed on): `c/sub` was moved under `other`,
// and BOTH devices ended with c's own note at `other/n1.md`. The manifest
// pass resolved the folder `other` (a folder this device never learned) from
// a note sharing a path tail: local `c/sub/n2.md` vs server `other/sub/n2.md`
// put `other` at `c`, and the follow then merged c (with n1) into other. Only
// the notes the server lists DIRECTLY in a folder may place it, and only when
// every one held here agrees on the same local folder.
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

// `other` is not on this device and holds no direct note this device has:
// the nested match alone learns nothing.
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

// Notes moved one by one out of c (since deleted on the server) into a new
// folder `other`: every direct child of other sits in c, but c also holds n3,
// which the server lists elsewhere, so c is not other.
test("notes moved one by one into a new folder never rename their old folder", async () => {
	const { engine, tree, renames } = await setup({
		[`${R}/c/n1.md`]: "n1",
		[`${R}/c/n2.md`]: "n2",
		[`${R}/c/n3.md`]: "n3",
	});
	engine.learnFolders([
		{ id: "fE", parent_id: null, name: "E2E" },
		{ id: "fR", parent_id: "fE", name: "Chain108" },
		{ id: "fC", parent_id: "fR", name: "c" },
	]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/other/n2.md`, content_hash: "h2" },
			{ id: "n3", path: `${R}/z/n3.md`, content_hash: "h3" },
		],
		attachments: [],
		total_notes: 3,
		total_attachments: 0,
		folders: [
			{ id: "fE", parent_id: null, name: "E2E" },
			{ id: "fR", parent_id: "fE", name: "Chain108" },
			{ id: "fO", parent_id: "fR", name: "other" },
			{ id: "fZ", parent_id: "fR", name: "z" },
		],
	});
	expect(renames).toEqual([]);
	expect(tree.has(`${R}/c/n3.md`)).toBe(true);
});

const FOLDERS_BASE = [
	{ id: "fE", parent_id: null, name: "E2E" },
	{ id: "fR", parent_id: "fE", name: "Chain108" },
];
// c holds ONE direct synced note plus a subfolder; the note alone was moved
// into a new folder `other` (web app). c still exists server-side (fC).
test("review: one note moved out of c must not move c", async () => {
	const { engine, tree, renames } = await setup({
		[`${R}/c/n1.md`]: "n1",
		[`${R}/c/sub/n2.md`]: "n2",
	});
	engine.learnFolders([
		...FOLDERS_BASE,
		{ id: "fC", parent_id: "fR", name: "c" },
		{ id: "fS", parent_id: "fC", name: "sub" },
	]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/c/sub/n2.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			...FOLDERS_BASE,
			{ id: "fC", parent_id: "fR", name: "c" },
			{ id: "fS", parent_id: "fC", name: "sub" },
			{ id: "fO", parent_id: "fR", name: "other" },
		],
	});
	expect(tree.has(`${R}/c/sub/n2.md`)).toBe(true);
	expect(renames).toEqual([]);
});
// c holds one synced note plus a local-only draft not in the manifest.
test("review: one synced note moved out of c must not carry the draft", async () => {
	const { engine, tree, renames } = await setup({
		[`${R}/c/n1.md`]: "n1",
		[`${R}/c/draft.md`]: "dr",
	});
	engine.learnFolders([...FOLDERS_BASE, { id: "fC", parent_id: "fR", name: "c" }]);
	await (engine as any).syncManifestFolders({
		notes: [{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" }],
		attachments: [],
		total_notes: 1,
		total_attachments: 0,
		folders: [
			...FOLDERS_BASE,
			{ id: "fC", parent_id: "fR", name: "c" },
			{ id: "fO", parent_id: "fR", name: "other" },
		],
	});
	expect(tree.has(`${R}/c/draft.md`)).toBe(true);
	expect(renames).toEqual([]);
});
// Two notes moved one by one, c keeps nothing else synced: indistinguishable
// per the PR's stated residual, but c is a KNOWN folder still present server-side.
test("review: c still exists server-side under its own id", async () => {
	const { engine, renames } = await setup({
		[`${R}/c/n1.md`]: "n1",
		[`${R}/c/n2.md`]: "n2",
	});
	engine.learnFolders([...FOLDERS_BASE, { id: "fC", parent_id: "fR", name: "c" }]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/other/n2.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			...FOLDERS_BASE,
			{ id: "fC", parent_id: "fR", name: "c" },
			{ id: "fO", parent_id: "fR", name: "other" },
		],
	});
	expect(renames).toEqual([]);
});
// Root: the only root-level note moved into a new folder.
test("review: the vault root is never a moved folder", async () => {
	const { engine, tree, renames } = await setup({
		["top.md"]: "t1",
		[`${R}/c/n1.md`]: "n1",
	});
	engine.learnFolders([...FOLDERS_BASE, { id: "fC", parent_id: "fR", name: "c" }]);
	const spy = (engine as any).localPathForFolder.bind(engine);
	let answer: unknown = "unset";
	(engine as any).localPathForFolder = (...a: unknown[]) => (answer = spy(...a));
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "t1", path: `Inbox/top.md`, content_hash: "h1" },
			{ id: "n1", path: `${R}/c/n1.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			...FOLDERS_BASE,
			{ id: "fC", parent_id: "fR", name: "c" },
			{ id: "fI", parent_id: null, name: "Inbox" },
		],
	});
	expect(answer).toBeNull();
});

// A note renamed as well as moved: the name must match, or nothing is learned.
test("a direct child under another file name places nothing", async () => {
	const { engine, renames } = await setup({ [`${R}/c/old-name.md`]: "n1" });
	engine.learnFolders(FOLDERS_BASE);
	await (engine as any).syncManifestFolders({
		notes: [{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" }],
		attachments: [],
		total_notes: 1,
		total_attachments: 0,
		folders: [...FOLDERS_BASE, { id: "fO", parent_id: "fR", name: "other" }],
	});
	expect(renames).toEqual([]);
});

// A folder moved whole (c gone from the server, every note agrees) is still
// followed: the rule is exact, not off.
test("a whole folder move is still followed", async () => {
	const { engine, tree } = await setup({ [`${R}/c/n1.md`]: "n1", [`${R}/c/n2.md`]: "n2" });
	engine.learnFolders(FOLDERS_BASE);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/other/n2.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [...FOLDERS_BASE, { id: "fO", parent_id: "fR", name: "other" }],
	});
	expect(tree.has(`${R}/other/n1.md`)).toBe(true);
	expect(tree.has(`${R}/c`)).toBe(false);
});

// The explicit root rule on its own, with no server folders to refuse it.
test("the vault root is refused even with no server folder at it", async () => {
	const { engine } = await setup({ ["top.md"]: "t1" });
	const answer = (engine as any).localPathForFolder(
		"Inbox",
		[{ id: "t1", name: "top.md", path: "Inbox/top.md" }],
		new Map([["", new Set(["Inbox"])]]),
		new Set<string>(),
	);
	expect(answer).toBeNull();
});

// Review @ 549d3bf5: the server still has `notes`; local `Notes` must not be
// read as moved to `other` (a case-insensitive disk holds one folder).
test("review: a server folder differing only in case still refuses", async () => {
	const { engine, renames } = await setup({
		[`${R}/Notes/n1.md`]: "n1",
		[`${R}/Notes/sub/n2.md`]: "n2",
	});
	engine.learnFolders(FOLDERS_BASE);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "n1", path: `${R}/other/n1.md`, content_hash: "h1" },
			{ id: "n2", path: `${R}/notes/sub/n2.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			...FOLDERS_BASE,
			{ id: "fN", parent_id: "fR", name: "notes" },
			{ id: "fS", parent_id: "fN", name: "sub" },
			{ id: "fO", parent_id: "fR", name: "other" },
		],
	});
	expect(renames).toEqual([]);
});

// Control: the fold only refuses. A server with BOTH `Notes` and `notes`
// still places `notes` at a gone folder whose notes all agree, and leaves
// the local `Notes` where it is.
test("case folding never accepts more: distinct Notes and notes", async () => {
	const { engine, tree, renames } = await setup({
		[`${R}/Notes/a.md`]: "na",
		[`${R}/Old/b.md`]: "nb",
	});
	engine.learnFolders([...FOLDERS_BASE, { id: "fU", parent_id: "fR", name: "Notes" }]);
	await (engine as any).syncManifestFolders({
		notes: [
			{ id: "na", path: `${R}/Notes/a.md`, content_hash: "h1" },
			{ id: "nb", path: `${R}/notes/b.md`, content_hash: "h2" },
		],
		attachments: [],
		total_notes: 2,
		total_attachments: 0,
		folders: [
			...FOLDERS_BASE,
			{ id: "fU", parent_id: "fR", name: "Notes" },
			{ id: "fL", parent_id: "fR", name: "notes" },
		],
	});
	expect(renames).toEqual([[`${R}/Old`, `${R}/notes`]]);
	expect(tree.has(`${R}/Notes/a.md`)).toBe(true);
	expect(tree.has(`${R}/notes/b.md`)).toBe(true);
});
