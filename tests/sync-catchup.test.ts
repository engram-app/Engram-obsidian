/**
 * Split 2 of fresh-note identity + catch-up (2026-07-07 evening, live-tested
 * against prod v0.5.642):
 *
 * 1. base_hash on pushes — the plugin declares the server content_hash it last
 *    synced (syncState.serverHash). The backend CAS gate 409s a stale push so
 *    a client that MISSED a delivery cannot "convergently" delete content it
 *    never saw (the sync-test-2 clobber: local never received an MCP line, its
 *    full-content push merged as "delete that line").
 * 2. Pull un-masking — a /sync/changes entry for a CRDT-owned note that exists
 *    locally used to only re-enroll and return, NEVER comparing hashes: a
 *    missed crdt_doc_ready announce meant the note never caught up (the
 *    "Obsidian never got any updates" black hole). The pull already carries
 *    the authoritative body — write it when the hashes prove divergence.
 * 3. Bind-time convergence — on note open, compare the cached manifest hash
 *    (30s TTL, already fetched for the destructive-op guard) against the last
 *    synced serverHash; mismatch forces a fresh CRDT handshake (reset+enroll).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "n.md",
		title: "n",
		content: "body",
		folder: "",
		tags: [],
		mtime: 1,
	}),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	getUpdates: mock().mockResolvedValue({ update: new Uint8Array([1, 2]), head: "head-1" }),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
			Promise.resolve(fn("")),
		),
		create: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

/** Real-timer wait, mirroring tests/sync-postpull-defer.test.ts's `flush` —
 *  used with a shrunk `engine.healCooldownMs` to observe the trailing-fire
 *  coalesce (fix wave 2) without mocking timers. */
function flush(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function createEngine(overrides: Partial<typeof DEFAULT_SETTINGS> = {}): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, ...overrides },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	return engine;
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 });
	(mockApi.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
	((mockApi as any).getUpdates as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ update: new Uint8Array([1, 2]), head: "head-1" });
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
	(mockApp.vault.create as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
	(mockApp.vault.modify as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.process as ReturnType<typeof mock>)
		.mockReset()
		.mockImplementation((_f: any, fn: (d: string) => string) => Promise.resolve(fn("")));
});

