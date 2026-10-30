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
import { KeyedSerial } from "../src/keyed-serial";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
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

async function renamedLocally(
	files: Record<string, string>,
	renames: [string, string][],
	opts: { time?: ManualTimeProvider; createRefused?: boolean } = {},
) {
	const h = makeVault(Object.fromEntries(Object.keys(files).map((p) => [p, "original"])));
	const engine = makeEngine(h.app, opts.time);
	h.attach(engine);
	const map = new NoteIdMap();
	map.seed(files);
	engine.setNoteIdMap(map);
	// The rename's relocating crdt_create goes out and is acked.
	engine.setCrdtPorts({
		create: mock(async (docId: string) => {
			if (opts.createRefused) {
				throw new Error('crdt_create request failed: {"reason":"notes_cap_reached"}');
			}
			return { docId, seeded: false, genesisOutcome: "occupied" };
		}),
	} as never);
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

	test("an equal seq at a different path is a real rename (B was offline while A renamed)", async () => {
		// Review R1: a fan-out stamped the note's current seq as the mark, then the
		// replay serves the rename row at that same seq. Strict `<` lets it move.
		const h = await plainEngine({ "Old.md": ID }, 10);

		await h.engine.applyOp(row(ID, "Moved.md", 10));
		await settle();

		expect([...h.present.keys()]).toEqual(["Moved.md"]);
		expect(h.map.pathForId(ID)).toBe("Moved.md");
	});

	test("an older seq at a different path is history: it does not move", async () => {
		const h = await plainEngine({ "New.md": ID }, 10);

		await h.engine.applyOp(row(ID, "Old.md", 9));
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
	});

	test("a fence whose echo never comes expires, and a later real rename moves", async () => {
		// Review R2.
		const time = new ManualTimeProvider(1_000_000);
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]], { time });
		time.advance(121_000);

		await h.engine.applyOp(row(ID, "Elsewhere.md", 50));
		await settle();

		expect([...h.present.keys()]).toEqual(["Elsewhere.md"]);
	});

	test("a rename push refused by the plan cap clears the fence: the server's path is current again", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]], {
			createRefused: true,
		});

		await h.engine.applyOp(row(ID, "Elsewhere.md", 50));
		await settle();

		expect([...h.present.keys()]).toEqual(["Elsewhere.md"]);
	});

	test("after the WS echo, a replay row from before the rename still does not move it back", async () => {
		// Review D1: the echo carries no seq; a replay page fetched before the
		// server applied the rename lands after it.
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);
		await h.engine.handleStreamEvent({
			event_type: "upsert",
			kind: "note",
			id: ID,
			path: "New.md",
			content_hash: "h",
			timestamp: 3,
			updated_at: "2026-01-01T00:00:05Z",
		} as never);
		await settle();

		await h.engine.applyOp(row(ID, "Old.md", 9));
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
	});

	test("a seq-bearing row at the new path confirms the move: a later rename elsewhere applies", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);
		await h.engine.applyOp(row(ID, "New.md", 10));
		await settle();

		await h.engine.applyOp(row(ID, "Elsewhere.md", 11));
		await settle();

		expect([...h.present.keys()]).toEqual(["Elsewhere.md"]);
	});

	test("the fence does not expire while the rename is still queued (offline over 2 min)", async () => {
		// Review D2.
		const time = new ManualTimeProvider(1_000_000);
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]], { time });
		(h.engine as unknown as { crdtHasPendingOp: () => boolean }).crdtHasPendingOp = () => true;
		time.advance(121_000);

		await h.engine.applyOp(row(ID, "Old.md", 9));
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
	});

	test("a stale broadcast still delivers its content, at the note's current path", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);
		const applied: string[] = [];
		(h.engine as any).moveIfIdRelocated = mock(async (_id: string, p: string) => {
			applied.push(p);
		});

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

		// Processed (not dropped), against the path the note lives at now.
		expect(applied).toEqual(["New.md"]);
	});
});

