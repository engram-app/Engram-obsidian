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
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
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

function flush(ms = 50): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function manifestWith(notes: Array<{ id: string; path: string; content_hash: string }>) {
	(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValue({
		notes,
		attachments: [],
		total_notes: notes.length,
		total_attachments: 0,
		change_seq: 1,
	});
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 });
	(mockApi.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
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

describe("base_hash on pushes (CAS against the v0.5.642 backend gate)", () => {
	test("pushFile declares the last-synced serverHash as base_hash", async () => {
		const engine = createEngine();
		engine.importSyncState({
			"note.md": { hash: 123, version: 3, serverHash: "srv-hash-abc" },
		});

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		// pushNote(path, content, mtime, version?, clientId?, baseHash?)
		expect(call[5]).toBe("srv-hash-abc");
	});

	test("a note with no prior server state sends NO base_hash (create path)", async () => {
		const engine = createEngine();

		const file = new TFile("fresh.md");
		engine.handleModify(file);
		await flush();

		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		expect(call.length).toBeLessThanOrEqual(5);
	});

	test("a base_hash-induced 409 routes into the existing conflict flow (keep-remote default)", async () => {
		const engine = createEngine();
		engine.importSyncState({
			"note.md": { hash: 123, version: 3, serverHash: "stale-base" },
		});
		const localFile = new TFile("note.md");
		mockApp.vault.getFileByPath.mockReturnValue(localFile);

		// The CAS gate refuses the stale push with the current server note.
		(mockApi.pushNote as ReturnType<typeof mock>).mockReset().mockResolvedValue({
			conflict: true,
			server_note: {
				id: "sid",
				path: "note.md",
				content: "server content the client never saw",
				content_hash: "srv-current",
				version: 7,
				mtime: 99,
			},
		});

		engine.handleModify(localFile);
		await flush();

		// Default ("auto") resolution: the server content the client never saw
		// is preserved as a conflict-copy file — NOT silently deleted. That is
		// the whole point of the CAS gate: without base_hash the push would
		// have merged as a deletion with no trace.
		expect(mockApp.vault.create).toHaveBeenCalled();
		const created = (mockApp.vault.create as ReturnType<typeof mock>).mock.calls[0];
		expect(created[0]).toContain("conflict");
		expect(created[1]).toBe("server content the client never saw");
	});
});

describe("pull un-masking — CRDT-owned local note must catch up from /changes", () => {
	function crdtEngine(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
		const engine = createEngine(overrides);
		engine.setCrdtManager({ applyLocalEdit: mock().mockReturnValue(true) } as any);
		const map = new NoteIdMap();
		map.set("owned.md", "note-id-1");
		engine.setNoteIdMap(map);
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset });
		return { engine, enroll, reset, map };
	}

	test("diverged hashes: the pulled body is written to disk and serverHash converges", async () => {
		const { engine, enroll } = crdtEngine();
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

		// The body materializes (the pull is the safety net for a missed
		// announce) and the stored serverHash converges so dedupe recognizes it.
		expect(mockApp.vault.modify).toHaveBeenCalledWith(
			localFile,
			"authoritative body the announce never delivered",
		);
		expect(engine.exportSyncState()["owned.md"]?.serverHash).toBe("new-hash");
		// Enrollment still fires (live routing unaffected).
		expect(enroll).toHaveBeenCalledWith("note-id-1");
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

	test("diverged + live-bound: no disk write — forced re-handshake instead", async () => {
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
	});

	test("converged hashes: no disk write (CRDT stays the single live writer)", async () => {
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
		expect(enroll).toHaveBeenCalledWith("note-id-1");
	});
});

describe("bind-time convergence — verifyConvergenceOnOpen", () => {
	test("manifest hash differs from last-synced serverHash → forced re-handshake", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock().mockReturnValue(true) } as any);
		const map = new NoteIdMap();
		map.set("open-me.md", "note-id-9");
		engine.setNoteIdMap(map);
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset });
		engine.importSyncState({
			"open-me.md": { hash: 1, version: 1, serverHash: "what-i-last-saw" },
		});
		manifestWith([{ id: "note-id-9", path: "open-me.md", content_hash: "server-moved-on" }]);
		// Prime the manifest snapshot (reconcile caches owners + hashes).
		await engine.reconcileNoteIdMapFromManifest();

		await engine.verifyConvergenceOnOpen("open-me.md");

		// Divergence → force a fresh CRDT handshake: reset lifts the
		// once-per-session guard, enroll re-fires STEP1.
		expect(reset).toHaveBeenCalledWith("note-id-9");
		expect(enroll).toHaveBeenCalledWith("note-id-9");
	});

	test("hashes agree → no re-handshake", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock().mockReturnValue(true) } as any);
		const map = new NoteIdMap();
		map.set("open-me.md", "note-id-9");
		engine.setNoteIdMap(map);
		const enroll = mock();
		const reset = mock();
		engine.setCrdtEnrollment({ enroll, reset });
		engine.importSyncState({
			"open-me.md": { hash: 1, version: 1, serverHash: "same" },
		});
		manifestWith([{ id: "note-id-9", path: "open-me.md", content_hash: "same" }]);
		await engine.reconcileNoteIdMapFromManifest();

		await engine.verifyConvergenceOnOpen("open-me.md");

		expect(reset).not.toHaveBeenCalled();
	});
});
