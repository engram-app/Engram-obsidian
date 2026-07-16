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
import { toB64 } from "../src/crdt/channel";
import { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
	// CRDT-sole oracle: hasServerNote(noteId) = getCrdtHead(pathForId(noteId)) != null.
	// Record a server head under the note's path so a "server-known" note routes
	// through the CRDT path (the confirmed-set no longer gates CRDT routing).
	const e = engine as unknown as {
		noteIdMap?: { pathForId(id: string): string | null };
		setCrdtHead(path: string, head: string): void;
	};
	const p = e.noteIdMap?.pathForId(noteId);
	if (p) e.setCrdtHead(p, "server-head");
}
function markProbed(engine: SyncEngine): void {
	(engine as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
}

/** Drive the sole CRDT convergence path (catchupViaSocket → convergeNoteFromDelta)
 *  using the engine's already-wired getVaultHeads/getUpdates test doubles. Replaces
 *  the deleted REST coldReceive() driver; the convergence guarantees it exercised
 *  (history-less adopt, disk-drift merge, keep-both) are identical. */
async function driveCatchup(engine: SyncEngine): Promise<void> {
	const api = (
		engine as unknown as {
			api: {
				getVaultHeads: () => Promise<{ heads: Record<string, string> }>;
				getUpdates: (
					id: string,
					sv: string,
				) => Promise<{ update: Uint8Array; head: string }>;
			};
		}
	).api;
	engine.setCrdtCatchup(
		() => api.getVaultHeads(),
		async (id, sv) => {
			const { update, head } = await api.getUpdates(id, sv);
			return { doc_id: id, b64: toB64(update), head };
		},
	);
	await engine.catchupViaSocket();
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
	serverFull: string; // full server body (what getUpdates reconstructs)
	baseStoreContent?: string; // LCA content, if present
	createThrows?: boolean; // vault.create rejects (conflict-copy write fails)
}) {
	const disk = new Map<string, string>();
	disk.set("a.md", opts.disk);
	const sinceCalls: string[] = []; // every getUpdates `since` arg, in order

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
				if (opts.createThrows) throw new Error("EACCES: simulated disk write failure");
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
		getUpdates: async (_id: string, since?: string) => {
			sinceCalls.push(since ?? "");
			return { update: serverFullUpdate, head: "SRV" };
		},
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
	return { e, mgr, disk, sinceCalls };
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

	test("(v) socket catch-up: history-less + NO drift → adopts full server content, not doubled", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-cold-nodrift",
			disk: "BASE",
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		await driveCatchup(e);

		expect(await mgr.getText("id-a")).toBe("BASE REMOTE");
		expect(disk.get("a.md")).toBe("BASE REMOTE");
		expect(disk.get("a.md")?.match(/BASE/g)?.length).toBe(1);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
		await mgr.destroy();
	});

	test("(v) socket catch-up: history-less + drift + NO LCA → keep-both", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-cold-nolca",
			disk: "BASE local",
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		await driveCatchup(e);

		expect(disk.get("a.md")).toBe("BASE REMOTE");
		const conflictKey = [...disk.keys()].find((k) => k.includes("(conflict"));
		expect(conflictKey).toBeDefined();
		expect(disk.get(conflictKey as string)).toBe("BASE local");
		await mgr.destroy();
	});
});

describe("I1: no-LCA keep-both preserves the local edit even if the copy write fails", () => {
	test("conflict-copy write THROWS → local edit NOT lost: adopt aborts, crdtHead unadvanced, original disk intact", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-copyfail",
			disk: "BASE local", // un-pushed local edit — the sole live copy
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
			createThrows: true, // conflict-copy write fails for real
			// no baseStoreContent → no LCA → keep-both path
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		// Adopt aborted BEFORE overwriting disk: the original still holds the edit.
		expect(disk.get("a.md")).toBe("BASE local");
		// crdtHead NOT advanced → the caller retries next poll (no silent loss).
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
		await mgr.destroy();
	});

	test("happy path: original=server, copy=local, both recorded, crdtHead advanced", async () => {
		const { e, mgr, disk } = await historyLessScenario({
			dbPrefix: "hl-copyok",
			disk: "BASE local",
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(disk.get("a.md")).toBe("BASE REMOTE"); // original converged to server
		const conflictKey = [...disk.keys()].find((k) => k.includes("(conflict"));
		expect(conflictKey).toBeDefined();
		expect(disk.get(conflictKey as string)).toBe("BASE local"); // copy = local
		// Both recorded in syncState so neither is re-pushed as spurious drift.
		const state = (e as any).syncState as Map<string, { hash: number }>;
		expect(state.get("a.md")?.hash).toBe(fnv1a("BASE REMOTE"));
		expect(state.get(conflictKey as string)?.hash).toBe(fnv1a("BASE local"));
		expect((e as any).getCrdtHead("a.md")).toBe("SRV"); // advanced
		await mgr.destroy();
	});

	test("full-state fetch uses the empty-doc state vector, NOT an empty since (backend 400 guard)", async () => {
		const { e, mgr, sinceCalls } = await historyLessScenario({
			dbPrefix: "hl-since",
			disk: "BASE", // no drift — isolate the adopt fetch
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(sinceCalls.length).toBe(1);
		expect(sinceCalls[0]).not.toBe(""); // real empty-doc SV, not the rejected ""
		expect(sinceCalls[0].length).toBeGreaterThan(0);
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

	test("socket catch-up merges the un-pushed local disk edit with the pulled update", async () => {
		const { e, remoteDelta, flushed } = await scenario("bug2-cold");
		markProbed(e);
		(e as any).api = {
			getVaultHeads: async () => ({ heads: { "id-a": "HEAD" } }),
			getUpdates: async () => ({ update: remoteDelta, head: "HEAD" }),
		};

		await driveCatchup(e);

		const out = flushed();
		expect(out).not.toBeNull();
		expect(out).toContain("local");
		expect(out).toContain("REMOTE");
	});

	test("crdt topic DOWN: the seeded drift is durably queued (reconnect-window ship guarantee)", async () => {
		// The reconnect window: the SYNC topic delivered this fan-out but the crdt
		// topic has not re-joined (`crdtLive()` false), so the seed's live send is
		// dropped. Once flushFromCrdt advances the baseline to the merged content,
		// the debounced pushFile echo-skips — the drift would be stranded. The
		// guard durably queues it so the next flush ships the merged Y.Doc state.
		const { e, remoteDelta, flushed } = await scenario("bug2-topicdown");
		e.setCrdtLiveCheck(() => false);

		await (e as any).applyPushedNoteUpdate("id-a", remoteDelta, "HEAD");

		// Local merge still preserved the drift on disk...
		const out = flushed();
		expect(out).toContain("local");
		expect(out).toContain("REMOTE");

		// ...AND a durable crdt-tagged queue entry exists to ship it.
		const entry = (e as any).queue
			.all()
			.find((q: any) => q.noteId === "id-a" && q.crdt === true);
		expect(entry).toBeDefined();
	});

	test("crdt topic UP: no redundant queue entry (the live send ships the seed)", async () => {
		// When the crdt topic is joined, manager.onUpdate ships the seed live over
		// the channel, so the durable queue must NOT also carry it.
		const { e, remoteDelta } = await scenario("bug2-topicup");
		e.setCrdtLiveCheck(() => true);

		await (e as any).applyPushedNoteUpdate("id-a", remoteDelta, "HEAD");

		const queued = (e as any).queue.all().find((q: any) => q.noteId === "id-a");
		expect(queued).toBeUndefined();
	});
});