describe("pull un-masking — CRDT-owned local note must catch up from /changes", () => {
	function crdtEngine(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
		const engine = createEngine(overrides);
		const map = new NoteIdMap();
		map.set("owned.md", "note-id-1");
		engine.setNoteIdMap(map);
		const encodeStateVector = mock().mockResolvedValue(new Uint8Array([0]));
		const hasPendingGap = mock().mockResolvedValue(false);
		// Default: the doc projects empty; tests that exercise the cold catch-up
		// converge (restConvergeAndFlush) override this to the doc's real content.
		const projectedText = mock().mockResolvedValue("");
		// Simulates the real CrdtManager's remote-merge listener (manager.ts):
		// applying an update flushes the projected content to disk via
		// engine.flushFromCrdt, UNLESS the note is live-bound (the editor owns
		// disk then — wiring.ts's onFlushToDisk skips the write in that case).
		// restConvergeAndFlush no longer performs its own disk write — it
		// relies on this auto-flush having already happened inside
		// applyRemoteUpdate — so the mock must simulate it for these tests to
		// still observe a disk write.
		const applyRemoteUpdate = mock().mockImplementation(async (noteId: string) => {
			const path = map.pathForId(noteId);
			if (path && !(engine as any).isLiveBound(path)) {
				await engine.flushFromCrdt(path, await projectedText());
			}
		});
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			applyRemoteUpdate,
			encodeStateVector,
			hasPendingGap,
			projectedText,
		} as any);
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset });
		return {
			engine,
			enroll,
			reset,
			map,
			applyRemoteUpdate,
			encodeStateVector,
			hasPendingGap,
			projectedText,
		};
	}

	test("diverged hashes: catch-up converges via the Yjs delta (not the feed snapshot) and serverHash converges", async () => {
		const { engine, enroll, applyRemoteUpdate, projectedText } = crdtEngine();
		// The doc converges to exactly what the feed said in this quiescent
		// (no concurrent live edit) case — the Yjs delta path and the old
		// snapshot path agree on the outcome here; the D2 regression test below
		// is where they diverge.
		projectedText.mockResolvedValue("authoritative body the announce never delivered");
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		// Local is CLEAN (its content still hashes to the last-synced hash) —
		// only the SERVER moved. This is the missed-announce catch-up case.
		engine.importSyncState({
			"owned.md": { hash: fnv1a("body"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "authoritative body the announce never delivered",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// Converges through the Y.Doc: the REST delta is pulled and applied...
		expect(applyRemoteUpdate).toHaveBeenCalledWith("note-id-1", expect.any(Uint8Array));
		// ...and the disk write reflects the converged doc's projected text, not
		// a direct write of the feed's content field.
		expect(mockApp.vault.modify).toHaveBeenCalledWith(
			localFile,
			"authoritative body the announce never delivered",
		);
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
		// A cold (not live-bound) note is NOT enrolled on catch-up: its body
		// already materialized via the room-free REST pull, and future updates
		// arrive over the vault-channel fanout — enrolling every pulled note on
		// connect is the enrollment storm P2 removes. (Live-bound notes still
		// enroll — see the "diverged + live-bound" test below.)
		expect(enroll).not.toHaveBeenCalled();
	});

	test("D2 regression: a fresher live-merged Y.Doc survives a stale/checkpoint-lagged feed snapshot", async () => {
		// The feed entry carries a checkpoint-lagged snapshot ("base FROM_B")
		// that is OLDER than what the local Y.Doc has already merged in
		// ("base FROM_A FROM_B", e.g. via a concurrent live edit from another
		// device). Yjs merge is monotonic — applying the stale delta cannot
		// move the doc backward — so the doc still projects FROM_A after
		// converging. Pre-fix, the backfill wrote the feed's raw `content`
		// straight to disk and reverted FROM_A.
		const fresherMerged = "base FROM_A FROM_B";
		const staleSnapshot = "base FROM_B";
		const { engine, applyRemoteUpdate, projectedText } = crdtEngine();
		projectedText.mockResolvedValue(fresherMerged);
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		// Disk is "clean": its recorded hash already matches the fresher
		// merged content (the live path already materialized it here), so
		// this is the missed-announce/catch-up leg, not the conflict leg.
		mockApp.vault.cachedRead.mockResolvedValue(fresherMerged);
		engine.importSyncState({
			"owned.md": { hash: fnv1a(fresherMerged), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: staleSnapshot,
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// The Yjs converge core ran (proves the fix's code path executed, not
		// the old direct-snapshot write, which never calls applyRemoteUpdate).
		expect(applyRemoteUpdate).toHaveBeenCalledWith("note-id-1", expect.any(Uint8Array));
		// The disk must never be overwritten with the stale snapshot — FROM_A
		// must survive. (flushFromCrdt's own idempotency guard means disk,
		// already holding the fresher content, isn't rewritten at all here —
		// the assertion that matters is that the stale snapshot never lands.)
		expect(mockApp.vault.modify).not.toHaveBeenCalledWith(localFile, staleSnapshot);
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
	});

	test("no note_id (legacy /notes/changes path): falls back to the content-snapshot backfill unchanged", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			applyRemoteUpdate: mock().mockResolvedValue(undefined),
			encodeStateVector: mock().mockResolvedValue(new Uint8Array([0])),
			hasPendingGap: mock().mockResolvedValue(false),
			projectedText: mock().mockResolvedValue(""),
		} as any);
		// No NoteIdMap entry for this path — noteId resolves to null, same as
		// the legacy GET /notes/changes feed that never carries an `id`.
		const localFile = new TFile("legacy.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("body");
		engine.importSyncState({
			"legacy.md": { hash: fnv1a("body"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "legacy.md",
			action: "upsert",
			content: "server body",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		expect(mockApp.vault.modify).toHaveBeenCalledWith(localFile, "server body");
		expect(engine.exportSyncState()["legacy.md"]?.serverHash).toBe("new-hash");
	});

	test("unbound catch-up: REST converge FAILURE never fakes convergence — serverHash stays unrecorded so every poll retries", async () => {
		// Equivalent of the live-bound "REST catch-up FAILURE" test below, for
		// the NOT-live-bound (`else if (noteId)`) leg — restConvergeAndFlush's
		// retry contract must hold the same way: a failed REST pull never
		// records convergence for data that never arrived.
		const { engine, applyRemoteUpdate } = crdtEngine();
		((mockApi as any).getUpdates as ReturnType<typeof mock>).mockRejectedValue(
			new Error("HTTP 500"),
		);
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		// Local is clean (matches the last-synced hash) so this takes the
		// catch-up converge branch, not the local+remote-diverged conflict flow.
		engine.importSyncState({
			"owned.md": { hash: fnv1a("body"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "authoritative body the announce never delivered",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// restConvergeCore's getUpdates() throws before ever reaching
		// applyRemoteUpdate — nothing was applied, nothing was flushed.
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("unbound catch-up: a delta that leaves a pending gap does NOT record convergence", async () => {
		// Equivalent of the live-bound "pending gap" test below, for the
		// NOT-live-bound leg.
		const { engine, hasPendingGap } = crdtEngine();
		hasPendingGap.mockResolvedValue(true);
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.importSyncState({
			"owned.md": { hash: fnv1a("body"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "authoritative body the announce never delivered",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// The delta was applied (Yjs merge always integrates what it received)
		// but the doc is still gapped, so restConvergeCore returns null and
		// restConvergeAndFlush must not record convergence.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("local edit + remote edit diverged: routes to conflict flow — skip preserves local (test_14 regression)", async () => {
		const { engine } = crdtEngine({ conflictResolution: "modal" });
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		// Local content NO LONGER matches the last-synced hash — the user
		// edited it. The server ALSO moved. That is a conflict, not a catch-up:
		// backfilling would silently overwrite the local edit (2026-07-08
		// e2e test_14: "skip" was never consulted).
		mockApp.vault.cachedRead.mockResolvedValue("Edited by B");
		engine.importSyncState({
			"owned.md": { hash: fnv1a("Base content"), version: 1, serverHash: "old-hash" },
		});
		const onConflict = mock().mockResolvedValue({ choice: "skip" });
		engine.onConflict = onConflict;

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "Edited by A",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// The conflict flow was consulted and skip left everything untouched.
		expect(onConflict).toHaveBeenCalledTimes(1);
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(mockApp.vault.process).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("local edited to EXACTLY the remote content: no conflict — converges quietly", async () => {
		const { engine } = crdtEngine({ conflictResolution: "modal" });
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("same on both");
		engine.importSyncState({
			"owned.md": { hash: fnv1a("older base"), version: 1, serverHash: "old-hash" },
		});
		const onConflict = mock().mockResolvedValue({ choice: "skip" });
		engine.onConflict = onConflict;

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "same on both",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		expect(onConflict).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
	});

	test("fix wave 1 (a): diverged + live-bound fires reset+enroll — NOTHING recorded until STEP2 commits", async () => {
		const { engine, enroll, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "diverged body",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// The open editor owns the file: never write disk under it. The missed
		// ops arrive via the forced handshake and paint through the binding.
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(reset).toHaveBeenCalledWith("note-id-1");
		expect(enroll).toHaveBeenCalledWith("note-id-1");
		expect((mockApi as any).getUpdates).not.toHaveBeenCalled();
		// No text-verify shortcut anymore — a diverged row NEVER records on its
		// own. Only a real STEP2/update apply (commitCrdtConvergence) can.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("fix wave 1 (b): STEP2 commit records the staged serverHash/version/seq and clears bookkeeping", async () => {
		const { engine } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("real disk content");
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "diverged body",
			content_hash: "new-hash",
			version: 2,
			seq: 42,
			mtime: 50,
		} as any);
		// Nothing recorded yet — the diverged leg only staged it.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");

		// Simulates CrdtManager firing onSynced after a real inbound frame
		// applies non-empty (see manager.ts markSynced / wiring.ts onSynced).
		await engine.commitCrdtConvergence("note-id-1");

		const state = engine.exportSyncState()["owned.md"];
		expect(state?.serverHash).toBe("new-hash");
		expect(state?.version).toBe(2);
		expect(state?.seq).toBe(42);
		// stored.hash was already 1 (imported baseline) — preserved, not
		// recomputed from disk, since the editor owns the body.
		expect(state?.hash).toBe(1);

		// Idempotent: a second commit for the same id is a no-op (nothing
		// staged anymore) — does not throw, does not touch syncState again.
		await engine.commitCrdtConvergence("note-id-1");
		expect(engine.exportSyncState()["owned.md"]).toEqual(state);
	});

	test("fix wave 1 (c): commit with nothing staged for the id is a no-op", async () => {
		const { engine } = crdtEngine();
		engine.importSyncState({
			"owned.md": { hash: 1, version: 1, serverHash: "old-hash" },
		});

		await expect(engine.commitCrdtConvergence("never-staged-id")).resolves.toBeUndefined();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("fix wave 1 (d): per-note cooldown collapses two diverged rows to one handshake", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({ "owned.md": { hash: 1, version: 1, serverHash: "h0" } });

		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "a",
			content_hash: "h1",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1);
		await engine.applyChange(c1);

		// Within the cooldown window (default 15s): only the first row actually
		// fires STEP1 — the second is a cheap no-op, not a second handshake.
		expect(reset).toHaveBeenCalledTimes(1);
	});

	test("fix wave 2 (a): a suppressed poke arms a trailing fire — reset+enroll fires exactly once more after the window", async () => {
		const { engine, reset } = crdtEngine();
		engine.healCooldownMs = 30;
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({ "owned.md": { hash: 1, version: 1, serverHash: "h0" } });

		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "a",
			content_hash: "h1",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1); // immediate fire
		expect(reset).toHaveBeenCalledTimes(1);

		await engine.applyChange(c1); // suppressed — must NOT drop; arms a trailing fire
		expect(reset).toHaveBeenCalledTimes(1);

		await flush(60); // past the window
		expect(reset).toHaveBeenCalledTimes(2);

		engine.destroy();
	});

	test("fix wave 2 (b): three suppressed pokes for the same note coalesce into ONE trailing fire", async () => {
		const { engine, reset } = crdtEngine();
		engine.healCooldownMs = 30;
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({ "owned.md": { hash: 1, version: 1, serverHash: "h0" } });

		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "a",
			content_hash: "h1",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1); // immediate fire
		await engine.applyChange(c1); // suppressed — arms the trailing timer
		await engine.applyChange(c1); // suppressed — already coalesced, no 2nd timer
		await engine.applyChange(c1); // suppressed — already coalesced, no 3rd timer
		expect(reset).toHaveBeenCalledTimes(1);

		await flush(60);
		// Exactly one trailing fire for all three coalesced pokes, not three.
		expect(reset).toHaveBeenCalledTimes(2);

		engine.destroy();
	});

	test("fix wave 2 (c): the trailing fire records a NEW cooldown timestamp (not stale from the suppressed poke)", async () => {
		const { engine, reset } = crdtEngine();
		engine.healCooldownMs = 30;
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({ "owned.md": { hash: 1, version: 1, serverHash: "h0" } });

		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "a",
			content_hash: "h1",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1); // immediate fire #1, cooldown starts at t0
		await engine.applyChange(c1); // suppressed — arms a trailing timer that
		// fires at t0+healCooldownMs regardless of when this poke landed.
		// Wait just past that (not a second full window) so the follow-up poke
		// below still lands inside the trailing fire's OWN fresh window.
		await flush(40);
		expect(reset).toHaveBeenCalledTimes(2);

		// A poke immediately after the trailing fire must be suppressed — if the
		// trailing fire had NOT refreshed the cooldown timestamp (stayed at the
		// original suppressed-attempt time, or unset), this would wrongly fire
		// immediately as a 3rd handshake.
		await engine.applyChange(c1);
		expect(reset).toHaveBeenCalledTimes(2);

		engine.destroy();
	});

	test("fix wave 2 (d): destroy() clears a pending trailing timer — it never fires after teardown", async () => {
		const { engine, reset } = crdtEngine();
		engine.healCooldownMs = 30;
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({ "owned.md": { hash: 1, version: 1, serverHash: "h0" } });

		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "a",
			content_hash: "h1",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1); // immediate fire
		await engine.applyChange(c1); // suppressed — arms the trailing timer
		expect(reset).toHaveBeenCalledTimes(1);

		engine.destroy();
		await flush(60); // past what would have been the trailing-fire window

		// Torn down: the armed trailing timer must never fire.
		expect(reset).toHaveBeenCalledTimes(1);
	});

	test("fix wave 3 (a): seq decides the staleRow fence — a newer seq with equal version RUNS the diverged leg (D3 gate forensics, issue #282)", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, seq: 40, version: 1, serverHash: "old-hash" },
		});

		// forceOverwrite=true: isolates the CRDT-specific staleRow fence under
		// test from the separate, out-of-scope, non-CRDT "anti-stale guard"
		// (applyChange skip "stale vN <= synced vN", src/sync.ts:5053) — that
		// guard runs BEFORE the CRDT block and independently short-circuits on
		// change.version <= stored.version alone (no seq awareness at all), so
		// this exact equal-version row would otherwise never reach the fence
		// being fixed here. That guard is its own, separate concern (a
		// mid-pull-push race guard, not CRDT-specific) — not touched by this
		// task's scope.
		await engine.applyChange(
			{
				path: "owned.md",
				action: "upsert",
				content: "unseen edit",
				content_hash: "new-hash",
				// Checkpoint-lagged version equal to stored — under the old
				// OR-of-both-checks fence this alone masked the row as stale even
				// though the seq below proves it's genuinely newer (the CI gate
				// flake: "stale row" skip x2, the note converged only at teardown).
				version: 1,
				seq: 41,
				mtime: 50,
			} as any,
			true,
		);

		// seq alone proves this row is newer — the diverged leg must run, not
		// be fence-skipped as history.
		expect(reset).toHaveBeenCalledWith("note-id-1");
	});

	test("fix wave 3 (b): equal seq is still stale — the fence is preserved (PR #280 scope, untouched)", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, seq: 40, version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "replayed row",
			content_hash: "new-hash",
			version: 2,
			seq: 40, // equal to stored.seq — still history, must still skip
			mtime: 50,
		} as any);

		expect(reset).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("fix wave 3 (c): seq absent on the row falls back to version — the legacy skip path is preserved", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, version: 1, serverHash: "old-hash" }, // no seq recorded
		});

		// forceOverwrite=true: same isolation as fix wave 3 (a) — an equal
		// version here would ALSO trip the separate, out-of-scope anti-stale
		// guard at src/sync.ts:5053 before ever reaching the CRDT fence's
		// version-fallback branch this test targets.
		await engine.applyChange(
			{
				path: "owned.md",
				action: "upsert",
				content: "legacy row, no seq field",
				content_hash: "new-hash",
				version: 1, // equal, no seq on either side — version fallback applies
				mtime: 50,
			} as any,
			true,
		);

		expect(reset).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("fix wave 1 (f): a fresh content_hash overwrites the staged entry — commit lands the LATEST, not the first", async () => {
		const { engine } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({ "owned.md": { hash: 1, version: 1, serverHash: "h0" } });

		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "a",
			content_hash: "h1",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1);
		// A NEWER row lands (e.g. a fan-out replay) before STEP2 ever committed
		// h1 — this is a fresh episode and must overwrite the stage, not queue
		// behind it.
		await engine.applyChange({ ...c1, content_hash: "h2", version: 3 });

		await engine.commitCrdtConvergence("note-id-1");

		// h1 must never land — only the latest staged value commits.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("h2");
		expect(engine.exportSyncState()["owned.md"]?.version).toBe(3);
	});

	test("live-bound divergence for an UNMAPPED note (no note_id): quietly retries, never throws, never fakes convergence", async () => {
		const { engine, applyRemoteUpdate } = crdtEngine();
		const localFile = new TFile("unmapped.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "unmapped.md");
		engine.importSyncState({
			"unmapped.md": { hash: 7, version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "unmapped.md",
			action: "upsert",
			content: "diverged body",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		expect((mockApi as any).getUpdates).not.toHaveBeenCalled();
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["unmapped.md"]?.serverHash).toBe("old-hash");
	});

	test("STEP2 commit with no prior baseline records the REAL local hash, not a poisoning 0", async () => {
		const { engine } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("actual disk content");
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		// NO importSyncState → stored is undefined for owned.md, so the commit
		// falls back to reading disk (cachedRead) for the local hash.

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "x",
			content_hash: "h",
			version: 2,
			mtime: 1,
		} as any);
		await engine.commitCrdtConvergence("note-id-1");

		// A 0 sentinel here would later read as `fnv1a(local) !== 0` = local
		// diverged, spuriously routing a note the user only VIEWED to the
		// conflict flow. Record the real disk hash instead.
		expect(engine.exportSyncState()["owned.md"]?.hash).toBe(fnv1a("actual disk content"));
		expect(engine.exportSyncState()["owned.md"]?.hash).not.toBe(0);
	});

	test("no spurious conflict: a VIEWED-then-cold note with the real hash recorded does NOT hit the conflict flow (#2 outcome)", async () => {
		const { engine } = crdtEngine({ conflictResolution: "modal" });
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("viewed content");
		const onConflict = mock().mockResolvedValue({ choice: "skip" });
		engine.onConflict = onConflict;

		// Phase 1: note OPEN (live-bound), no prior baseline. STEP2 commits the
		// staged convergence, recording the REAL local disk hash, not a 0
		// sentinel.
		let live = true;
		engine.setLiveBoundCheck((p: string) => live && p === "owned.md");
		const c1 = {
			path: "owned.md",
			action: "upsert",
			content: "x",
			content_hash: "h",
			version: 2,
			mtime: 1,
		} as any;
		await engine.applyChange(c1);
		await engine.commitCrdtConvergence("note-id-1");
		expect(engine.exportSyncState()["owned.md"]?.hash).toBe(fnv1a("viewed content"));

		// Phase 2: user CLOSES the editor (note cold); a later poll brings a new
		// server hash while local disk is UNCHANGED. With a 0 sentinel this
		// false-positived as localDiverged → conflict. With the real hash it sees
		// local is clean → plain backfill, no conflict dialog / copy.
		live = false;
		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "server body",
			content_hash: "h2",
			version: 3,
			mtime: 2,
		} as any);
		expect(onConflict).not.toHaveBeenCalled();
	});

	test("converged hashes: no disk write, and a cold note is not enrolled", async () => {
		const { engine, enroll } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		engine.importSyncState({
			"owned.md": { hash: 1, version: 2, serverHash: "same-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "already have this",
			content_hash: "same-hash",
			version: 2,
			mtime: 50,
		} as any);

		expect(mockApp.vault.process).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		// Cold (not live-bound): no STEP1 room opened on the pull feed.
		expect(enroll).not.toHaveBeenCalled();
	});
});

// The "bind-time convergence — verifyConvergenceOnOpen" describe block that
// lived here is gone (Plan B1 Task 6): the per-file-open REST manifest-hash
// check it tested no longer exists (verifyConvergenceOnOpen deleted from
// src/sync.ts, along with the manifestPathHashes cache it solely read). Its
// intent — heal a note whose local state diverged from the server without
// waiting for the user to act — is now served by catchupViaSeqReplay
// (crdt_catchup_since) running on every (re)connect instead of once per
// file-open; that mechanism has its own non-redundant coverage in
// tests/sync-socket-catchup.test.ts (the "catchupViaSeqReplay" describe).
// Re-pointing these two tests at it would just duplicate that coverage under
// a different name — the manifest-hash-vs-serverHash comparison these tests
// exercised is not a mechanism the seq-replay has (it applies full-content
// ops in seq order), so there's no meaningful "same intent, new API" retarget.

describe("anti-stale apply guard (review 2026-07-15 — mid-pull push overwrite race)", () => {
	test("a change at or below the already-synced version is skipped", async () => {
		const engine = createEngine();
		const localFile = new TFile("note.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		// A mid-pull push (bounded drain) bumped syncState to v5; this pull's
		// snapshot still carries the pre-push v4 body.
		engine.importSyncState({
			"note.md": { hash: fnv1a("fresh local edit"), version: 5, serverHash: "h5" },
		});

		const applied = await engine.applyChange({
			path: "note.md",
			content: "stale pre-push body",
			content_hash: "h4",
			version: 4,
			mtime: 10,
		} as any);

		expect(applied).toBe(false);
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(mockApp.vault.process).not.toHaveBeenCalled();
	});

	test("a NEWER version still applies", async () => {
		const engine = createEngine();
		const localFile = new TFile("note.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("body");
		engine.importSyncState({
			"note.md": { hash: fnv1a("body"), version: 5, serverHash: "h5" },
		});

		const applied = await engine.applyChange({
			path: "note.md",
			content: "newer remote body",
			content_hash: "h6",
			version: 6,
			mtime: 20,
		} as any);

		expect(applied).toBe(true);
		// modifyFile prefers vault.process (atomic in-place write).
		expect(mockApp.vault.process).toHaveBeenCalled();
	});

	test("forceOverwrite (explicit keep-remote) bypasses the guard", async () => {
		const engine = createEngine();
		const localFile = new TFile("note.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("body");
		engine.importSyncState({
			"note.md": { hash: fnv1a("body"), version: 5, serverHash: "h5" },
		});

		const applied = await engine.applyChange(
			{
				path: "note.md",
				content: "remote body the user chose",
				content_hash: "h4",
				version: 4,
				mtime: 10,
			} as any,
			true,
		);

		expect(applied).toBe(true);
	});
});
