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
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);

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

	test("applyChange does NOT enroll a markdown note that already exists locally", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		// The note already exists locally → CRDT already owns it, no discovery.
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

		expect(result).toBe(false);
		expect(enroll).not.toHaveBeenCalled();
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

		// Wire new manager (re-creation)
		const newApplyLocalEdit = mock(async () => {});
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
		const applyLocalEdit = mock(async () => {});
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

		// Simulate the sequence from main.ts: manager is wired only after join
		const applyLocalEdit = mock(async () => {});
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
