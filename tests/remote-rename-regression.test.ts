/**
 * REGRESSION SUITE: a remote rename must MOVE the note's file.
 *
 * Three separate bugs made a web-app rename fail in Obsidian, and all three
 * survived rounds of testing because the existing coverage asserted the wrong
 * thing: that the note's bytes end up at the new path. That passes perfectly
 * when the old file is destroyed and a new one is built in its place, which is
 * exactly what was happening. Obsidian treats that as a different note -- open
 * tabs close, backlinks re-resolve, the creation date resets.
 *
 * So the assertions here are deliberately about the VERB, not the payload:
 * `vault.rename` was called, `vault.create` and `trashFile` were not. A test
 * that only checks content cannot fail on the bug it is meant to catch.
 *
 * See docs/context/remote-rename-identity-vs-file.md.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { BaseStore } from "../src/base-store";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

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

const upsert = (path: string, body = "body") =>
	({
		event_type: "upsert",
		kind: "note",
		id: ID,
		path,
		content: body,
		timestamp: 2,
		updated_at: "2026-01-01T00:00:02Z",
	}) as any;

const del = (path: string) =>
	({
		event_type: "delete",
		kind: "note",
		id: ID,
		path,
		timestamp: 3,
		updated_at: "2026-01-01T00:00:03Z",
	}) as any;

const settle = () => new Promise((r) => setTimeout(r, 60));

/** Drive a remote rename the way the server sends one, with identity already
 *  relocated -- the state the field traces showed at every single occurrence. */
