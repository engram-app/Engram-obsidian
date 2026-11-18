/**
 * #708 review (MEDIUM-2): after B follows a server folder move Proj -> Done,
 * a row from BEFORE the move that B never saw (A's offline edit, the e2e
 * test_107 shape) arrives naming Proj/a.md with a seq ABOVE the note's own
 * mark. The per-note seq fence does not catch it (a folder move leaves each
 * note's mark where it was), so it moved the note BACK into a re-made Proj,
 * and nothing moved it forward again. The folder move's own seq fences it:
 * the row lands where the note lives now, content and all.
 */
import { expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { fnv1a } from "../src/content-hash";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import type { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS, type SyncOp } from "../src/types";

const ID = "01a011f9-3b85-79b3-af2f-de167b256949";

const api = {
	getManifest: mock().mockResolvedValue(null),
	pushNote: mock().mockResolvedValue({ note: { id: ID }, chunks_indexed: 1 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
} as unknown as EngramApi;

/** A vault that actually behaves like one: renames move bytes, creates add
 *  files, trash removes them, and a rename onto an occupied path rejects.
 *  A double that silently no-ops makes every assertion below vacuous. */
function makeVault(initial: Record<string, string>) {
	const present = new Map<string, TFile>();
	const bodies = new Map<string, string>();
	for (const [p, b] of Object.entries(initial)) {
		present.set(p, new TFile(p));
		bodies.set(p, b);
	}
	const folders = new Set<string>();
	const look = (p: string) => present.get(p) ?? null;
	const vault = {
		configDir: ".obsidian",
		read: mock(async (f: TFile) => bodies.get(f.path) ?? ""),
		cachedRead: mock(async (f: TFile) => bodies.get(f.path) ?? ""),
		getMarkdownFiles: mock(() => [...present.values()]),
		getFiles: mock(() => [...present.values()]),
		getFileByPath: mock(look),
		getAbstractFileByPath: mock(look),
		create: mock(async (p: string, b: string) => {
			if (present.has(p)) throw new Error(`File already exists: ${p}`);
			present.set(p, new TFile(p));
			bodies.set(p, b);
		}),
		createFolder: mock(async (p: string) => void folders.add(p)),
		modify: mock(async (f: TFile, b: string) => void bodies.set(f.path, b)),
		process: mock(async (f: TFile, fn: (d: string) => string) => {
			const next = fn(bodies.get(f.path) ?? "");
			bodies.set(f.path, next);
			return next;
		}),
		rename: mock(async (f: TFile, to: string) => {
			if (present.has(to)) throw new Error(`File already exists: ${to}`);
			present.delete(f.path);
			const b = bodies.get(f.path) ?? "";
			bodies.delete(f.path);
			f.path = to;
			present.set(to, f);
			bodies.set(to, b);
		}),
		trash: mock().mockResolvedValue(undefined),
		getName: mock(() => "V"),
	};
	const app = {
		vault,
		fileManager: {
			trashFile: mock(async (f: TFile) => {
				present.delete(f.path);
				bodies.delete(f.path);
				await engine.handleDelete(f);
			}),
		},
		workspace: {
			getActiveViewOfType: mock(() => null),
			getLeavesOfType: mock(() => []),
		},
	} as any;
	let engine: SyncEngine;
	const attach = (e: SyncEngine) => {
		engine = e;
	};
	return { app, vault, present, bodies, folders, attach };
}

function makeEngine(app: any, time?: ManualTimeProvider) {
	const e = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		time,
	);
	e.setReady();
	e.setCrdtManager({
		isSynced: mock(() => true),
		projectedText: mock().mockResolvedValue(""),
		removeDoc: mock().mockResolvedValue(undefined),
		hasUndeliveredOps: mock(() => false),
		hasCurrentDeliveryReceipt: mock(() => false),
	} as any);
	e.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);
	return e;
}

const row = (path: string, seq: number, content: string): SyncOp =>
	({
		kind: "upsert",
		id: ID,
		path,
		seq,
		title: "a",
		content,
		content_hash: "h",
		folder: "",
		tags: [],
		updated_at: "2026-01-01T00:00:01Z",
	}) as SyncOp;

const settle = () => new Promise((r) => setTimeout(r, 60));

/** B has followed the server's move Proj -> Done (folder move seq 6); the
 *  note's own row mark is 3. */
async function followedMove() {
	const h = makeVault({ "Done/a.md": "original" });
	const engine = makeEngine(h.app);
	h.attach(engine);
	const map = new NoteIdMap();
	map.seed({ "Done/a.md": ID });
	engine.setNoteIdMap(map);
	(engine as any).syncState.set("Done/a.md", { hash: fnv1a("original"), seq: 3 });
	engine.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
	await (engine as any).applyFolderChange({ id: "f1", parent_id: null, name: "Done", seq: 6 });
	h.vault.rename.mockClear();
	h.vault.create.mockClear();
	h.vault.createFolder.mockClear();
	return { ...h, engine, map };
}

test("a pre-move row naming the old folder lands at the new path, and its edit converges there", async () => {
	const h = await followedMove();
	try {
		// A's edit converges into the note by id (the row is a CRDT note on disk).
		const converge = mock();
		(h.engine as any).stageConvergence = converge;
		await h.engine.applyOp(row("Proj/a.md", 5, "A's offline edit"));
		await settle();
		expect([...h.present.keys()]).toEqual(["Done/a.md"]);
		expect(h.map.pathForId(ID)).toBe("Done/a.md");
		expect(converge).toHaveBeenCalled();
		expect(converge.mock.calls[0].slice(0, 2)).toEqual([ID, "Done/a.md"]);
		expect(h.vault.rename).not.toHaveBeenCalled();
		expect(h.vault.createFolder).not.toHaveBeenCalled(); // no re-made Proj
		expect(h.folders.has("Proj")).toBe(false);
	} finally {
		h.engine.destroy();
	}
});

test("control: a row AFTER the folder move naming the old folder is a real move back", async () => {
	const h = await followedMove();
	try {
		await h.engine.applyOp(row("Proj/a.md", 7, "original"));
		await settle();
		expect(h.map.pathForId(ID)).toBe("Proj/a.md");
		expect(h.present.has("Proj/a.md")).toBe(true);
	} finally {
		h.engine.destroy();
	}
});

test("several recorded moves: each ancestor's own move seq fences, at any depth", () => {
	const h = makeVault({});
	const engine = makeEngine(h.app);
	try {
		const fence = engine as any;
		fence.recordFolderMove("A/B", 4); // A/B moved away at seq 4
		fence.recordFolderMove("A", 10); // later, A itself moved away at seq 10
		fence.recordFolderMove("Z", 20); // unrelated
		// Under A/B, written after A/B moved but before A did: the deeper
		// record alone would let it through; A's move still makes it stale.
		expect(fence.predatesFolderMove("A/B/x.md", 6)).toBe(true);
		expect(fence.predatesFolderMove("A/B/x.md", 3)).toBe(true);
		expect(fence.predatesFolderMove("A/B/x.md", 11)).toBe(false); // after both
		expect(fence.predatesFolderMove("A/C/deep/y.md", 9)).toBe(true); // via A
		expect(fence.predatesFolderMove("A/x.md", 10)).toBe(false); // equal: the move itself
		expect(fence.predatesFolderMove("AB/x.md", 1)).toBe(false); // prefix, not ancestor
		expect(fence.predatesFolderMove("x.md", 1)).toBe(false); // root: no ancestor
	} finally {
		engine.destroy();
	}
});
