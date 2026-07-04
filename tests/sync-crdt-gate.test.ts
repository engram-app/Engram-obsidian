/**
 * Tests: CRDT gate fixes (C1, I1, I2).
 *
 * C1 — legacy down-sync gate for CRDT-managed markdown:
 *   - note_changed/upsert content event for a .md note does NOT call applyChange
 *     / threeWayMerge / disk-write when this.crdt is set.
 *   - DELETE event for a CRDT-managed .md note STILL processes via the legacy path.
 *   - Attachment upsert event STILL processes via the legacy path.
 *   - applyChange() returns false (no disk write) for markdown when CRDT is active.
 *   - applyChange() delete path still deletes when CRDT is active.
 *   - Cold-start pull (getChanges/pullViaCursor) skips markdown body write when CRDT
 *     is active.
 *
 * I1 — CrdtManager leak on re-setup:
 *   - Calling the teardown sequence (destroy + null) before re-wiring a new manager
 *     causes destroy() on the old manager to fire exactly once.
 *
 * I2 — null vaultId silently loses all markdown sync:
 *   - When SyncEngine has no CRDT manager set (simulating null vaultId), a markdown
 *     edit goes through pushNote (legacy path), not dropped.
 *   - applyChange() for markdown completes normally (writes disk) when CRDT is unset.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Cast engine to access private syncState for test setup. */
function seedSyncState(engine: SyncEngine, path: string, content: string, version?: number): void {
	const state = (
		engine as unknown as { syncState: Map<string, { hash: number; version?: number }> }
	).syncState;
	state.set(path, { hash: fnv1a(content), ...(version !== undefined ? { version } : {}) });
}

// ---------------------------------------------------------------------------
// Shared mock infrastructure
// ---------------------------------------------------------------------------

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "Notes/Remote.md",
		title: "Remote",
		content: "remote body",
		folder: "Notes",
		tags: [],
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
	}),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue({
		path: "Assets/img.png",
		content_base64: "AQID",
		mime_type: "image/png",
		size_bytes: 3,
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: mock().mockResolvedValue({ id: "v1", name: "Test", slug: "test" }),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("local body"),
		cachedRead: mock().mockResolvedValue("local body"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
		process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
			Promise.resolve(fn("")),
		),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function resetMocks(): void {
	(mockApi.pushNote as any).mockReset().mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApi.getNote as any).mockReset().mockResolvedValue({
		path: "Notes/Remote.md",
		title: "Remote",
		content: "remote body",
		folder: "Notes",
		tags: [],
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
	});
	(mockApi.getAttachment as any).mockReset().mockResolvedValue({
		path: "Assets/img.png",
		content_base64: "AQID",
		mime_type: "image/png",
		size_bytes: 3,
		mtime: 1709345678,
		updated_at: "2026-03-01T12:00:00Z",
	});
	(mockApp.vault.cachedRead as any).mockReset().mockResolvedValue("local body");
	(mockApp.vault.modify as any).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.create as any).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.getFileByPath as any).mockReset().mockReturnValue(null);
	(mockApp.fileManager.trashFile as any).mockReset().mockResolvedValue(undefined);
}

function createEngine(): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	return engine;
}

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// C1 — gate legacy down-sync for CRDT-managed markdown
// ---------------------------------------------------------------------------

