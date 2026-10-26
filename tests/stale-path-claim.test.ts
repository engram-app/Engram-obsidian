/**
 * A LOCAL rename must fence older path claims (prod pairing run 40251575611,
 * both devices on 1.38.1). A renamed notes, then replayed server rows that
 * still carried the OLD paths (checkpointed before the rename reached the
 * server), and moved 12 files BACK with no server instruction. In a folder
 * rename some moved back and others were re-minted under new ids: duplicates.
 *
 * Same "real vault" harness as remote-rename-regression.test.ts: the assertion
 * is about where the files are and which verbs ran.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
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

function makeEngine(app: any) {
	const e = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	e.setCrdtManager({
		isSynced: mock(() => true),
		projectedText: mock().mockResolvedValue(""),
		removeDoc: mock().mockResolvedValue(undefined),
	} as any);
	e.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);
	return e;
}

const ID2 = "01a011f9-3b85-79b3-af2f-de167b256950";

const row = (id: string, path: string, seq: number): SyncOp =>
	({
		kind: "upsert",
		id,
		path,
		seq,
		title: path,
		content: "original",
		content_hash: "h",
		folder: "",
		tags: [],
		updated_at: "2026-01-01T00:00:01Z",
	}) as SyncOp;

const settle = () => new Promise((r) => setTimeout(r, 60));

async function renamedLocally(files: Record<string, string>, renames: [string, string][]) {
	const h = makeVault(Object.fromEntries(Object.keys(files).map((p) => [p, "original"])));
	const engine = makeEngine(h.app);
	h.attach(engine);
	const map = new NoteIdMap();
	map.seed(files);
	engine.setNoteIdMap(map);
	for (const p of Object.keys(files)) {
		(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(p, {
			hash: 1,
			seq: 4,
		});
	}
	for (const [from, to] of renames) {
		const f = h.present.get(from) as TFile;
		await h.vault.rename(f, to);
		await engine.handleRename(f, from);
	}
	await settle();
	h.vault.rename.mockClear();
	h.vault.create.mockClear();
	return { ...h, engine, map };
}

beforeEach(() => {
	(api.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
});

describe("a local rename fences older path claims", () => {
	test("a replayed row with the old path does not move the note back", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);

		// Checkpointed before the rename reached the server; a newer seq (another
		// device edited the note meanwhile) does not make the old path current.
		await h.engine.applyOp(row(ID, "Old.md", 9));
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
		expect(h.vault.rename).not.toHaveBeenCalled();
		expect(h.vault.create).not.toHaveBeenCalled();
		expect(h.map.pathForId(ID)).toBe("New.md");
	});

	test("a broadcast with the old path does not move it back either", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);

		await h.engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: ID,
			path: "Old.md",
			content: "original",
			timestamp: 2,
			updated_at: "2026-01-01T00:00:02Z",
		} as never);
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
		expect(h.map.pathForId(ID)).toBe("New.md");
	});

	test("folder rename + stale rows: nothing moves back, nothing is re-minted", async () => {
		const h = await renamedLocally({ "f/x.md": ID, "f/y.md": ID2 }, [
			["f/x.md", "g/x.md"],
			["f/y.md", "g/y.md"],
		]);

		await h.engine.applyOp(row(ID, "f/x.md", 5));
		await h.engine.applyOp(row(ID2, "f/y.md", 6));
		await settle();

		expect([...h.present.keys()].sort()).toEqual(["g/x.md", "g/y.md"]);
		expect(h.map.pathForId(ID)).toBe("g/x.md");
		expect(h.map.pathForId(ID2)).toBe("g/y.md");
		expect(h.vault.create).not.toHaveBeenCalled();
	});

	test("once the server shows the new path, a real later rename still moves", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);
		await h.engine.applyOp(row(ID, "New.md", 10)); // the server confirms our move

		await h.engine.applyOp(row(ID, "Other.md", 11)); // another device renames it
		await settle();

		expect([...h.present.keys()]).toEqual(["Other.md"]);
		expect(h.map.pathForId(ID)).toBe("Other.md");
	});
});