describe("fence review follow-ups", () => {
	const echo = (id: string, path: string) =>
		({
			event_type: "upsert",
			kind: "note",
			id,
			path,
			content_hash: "h",
			timestamp: 3,
			updated_at: "2026-01-01T00:00:05Z",
		}) as never;

	test("an offline rename whose push drains first still holds the fence for a full TTL", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]], { time });
		const eng = h.engine as unknown as { crdtHasPendingOp: () => boolean };
		let queued = true;
		eng.crdtHasPendingOp = () => queued;
		time.advance(300_000); // offline for 5 min, nobody checks a claim meanwhile
		queued = false; // reconnect: the push drains
		time.advance(10_000);

		await h.engine.applyOp(row(ID, "Old.md", 9)); // stale replay
		await settle();

		expect([...h.present.keys()]).toEqual(["New.md"]);
	});

	test("after the echo, a stream rename back to the old path is real and applies", async () => {
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]]);
		await h.engine.handleStreamEvent(echo(ID, "New.md"));
		await settle();

		await h.engine.handleStreamEvent(echo(ID, "Old.md")); // another device renames it back
		await settle();

		expect([...h.present.keys()]).toEqual(["Old.md"]);
		expect(h.map.pathForId(ID)).toBe("Old.md");
	});

	test("an unclaimed fence is pruned once its TTL passes", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]], { time });
		const moves = (h.engine as unknown as { pendingLocalMoves: Map<string, unknown> })
			.pendingLocalMoves;
		expect(moves.size).toBe(1);

		time.advance(200_000); // no claim ever arrives

		expect(moves.size).toBe(0);
	});

	test("fan-outs for one note apply in arrival order even when the first waits on a heal", async () => {
		const h = await plainEngine({ "A.md": ID }, 1);
		const eng = h.engine as any;
		const order: string[] = [];
		eng.applyPushedNoteUpdateNow = mock(async (_id: string, _u: Uint8Array, head: string) => {
			order.push(head);
			return "applied";
		});
		let release!: () => void;
		eng.idMapReconcileInflight = new Promise<void>((r) => {
			release = r;
		});
		void h.engine.applyPushedNoteUpdate(ID2, new Uint8Array(), "first"); // unmapped: waits
		h.map.set("B.md", ID2); // healed in the meantime, then a second update arrives
		void h.engine.applyPushedNoteUpdate(ID2, new Uint8Array(), "second");
		await settle();
		release();
		await settle();

		expect(order).toEqual(["first", "second"]);
	});

	test("destroy clears the fence sweep timer", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const h = await renamedLocally({ "Old.md": ID }, [["Old.md", "New.md"]], { time });
		expect((h.engine as any).moveSweepTimer).not.toBeNull();
		h.engine.destroy();
		expect((h.engine as any).moveSweepTimer).toBeNull();
	});

	test("a fan-out waiting on a slow manifest heal does not hold its note's lane", async () => {
		const h = await plainEngine({ "A.md": ID }, 1);
		const eng = h.engine as any;
		let release!: () => void;
		eng.idMapReconcileInflight = new Promise<void>((r) => {
			release = r;
		});
		void h.engine.applyPushedNoteUpdate(ID2, new Uint8Array(), "h"); // unmapped id
		let ran = false;
		const probe = eng.serial.run(ID2, async () => {
			ran = true;
		});
		await settle();

		expect(ran).toBe(true);
		release();
		await probe;
	});
});

/** An engine holding `files` as synced notes at `seq`, no local rename. */
async function plainEngine(files: Record<string, string>, seq: number) {
	const h = makeVault(Object.fromEntries(Object.keys(files).map((p) => [p, "original"])));
	const engine = makeEngine(h.app);
	h.attach(engine);
	const map = new NoteIdMap();
	map.seed(files);
	engine.setNoteIdMap(map);
	for (const p of Object.keys(files)) {
		(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(p, {
			hash: 1,
			seq,
		});
	}
	return { ...h, engine, map };
}

describe("KeyedSerial", () => {
	const time = () => new ManualTimeProvider(0);

	test("runs one key in order; a rejection does not wedge it", async () => {
		const q = new KeyedSerial(time(), 1000);
		const order: number[] = [];
		const a = q.run("k", async () => {
			await new Promise((r) => setTimeout(r, 5));
			order.push(1);
		});
		const b = q.run("k", async () => {
			throw new Error("boom");
		});
		const c = q.run("k", async () => {
			order.push(3);
			return 3;
		});
		await a;
		await expect(b).rejects.toThrow("boom");
		expect(await c).toBe(3);
		expect(order).toEqual([1, 3]);
	});

	test("a task that never settles releases its key after the stall bound", async () => {
		const t = time();
		const stalled: string[] = [];
		const q = new KeyedSerial(t, 1000, (k) => stalled.push(k));
		void q.run("k", () => new Promise(() => {}));
		const next = q.run("k", async () => "ran");
		await new Promise((r) => setTimeout(r, 1));
		t.advance(1001);

		expect(await next).toBe("ran");
		expect(stalled).toEqual(["k"]);
	});
});

test("a stream event queued before a vault switch is dropped, not applied to the new vault", async () => {
	const engine = makeEngine(makeVault({}).app);
	const applied: string[] = [];
	(
		engine as unknown as { applyStreamEvent: (e: { path: string }) => Promise<void> }
	).applyStreamEvent = async (e) => {
		applied.push(e.path);
		await new Promise((r) => setTimeout(r, 5));
	};
	const settings = (engine as unknown as { settings: { vaultId: string | null } }).settings;
	settings.vaultId = "vault-1";
	const first = engine.handleStreamEvent({ event_type: "upsert", path: "a.md" } as never);
	const queued = engine.handleStreamEvent({ event_type: "upsert", path: "b.md" } as never);
	await new Promise((r) => setTimeout(r, 1)); // a.md is running, b.md waits
	settings.vaultId = "vault-2";
	await Promise.all([first, queued]);

	expect(applied).toEqual(["a.md"]);
});
