/**
 * BUG 2: a fanned-out remote update must NOT clobber an un-pushed local disk
 * edit. A NOT-live-bound note edited on disk (external tool / reading view /
 * another device) lives only on disk until its debounce fires pushFile. If a
 * fanned-out remote update (applyPushedNoteUpdate) lands in that window,
 * applyRemoteUpdate flushes the REMOTE projection to disk with no merge — the
 * local edit was never in the Y.Doc, so it is destroyed. The fix captures the
 * disk drift into the Y.Doc (applyLocalEdit) BEFORE applying the remote update,
 * so CRDT MERGES both.
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
 *  NO CRDT history (feed-synced) and a mutable fake disk shared by the manager
 *  flush and the vault reads. Phase E3: full state arrives via the enroll
 *  re-handshake's STEP2 (socket), so the harness exposes enroll/reset mocks —
 *  there is no REST full-state fetch anymore. */
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
	const enroll = mock();
	const reset = mock();
	e.setCrdtEnrollment({ enroll, reset });
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
	return { e, mgr, disk, sinceCalls, enroll, reset, serverFullUpdate };
}

/** normalizePath is not exported; a.md needs no normalization in these tests. */
function normalizePathLike(p: string): string {
	return p;
}

describe("#234 (Phase E3 storm-safe): history-less note applies the delta directly — no seed, no room", () => {
	test("(i) NO drift + full-lineage first delta → integrates gap-free, history-full, disk converged, NO enroll", async () => {
		const { e, mgr, disk, enroll, serverFullUpdate } = await historyLessScenario({
			dbPrefix: "hl-nodrift",
			disk: "BASE", // in sync with baseline
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		// A note created while this device is online fans out its FIRST delta =
		// the entire lineage since genesis — it integrates into the empty doc
		// with no causal gap.
		await (e as any).applyPushedNoteUpdate("id-a", serverFullUpdate, "SRV");

		expect(await mgr.getText("id-a")).toBe("BASE REMOTE"); // complete, not doubled
		expect(disk.get("a.md")).toBe("BASE REMOTE"); // flushed complete
		expect(disk.get("a.md")?.match(/BASE/g)?.length).toBe(1); // NOT doubled
		expect((e as any).getCrdtHead("a.md")).toBe("SRV"); // history-full, head recorded
		expect(enroll).not.toHaveBeenCalled(); // room-free — no connect-storm contribution
		await mgr.destroy();
	});

	test("(ii) INCREMENTAL delta (note predates this device) → pends, defers, and fires ONE cooldown-gated socket converge", async () => {
		const { e, mgr, disk, enroll, reset } = await historyLessScenario({
			dbPrefix: "hl-incr",
			disk: "BASE",
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
		});

		// An incremental delta built on server state this empty doc has never
		// seen: encode the server's "REMOTE" edit AGAINST a non-empty base the
		// local doc lacks — Yjs pends it.
		const base = new Y.Doc();
		base.getText("content").insert(0, "BASE");
		const baseSv = Y.encodeStateVector(base);
		base.getText("content").insert(4, " REMOTE");
		const incremental = Y.encodeStateAsUpdate(base, baseSv);

		const result = await (e as any).applyPushedNoteUpdate("id-a", incremental, "SRV");

		expect(result).toBe("deferred");
		// A pended incremental delta means the ONLY in-window delivery (this
		// fan-out) could not reconstruct the note, and the op-log rows do NOT
		// reliably own disk here: the edit's row seq is checkpoint-lagged and a
		// resumed device's cursor may already be past the note's old row (e2e
		// test_82, local repro 2026-07-22). Fire the cooldown-gated re-handshake
		// so STEP2's full state converges the empty doc — the 15s per-note
		// cooldown keeps this storm-safe (CI 29942250643 class), since only
		// actively-edited notes fan out, not catch-up-scale enumerations.
		expect(reset).toHaveBeenCalledWith("id-a");
		expect(enroll).toHaveBeenCalledWith("id-a");
		expect(disk.get("a.md")).toBe("BASE"); // untouched until STEP2 lands
		expect((e as any).getCrdtHead("a.md")).toBeUndefined(); // unadvanced
		await mgr.destroy();
	});

	test("(iii) drift + full-lineage delta → keep-both copy BEFORE the apply, server content lands, nothing lost", async () => {
		const { e, mgr, disk, enroll, serverFullUpdate } = await historyLessScenario({
			dbPrefix: "hl-drift",
			disk: "BASE local", // un-pushed local edit
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
			// no baseStoreContent → no LCA
		});

		await (e as any).applyPushedNoteUpdate("id-a", serverFullUpdate, "SRV");

		// Local version preserved as a conflict copy; the integrate's flush
		// then freely converges the original to server content.
		const conflictKey = [...disk.keys()].find((k) => k.includes("(conflict"));
		expect(conflictKey).toBeDefined();
		expect(disk.get(conflictKey as string)).toBe("BASE local");
		expect(disk.get("a.md")).toBe("BASE REMOTE");
		expect(disk.get("a.md")?.match(/BASE/g)?.length).toBe(1); // NOT doubled
		expect(enroll).not.toHaveBeenCalled();
		const state = (e as any).syncState as Map<string, { hash: number }>;
		expect(state.get(conflictKey as string)?.hash).toBe(fnv1a("BASE local"));
		await mgr.destroy();
	});
});

describe("I1: keep-both preserves the local edit even if the copy write fails", () => {
	test("conflict-copy write THROWS → local edit NOT lost: abort BEFORE the apply, crdtHead unadvanced, disk intact", async () => {
		const { e, mgr, disk, serverFullUpdate } = await historyLessScenario({
			dbPrefix: "hl-copyfail",
			disk: "BASE local", // un-pushed local edit — the sole live copy
			baselineHash: fnv1a("BASE"),
			serverFull: "BASE REMOTE",
			createThrows: true, // conflict-copy write fails for real
		});

		const result = await (e as any).applyPushedNoteUpdate("id-a", serverFullUpdate, "SRV");

		// Aborted BEFORE applying: the integrate's flush would overwrite the
		// sole copy of the edit. The original still holds it; the caller
		// retries next fan-out/poll.
		expect(result).toBe("deferred");
		expect(disk.get("a.md")).toBe("BASE local");
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
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