async function remoteRename(
	from: string,
	to: string,
	opts: { order?: "server" | "delete-first"; body?: string } = {},
) {
	const h = makeVault({ [from]: "original" });
	const engine = makeEngine(h.app);
	h.attach(engine);
	const map = new NoteIdMap();
	map.seed({ [from]: ID });
	// Identity moves ahead of the file. Done before the engine is watching,
	// because in the field it happens via the doc-ready announce / catch-up /
	// discovery, none of which leave a record the engine can consult later.
	map.set(to, ID);
	engine.setNoteIdMap(map);
	// A note this engine has synced carries bookkeeping for its path. Modelling
	// that is not a concession to the code: without it the harness describes a
	// file the engine has never seen, which is a different scenario.
	(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(from, { hash: 1 });

	const frames =
		opts.order === "delete-first"
			? [del(from), upsert(to, opts.body ?? "original")]
			: [upsert(to, opts.body ?? "original"), del(from)];
	await Promise.all(frames.map((f) => engine.handleStreamEvent(f)));
	await settle();
	return { ...h, engine, map };
}

beforeEach(() => {
	(api.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
});

describe("a remote rename moves the file", () => {
	for (const order of ["server", "delete-first"] as const) {
		test(`${order} frame order: renamed, never recreated`, async () => {
			const h = await remoteRename("Old.md", "New.md", { order });

			expect([...h.present.keys()]).toEqual(["New.md"]);
			// The verb, not the payload. These three are the actual regression.
			expect(h.vault.rename).toHaveBeenCalled();
			expect(h.vault.create).not.toHaveBeenCalled();
			expect(h.app.fileManager.trashFile).not.toHaveBeenCalled();
		});
	}

	test("the note keeps its id and its content", async () => {
		const h = await remoteRename("Old.md", "New.md");

		expect(h.map.pathForId(ID)).toBe("New.md");
		expect(h.map.get("New.md")).toBe(ID);
		expect(h.map.get("Old.md")).toBeNull();
		expect(h.bodies.get("New.md")).toBe("original");
	});

	test("a rename into a NEW folder creates the folder and still moves", async () => {
		const h = await remoteRename("Old.md", "Archive/2026/New.md");

		expect([...h.present.keys()]).toEqual(["Archive/2026/New.md"]);
		expect(h.vault.rename).toHaveBeenCalled();
		expect(h.vault.create).not.toHaveBeenCalled();
	});

	test("consecutive renames each move — the pattern that reproduced in the field", async () => {
		// The live repro was v16 -> v17 -> v18 in quick succession. A fix that
		// only survives the first rename is not a fix: the second one runs with
		// bookkeeping the first one left behind.
		const h = makeVault({ "v1.md": "original" });
		const engine = makeEngine(h.app);
		h.attach(engine);
		const map = new NoteIdMap();
		map.seed({ "v1.md": ID });
		engine.setNoteIdMap(map);

		for (const [from, to] of [
			["v1.md", "v2.md"],
			["v2.md", "v3.md"],
			["v3.md", "v4.md"],
		]) {
			(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(from, {
				hash: 1,
			});
			map.set(to, ID);
			await Promise.all([
				engine.handleStreamEvent(upsert(to)),
				engine.handleStreamEvent(del(from)),
			]);
			await settle();
		}

		expect([...h.present.keys()]).toEqual(["v4.md"]);
		expect(h.vault.create).not.toHaveBeenCalled();
		expect(h.app.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("redelivering the same rename is a no-op, not a second move", async () => {
		const h = await remoteRename("Old.md", "New.md");
		const before = (h.vault.rename as ReturnType<typeof mock>).mock.calls.length;

		await h.engine.handleStreamEvent(upsert("New.md"));
		await h.engine.handleStreamEvent(del("Old.md"));
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
		expect((h.vault.rename as ReturnType<typeof mock>).mock.calls.length).toBe(before);
	});

	test("the engine's own move is not pushed back as a fresh rename", async () => {
		// Obsidian fires the same vault event for our move as for a user drag.
		// Without suppression the two devices trade renames forever.
		const h = await remoteRename("Old.md", "New.md");
		// Spied at `pushFile`, which is what the guard actually prevents. Watching
		// the CRDT queue instead passed with the guard deleted -- a rename does not
		// route through it, so the assertion never touched the behaviour it named.
		const pushed: string[] = [];
		(h.engine as unknown as { pushFile: (f: TFile) => Promise<void> }).pushFile = async (
			f: TFile,
		) => void pushed.push(f.path);
		// Sync evidence for the old path, or the evidence rule refuses the push on
		// its own and the test passes without the suppression ever being consulted.
		(h.engine as unknown as { syncState: Map<string, unknown> }).syncState.set("Old.md", {
			hash: 1,
		});
		// Re-arm: the engine's move consumed the marker it set.
		(
			h.engine as unknown as { files: { mark(p: string, m: string, ms: number): void } }
		).files.mark("Old.md", "remotelyRenamed", 5_000);

		await h.engine.handleRename(h.present.get("New.md") as TFile, "Old.md");
		await settle();

		expect(pushed).toEqual([]);
	});
});

describe("what must still happen normally", () => {
	test("a genuinely new note is created, not moved", async () => {
		const h = makeVault({});
		const engine = makeEngine(h.app);
		h.attach(engine);
		engine.setNoteIdMap(new NoteIdMap());

		await engine.handleStreamEvent(upsert("Brand New.md", "hello"));
		await settle();

		expect(h.vault.rename).not.toHaveBeenCalled();
	});

	test("a genuine remote delete still removes the file", async () => {
		const h = makeVault({ "Doomed.md": "bye" });
		const engine = makeEngine(h.app);
		h.attach(engine);
		const map = new NoteIdMap();
		map.set("Doomed.md", ID);
		engine.setNoteIdMap(map);

		await engine.handleStreamEvent(del("Doomed.md"));
		await settle();

		expect(h.present.has("Doomed.md")).toBe(false);
	});

	test("a remembered path REUSED by another note is never stolen", async () => {
		// The cached mapping is a load-time snapshot. Our note used to live at
		// Recycled.md; since then a DIFFERENT note took that path. Moving it
		// because we remember living there would hand one note's file to another
		// -- silent data loss, and strictly worse than the recreate this whole
		// mechanism exists to avoid.
		const h = makeVault({ "Recycled.md": "someone else's note" });
		const engine = makeEngine(h.app);
		h.attach(engine);
		const map = new NoteIdMap();
		map.seed({ "Recycled.md": ID }); // our note's remembered home...
		map.set("Recycled.md", "a-different-id"); // ...now claimed by another note
		map.set("New.md", ID);
		engine.setNoteIdMap(map);

		await engine.handleStreamEvent(upsert("New.md", "mine"));
		await settle();

		expect(h.present.has("Recycled.md")).toBe(true);
		expect(h.bodies.get("Recycled.md")).toBe("someone else's note");
	});
});

describe("review hardening", () => {
	test("destroy() sweeps the relocation timers", async () => {
		// Every other TTL map here is swept on teardown; one that is not leaves
		// timers firing against a torn-down engine after a plugin reload.
		const cleared: number[] = [];
		const h = makeVault({ "Old.md": "body" });
		const clock = {
			setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
			clearTimeout: (id: number) => {
				cleared.push(id);
				clearTimeout(id);
			},
			now: () => Date.now(),
		};
		const engine = new SyncEngine(
			h.app,
			api,
			{ ...DEFAULT_SETTINGS, debounceMs: 1 },
			mock().mockResolvedValue(undefined),
			clock as never,
		);
		engine.setReady();
		h.attach(engine);
		const map = new NoteIdMap();
		map.set("Old.md", ID);
		engine.setNoteIdMap(map);
		map.set("New.md", ID); // arms a relocation timer

		const before = cleared.length;
		engine.destroy();

		expect(cleared.length).toBeGreaterThan(before);
		expect(
			(engine as unknown as { relocatedFrom: Map<string, unknown> }).relocatedFrom.size,
		).toBe(0);
	});

	test("the trash path carries the merge base to the note's new home", async () => {
		// Runs when something else won the race to materialize the new path. The
		// base was being destroyed with the old path, leaving the live note with no
		// common ancestor — so the next divergence writes a conflict copy.
		const h = makeVault({ "Old.md": "original", "New.md": "already here" });
		const engine = makeEngine(h.app);
		h.attach(engine);
		const bases = new BaseStore(
			{ read: async () => "", write: async () => {}, exists: async () => false } as never,
			"bases.json",
		);
		bases.set("Old.md", "original", 1);
		(engine as unknown as { baseStore: BaseStore | null }).baseStore = bases;
		const map = new NoteIdMap();
		map.seed({ "Old.md": ID });
		map.set("New.md", ID);
		engine.setNoteIdMap(map);

		await engine.handleStreamEvent(del("Old.md"));
		await settle();

		expect(bases.get("New.md")).toBeDefined();
		expect(bases.get("Old.md")).toBeUndefined();
	});

	test("a never-synced local file at the remembered path is not moved", async () => {
		// A locally created note carries no claim, so the claim check waves it
		// through — and a path we just vacated is exactly where a user makes one.
		// Sync evidence is what separates "our old file" from "their new file".
		const h = makeVault({ "Old.md": "the user's brand new note" });
		const engine = makeEngine(h.app);
		h.attach(engine);
		const map = new NoteIdMap();
		map.seed({ "Old.md": ID });
		map.set("New.md", ID);
		engine.setNoteIdMap(map);
		// Deliberately NO syncState entry for Old.md.

		await engine.handleStreamEvent(upsert("New.md", "mine"));
		await settle();

		expect(h.present.has("Old.md")).toBe(true);
		expect(h.bodies.get("Old.md")).toBe("the user's brand new note");
	});

	test("a hung event does not block the ones behind it", async () => {
		const h = makeVault({});
		const engine = makeEngine(h.app);
		h.attach(engine);
		engine.setNoteIdMap(new NoteIdMap());
		const e = engine as unknown as {
			applyStreamEvent(ev: unknown): Promise<void>;
			time: { setTimeout(fn: () => void, ms: number): number };
		};
		const seen: string[] = [];
		const original = e.applyStreamEvent.bind(e);
		e.applyStreamEvent = async (ev: any) => {
			seen.push(ev.path);
			if (ev.path === "Hangs.md") return new Promise<void>(() => {}); // never settles
			return original(ev);
		};
		// The stall release is scheduled on the injected clock; fire it immediately.
		e.time.setTimeout = (fn: () => void) => setTimeout(fn, 0) as unknown as number;

		void engine.handleStreamEvent(upsert("Hangs.md"));
		await engine.handleStreamEvent(upsert("After.md"));

		expect(seen).toContain("After.md");
	});
});