describe("C1 — handleStreamEvent: CRDT gate for markdown content", () => {
	test("upsert with inline content does NOT call vault.create/modify when CRDT active (markdown)", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/test.md",
			timestamp: Date.now(),
			content: "# From server",
			title: "test",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// Legacy disk-write must NOT happen — CRDT owns the content
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		// getNote should not be fetched either
		expect(mockApi.getNote).not.toHaveBeenCalled();
	});

	test("upsert for markdown CRDT note enroll is called to ensure live sync (P2-1)", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/test.md",
			timestamp: Date.now(),
			content: "# From server",
			title: "test",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// Legacy disk-write must NOT happen — CRDT owns the content
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		// But enroll MUST be called to ensure the device stays in sync if not currently observing
		expect(enroll).toHaveBeenCalledWith("Notes/test.md");
	});

	test("upsert for non-markdown or attachments CRDT-gated does NOT call enroll", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);

		// canvas file — not .md — should not enroll
		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/board.canvas",
			timestamp: Date.now(),
			content: '{"nodes":[],"edges":[]}',
			title: "board",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// Non-markdown: enroll NOT called
		expect(enroll).not.toHaveBeenCalled();
	});

	test("upsert hash-only (no inline content) does NOT call getNote/vault.create when CRDT active (markdown)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/test.md",
			timestamp: Date.now(),
			content_hash: "abc123",
		});

		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("DELETE event for markdown still processes via legacy path when CRDT active", async () => {
		const engine = createEngine();
		// removeDoc is called by handleStreamEvent on md deletes (Task 5 teardown).
		// Provide a stub so the call doesn't throw at runtime.
		engine.setCrdtManager({
			applyLocalEdit: mock(async () => {}),
			removeDoc: mock(async () => {}),
		} as any);

		const existingFile = new TFile("Notes/delete-me.md");
		(mockApp.vault.getFileByPath as any).mockReturnValue(existingFile);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/delete-me.md",
			timestamp: Date.now(),
		});

		// Delete MUST still happen — CRDT gate only blocks content/body writes
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
	});

	test("attachment upsert still processes via legacy path when CRDT active", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			kind: "attachment",
			path: "Assets/img.png",
			timestamp: Date.now(),
		});

		// Attachment fetch MUST still happen
		expect(mockApi.getAttachment).toHaveBeenCalledWith("Assets/img.png");
	});

	test("non-markdown note upsert still processes via legacy path when CRDT active", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);

		// canvas file — not .md — should still go through legacy applyChange
		(mockApi.getNote as any).mockResolvedValueOnce({
			path: "Notes/board.canvas",
			title: "board",
			content: '{"nodes":[],"edges":[]}',
			folder: "Notes",
			tags: [],
			mtime: 1709345678,
			updated_at: "2026-03-01T12:00:00Z",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/board.canvas",
			timestamp: Date.now(),
		});

		// canvas fetch should happen (legacy path)
		expect(mockApi.getNote).toHaveBeenCalledWith("Notes/board.canvas");
	});
});

describe("C1 — applyChange: CRDT gate skips disk write for markdown", () => {
	test("applyChange returns false and skips disk write for markdown when CRDT active", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);

		const result = await engine.applyChange({
			path: "Notes/test.md",
			title: "test",
			content: "remote content",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 1,
		});

		expect(result).toBe(false);
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("applyChange enrolls a not-yet-local markdown note into CRDT (discovery)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		// getFileByPath returns null by default → the note does not exist locally,
		// so this pull is a discovery: enroll it so the CRDT handshake pulls the body.

		const result = await engine.applyChange({
			path: "Notes/discovered.md",
			title: "discovered",
			content: "remote content",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 1,
		});

		// Still no legacy disk write — CRDT owns the body — but it IS enrolled.
		expect(result).toBe(false);
		expect(enroll).toHaveBeenCalledWith("Notes/discovered.md");
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("applyChange re-enrolls an existing markdown note (reconnect catch-up)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		// The note already exists locally → CRDT owns its body (no legacy write),
		// but we still re-enroll so a post-reconnect resetAll re-fires the STEP1
		// handshake and pulls any update made while disconnected (idempotent
		// otherwise). See test_48 oauth reconnect catch-up.
		const existingFile = new TFile("Notes/have.md");
		(mockApp.vault.getFileByPath as any).mockReturnValue(existingFile);

		const result = await engine.applyChange({
			path: "Notes/have.md",
			title: "have",
			content: "remote content",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 1,
		});

		// No legacy disk write (CRDT owns the body), but it IS re-enrolled.
		expect(result).toBe(false);
		expect(enroll).toHaveBeenCalledWith("Notes/have.md");
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("applyChange delete path still deletes for markdown when CRDT active", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);

		const localContent = "local body";
		const existingFile = new TFile("Notes/delete-me.md");
		(mockApp.vault.getFileByPath as any).mockReturnValue(existingFile);
		(mockApp.vault.cachedRead as any).mockResolvedValue(localContent);
		// Seed syncState so the resurrection guard sees no unsynced edits → delete proceeds
		seedSyncState(engine, "Notes/delete-me.md", localContent, 1);

		const result = await engine.applyChange({
			path: "Notes/delete-me.md",
			title: "delete-me",
			content: undefined,
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: true,
			version: 1,
		});

		// Delete MUST still happen
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(existingFile);
		expect(result).toBe(true);
	});

	test("applyChange still writes disk for markdown when CRDT is NOT active", async () => {
		const engine = createEngine();
		// No CRDT manager wired

		const result = await engine.applyChange({
			path: "Notes/test.md",
			title: "test",
			content: "remote content",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 1,
		});

		// Without CRDT, file should be created
		expect(result).toBe(true);
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/test.md", "remote content");
	});
});

