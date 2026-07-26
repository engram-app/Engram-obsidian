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
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
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
		const closeDoc = mock();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			applyRemoteUpdate,
			encodeStateVector,
			hasPendingGap,
			projectedText,
			closeDoc,
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
			closeDoc,
		};
	}

	test("diverged hashes (cold): stages + fires the socket re-handshake — records only on STEP2 commit (Phase E3)", async () => {
		const { engine, enroll, reset, applyRemoteUpdate, projectedText } = crdtEngine();
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
			seq: 7,
			mtime: 50,
		} as any);

		// Same stage-then-fire pattern as the live-bound leg: the REST delta
		// pull is DELETED — the missing ops arrive via the room re-handshake
		// (STEP2), whose remote-merge listener flushes disk.
		expect(reset).toHaveBeenCalledWith("note-id-1");
		expect(enroll).toHaveBeenCalledWith("note-id-1");
		expect((mockApi as any).getUpdates).not.toHaveBeenCalled();
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
		// Nothing recorded until a real inbound frame proves convergence.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");

		// STEP2: the doc now projects the staged row's text — commit records it.
		projectedText.mockResolvedValue("authoritative body the announce never delivered");
		await engine.commitCrdtConvergence("note-id-1");
		const state = engine.exportSyncState()["owned.md"];
		expect(state?.serverHash).toBe("new-hash");
		expect(state?.version).toBe(2);
		expect(state?.seq).toBe(7);
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
		const { engine, projectedText } = crdtEngine();
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

		// The stale snapshot can never land: the socket path writes disk only
		// from the Y.Doc's projection (via the remote-merge listener), never
		// from the feed's content field.
		expect(mockApp.vault.modify).not.toHaveBeenCalledWith(localFile, staleSnapshot);
		// Relay model: convergence is the provider's syncStep2, not a text-verify —
		// committing records the staged row unconditionally. The D2 guarantee under
		// test is the DISK one above (the stale snapshot never lands); the Yjs merge
		// is monotonic, so disk keeps the fresher content regardless of the commit.
		await engine.commitCrdtConvergence("note-id-1");
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

	test("NO recorded CAS base + disk already holds the row bytes: quiet record, NO re-handshake (storm class)", async () => {
		// Post-wipe re-adoption / account swap: every row's per-user HMAC hash
		// reads diverged, but disk content is identical. Firing a re-handshake
		// per such row re-created the connect storm (hundreds of enrolls →
		// server rate limit → real heals starved; CI run 29942250643). With no
		// serverHash ever recorded there is no convergence history to mask —
		// record the bookkeeping quietly.
		const { engine, enroll, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("identical body");
		// Baseline hash exists (file tracked) but NO serverHash was ever recorded.
		engine.importSyncState({ "owned.md": { hash: fnv1a("identical body") } });

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "identical body",
			content_hash: "row-hash",
			version: 4,
			seq: 11,
			mtime: 50,
		} as any);

		expect(enroll).not.toHaveBeenCalled();
		expect(reset).not.toHaveBeenCalled();
		const state = engine.exportSyncState()["owned.md"];
		expect(state?.serverHash).toBe("row-hash");
		// seq deliberately NOT stamped: if this row was a checkpoint-lagged
		// projection, the E1 validator re-serves it next pass and the
		// identical/diverged branches consume it properly.
		expect(state?.seq).toBeUndefined();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("cold diverged leg issues ZERO REST calls — no getUpdates, no fetch (Phase E3 purge regression)", async () => {
		// The REST delta pull (restConvergeAndFlush/restConvergeCore) is
		// DELETED: a cold diverged note stages + fires the socket re-handshake
		// and nothing else. A failure to deliver simply leaves the stage
		// uncommitted — the retry contract moved from "failed REST pull records
		// nothing" to "unhealed stage records nothing" (commit is
		// content-verified; the next replay re-pokes).
		const { engine, enroll, applyRemoteUpdate } = crdtEngine();
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

		expect((mockApi as any).getUpdates).not.toHaveBeenCalled();
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(enroll).toHaveBeenCalledWith("note-id-1");
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("a row carrying EXACTLY the last-synced baseline (echo / checkpoint-lagged): NO conflict, NO record — socket converge (test_82 class)", async () => {
		// Two indistinguishable shapes: our own create/edit row echoing back
		// while the next local edit is in flight, OR a checkpoint-lagged row
		// whose content projection trails fresh tail ops (test_34 class). The
		// content is not evidence of a remote change: conflicting on it
		// stalled the real push behind a 20s auto-resolve (round 2, CI
		// 29944157587); silently recording it consumed a lagged row and left
		// the device deaf on stale bytes (round 4, CI 29945930489). The only
		// correct move is the room re-handshake — Yjs deltas are right in
		// both cases.
		const { engine, enroll, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		// Disk moved AHEAD of the baseline (pending local edit)…
		mockApp.vault.cachedRead.mockResolvedValue("baseline body PLUS local edit");
		engine.importSyncState({
			"owned.md": { hash: fnv1a("baseline body"), version: 1, serverHash: "old-hash" },
		});

		// …and the row carries exactly the baseline content.
		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "baseline body",
			content_hash: "new-hash",
			version: 2,
			seq: 9,
			mtime: 50,
		} as any);

		expect(reset).toHaveBeenCalledWith("note-id-1");
		expect(enroll).toHaveBeenCalledWith("note-id-1");
		expect(mockApp.vault.modify).not.toHaveBeenCalled(); // disk untouched
		// NOTHING recorded until op-level proof (best-effort content:null
		// stage — commits on the next inbound frame).
		const state = engine.exportSyncState()["owned.md"];
		expect(state?.serverHash).toBe("old-hash");
		expect(state?.seq).toBeUndefined();
	});

	test("local edit + remote edit diverged: drift-copy preserves local + converges main, no modal (test_14 regression)", async () => {
		const { engine, enroll, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		// Local content NO LONGER matches the last-synced hash (user edited it)
		// and the server ALSO moved: a real double-divergence. #306 Phase A
		// resolves it modal-free — the local edit is preserved as a "(conflict)"
		// copy (never silently overwritten, the test_14 invariant) and the main
		// file converges to the server via the room re-handshake.
		mockApp.vault.cachedRead.mockResolvedValue("Edited by B");
		engine.importSyncState({
			"owned.md": { hash: fnv1a("Base content"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "Edited by A",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// No modal; the local edit is saved as a "(conflict)" copy (never lost).
		const conflictCreate = (mockApp.vault.create as any).mock.calls.find((c: unknown[]) =>
			/\(conflict .*\)\.md$/.test(c[0] as string),
		);
		expect(conflictCreate).toBeDefined();
		expect(conflictCreate?.[1]).toBe("Edited by B");
		// Main converges via the room re-handshake; nothing recorded until STEP2.
		expect(reset).toHaveBeenCalledWith("note-id-1");
		expect(enroll).toHaveBeenCalledWith("note-id-1");
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("drift-copy: if the conflict-copy write FAILS, do NOT converge (local edit not silently lost)", async () => {
		const { engine, enroll, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		// Only the main file exists; the "(conflict …)" path does NOT — so a failed
		// vault.create is a genuine write failure, not the already-exists degrade.
		mockApp.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === "owned.md" ? localFile : null,
		);
		mockApp.vault.cachedRead.mockResolvedValue("Edited by B");
		// The conflict-copy write fails (disk full / permission). The local edit
		// could NOT be preserved, so convergence must be SKIPPED — otherwise the
		// room re-handshake would overwrite the main file and the local edit would
		// exist in neither the copy nor the file.
		mockApp.vault.create.mockRejectedValue(new Error("disk full"));
		engine.importSyncState({
			"owned.md": { hash: fnv1a("Base content"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "Edited by A",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		// No convergence fired, so the diverged local file is left intact on disk
		// for the next catch-up to retry the copy.
		expect(reset).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("local edited to EXACTLY the remote content: no conflict — stage-then-fire, commit records on proof", async () => {
		// Identical text is NOT op-level proof (two independently-typed identical
		// bodies are a disjoint lineage — the #234 doubling / #282 fence class),
		// so even this case routes through the socket re-handshake; the
		// content-verified commit lands the bookkeeping once real ops arrive.
		const { engine, enroll, projectedText } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("same on both");
		engine.importSyncState({
			"owned.md": { hash: fnv1a("older base"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "same on both",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);

		expect(enroll).toHaveBeenCalledWith("note-id-1");
		// Nothing recorded until the frame proves it.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
		projectedText.mockResolvedValue("same on both");
		await engine.commitCrdtConvergence("note-id-1");
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
		const { engine, projectedText } = crdtEngine();
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

		// Fix wave 5: the commit is content-verified — the doc must actually
		// project the staged row's text before commitCrdtConvergence records
		// anything. Simulates CrdtManager firing onSynced after the real
		// inbound frame (the staged row's own ops) applies non-empty (see
		// manager.ts markSynced / wiring.ts onSynced).
		projectedText.mockResolvedValue("diverged body");
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

	// -----------------------------------------------------------------------
	// Heal-room release (fan-out idle invariant): the diverged-cold-note heal
	// and the queued-delivery nudge open a TRANSIENT room via reset+enroll.
	// Once the convergence commits (or the delivery settles), the room must be
	// RELEASED — enrollment un-marked (so a future heal can re-handshake) and
	// the doc hibernated. Without the release every healed idle note holds a
	// room for the rest of the session (the e2e fan-out precondition flake,
	// test_cold_send_over_fanout_opens_no_room).
	// -----------------------------------------------------------------------

	test("heal-room release: verified commit for an IDLE note resets enrollment and hibernates the doc", async () => {
		const { engine, enroll, reset, closeDoc, projectedText } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("old base");
		engine.setLiveBoundCheck(() => false);
		engine.importSyncState({
			"owned.md": { hash: fnv1a("old base"), version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "new server body",
			content_hash: "new-hash",
			version: 2,
			mtime: 50,
		} as any);
		// The cold heal opened the transient room (reset+enroll once).
		expect(enroll).toHaveBeenCalledTimes(1);
		expect(reset).toHaveBeenCalledTimes(1);

		projectedText.mockResolvedValue("new server body");
		await engine.commitCrdtConvergence("note-id-1");

		// Release: a SECOND reset (un-mark, so a future heal re-handshakes) and
		// the doc hibernated — the idle note holds no room after convergence.
		expect(reset).toHaveBeenCalledTimes(2);
		expect(reset.mock.calls[1]?.[0]).toBe("note-id-1");
		expect(closeDoc).toHaveBeenCalledWith("note-id-1");
		// No re-enroll — released, not re-opened.
		expect(enroll).toHaveBeenCalledTimes(1);
	});

	test("heal-room release: LIVE-BOUND note keeps its room after commit (editor owns it)", async () => {
		const { engine, reset, closeDoc, projectedText } = crdtEngine();
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
		expect(reset).toHaveBeenCalledTimes(1); // the heal's own reset+enroll

		projectedText.mockResolvedValue("diverged body");
		await engine.commitCrdtConvergence("note-id-1");

		// Live-bound: the room stays — no release reset, no hibernate.
		expect(reset).toHaveBeenCalledTimes(1);
		expect(closeDoc).not.toHaveBeenCalled();
	});

	test("heal-room release: queued-delivery settle releases the nudge room for an idle note", async () => {
		const { engine, reset, closeDoc } = crdtEngine();
		engine.setLiveBoundCheck(() => false);
		await (engine as any).queue.enqueue({
			path: "owned.md",
			action: "upsert",
			timestamp: 1,
			crdt: true,
			noteId: "note-id-1",
		});
		(engine as any).pendingQueueDeliveries.set("note-id-1", { path: "owned.md" });

		await engine.commitCrdtConvergence("note-id-1");

		expect(reset).toHaveBeenCalledWith("note-id-1");
		expect(closeDoc).toHaveBeenCalledWith("note-id-1");
		expect((engine as any).queue.size).toBe(0); // the settle still dequeues
	});

	test("heal-room release: settle after a RENAME re-resolves the path — never closes the doc live-bound at its NEW path", async () => {
		const { engine, reset, closeDoc, map } = crdtEngine();
		// Entry enqueued under the OLD path; the note was renamed and is now
		// OPEN in the editor at the NEW path.
		map.set("renamed.md", "note-id-1"); // NoteIdMap: note-id-1 now lives at renamed.md
		engine.setLiveBoundCheck((p: string) => p === "renamed.md");
		await (engine as any).queue.enqueue({
			path: "owned.md",
			action: "upsert",
			timestamp: 1,
			crdt: true,
			noteId: "note-id-1",
		});
		(engine as any).pendingQueueDeliveries.set("note-id-1", { path: "owned.md" });

		await engine.commitCrdtConvergence("note-id-1");

		// Live-bound at the CURRENT path: the room must survive — releasing on
		// the stale enqueue-time path would closeDoc the editor's live doc.
		expect(reset).not.toHaveBeenCalled();
		expect(closeDoc).not.toHaveBeenCalled();
	});

	// (Removed: "a DEFERRED commit does NOT release the in-flight heal" — the
	// text-verify defer no longer exists in the Relay model. onSynced fires from
	// the provider's syncStep2, so a commit is always for an already-converged
	// doc; the idle-note release path is covered by the "verified commit for an
	// IDLE note resets enrollment and hibernates the doc" test above.)

	test("heal-room release: a frame with nothing staged and nothing queued stays a pure no-op", async () => {
		const { engine, reset, closeDoc } = crdtEngine();
		engine.setLiveBoundCheck(() => false);

		await engine.commitCrdtConvergence("note-id-1");

		expect(reset).not.toHaveBeenCalled();
		expect(closeDoc).not.toHaveBeenCalled();
	});

	test("fix wave 1 (c): commit with nothing staged for the id is a no-op", async () => {
		const { engine } = crdtEngine();
		engine.importSyncState({
			"owned.md": { hash: 1, version: 1, serverHash: "old-hash" },
		});

		await expect(engine.commitCrdtConvergence("never-staged-id")).resolves.toBeUndefined();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("old-hash");
	});

	test("fix wave 7 (a): verified commit + bound buffer already matches the converged doc — no rebind, no nudge", async () => {
		const { engine, projectedText } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		const rebinds: string[] = [];
		engine.setCrdtEditorRebind((p: string) => rebinds.push(p));
		const nudges: string[] = [];
		engine.setCrdtRequestSave((p: string) => nudges.push(p));
		// The editor repainted correctly — its buffer already holds the
		// converged content.
		engine.setCrdtBoundBufferText((p: string) => (p === "owned.md" ? "diverged body" : null));
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

		projectedText.mockResolvedValue("diverged body");
		await engine.commitCrdtConvergence("note-id-1");

		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
		expect(rebinds).toEqual([]);
		expect(nudges).toEqual([]);
	});

	test("fix wave 7 (b): verified commit + STALE bound buffer (phantom binding, #191) — rebinds exactly once, then nudges the save", async () => {
		const { engine, projectedText } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		const rebinds: string[] = [];
		engine.setCrdtEditorRebind((p: string) => rebinds.push(p));
		const nudges: string[] = [];
		engine.setCrdtRequestSave((p: string) => nudges.push(p));
		// The editor's Yjs binding detached (unclean close during a rate-limit
		// window) while isLiveBound stayed true — its buffer never repainted,
		// so it still shows the pre-converge content.
		engine.setCrdtBoundBufferText((p: string) =>
			p === "owned.md" ? "STALE — never repainted" : null,
		);
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

		projectedText.mockResolvedValue("diverged body");
		await engine.commitCrdtConvergence("note-id-1");

		// Convergence still records — the doc itself is fine, only the editor
		// binding was phantom.
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
		expect(rebinds).toEqual(["owned.md"]);
		expect(nudges).toEqual(["owned.md"]);
	});

	test("fix wave 7 (c): the path is no longer live-bound BY COMMIT TIME (editor closed meanwhile) — phantom-binding check never runs", async () => {
		const { engine, projectedText } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		let liveBound = true; // live-bound at staging time — required to stage content
		engine.setLiveBoundCheck((p: string) => liveBound && p === "owned.md");
		const rebinds: string[] = [];
		engine.setCrdtEditorRebind((p: string) => rebinds.push(p));
		const nudges: string[] = [];
		engine.setCrdtRequestSave((p: string) => nudges.push(p));
		const bufferReads: string[] = [];
		engine.setCrdtBoundBufferText((p: string) => {
			bufferReads.push(p);
			return "would-mismatch-if-checked";
		});
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

		// The editor closed between staging and the STEP2 commit — the note is
		// no longer live-bound. The commit itself checks isLiveBound fresh, so
		// this must gate the phantom-binding check off entirely (nothing to
		// rebind — there's no editor left to be phantom).
		liveBound = false;
		projectedText.mockResolvedValue("diverged body");
		await engine.commitCrdtConvergence("note-id-1");

		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
		expect(bufferReads).toEqual([]); // gated by isLiveBound before ever reading the buffer
		expect(rebinds).toEqual([]);
		expect(nudges).toEqual([]);
	});

	test("Relay: converged commit records the staged row on the first onSynced (no text-verify defer)", async () => {
		const { engine, projectedText } = crdtEngine();
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
			content: "the real edit",
			content_hash: "new-hash",
			version: 2,
			seq: 10,
			mtime: 50,
		} as any);

		// Relay model: onSynced fires from the provider's syncStep2 — the doc is
		// ALREADY converged with the server. The old `projectedText === staged.content`
		// gate is gone (it wedged forever on a cosmetic byte diff), so the commit
		// records the staged serverHash/version/seq on the first fire, no matter what
		// the doc happens to project at this instant.
		projectedText.mockResolvedValue("some other concurrent doc state");
		await engine.commitCrdtConvergence("note-id-1");

		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
	});

	test("Relay: converged commit records even if projectedText would throw (it is never read)", async () => {
		const { engine, projectedText } = crdtEngine();
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
			content: "the real edit",
			content_hash: "new-hash",
			version: 2,
			seq: 10,
			mtime: 50,
		} as any);

		// The commit no longer calls projectedText at all, so a dead IDB read can't
		// block convergence — the staged row still records.
		projectedText.mockRejectedValue(new Error("IDB dead"));
		await expect(engine.commitCrdtConvergence("note-id-1")).resolves.toBeUndefined();

		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
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

	test("fix wave 3 (b): equal seq with DIFFERENT content is NOT stale — the hash-aware fence runs the re-handshake (supersedes PR #280's blunt strict-<)", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, seq: 40, version: 1, serverHash: "old-hash" },
		});

		// Equal seq (the backend shares one seq across multiple live updates —
		// crdt_persistence.ex:180 GUARANTEE BOUNDARY) but a DIFFERENT
		// content_hash than stored.serverHash: this row carries content this
		// device never saw (A's concurrent edit merged at the same seq). Under
		// the old `<=` fence it was fence-skipped and A's edit was lost; the
		// hash-aware fence must let it fall through to the divergence leg.
		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "unseen concurrent edit",
			content_hash: "new-hash", // != stored.serverHash "old-hash"
			version: 2,
			seq: 40, // EQUAL to stored.seq, but the content differs
			mtime: 50,
		} as any);

		// The live-bound divergence leg fires the socket re-handshake
		// (socketConverge → fireCrdtReHandshake → crdtEnrollment.reset). Under
		// the OLD strict-`<=` fence this row is skipped as history and reset is
		// NEVER called — so this assertion genuinely discriminates the fix
		// (unlike the old serverHash-unchanged assertion, which held for both
		// the skip AND the stage-only live-bound leg).
		expect(reset).toHaveBeenCalledWith("note-id-1");
	});

	test("fix wave 3 (b2): equal seq with MATCHING content IS still stale — the fix does not over-apply (genuine echo/duplicate)", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, seq: 40, version: 1, serverHash: "dup-hash" },
		});

		// Equal seq AND content_hash equals stored.serverHash — we already hold
		// exactly this content (our own push echoed back). Genuine history: the
		// fence must still skip it, no re-handshake.
		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "content we already have",
			content_hash: "dup-hash", // == stored.serverHash — already held
			version: 2,
			seq: 40,
			mtime: 50,
		} as any);

		expect(reset).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("dup-hash");
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

	test("fix wave 5 defect 1: a seq-bearing row with NO stored.seq is NOT stale, even at equal version (CI run 29920053637: `stale row (seq 33/- v1/1)`)", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		// stored carries NO seq (this device never recorded one for this path
		// yet) but DOES carry version:1 — the wave-3 fence's old condition
		// ("both sides carry seq") fell back to version equality here and
		// wrongly judged the row stale. With no stored.seq there is nothing to
		// be behind of, so a seq-bearing row must never fall back to version.
		engine.importSyncState({
			"owned.md": { hash: 1, version: 1, serverHash: "old-hash" },
		});

		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "the real edit",
			content_hash: "new-hash",
			version: 1, // equal to stored — would mask under the version fallback
			seq: 33,
			mtime: 50,
		} as any);

		// The row carries seq, so it's judged by seq alone (no stored.seq to
		// compare against) — NOT stale, the diverged leg must run.
		expect(reset).toHaveBeenCalledWith("note-id-1");
	});

	test("fix wave 4 (a): CI scenario end-to-end — mapped CRDT note, version-equal seq-ahead row reaches the diverged leg WITHOUT forceOverwrite", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck((p: string) => p === "owned.md");
		engine.importSyncState({
			"owned.md": { hash: 1, seq: 40, version: 1, serverHash: "old-hash" },
		});

		// "owned.md" is mapped to "note-id-1" by crdtEngine()'s harness. The
		// anti-stale guard (src/sync.ts ~5074) now skips only when CRDT owns
		// the body AND a noteId resolves — this row satisfies both, so it
		// reaches the CRDT block's own seq-first staleRow fence directly. No
		// forceOverwrite lever needed (unlike wave 3's tests, written before
		// this fix, which had to dodge the guard to reach the same fence).
		await engine.applyChange({
			path: "owned.md",
			action: "upsert",
			content: "unseen edit",
			content_hash: "new-hash",
			version: 1, // checkpoint-lagged, equal to stored
			seq: 41,
			mtime: 50,
		} as any);

		expect(reset).toHaveBeenCalledWith("note-id-1");
	});

	test("fix wave 4 (b): a non-CRDT note's version-equality is still guarded (legacy path preserved)", async () => {
		const engine = createEngine(); // no setCrdtManager — this.crdt stays null
		const localFile = new TFile("plain.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		engine.importSyncState({
			"plain.md": { hash: fnv1a("body"), version: 1, serverHash: "h1" },
		});

		const applied = await engine.applyChange({
			path: "plain.md",
			action: "upsert",
			content: "server body",
			content_hash: "h2",
			version: 1, // equal — crdtOwnsBody is false, the guard still applies
			mtime: 50,
		} as any);

		expect(applied).toBe(false);
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("fix wave 4 (c2): a CRDT-managed row with NO resolvable noteId is still guarded (the no-noteId raw-write branch found in the safety check stays protected)", async () => {
		const { engine, reset } = crdtEngine();
		const localFile = new TFile("unmapped.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		engine.setLiveBoundCheck(() => false); // cold — would otherwise reach the
		// no-noteId sub-branch (src/sync.ts ~5262-5277) that does a raw
		// content-snapshot write with no Yjs convergence.
		engine.importSyncState({
			"unmapped.md": { hash: 1, version: 1, serverHash: "old-hash" },
		});

		// "unmapped.md" was never map.set() in crdtEngine()'s harness, so
		// noteId resolves to null — crdtOwnsBody && noteId is false and the
		// version guard still applies.
		const applied = await engine.applyChange({
			path: "unmapped.md",
			action: "upsert",
			content: "server body",
			content_hash: "new-hash",
			version: 1, // equal — no resolvable id, guard applies
			mtime: 50,
		} as any);

		expect(applied).toBe(false);
		expect(reset).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("fix wave 1 (f): a fresh content_hash overwrites the staged entry — commit lands the LATEST, not the first", async () => {
		const { engine, projectedText } = crdtEngine();
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

		// Fix wave 5: content-verify against the LATEST staged content ("a" —
		// unchanged by the second applyChange call above).
		projectedText.mockResolvedValue("a");
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
		const { engine, projectedText } = crdtEngine();
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
		// Fix wave 5: content-verify against the staged row's own text ("x").
		projectedText.mockResolvedValue("x");
		await engine.commitCrdtConvergence("note-id-1");

		// A 0 sentinel here would later read as `fnv1a(local) !== 0` = local
		// diverged, spuriously routing a note the user only VIEWED to the
		// conflict flow. Record the real disk hash instead.
		expect(engine.exportSyncState()["owned.md"]?.hash).toBe(fnv1a("actual disk content"));
		expect(engine.exportSyncState()["owned.md"]?.hash).not.toBe(0);
	});

	test("no spurious conflict: a VIEWED-then-cold note with the real hash recorded does NOT hit the conflict flow (#2 outcome)", async () => {
		const { engine, projectedText } = crdtEngine();
		const localFile = new TFile("owned.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		mockApp.vault.getAbstractFileByPath.mockReturnValue(localFile);
		mockApp.vault.cachedRead.mockResolvedValue("viewed content");

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
		// Fix wave 5: content-verify against the staged row's own text ("x").
		projectedText.mockResolvedValue("x");
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

		// Clean local (disk unchanged) → plain backfill, NEVER a drift-copy. A 0
		// sentinel hash would have false-positived localDiverged and written a
		// "(conflict …)" sibling here; the real recorded hash keeps it clean.
		const created = (mockApp.vault.create as any).mock.calls.map((c: unknown[]) => c[0]);
		expect(created.some((p: unknown) => /\(conflict .*\)\.md$/.test(p as string))).toBe(false);
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
