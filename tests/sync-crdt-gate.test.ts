/**
 * Tests: CRDT gate fixes (C1, I1, I2).
 *
 * C1 — legacy down-sync gate for CRDT-managed markdown:
 *   - note_changed/upsert content event for a .md note does NOT call applyChange
 *     / disk-write when this.crdt is set.
 *   - DELETE event for a CRDT-managed .md note STILL processes via the legacy path.
 *   - Attachment upsert event STILL processes via the legacy path.
 *   - applyChange() returns false (no disk write) for markdown when CRDT is active.
 *   - applyChange() delete path still deletes when CRDT is active.
 *   - Cold-start catch-up skips markdown body write when CRDT is active.
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
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Cast engine to access private syncState for test setup. */
function seedSyncState(engine: SyncEngine, path: string, content: string, version?: number): void {
	const state = (
		engine as unknown as { syncState: Map<string, { hash: number; version?: number }> }
	).syncState;
	state.set(path, { hash: fnv1a(content), ...(version !== undefined ? { version } : {}) });
}

/** Mark a note_id as server-confirmed (rest-first fix): pushFile only routes
 *  a note through CRDT once the server is known to have a row for it. Tests
 *  that exercise CRDT routing itself (not the new-note gate) must seed this,
 *  same pattern as seedSyncState above for private test setup. */
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

// ---------------------------------------------------------------------------
// Shared mock infrastructure
// ---------------------------------------------------------------------------

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
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

// Task 6 (note_id-keyed CRDT): production always wires a NoteIdMap alongside
// the CrdtManager, so the pushFile CRDT gate (which now requires a resolved
// note_id, not just a manager) needs one here too.
function createEngine(): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setNoteIdMap(new NoteIdMap());
	return engine;
}

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// C1 — gate legacy down-sync for CRDT-managed markdown
// ---------------------------------------------------------------------------

describe("C1 — handleStreamEvent: CRDT gate for markdown content", () => {
	test("first-delivery upsert with inline content materializes from that content (no getNote)", async () => {
		// A never-seen IDLE CRDT note will never join a room (fan-out isolation),
		// and its live note_yjs_update fan-out is missed if we were offline when it
		// fired (a note created before we connected). Deferring to the slow pull
		// backstop loses the delivery-timing race (e2e test_27 + the broader
		// created-before-connect class), so materialize now from the AUTHORITATIVE
		// broadcast body. Inline content is present, so no getNote round-trip.
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/test.md",
			timestamp: Date.now(),
			id: "id-inline-1",
			content: "# From server",
			title: "test",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		expect(mockApp.vault.create).toHaveBeenCalled();
	});

	test("a KNOWN CRDT note (prior syncState) upsert does NOT re-materialize — CRDT owns the body", async () => {
		// The first-delivery write fires ONLY for a genuinely never-seen note. A
		// note this device already has a baseline for converges via CRDT / the pull
		// path; re-writing it here would double-write the body and could clobber a
		// converged base. Gate: prior syncState present -> skip.
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		seedSyncState(engine, "Notes/known.md", "old body", 3);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/known.md",
			timestamp: Date.now(),
			id: "id-known-1",
			content: "# From server",
			title: "known",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 4,
		});

		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("upsert for an IDLE markdown CRDT note does NOT enroll a room (vault-channel fan-out)", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		// Default isLiveBound is false → the note is idle (not open in the editor).
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/test.md", "Notes/test.md");
		engine.setNoteIdMap(noteIdMap);

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

		// A first delivery materializes room-free (from the inline body) so it
		// appears promptly, but it does NOT enroll a room: enrolling a room per note
		// that received a live edit is the connect storm P2 removes. The live-bound
		// positive case is covered in sync-c1-serverhash.test.ts.
		expect(mockApp.vault.create).toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("brand-new IDLE markdown upsert learns the note_id but does NOT enroll (never-seen, no local mapping)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_id: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/brand-new.md",
			timestamp: Date.now(),
			// The server's note_changed broadcast carries the note_id; this device
			// has never seen the note, so the id can ONLY come from the broadcast.
			id: "id-brand-new",
			content: "# hi",
			title: "brand-new",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// The id is learned from the broadcast so future local edits route through
		// CRDT, and the first delivery materializes room-free from the inline body
		// (a never-seen idle note joins no room and may have missed the fan-out).
		// Still no enrollment for an idle note.
		expect(noteIdMap.get("Notes/brand-new.md")).toBe("id-brand-new");
		expect(mockApp.vault.create).toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("markdown upsert with NO resolvable note_id materializes via legacy apply (not silently dropped)", async () => {
		// Regression for the received-but-not-materialized bug: with CRDT active, a
		// never-seen note whose broadcast carried no id (and no local mapping) hit
		// the C1 skip and was enroll-only — but an id-keyed room cannot be joined
		// without an id, so the note was received and silently never written. It
		// MUST fall through to applyChange, which materializes the carried body.
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		engine.setCrdtEnrollment({ enroll: mock(() => {}) } as any);
		engine.setNoteIdMap(new NoteIdMap());

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/no-id.md",
			timestamp: Date.now(),
			// no id field, no local mapping → cannot participate in a CRDT room
			content: "# body that must land on disk",
			title: "no-id",
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			version: 1,
		});

		// Materialized: applyChange's discovery path wrote the carried body to disk.
		expect(mockApp.vault.create).toHaveBeenCalled();
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

	test("upsert hash-only first-delivery routes to the op-log catch-up — never fetches (Phase E3)", async () => {
		// The prod broadcast is hash-only (serialize_note drops content). A
		// first-delivery idle note has no inline body; the op-log replay rows
		// carry the REAL content, so the event routes to catchupViaSeqReplay
		// instead of a REST getNote fetch (Phase E3: getNote-for-sync deleted).
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/test.md",
			timestamp: Date.now(),
			id: "id-hash-1",
			content_hash: "abc123",
		});

		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(replay).toHaveBeenCalled();
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

	test("a canvas upsert with NO note_id falls through to the op-log catch-up", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		});

		// A canvas upsert carrying no id (and no sidecar mapping) can't key a CRDT
		// room and has no inline body, so it heals via the op-log seq-replay — the
		// same authoritative backstop markdown takes when it has no resolvable id
		// (Phase E3: getNote-for-sync deleted).
		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/board.canvas",
			timestamp: Date.now(),
		});

		expect(replay).toHaveBeenCalled();
	});

	test("a canvas upsert WITH a note_id takes the CRDT branch (id bookkeeping, no legacy getNote) since #306", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "Notes/board.canvas",
			id: "id-board",
			timestamp: Date.now(),
		} as never);

		// CRDT owns canvas now — the id is confirmed and the note enrolled (canvas
		// enrolls even when idle, to pull its Yjs state).
		expect(enroll).toHaveBeenCalledWith("id-board");
	});
});