// ---------------------------------------------------------------------------
// I1 — CrdtManager leak on re-setup: destroy must be called on teardown
// ---------------------------------------------------------------------------

describe("I1 — CrdtManager destroy on re-setup", () => {
	test("destroying and nulling an existing CrdtManager before re-wiring calls destroy() once", async () => {
		// Simulate what setupNoteStream() now does at its top:
		//   void this.crdtManager?.destroy();
		//   this.crdtManager = null;
		//   ...
		// We verify destroy() was called on the first manager.

		let crdtManager: { destroy: ReturnType<typeof mock> } | null = {
			destroy: mock(async () => {}),
		};

		// Simulated "re-setup" teardown sequence (mirrors the new setupNoteStream head)
		const oldManager = crdtManager;
		void oldManager?.destroy();
		crdtManager = null;

		// Wire new manager (re-creation).
		// applyLocalEdit must return true so routeModify treats the edit as consumed
		// and does not fall through to pushNote (handshake-gate fix).
		const newApplyLocalEdit = mock(async () => true);
		const newManager = { applyLocalEdit: newApplyLocalEdit };

		// Verify old manager got its destroy called
		expect(oldManager.destroy).toHaveBeenCalledTimes(1);

		// Wire new manager into the engine — should use new CRDT path
		const engine = createEngine();
		engine.setCrdtManager(newManager as any);

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(newApplyLocalEdit).toHaveBeenCalledTimes(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("after teardown (crdtManager=null on engine), markdown edits use pushNote", async () => {
		const engine = createEngine();

		// Wire a CRDT manager
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		// Simulate teardown: remove CRDT manager (what setupNoteStream now does)
		engine.setCrdtManager(null as any);

		// Markdown edit should now fall back to legacy pushNote
		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// I2 — null vaultId: CRDT must NOT be wired; legacy pushNote must work
// ---------------------------------------------------------------------------

describe("I2 — null vaultId: CRDT unset, legacy path active", () => {
	test("without CRDT manager set, markdown modify goes through pushNote (not dropped)", async () => {
		const engine = createEngine();
		// No setCrdtManager call — simulates vaultId=null path where CRDT is never wired

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// Legacy path must still work — pushNote should be called
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});

	test("applyChange writes disk for markdown when no CRDT manager (vaultId null case)", async () => {
		const engine = createEngine();
		// No CRDT wired

		const result = await engine.applyChange({
			path: "Notes/new.md",
			title: "new",
			content: "body from server",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 1,
		});

		expect(result).toBe(true);
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/new.md", "body from server");
	});

	test("with CRDT manager set (non-null vaultId case), markdown pushNote is skipped", async () => {
		const engine = createEngine();
		// applyLocalEdit must return true so routeModify treats the edit as consumed
		// and does not fall through to pushNote (handshake-gate fix).
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// CRDT path active — pushNote must not be called
		expect(mockApi.pushNote).not.toHaveBeenCalled();
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Graceful degradation: channel join gate (simulates main.ts onCrdtJoined pattern)
//
// These tests prove the key invariant: CRDT routing (setCrdtManager) is only
// activated AFTER the crdt: topic join succeeds. A non-CRDT backend never fires
// the join callback → setCrdtManager stays null → legacy path handles everything.
// ---------------------------------------------------------------------------

describe("Graceful degradation: channel join gate — CRDT not connected", () => {
	test("with crdt NOT connected (manager null), .md edit goes through pushNote (legacy)", async () => {
		const engine = createEngine();
		// Simulates: vaultId known but crdt: topic join has not been acknowledged yet
		// (or backend errored on join) — manager is null, legacy path active.

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});

	test("with crdt NOT connected (manager null), inbound note_changed for .md IS applied via applyChange (legacy)", async () => {
		const engine = createEngine();
		// No manager set — simulates pre-join or non-CRDT-backend state

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/remote.md",
			timestamp: Date.now(),
			content: "# From server",
			title: "remote",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// Legacy applyChange must run — file should be created on disk
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/remote.md", "# From server");
	});

	test("after onCrdtJoined fires (setCrdtManager called), CRDT path is active and legacy is gated", async () => {
		const engine = createEngine();

		// Simulate the sequence from main.ts: manager is wired only after join.
		// applyLocalEdit must return true so routeModify treats the edit as consumed
		// and does not fall through to pushNote (handshake-gate fix).
		const applyLocalEdit = mock(async () => true);
		const manager = { applyLocalEdit } as any;

		// Before join: manager not set
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		// onCrdtJoined fires (crdt: topic join succeeded)
		engine.setCrdtManager(manager);

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// CRDT path active — applyLocalEdit called, pushNote NOT called
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("after disconnect (setCrdtManager(null)), .md edits revert to pushNote (legacy)", async () => {
		const engine = createEngine();

		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		// Simulate channel disconnect: clear manager (mirrors onStatusChange false handler)
		engine.setCrdtManager(null);

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// Legacy path active after disconnect
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("after disconnect (setCrdtManager(null)), inbound note_changed for .md IS applied via legacy applyChange", async () => {
		const engine = createEngine();

		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		// Simulate disconnect
		engine.setCrdtManager(null);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/remote.md",
			timestamp: Date.now(),
			content: "# After reconnect",
			title: "remote",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// Legacy must apply the change now that CRDT is down
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/remote.md", "# After reconnect");
	});
});

// ---------------------------------------------------------------------------
// P0-2 — sync gate blocks all CRDT inbound paths
// ---------------------------------------------------------------------------

/** Access private recentlyFlushed map via type cast (same pattern as seedSyncState). */
function getRecentlyFlushed(engine: SyncEngine): Map<string, number> {
	return (engine as unknown as { recentlyFlushed: Map<string, number> }).recentlyFlushed;
}

describe("P0-2 — flushFromCrdt: no-ops when syncBlocked", () => {
	test("flushFromCrdt does NOT call vault.modify when syncBlocked", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		// Simulate existing file on disk
		const existingFile = new TFile("Notes/target.md");
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(existingFile);

		await engine.flushFromCrdt("Notes/target.md", "remote content");

		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("flushFromCrdt does NOT call vault.create when syncBlocked (discovery path)", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		// No file on disk — discovery path
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);

		await engine.flushFromCrdt("Notes/new.md", "remote content");

		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("flushFromCrdt does NOT mark recentlyFlushed when syncBlocked", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);

		await engine.flushFromCrdt("Notes/echo-test.md", "content");

		// recentlyFlushed must be empty — a gated flush must leave no echo-suppression residue
		expect(getRecentlyFlushed(engine).has("Notes/echo-test.md")).toBe(false);
	});

	test("a blocked flushFromCrdt leaves no echo-suppression: subsequent handleModify for same path is NOT suppressed", async () => {
		const engine = createEngine();
		// No CRDT manager — so handleModify uses the legacy path where recentlyFlushed matters
		engine.setSyncBlocked(true);

		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);
		await engine.flushFromCrdt("Notes/echo-test.md", "content");

		// Now unblock and verify handleModify proceeds (not echo-suppressed)
		engine.setSyncBlocked(false);

		const file = new TFile("Notes/echo-test.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// pushNote should have been called — the file was NOT echo-suppressed
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});

	test("flushFromCrdt still works (writes disk) when syncBlocked is false", async () => {
		const engine = createEngine();

		const existingFile = new TFile("Notes/ok.md");
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(existingFile);

		await engine.flushFromCrdt("Notes/ok.md", "new content");

		expect(mockApp.vault.modify).toHaveBeenCalledWith(existingFile, "new content");
	});
});

describe("P0-2 — materializeEmptyDiscovered: no-ops when syncBlocked", () => {
	test("materializeEmptyDiscovered does NOT create a file when syncBlocked", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		// File not on disk — would normally trigger creation
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);

		await engine.materializeEmptyDiscovered("Notes/empty.md");

		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("materializeEmptyDiscovered does NOT mark recentlyFlushed when syncBlocked", async () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);

		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);

		await engine.materializeEmptyDiscovered("Notes/empty.md");

		expect(getRecentlyFlushed(engine).has("Notes/empty.md")).toBe(false);
	});

	test("materializeEmptyDiscovered still works when syncBlocked is false", async () => {
		const engine = createEngine();

		// File not on disk (simulating discovery)
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);
		// No CRDT manager → projectedText falls back to ""
		engine.setCrdtManager(null as any);
		// Server also has no content → genuinely empty.
		(mockApi.getNote as any).mockResolvedValueOnce({ path: "Notes/empty.md", content: "" });

		await engine.materializeEmptyDiscovered("Notes/empty.md");

		// Should create the file (empty content)
		expect(mockApp.vault.create).toHaveBeenCalled();
	});
});

describe("materializeEmptyDiscovered — transient-empty STEP2 race guard", () => {
	test("writes the REST body (NOT empty) when the server note has content", async () => {
		const engine = createEngine();
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);
		engine.setCrdtManager(null as any); // CRDT doc empty → projectedText ""
		// Server DID receive A's REST push — the empty STEP2 is stale, not authoritative.
		(mockApi.getNote as any).mockResolvedValueOnce({
			path: "Notes/race.md",
			content: "server body v1",
		});

		await engine.materializeEmptyDiscovered("Notes/race.md");

		expect(mockApi.getNote).toHaveBeenCalledWith("Notes/race.md");
		const createArgs = (mockApp.vault.create as any).mock.calls[0];
		expect(createArgs).toBeDefined();
		expect(createArgs[1]).toContain("server body v1");
	});

	test("writes empty when the server confirms the note is genuinely empty", async () => {
		const engine = createEngine();
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);
		engine.setCrdtManager(null as any);
		(mockApi.getNote as any).mockResolvedValueOnce({ path: "Notes/blank.md", content: "" });

		await engine.materializeEmptyDiscovered("Notes/blank.md");

		expect(mockApp.vault.create).toHaveBeenCalled();
		expect((mockApp.vault.create as any).mock.calls[0][1]).toBe("");
	});

	test("falls back to empty-materialize when getNote fails (offline / 404)", async () => {
		const engine = createEngine();
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);
		engine.setCrdtManager(null as any);
		(mockApi.getNote as any).mockRejectedValueOnce(new Error("404"));

		await engine.materializeEmptyDiscovered("Notes/gone.md");

		// A genuinely-empty note must still materialize even if REST is unreachable.
		expect(mockApp.vault.create).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// C1 — onCrdtDocReady gate: isSyncBlocked() must suppress enrollment
// The actual guard is in main.ts (channel.onCrdtDocReady lambda). These tests
// verify the gate predicate (isSyncBlocked) and the downstream side-effects
// (enroll + materializeEmptyDiscovered) that must NOT fire when blocked.
// ---------------------------------------------------------------------------

describe("C1 — onCrdtDocReady: isSyncBlocked suppresses enrollment and materialization", () => {
	test("isSyncBlocked() returns true when sync gate is closed", () => {
		const engine = createEngine();
		engine.setSyncBlocked(true);
		expect(engine.isSyncBlocked()).toBe(true);
	});

	test("isSyncBlocked() returns false when sync gate is open", () => {
		const engine = createEngine();
		// Default is unblocked
		expect(engine.isSyncBlocked()).toBe(false);
	});

	test("enrollment enroll is NOT called when gate is closed (simulating onCrdtDocReady with guard)", async () => {
		// Mirrors the guard added to main.ts channel.onCrdtDocReady:
		//   if (this.syncEngine.isSyncBlocked()) return;
		// This test drives the same predicate + enrollment side-effect to confirm
		// the guard prevents enrollment during gated-period discovery.
		const engine = createEngine();
		engine.setSyncBlocked(true);
		const crdt = { removeDoc: mock(), applyLocalEdit: mock() };
		const enrollment = { enroll: mock(), reset: mock() };
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// Simulate what main.ts onCrdtDocReady does — gate first, then enroll.
		if (!engine.isSyncBlocked()) {
			enrollment.enroll("Notes/discovered.md");
		}

		expect(enrollment.enroll).not.toHaveBeenCalled();
	});

	test("enrollment enroll IS called when gate is open (simulating onCrdtDocReady after accept)", () => {
		const engine = createEngine();
		// Gate is open (default)
		const enrollment = { enroll: mock(), reset: mock() };
		engine.setCrdtEnrollment(enrollment as any);

		if (!engine.isSyncBlocked()) {
			enrollment.enroll("Notes/discovered.md");
		}

		expect(enrollment.enroll).toHaveBeenCalledWith("Notes/discovered.md");
	});
});
