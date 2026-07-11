/**
 * BUG 2: a fanned-out remote update must NOT clobber an un-pushed local disk
 * edit. A NOT-live-bound note edited on disk (external tool / reading view /
 * another device) lives only on disk until its debounce fires pushFile. If a
 * fanned-out remote update (applyPushedNoteUpdate) or a cold-receive poll
 * (coldReceive) lands in that window, applyRemoteUpdate flushes the REMOTE
 * projection to disk with no merge — the local edit was never in the Y.Doc, so
 * it is destroyed. The fix captures the disk drift into the Y.Doc (applyLocalEdit)
 * BEFORE applying the remote update, so CRDT MERGES both.
 *
 * Uses the REAL CrdtManager so the merge is genuine, not mocked.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
}
function markProbed(engine: SyncEngine): void {
	(engine as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
}

/** Build a shared-base local doc + a remote delta that adds " REMOTE" on that
 *  same base, plus the disk drift "BASE local" and its recorded baseline. */
async function scenario(dbPrefix: string) {
	let lastFlushed: string | null = null;
	const mgr = new CrdtManager({
		dbPrefix,
		onUpdate: () => {},
		onFlushToDisk: async (_id, content) => {
			lastFlushed = content;
		},
	});

	// Shared base lineage: both local and remote descend from "BASE".
	const base = new Y.Doc();
	base.getText("content").insert(0, "BASE");
	const uBase = Y.encodeStateAsUpdate(base);

	// Local doc adopts the base lineage (as a prior sync would have).
	await mgr.applyRemoteUpdate("id-a", uBase);
	lastFlushed = null; // reset — that flush was the base, not the merge under test

	// Remote update: " REMOTE" appended on the shared base.
	const remote = new Y.Doc();
	Y.applyUpdate(remote, uBase);
	remote.getText("content").insert(4, " REMOTE");
	const remoteDelta = Y.encodeStateAsUpdate(remote, Y.encodeStateVector(base));

	const file = new TFile("a.md");
	const mockApp = {
		vault: {
			configDir: ".obsidian",
			// Disk holds an un-pushed external edit relative to the "BASE" baseline.
			getAbstractFileByPath: mock().mockReturnValue(file),
			getFileByPath: mock().mockReturnValue(file),
			cachedRead: mock().mockResolvedValue("BASE local"),
			modify: mock().mockResolvedValue(undefined),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const e = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(mgr as unknown as CrdtManager);
	e.setReady();
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	markConfirmed(e, "id-a");
	e.setLiveBoundCheck(() => false);
	// Recorded baseline = the last-synced content "BASE" (disk now differs).
	e.importSyncState({ "a.md": { hash: fnv1a("BASE") } });

	return { e, mgr, remoteDelta, flushed: () => lastFlushed };
}

/** History-LESS harness (#234): a real CrdtManager whose local doc for id-a has
 *  NO CRDT history (feed-synced), a mutable fake disk shared by the manager flush
 *  and the vault reads, and an api.getUpdates(since="") that returns FULL server
 *  state. Exercises adoptHistoryLessNote + reconcileDriftOntoServer end-to-end. */
async function historyLessScenario(opts: {
	dbPrefix: string;
	disk: string; // on-disk content for a.md (drift or in-sync)
	baselineHash: number; // recorded last-synced hash (drives needsColdReconcile)
	serverFull: string; // full server body (what getUpdates since="" reconstructs)
	baseStoreContent?: string; // LCA content, if present
}) {
	const disk = new Map<string, string>();
	disk.set("a.md", opts.disk);

	const box = { e: null as unknown as SyncEngine };
	const mgr = new CrdtManager({
		dbPrefix: opts.dbPrefix,
		onUpdate: () => {},
		onFlushToDisk: async (id, content) => {
			// Mirror production wiring: route the manager flush through the engine's
			// flushFromCrdt so it lands on the shared fake disk with baseline recording.
			await box.e.flushFromCrdt("a.md", content);
			void id;
		},
	});

	// Server full state: a single lineage carrying the whole server body.
	const server = new Y.Doc();
	server.getText("content").insert(0, opts.serverFull);
	const serverFullUpdate = Y.encodeStateAsUpdate(server);

	const tfile = (p: string) => new TFile(p);
	const mockApp = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? tfile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? tfile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
			}),
			create: mock(async (p: string, c: string) => {
				disk.set(p, c);
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const api = {
		getVaultHeads: async () => ({ heads: { "id-a": "SRV" } }),
		getUpdates: async (_id: string, _since?: string) => ({
			update: serverFullUpdate,
			head: "SRV",
		}),
	} as unknown as EngramApi;

	const e = new SyncEngine(
		mockApp,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	box.e = e;
	e.setCrdtManager(mgr as unknown as CrdtManager);
	e.setReady();
	markProbed(e);
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	markConfirmed(e, "id-a");
	e.setLiveBoundCheck(() => false);
	e.importSyncState({ "a.md": { hash: opts.baselineHash } });
	if (opts.baseStoreContent !== undefined) {
		(e as any).baseStore = {
			get: (p: string) =>
				normalizePathLike(p) === "a.md"
					? { content: opts.baseStoreContent, version: 1, ts: 0 }
					: undefined,
			set: () => {},
			delete: () => {},
		};
	}
	return { e, mgr, disk };
}

/** normalizePath is not exported; a.md needs no normalization in these tests. */
function normalizePathLike(p: string): string {
	return p;
}

describe("#234: history-less note adopts full state, never doubles/loses/incomplete", () => {
	test("(i) history-less + NO drift + pushed update → full server content, not doubled, not incomplete", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-nodrift",
			disk: "BASE", // in sync with baseline
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1, 2, 3]), "SRV");

		expect(await mgr.getText("id-a")).toBe("BASE REMOTE"); // complete, not empty
		expect(disk.get("a.md")).toBe("BASE REMOTE"); // flushed complete
		expect(disk.get("a.md")?.match(/BASE/g)?.length).toBe(1); // NOT doubled
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
		await mgr.destroy();
	});

	test("(ii) history-less + drift + LCA present → clean 3-way merge, baseline not doubled", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-lca",
			disk: "ALPHA bravo charlie", // local edited the START
			baselineHash: fnv1a("alpha bravo charlie"),
			serverFull: "alpha bravo DELTA", // remote edited the END
			baseStoreContent: "alpha bravo charlie", // LCA available
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([9]), "SRV");

		const out = disk.get("a.md") ?? "";
		expect(out).toContain("ALPHA"); // local edit preserved
		expect(out).toContain("DELTA"); // remote edit preserved
		expect(out.match(/bravo/g)?.length).toBe(1); // baseline word NOT doubled
		expect(await mgr.getText("id-a")).toBe(out); // doc == disk (consistent)
		await mgr.destroy();
	});

	test("(iii) history-less + drift + NO LCA → keep-both (both preserved, nothing lost/doubled)", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-nolca",
			disk: "BASE local", // un-pushed local edit
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
			// no baseStoreContent → no LCA
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		// Original converges to SERVER (doc == disk == server), no doubling.
		expect(disk.get("a.md")).toBe("BASE REMOTE");
		expect(disk.get("a.md")?.match(/BASE/g)?.length).toBe(1);
		// Local version preserved as a conflict copy — nothing lost.
		const conflictKey = [...disk.keys()].find((k) => k.includes("(conflict"));
		expect(conflictKey).toBeDefined();
		expect(disk.get(conflictKey as string)).toBe("BASE local");
		await mgr.destroy();
	});

	test("(v) coldReceive: history-less + NO drift → adopts full server content, not doubled", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-cold-nodrift",
			disk: "BASE",
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		expect(await e.coldReceive()).toBe(1);

		expect(await mgr.getText("id-a")).toBe("BASE REMOTE");
		expect(disk.get("a.md")).toBe("BASE REMOTE");
		expect(disk.get("a.md")?.match(/BASE/g)?.length).toBe(1);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
		await mgr.destroy();
	});

	test("(v) coldReceive: history-less + drift + NO LCA → keep-both", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-cold-nolca",
			disk: "BASE local",
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		expect(await e.coldReceive()).toBe(1);

		expect(disk.get("a.md")).toBe("BASE REMOTE");
		const conflictKey = [...disk.keys()].find((k) => k.includes("(conflict"));
		expect(conflictKey).toBeDefined();
		expect(disk.get(conflictKey as string)).toBe("BASE local");
		await mgr.destroy();
	});
});

describe("BUG 2: un-pushed disk drift is merged, not clobbered", () => {
	test("applyPushedNoteUpdate merges the un-pushed local disk edit with the remote update", async () => {
		const { e, remoteDelta, flushed } = await scenario("bug2-pushed");

		await (e as any).applyPushedNoteUpdate("id-a", remoteDelta, "HEAD");

		const out = flushed();
		expect(out).not.toBeNull();
		expect(out).toContain("local"); // the un-pushed disk edit survived
		expect(out).toContain("REMOTE"); // the remote change applied too
	});

	test("coldReceive merges the un-pushed local disk edit with the pulled update", async () => {
		const { e, remoteDelta, flushed } = await scenario("bug2-cold");
		markProbed(e);
		(e as any).api = {
			getVaultHeads: async () => ({ heads: { "id-a": "HEAD" } }),
			getUpdates: async () => ({ update: remoteDelta, head: "HEAD" }),
		};

		expect(await e.coldReceive()).toBe(1);

		const out = flushed();
		expect(out).not.toBeNull();
		expect(out).toContain("local");
		expect(out).toContain("REMOTE");
	});
});