describe("C1 — applyChange: CRDT gate skips disk write for markdown", () => {
	test("applyChange skips legacy disk write for an ALREADY-LOCAL markdown note (CRDT owns live edits)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		engine.setCrdtEnrollment({ enroll: mock((_p: string) => {}) } as any);
		// Note already exists on disk → CRDT owns its body; the pull must not
		// legacy-write it (only discovery materializes; live edits flow via CRDT).
		(mockApp.vault.getFileByPath as any).mockReturnValue({ path: "Notes/test.md" });

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

	test("applyChange for a canvas note enrolls for Yjs convergence and NEVER writes the vestigial seq-feed content (#306)", async () => {
		const engine = createEngine();
		const enroll = mock((_p: string) => {});
		const applyLocalEdit = mock(async () => null);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll } as any);
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/board.canvas", "id-board");
		engine.setNoteIdMap(noteIdMap);
		// getFileByPath null → discovery. Canvas converges over the Yjs handshake
		// ONLY, so it must enroll (even idle) and must NOT write the vestigial
		// seq-feed `content` (the backend keeps notes.content stale for canvas).

		const result = await engine.applyChange({
			path: "Notes/board.canvas",
			title: "board",
			content: '{"nodes":[{"id":"STALE","type":"text"}],"edges":[]}',
			folder: "Notes",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 1,
			id: "id-board",
		} as never);

		expect(result).toBe(false);
		expect(enroll).toHaveBeenCalledWith("id-board");
		// The vestigial content is NEVER materialized to disk, nor seeded into a doc.
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("applyChange materializes a not-yet-local markdown note WITHOUT enrolling it (cold discovery, room-free)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		// applyChange (Task 6) resolves the note_id via the sidecar before
		// enrolling — seed a mapping for this test's path (the merged /sync/changes
		// feed normally learns this before applyChange runs).
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/discovered.md", "Notes/discovered.md");
		engine.setNoteIdMap(noteIdMap);
		// getFileByPath returns null by default → the note does not exist locally,
		// so this pull is a discovery. The /changes payload already carries the body,
		// so materialize it directly instead of deferring to the CRDT seed-from-REST
		// handshake (which can silently never complete under load — stranding the
		// note invisible; e2e test_10/test_34 rename discovery).

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

		// Materialized from the payload we already hold. A cold (not live-bound)
		// discovered note is NOT enrolled — its body arrived room-free and future
		// updates come over the vault-channel fanout; enrolling every discovered
		// note on connect is the enrollment storm P2 removes.
		expect(result).toBe(false);
		expect(enroll).not.toHaveBeenCalled();
		expect(mockApp.vault.create).toHaveBeenCalled();
		expect((mockApp.vault.create as any).mock.calls[0][1]).toContain("remote content");
	});

	test("applyChange does NOT enroll an existing cold (not live-bound) markdown note on catch-up", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async () => {}) } as any);
		const enroll = mock((_p: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/have.md", "Notes/have.md");
		engine.setNoteIdMap(noteIdMap);
		// The note already exists locally → CRDT owns its body (no legacy write).
		// It is NOT live-bound, so we do NOT open a STEP1 room on the pull feed:
		// a cold note receives via the channel fanout + coldReceive, and sends
		// room-free. (A live-bound note WOULD re-handshake — see sync-catchup.)
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

		// No legacy disk write (CRDT owns the body), and no STEP1 for a cold note.
		expect(result).toBe(false);
		expect(enroll).not.toHaveBeenCalled();
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
		// rest-first fix: CRDT routing requires the note to already be
		// server-confirmed. This test is about the manager-swap/destroy
		// behavior, not the new-note gate, so seed a deterministic id + confirm it.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		engine.setNoteIdMap(noteIdMap);
		markConfirmed(engine, "id-note");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		expect(newApplyLocalEdit).toHaveBeenCalledTimes(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("after teardown (crdtManager=null on engine), a non-CRDT note still REST-pushes", async () => {
		const engine = createEngine();

		// Wire a CRDT manager
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		// Simulate teardown: remove CRDT manager (what setupNoteStream now does)
		engine.setCrdtManager(null as any);

		// A note OUTSIDE the CRDT domain still takes the kept LWW REST path. Since
		// #306 both md and canvas are CRDT-sole, so the only REST note left is an
		// OVERSIZED one (> the CRDT transport cap) — use that for the regression.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
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
	test("without CRDT manager set, a legacy-path note modify goes through pushNote (not dropped)", async () => {
		const engine = createEngine();
		// No setCrdtManager call — simulates vaultId=null path where CRDT is never wired.
		// Since #306 both md and canvas are CRDT-eligible; the legacy REST push now
		// only serves OVERSIZED notes (> the CRDT transport cap), so use one here.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
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
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		engine.setNoteIdMap(noteIdMap);
		markConfirmed(engine, "id-note");

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
	test("with crdt NOT connected (manager null), an oversized note edit goes through pushNote (legacy)", async () => {
		const engine = createEngine();
		// Simulates: vaultId known but crdt: topic join has not been acknowledged yet
		// (or backend errored on join) — manager is null, legacy path active. Since
		// #306 the legacy REST push only serves oversized notes (> CRDT cap).
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
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
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		const manager = { applyLocalEdit } as any;

		// Before join: manager not set
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		// onCrdtJoined fires (crdt: topic join succeeded)
		engine.setCrdtManager(manager);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		engine.setNoteIdMap(noteIdMap);
		markConfirmed(engine, "id-note");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));

		// CRDT path active — applyLocalEdit called, pushNote NOT called
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("after disconnect (setCrdtManager(null)), non-CRDT note edits revert to pushNote (legacy)", async () => {
		const engine = createEngine();

		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		// Simulate channel disconnect: clear manager (mirrors onStatusChange false handler)
		engine.setCrdtManager(null);

		// Since #306 the legacy REST push only serves oversized notes (> CRDT cap).
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);
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

describe("flushFromCrdt — idempotent: skips rewrite when disk already matches", () => {
	test("does NOT call vault.modify when on-disk content already equals the flush content", async () => {
		const engine = createEngine();
		const existingFile = new TFile("Notes/target.md");
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(existingFile);
		// Disk already holds exactly what we're about to flush (identical re-push).
		(mockApp.vault.cachedRead as any).mockResolvedValue("# Same\n\nbody");

		await engine.flushFromCrdt("Notes/target.md", "# Same\n\nbody");

		// No redundant write → no mtime bump, no modify echo (e2e test_78).
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("DOES call vault.modify when on-disk content differs", async () => {
		const engine = createEngine();
		const existingFile = new TFile("Notes/target.md");
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(existingFile);
		(mockApp.vault.cachedRead as any).mockResolvedValue("# Old\n\nbody");

		await engine.flushFromCrdt("Notes/target.md", "# New\n\nbody");

		expect(mockApp.vault.modify).toHaveBeenCalledWith(existingFile, "# New\n\nbody");
	});
});

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

		// Now unblock and verify handleModify proceeds (not echo-suppressed).
		// Since #306 both md and canvas are CRDT-sole; the legacy REST path (where
		// recentlyFlushed matters) only serves oversized notes, so a non-suppressed
		// edit is observable as a pushNote call on an oversized note.
		engine.setSyncBlocked(false);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);

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
		// No CRDT manager → projectedText falls back to "" → materializes empty.
		engine.setCrdtManager(null as any);

		await engine.materializeEmptyDiscovered("Notes/empty.md");

		// Should create the file (empty content)
		expect(mockApp.vault.create).toHaveBeenCalled();
	});
});

// The former "transient-empty STEP2 race guard" describe block (a REST getNote
// cross-check that distrusted an empty STEP2) was removed with the #310
// race-closer: backend #1094 now seeds the room from notes.content server-side,
// so materializeEmptyDiscovered materializes the doc projection directly. Its
// convergence is covered end-to-end by e2e test_38/test_43 against the
// #1094-in-prod backend.

describe("materializeEmptyDiscovered — reads the CRDT doc via note_id, not path", () => {
	test("projectedText is called with the note_id, never the path (no path-keyed ghost doc)", async () => {
		const engine = createEngine();
		(mockApp.vault.getAbstractFileByPath as any).mockReturnValue(null);
		const projectedText = mock(async () => "");
		engine.setCrdtManager({ projectedText } as any);

		await engine.materializeEmptyDiscovered("Notes/idkeyed.md", "note-abc-123");

		expect(projectedText).toHaveBeenCalledWith("note-abc-123");
		expect(projectedText).not.toHaveBeenCalledWith("Notes/idkeyed.md");
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

// ---------------------------------------------------------------------------
// Sign-out gate — flushQueue must honor syncBlocked
//
// On sign-out the engine's WS/CRDT stack is torn down, but a queued edit made
// while signed in can still flush on offline→online health-check recovery
// (goOnline → flushQueue). Without gating flush on syncBlocked, that push goes
// out with an empty bearer and spams the server with auth errors. The gate must
// hold the queue until auth returns.
// ---------------------------------------------------------------------------

describe("sign-out gate — flushQueue respects syncBlocked", () => {
	test("does NOT push queued entries while blocked; keeps them queued", async () => {
		(mockApi.deleteNote as any).mockClear();
		const engine = createEngine();
		await (
			engine as unknown as { queue: { enqueue: (e: any) => Promise<void> } }
		).queue.enqueue({
			path: "Notes/old.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});

		engine.setSyncBlocked(true);
		const flushed = await engine.flushQueue();

		expect(flushed).toBe(0);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		expect((engine as unknown as { queue: { size: number } }).queue.size).toBe(1);
	});

	test("drains normally once unblocked", async () => {
		(mockApi.deleteNote as any).mockClear();
		const engine = createEngine();
		await (
			engine as unknown as { queue: { enqueue: (e: any) => Promise<void> } }
		).queue.enqueue({
			path: "Notes/old.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});

		engine.setSyncBlocked(false);
		const flushed = await engine.flushQueue();

		expect(mockApi.deleteNote).toHaveBeenCalledTimes(1);
		expect(flushed).toBe(1);
	});

	test("halts an in-flight drain when the gate closes mid-drain", async () => {
		const engine = createEngine();
		const q = (
			engine as unknown as {
				queue: { enqueue: (e: any) => Promise<void>; size: number };
			}
		).queue;
		await q.enqueue({
			path: "Notes/a.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});
		await q.enqueue({
			path: "Notes/b.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});

		// The first delete signs the user out; the second must NOT go out with the
		// now-empty bearer — the per-entry gate check must break the drain.
		(mockApi.deleteNote as any).mockReset().mockImplementation(async () => {
			engine.setSyncBlocked(true);
			return { deleted: true, path: "" };
		});

		const flushed = await engine.flushQueue();

		expect(mockApi.deleteNote).toHaveBeenCalledTimes(1);
		expect(flushed).toBe(1);
		expect(q.size).toBe(1);
	});
});
