/**
 * Tests: CRDT routing in SyncEngine.
 * - markdown modify → CrdtManager.applyLocalEdit, NOT api.pushNote
 * - binary modify → legacy path (NOT CrdtManager)
 * - flushFromCrdt → vault.modify + echo suppression
 * - onFlushToDisk echo: remote-applied disk write does not re-enqueue a local push
 * - offline CRDT capture: consumed md edits do NOT enter the legacy offline queue
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import {
	CRDT_HEAD_CREATED,
	fnv1a,
	MAX_CRDT_NOTE_BYTES,
	reconcileColdStart,
	routeModify,
	SyncEngine,
} from "../src/sync";
import type { SyncedFileTable } from "../src/synced-file";
import { DEFAULT_SETTINGS } from "../src/types";

// ---------------------------------------------------------------------------
// routeModify unit tests (pure, no SyncEngine needed)
// ---------------------------------------------------------------------------

describe("routeModify helper", () => {
	const BIG = 8 * 1024 * 1024;

	test("markdown modify routes to CRDT, never to pushNote", async () => {
		// applyLocalEdit reports the exact content it consumed; routeModify
		// forwards it so the caller stamps its echo baseline from what actually
		// entered the doc, never from a pre-guard snapshot.
		const applyLocalEdit = mock(async () => "body");
		const pushNote = mock(async () => ({ note: {}, chunks_indexed: 1 }));
		const result = await routeModify(
			{ crdtEligible: true, noteId: "id-n", readContent: async () => "body" },
			{ applyLocalEdit } as any,
			BIG,
		);
		expect(result).toBe("body");
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		// routeModify routes by note_id (Task 6), not path — "id-n" here, never
		// the file's vault path.
		expect(applyLocalEdit).toHaveBeenCalledWith(
			"id-n",
			"body",
			undefined,
			expect.any(Function),
		);
		expect(pushNote).not.toHaveBeenCalled();
	});

	test("routeModify returns the content the manager actually consumed (live reread)", async () => {
		// review finding sync.ts:2113: a remote merge landing mid-guard makes
		// the manager consume the REREAD content, not the first read — the
		// caller's echo baseline must be stamped from the consumed value.
		let reads = 0;
		const readContent = async () => (++reads === 1 ? "stale" : "merged");
		const applyLocalEdit = mock(
			async (_id: string, _c: string, _lca?: boolean, reread?: () => Promise<string>) =>
				await reread!(),
		);
		const result = await routeModify(
			{ crdtEligible: true, noteId: "id-n", readContent },
			{ applyLocalEdit } as any,
			BIG,
		);
		expect(result).toBe("merged");
	});

	test("routeModify's reread re-enforces the size cap (oversized reread rejects)", async () => {
		// review finding sync.ts:2099: the first-read cap check and the
		// manager's actually-applied reread are different reads — a file that
		// grows past MAX_CRDT_NOTE_BYTES in between must NOT enter the Y.Doc.
		let reads = 0;
		const readContent = async () => (++reads === 1 ? "ok" : "X".repeat(50));
		const applyLocalEdit = mock(
			async (_id: string, _c: string, _lca?: boolean, reread?: () => Promise<string>) => {
				// Mirrors the manager: a reread failure means NOT consumed.
				try {
					return await reread!();
				} catch {
					return null;
				}
			},
		);
		const result = await routeModify(
			{ crdtEligible: true, noteId: "id-n", readContent },
			{ applyLocalEdit } as any,
			10,
		);
		expect(result).toBeNull();
	});

	test("binary modify does NOT route to CRDT, returns null", async () => {
		const applyLocalEdit = mock(async () => null);
		const _pushNote = mock(async () => ({ note: {}, chunks_indexed: 1 }));
		const result = await routeModify(
			{ crdtEligible: false, noteId: "id-img", readContent: async () => "" },
			{ applyLocalEdit } as any,
			BIG,
		);
		expect(result).toBeNull();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("oversized markdown does NOT route to CRDT (would crash the WS frame)", async () => {
		const applyLocalEdit = mock(async () => null);
		// 5 MB of ASCII exceeds the 4 MB CRDT transport cap. Routing it into the
		// Yjs doc would produce a base64 crdt_msg over Bandit's 8 MB frame limit,
		// killing the socket. Must fall through to the legacy push path instead.
		const huge = "x".repeat(5 * 1024 * 1024);
		const result = await routeModify(
			{ crdtEligible: true, noteId: "id-big", readContent: async () => huge },
			{ applyLocalEdit } as any,
			4 * 1024 * 1024,
		);
		expect(result).toBeNull();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("multi-byte content is measured in UTF-8 bytes, not code units", async () => {
		const applyLocalEdit = mock(async () => null);
		// 2M emoji × 4 UTF-8 bytes = 8 MB > 6 MB cap, but only 2M UTF-16 units.
		// A naive .length check (code units) would wrongly let it through.
		const emoji = "😀".repeat(2 * 1024 * 1024);
		const result = await routeModify(
			{ crdtEligible: true, noteId: "id-emoji", readContent: async () => emoji },
			{ applyLocalEdit } as any,
			6 * 1024 * 1024,
		);
		expect(result).toBeNull();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// SyncEngine integration: handleModify routing through CrdtManager
// ---------------------------------------------------------------------------

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue({
		path: "",
		content_base64: "",
		mime_type: "",
		size_bytes: 0,
		mtime: 0,
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: mock().mockResolvedValue({
		id: "v1",
		name: "Test",
		slug: "test",
		is_default: true,
	}),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
			Promise.resolve(fn("")),
		),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

// Task 6 (note_id-keyed CRDT): production always wires a NoteIdMap alongside
// the CrdtManager (main.ts), so every CRDT-routed test needs one too — the
// pushFile CRDT gate now requires a resolved note_id, not just a manager.
// Defaults to a fresh map (mints a fresh UUID per new path); tests asserting
// exact CRDT call args pass a pre-seeded map for a deterministic id.
function createEngine(noteIdMap: NoteIdMap = new NoteIdMap()): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setNoteIdMap(noteIdMap);
	return engine;
}

function flush(ms = 50): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Mark a note_id as server-confirmed (rest-first fix): pushFile only routes
 *  a note through CRDT once the server is known to have a row for it (learned
 *  from a pull, or confirmed by a prior successful REST push). Tests that
 *  exercise CRDT routing itself — not the new-note REST-first gate — must
 *  seed this alongside a deterministic noteIdMap entry. */
function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
	// CRDT-sole oracle: hasServerNote(noteId) = getCrdtHead(pathForId(noteId)) != null.
	// Record a server head under the note's path so a "server-known" note routes
	// through the CRDT path (the confirmed-set no longer gates CRDT routing).
	const e = engine as unknown as {
		noteIdMap?: { pathForId(id: string): string | null; set(p: string, id: string): void };
		setCrdtHead(path: string, head: string): void;
	};
	let p = e.noteIdMap?.pathForId(noteId);
	if (!p) {
		// Test didn't seed a map: mint a path so the CRDT-sole oracle resolves
		// (a confirmed note IS server-known in production). Synthetic prefix so it
		// never collides with a real test path.
		p = `__confirmed__/${noteId}.md`;
		e.noteIdMap?.set(p, noteId);
	}
	e.setCrdtHead(p, "server-head");
}

/** Mark a note server-known WITHOUT confirming it: sets the id->path mapping and
 *  a crdtHead (so hasServerNote is true) while leaving confirmedNoteIds empty.
 *  Simulates the post-reconnect state after clearConfirmedNoteIds() wipes the
 *  confirmed-set but the note's server head persists (the #230/DI-1 case). */
function markServerKnown(engine: SyncEngine, path: string, noteId: string): void {
	const e = engine as unknown as {
		noteIdMap?: { set(p: string, id: string): void };
		setCrdtHead(p: string, h: string): void;
	};
	e.noteIdMap?.set(path, noteId);
	e.setCrdtHead(path, "server-head");
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApi.pushAttachment as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ attachment: {} });
	(mockApi.deleteNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ deleted: true, path: "" });
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
	(mockApp.vault.modify as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
});

describe("SyncEngine handleModify with CrdtManager", () => {
	test("markdown modify calls applyLocalEdit, NOT pushNote", async () => {
		// Pre-seed a deterministic note_id so the CRDT call args are assertable —
		// routeModify (Task 6) keys the frame by note_id, not path.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		// applyLocalEdit must return true so pushFile treats the edit as consumed
		// and does NOT fall through to pushNote (handshake-gate fix: routeModify
		// now forwards applyLocalEdit's boolean, so a void/falsy mock falls through).
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		const mockCrdt = { applyLocalEdit } as any;
		engine.setCrdtManager(mockCrdt);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-note");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith(
			"id-note",
			"body",
			undefined,
			expect.any(Function),
		);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("echo baseline is stamped from the CONSUMED content, not the stale first read", async () => {
		// review finding sync.ts:2113: when a remote merge lands mid-guard the
		// manager consumes the reread ("merged") while pushFile's own read said
		// "v1". Stamping H("v1") would echo-skip a later revert back to exactly
		// "v1" — the revert would never reach the Y.Doc and devices diverge.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async () => "merged");
		engine.setCrdtManager({ applyLocalEdit } as any);
		markConfirmed(engine, "id-note");
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("v1");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);

		// Disk still holds "v1" (the manager consumed "merged"): this is a REAL
		// divergence, not an echo — it must route again, not hash-skip.
		engine.handleModify(file);
		await flush();
		expect(applyLocalEdit).toHaveBeenCalledTimes(2);
	});

	test("anti-#230: a confirmed but NOT live-bound (cold) note STILL routes through CRDT, not REST", async () => {
		// The anti-#230 invariant. A cold edit (note edited while its dedicated
		// room is closed) MUST stay on CRDT so its change merges with concurrent
		// remote edits. Routing it to legacy whole-doc REST is last-write-wins →
		// LOST MERGES (this is exactly what broke test_concurrent_edits_both_survive
		// under the abandoned lazyEnrollment flag). CRDT is now unconditional for a
		// confirmed note — enrollment (STEP1) is only the down-pull, never required
		// to SEND an edit (manager.onUpdate ships it channel-up or via /updates).
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		markConfirmed(engine, "id-note");
		// NOT live-bound (default isLiveBound === false) — a cold note.

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith(
			"id-note",
			"body",
			undefined,
			expect.any(Function),
		);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("consumed CRDT edit does NOT enroll a cold (idle) note (vault-channel fan-out)", async () => {
		// The consumed-branch enroll gate: an idle note's edit ships over the
		// channel/updates (manager.onUpdate) with no room, and it receives future
		// updates over the note_yjs_update broadcast — no STEP1 enrollment.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c); // consumed
		const enroll = mock((_id: string) => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll } as any);
		markConfirmed(engine, "id-note");
		// Default isLiveBound === false → idle.

		engine.handleModify(new TFile("note.md"));
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(enroll).not.toHaveBeenCalled();
		// (A live-bound note's edits flow through the editor's ySync binding, not
		// handleModify's routeModify — so an open note enrolls via the bind path,
		// never this consumed branch. Verified: with isLiveBound true, handleModify
		// does not even call applyLocalEdit here.)
	});

	test("binary attachment modify does NOT call applyLocalEdit", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);

		const file = new TFile("image.png");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test(".canvas modify routes through CRDT applyLocalEdit (not legacy pushNote) since #306", async () => {
		// Canvas now rides the CRDT transport like markdown: a server-known .canvas
		// note routes its edit through applyLocalEdit, never api.pushNote.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Canvases/board.canvas", "id-board");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		markConfirmed(engine, "id-board");

		const file = new TFile("Canvases/board.canvas");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test(".md modify still routes through CRDT applyLocalEdit when CRDT is wired", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Canvases/overview.md", "id-overview");
		const engine = createEngine(noteIdMap);
		// applyLocalEdit must return true so pushFile treats the edit as consumed
		// and does not fall through to pushNote (handshake-gate fix).
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-overview");

		const file = new TFile("Canvases/overview.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith(
			"id-overview",
			"body",
			undefined,
			expect.any(Function),
		);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Review finding 3+4a: declined path — conditional enroll
// ---------------------------------------------------------------------------

describe("SyncEngine declined CRDT path (applyLocalEdit returns false)", () => {
	test("declined md does NOT enroll for a >MAX_CRDT_NOTE_BYTES file", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => null);
		const enroll = mock((_path: string) => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll } as any);

		// Stub cachedRead to return a 5 MB string (> 4 MB cap).
		const hugeMd = "x".repeat(5 * 1024 * 1024);
		expect(new TextEncoder().encode(hugeMd).length).toBeGreaterThan(MAX_CRDT_NOTE_BYTES);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(hugeMd);

		const file = new TFile("big.md");
		engine.handleModify(file);
		await flush();

		// Legacy push fires (size gate is in routeModify, which returns false for oversized).
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		// Enroll must NOT fire — enrolling an oversized note elicits a multi-MB STEP2
		// that can hit Bandit's 8 MB WS frame limit and crash the socket.
		expect(enroll).not.toHaveBeenCalled();
	});
});

describe("SyncEngine.flushFromCrdt echo suppression", () => {
	test("vault.modify is called with the content", async () => {
		const engine = createEngine();
		const mockFile = new TFile("note.md");
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(mockFile);

		await engine.flushFromCrdt("note.md", "new content");

		expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, "new content");
	});

	test("empty flush is REFUSED when the CRDT doc still holds content (stale echo — no blank)", async () => {
		// e2e test_09 content-loss: a note's own fan-out is echoed back to the
		// author and materializes an EMPTY projection (a self-echo landing during
		// the genesis pre-seed window) over the content it just wrote. The doc
		// still owns the content, so blanking the file is pure data loss.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const mockFile = new TFile("note.md");
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(mockFile);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("real content");
		// The CRDT doc genuinely still holds the content → the empty is transient.
		engine.setCrdtManager({ projectedText: mock(async () => "real content") } as any);

		const ok = await engine.flushFromCrdt("note.md", "");

		expect(ok).toBe(true);
		expect(mockApp.vault.modify).not.toHaveBeenCalled(); // file NOT blanked
	});

	test("empty flush WRITES THROUGH when the CRDT doc genuinely converged empty (legit remote clear)", async () => {
		// The other side of the guard: a peer legitimately cleared the note to
		// empty (test_27). The doc converged empty, so the empty IS authoritative
		// and must materialize — the guard must not block a real clear.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const mockFile = new TFile("note.md");
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(mockFile);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("old content");
		// Doc converged empty → the clear is real.
		engine.setCrdtManager({ projectedText: mock(async () => "") } as any);

		await engine.flushFromCrdt("note.md", "");

		expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, ""); // blanked, legitimately
	});

	test("creates the file when it does not exist yet (device-B discovery)", async () => {
		const engine = createEngine();
		// No local file — CRDT delivered content for a note this device has never
		// had on disk (the body lives only in the Yjs doc until now).
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);

		await engine.flushFromCrdt("Notes/discovered.md", "# Discovered\nfrom CRDT");

		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"Notes/discovered.md",
			"# Discovered\nfrom CRDT",
		);
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("after flushFromCrdt creates a file, the create echo no-ops at the diff layer", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/discovered.md", "id-discovered");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);
		// A note materialized via flushFromCrdt was discovered through the CRDT
		// feed, so the server unquestionably already has it — confirmed in
		// production by applySyncChange before flushFromCrdt runs.
		markConfirmed(engine, "id-discovered");

		await engine.flushFromCrdt("Notes/discovered.md", "from CRDT");

		// The vault.create fires a 'create' event routed through handleModify. For
		// CRDT-managed markdown we deliberately do NOT drop it on the recentlyFlushed
		// time-window (that also dropped real edits made right after discovery —
		// the round-trip/concurrent-edit bug). The echo instead flows to routeModify
		// → applyLocalEdit, where diffIntoYText sees identical content and produces
		// zero ops, so nothing re-transmits (no-op suppression, e2e tests/crdt).
		const created = new TFile("Notes/discovered.md");
		engine.handleModify(created);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalled();
	});

	test("after flushFromCrdt, a handleModify echo no-ops at the diff layer", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		// This note's body arrived via CRDT, so the server already knows it.
		markConfirmed(engine, "id-note");

		const mockFile = new TFile("note.md");
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(mockFile);

		// Flush to disk from remote CRDT update
		await engine.flushFromCrdt("note.md", "remote content");

		// The vault.modify above fires handleModify. For CRDT-managed markdown the
		// echo is NOT dropped on the recentlyFlushed time-window (which also dropped
		// real edits within the window); it flows to routeModify → applyLocalEdit,
		// where diffIntoYText no-ops on identical content so nothing re-transmits.
		engine.handleModify(mockFile);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalled();
	});

	test("a genuine local edit after a push is NOT dropped by the cooldown", async () => {
		// Regression: the handleModify echo guard must key off recentlyFlushed
		// (CRDT disk-write echoes), NOT recentlyPushed — which is also set after
		// every legacy push. Folding them together silently dropped real user
		// edits within the 5 s post-push cooldown, breaking conflict detection.
		// The cooldown/echo-guard logic is transport-agnostic; since #306 both
		// markdown AND canvas are CRDT-sole, so we exercise the remaining LWW REST
		// push path with an OVERSIZED note (> the CRDT transport cap).
		const engine = createEngine();
		const file = new TFile("note.md");
		const big = (c: string) => c.repeat(5 * 1024 * 1024);

		// First edit → oversized → REST-pushes → marks recentlyPushed in the finally.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(big("a"));
		engine.handleModify(file);
		await flush();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);

		// A real, diverging edit to the same file within the cooldown MUST push.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(big("b"));
		engine.handleModify(file);
		await flush();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// needsColdReconcile — the cold-start storm gate. Only a note with a recorded
// CRDT baseline that DISAGREES with disk needs a Y.Doc opened on connect.
// ---------------------------------------------------------------------------

describe("needsColdReconcile", () => {
	function asPredicate(engine: SyncEngine): (path: string, content: string) => boolean {
		return (
			engine as unknown as { needsColdReconcile(path: string, content: string): boolean }
		).needsColdReconcile.bind(engine);
	}
	function seedBaseline(engine: SyncEngine, path: string, content: string): void {
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(path, {
			hash: fnv1a(content),
		});
	}

	test("no baseline (fresh note) → false", () => {
		const engine = createEngine();
		expect(asPredicate(engine)("fresh.md", "anything")).toBe(false);
	});

	test("baseline hash == fnv1a(disk) (in sync) → false", () => {
		const engine = createEngine();
		seedBaseline(engine, "n.md", "same body");
		expect(asPredicate(engine)("n.md", "same body")).toBe(false);
	});

	test("baseline exists and differs from disk → true", () => {
		const engine = createEngine();
		seedBaseline(engine, "n.md", "old body");
		expect(asPredicate(engine)("n.md", "new body edited while closed")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Cold-start loop body: `if (needsColdReconcile) reconcileColdStart(...)`.
// The storm-killer — an in-sync note must NOT open a Y.Doc (no projectedText).
// ---------------------------------------------------------------------------

describe("cold-start loop gates reconcileColdStart on needsColdReconcile", () => {
	function needs(engine: SyncEngine, path: string, content: string): boolean {
		return (
			engine as unknown as { needsColdReconcile(path: string, content: string): boolean }
		).needsColdReconcile(path, content);
	}
	function seedBaseline(engine: SyncEngine, path: string, content: string): void {
		(engine as unknown as { syncState: Map<string, { hash: number }> }).syncState.set(path, {
			hash: fnv1a(content),
		});
	}

	test("in-sync note is skipped: reconcileColdStart never opens a Y.Doc (storm-killer)", async () => {
		const engine = createEngine();
		const disk = "converged body";
		seedBaseline(engine, "n.md", disk);
		const projectedText = mock(async () => disk);
		const applyLocalEdit = mock(async () => {});

		// Replicate the main.ts loop body.
		if (needs(engine, "n.md", disk)) {
			await reconcileColdStart(
				{ path: "n.md", noteId: "id-n", diskContent: disk },
				{ applyLocalEdit, getText: mock(async () => disk), projectedText } as any,
				() => {},
			);
		}

		expect(projectedText).not.toHaveBeenCalled();
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("drifted note IS reconciled: applyLocalEdit called with disk content", async () => {
		const engine = createEngine();
		seedBaseline(engine, "n.md", "old");
		const disk = "edited while app was closed";
		const projectedText = mock(async () => "old");
		const applyLocalEdit = mock(async () => {});

		if (needs(engine, "n.md", disk)) {
			await reconcileColdStart(
				{ path: "n.md", noteId: "id-n", diskContent: disk },
				{ applyLocalEdit, getText: mock(async () => "old"), projectedText } as any,
				() => {},
			);
		}

		expect(projectedText).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith("id-n", disk);
	});

	test("a supplied live reread is forwarded to applyLocalEdit (stale-snapshot guard at startup)", async () => {
		// review finding sync.ts:153: startup spans the LONGEST entry-await
		// (IndexedDB replay); a frozen diskContent diffed after a concurrent
		// remote merge would delete the remote ops. The caller's live read
		// must reach the manager's guard.
		const engine = createEngine();
		seedBaseline(engine, "n.md", "old");
		const disk = "edited while app was closed";
		const applyLocalEdit = mock(async () => disk);
		const reread = async () => disk;

		if (needs(engine, "n.md", disk)) {
			await reconcileColdStart(
				{ path: "n.md", noteId: "id-n", diskContent: disk, reread },
				{
					applyLocalEdit,
					getText: mock(async () => "old"),
					projectedText: mock(async () => "old"),
				} as any,
				() => {},
			);
		}

		expect(applyLocalEdit).toHaveBeenCalledWith("id-n", disk, undefined, reread);
	});
});

// ---------------------------------------------------------------------------
// reconcileColdStart — disk-changed-while-app-was-closed CRDT reconcile
// ---------------------------------------------------------------------------

describe("reconcileColdStart", () => {
	test("disk diverged from Y.Doc: applyLocalEdit called, no corruption callback", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "line one");
		const projectedText = mock(async () => "line one");
		let corrupted = false;
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "line one\nline two" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				corrupted = true;
			},
		);
		expect(applyLocalEdit).toHaveBeenCalledWith("n.md", "line one\nline two");
		expect(corrupted).toBe(false);
	});

	test("oversized note is NOT seeded or enrolled on cold start (would crash the WS frame)", async () => {
		// The cold-start reconcile path (#162) must apply the SAME size cap as
		// routeModify: an oversized note seeded here produces a base64 crdt_msg
		// past Bandit's 8 MB frame limit → 1009 → and because reconcile re-runs
		// on every reconnect, a permanent crash loop that kills all sync.
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "small");
		const projectedText = mock(async () => "small");
		const enroll = mock(() => {});
		const huge = "x".repeat(5 * 1024 * 1024); // 5 MB > 4 MB cap
		await reconcileColdStart(
			{ path: "big.md", noteId: "big.md", diskContent: huge },
			{ applyLocalEdit, getText, projectedText, enroll } as any,
			() => {},
			4 * 1024 * 1024,
		);
		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("disk matches Y.Doc: applyLocalEdit NOT called (already in sync)", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "same content");
		const projectedText = mock(async () => "same content");
		let corrupted = false;
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "same content" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				corrupted = true;
			},
		);
		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(corrupted).toBe(false);
	});

	test("getText throws (corrupted doc): onCorruption called, applyLocalEdit NOT called", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => {
			throw new Error("decode failed");
		});
		const projectedText = mock(async () => {
			throw new Error("decode failed");
		});
		let corrupted = false;
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "some content" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				corrupted = true;
			},
		);
		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(corrupted).toBe(true);
	});

	// Adopt-first gate follow-up (#846 review): when the doc is history-less and
	// the seed gate skips inside applyLocalEdit, the note converges ONLY via the
	// STEP1/STEP2 handshake — so a drifted note must always be enrolled, or it
	// silently sits out live sync until the user opens it (IDB-evicted docs,
	// reinstall-with-restored-data.json).
	test("drifted note is enrolled so the handshake adoption is guaranteed", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "");
		const projectedText = mock(async () => "");
		const enroll = mock(() => {});
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "pulled earlier, doc evicted" },
			{ applyLocalEdit, getText, projectedText, enroll } as any,
			() => {},
		);
		expect(enroll).toHaveBeenCalledWith("n.md");
	});

	test("in-sync note is NOT enrolled (no handshake churn for healthy docs)", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "same");
		const projectedText = mock(async () => "same");
		const enroll = mock(() => {});
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "same" },
			{ applyLocalEdit, getText, projectedText, enroll } as any,
			() => {},
		);
		expect(enroll).not.toHaveBeenCalled();
	});

	test("corrupted doc is NOT enrolled (conflict modal owns recovery)", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => {
			throw new Error("decode failed");
		});
		const projectedText = mock(async () => {
			throw new Error("decode failed");
		});
		const enroll = mock(() => {});
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "x" },
			{ applyLocalEdit, getText, projectedText, enroll } as any,
			() => {},
		);
		expect(enroll).not.toHaveBeenCalled();
	});

	test("enroll fires even when the local write fails (handshake still converges)", async () => {
		const applyLocalEdit = mock(async () => {
			throw new Error("storage write failed");
		});
		const getText = mock(async () => "old");
		const projectedText = mock(async () => "old");
		const enroll = mock(() => {});
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "old plus offline edit" },
			{ applyLocalEdit, getText, projectedText, enroll } as any,
			() => {},
		);
		expect(enroll).toHaveBeenCalledWith("n.md");
	});

	test("CRDT does NOT invoke conflict modal on normal cold-start divergence", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "old content");
		const projectedText = mock(async () => "old content");
		let conflictModalShown = false;
		await reconcileColdStart(
			{ path: "n.md", noteId: "n.md", diskContent: "old content\nnew line" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				conflictModalShown = true;
			},
		);
		expect(conflictModalShown).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Offline CRDT capture — Task 4 (audit P1-1)
//
// Regression pins that lock in the existing pushFile early-return behaviour:
// a consumed md edit returns from pushFile BEFORE the catch/enqueue path, so
// the legacy offline queue stays empty. These tests also verify the correct
// behaviour for the declined and non-md paths, guarding the T1 interplay.
// ---------------------------------------------------------------------------

describe("offline CRDT capture — queue behaviour", () => {
	// Helper: throw a plain network error (no .status) so categorizeError
	// classifies it as "network" → shouldRetryAfterFailure → enqueue path.
	function networkError(): Error {
		return new Error("Failed to fetch");
	}

	test("(a) consumed md edit while CRDT is active does NOT enqueue — queue stays empty", async () => {
		// pushFile's CRDT branch calls routeModify; when applyLocalEdit returns true
		// pushFile returns immediately (line ~1099) without ever reaching the catch
		// block that calls enqueueChange. This is the core offline-capture guarantee:
		// the edit lives in the Y.Doc + IndexedDB, not the stale-snapshot queue.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		// applyLocalEdit returns true → consumed
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-note");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(engine.queue.size).toBe(0);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("(b) oversized-note edit + network failure → queue entry EXISTS", async () => {
		// The offline-queue-on-failure path is transport-agnostic. Since #306 BOTH
		// markdown and canvas are CRDT-sole (a declined edit no longer falls through
		// to REST), so this exercises the kept LWW REST push with an OVERSIZED note
		// (> the CRDT transport cap) — it fails offline and must enqueue for retry.
		const engine = createEngine();
		const applyLocalEdit = mock(async () => null);
		engine.setCrdtManager({ applyLocalEdit } as any);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue(
			"a".repeat(5 * 1024 * 1024),
		);

		// Stub pushNote to simulate a connection-lost error
		(mockApi.pushNote as ReturnType<typeof mock>).mockRejectedValueOnce(networkError());

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush(100);

		// The edit must be queued for retry on reconnect
		expect(engine.queue.size).toBe(1);
		expect(engine.queue.all()[0]?.path).toBe("note.md");
	});

	test("(c) non-md file (attachment) + network failure → queue entry EXISTS", async () => {
		// Deletes/renames/attachments must always queue when offline — CRDT does not
		// manage binary files.
		const engine = createEngine();
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);

		// pushAttachment throws a network error
		(mockApi.pushAttachment as ReturnType<typeof mock>).mockRejectedValueOnce(networkError());

		const file = new TFile("image.png");
		engine.handleModify(file);
		await flush(100);

		// Attachment failure must queue; applyLocalEdit must NOT have been called
		expect(engine.queue.size).toBe(1);
		expect(engine.queue.all()[0]?.path).toBe("image.png");
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("(d) reconnect replay: flushQueue after a consumed edit does NOT re-push via pushNote", async () => {
		// After a CRDT-consumed edit the legacy queue stays empty (pinned by test (a)).
		// This test adds a second assertion: an explicit queue flush (the reconnect
		// recovery path) must not phantom-replay the consumed edit via pushNote.
		// Regression guard: if the consumed-edit somehow ended up in the queue, a
		// flush on reconnect would push a stale full-document snapshot over the CRDT
		// ops that were already committed to Y.Doc + IndexedDB during the offline window.
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-note");

		// Consume a markdown edit via CRDT (queue must stay empty).
		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(engine.queue.size).toBe(0);

		// Simulate reconnect recovery: trigger a queue flush.
		// An empty queue must drain instantly with 0 pushes — the consumed edit
		// must not be replayed as a legacy pushNote call.
		await engine.flushQueue();

		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Task 3: new-note genesis routes through crdt_create (socket-native create),
// not REST pushNote. crdt_create returns the server's authoritative doc_id: on
// ADOPT (path already owned by a live note under a different id) the note is
// remapped to that server id so its body/edits address the row that exists —
// keeping the local mint would orphan the note (content loss). crdt_create can
// reject (delete-wins, rate-limited, bad path); on rejection the note is NOT
// lost — it falls through to the still-functional REST create (removed in B2).
// ---------------------------------------------------------------------------

describe("Task 3: new-note genesis routes through crdt_create", () => {
	test("a brand-new note genesis goes over crdt_create, not REST pushNote", async () => {
		const noteIdMap = new NoteIdMap();
		const engine = createEngine(noteIdMap);
		// The body is seeded into the Y.Doc after the row is created — the update
		// listener forwards it over the channel. applyLocalEdit reports consumed.
		engine.setCrdtManager({ applyLocalEdit: mock(async (_id: string, c: string) => c) } as any);
		const created: Array<{ id: string; path: string }> = [];
		engine.setCrdtCreate(async (id: string, path: string) => {
			created.push({ id, path });
			return id; // server adopts the client-minted id (no collision).
		});

		const file = new TFile("Notes/brand-new.md");
		engine.handleModify(file);
		await flush();

		expect(created).toHaveLength(1);
		expect(created[0]?.path).toBe("Notes/brand-new.md");
		// The minted id is the one sent to crdt_create and retained on the map.
		expect(created[0]?.id).toBe(noteIdMap.get("Notes/brand-new.md"));
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("ADOPT: crdt_create returns a DIFFERENT id → note remapped, enroll + transfer use the server id", async () => {
		const noteIdMap = new NoteIdMap();
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		const projectedText = mock(async (_id: string) => "body"); // mint live buffer
		const removeDoc = mock(async (_id: string) => {});
		const hasHistory = mock(async (_id: string) => false);
		engine.setCrdtManager({ applyLocalEdit, projectedText, removeDoc, hasHistory } as any);
		// A live-bound note is gated OUT of handleModify (the editor owns the
		// disk-write echo), so it reaches pushFile's genesis only via a direct
		// call (full-sync batch / rename). Live-bound adopt now TRANSFERS the mint
		// buffer into serverId (no external rebind needed — the ViewPlugin self-heals).
		engine.setLiveBoundCheck(() => true);
		const enroll = mock((_id: string) => {});
		engine.setCrdtEnrollment({ enroll, reset: mock(() => {}) } as any);
		// Server already owns this path under a live note with a different id.
		engine.setCrdtCreate(async (_id: string, _path: string) => "server-owns-this");

		const file = new TFile("Notes/collision.md");
		await (
			engine as unknown as { pushFile: (f: TFile, force?: boolean) => Promise<boolean> }
		).pushFile(file);

		// The local mint is replaced by the server's authoritative id: subsequent
		// crdt_msg edits now address the row that actually exists.
		expect(noteIdMap.get("Notes/collision.md")).toBe("server-owns-this");
		// Mint buffer transferred (2-arg forward, default origin) AND enrolled under
		// the SERVER id, never the orphaned mint.
		expect(applyLocalEdit.mock.calls[0]?.[0]).toBe("server-owns-this");
		expect(applyLocalEdit.mock.calls[0]?.[1]).toBe("body");
		expect(enroll).toHaveBeenCalledWith("server-owns-this");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("ADOPT under a LIVE editor: seeds serverId from the mint's live buffer, rebinds the editor, removes the mint doc (no lost in-flight edits)", async () => {
		// The editor is bound to the MINT doc, so ySync propagated the user's live
		// keystrokes (incl. any typed during the crdt_create round-trip and any
		// not yet flushed to disk) into the mint Y.Text — projectedText reflects
		// them, cachedRead (disk) can lag. The adopt must transfer the MINT content
		// into serverId (default origin → forwards to the server) and rebind the
		// editor, NOT re-seed from the staler disk snapshot (which would clobber
		// the in-flight chars).
		const noteIdMap = new NoteIdMap();
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		const projectedText = mock(async (_id: string) => "hello world"); // mint live buffer
		const removeDoc = mock(async (_id: string) => {});
		const hasHistory = mock(async (_id: string) => false); // serverId empty → no doubling warn
		engine.setCrdtManager({ applyLocalEdit, projectedText, removeDoc, hasHistory } as any);
		engine.setLiveBoundCheck(() => true);
		const enroll = mock((_id: string) => {});
		const reset = mock((_id: string) => {});
		engine.setCrdtEnrollment({ enroll, reset } as any);
		const rebinds: string[] = [];
		engine.setCrdtEditorRebind((p: string) => rebinds.push(p));
		let mintId = "";
		engine.setCrdtCreate(async (id: string, _path: string) => {
			mintId = id;
			return "server-owns-this";
		});

		const file = new TFile("Notes/collision-live.md");
		await (
			engine as unknown as { pushFile: (f: TFile, force?: boolean) => Promise<boolean> }
		).pushFile(file);

		// Remap stuck; the mint's live buffer was seeded into the server id, once,
		// forwarding to the server (default origin) — NOT the disk "body" snapshot.
		expect(noteIdMap.get("Notes/collision-live.md")).toBe("server-owns-this");
		expect(projectedText).toHaveBeenCalledWith(mintId);
		expect(applyLocalEdit.mock.calls.length).toBe(1);
		expect(applyLocalEdit.mock.calls[0]?.[0]).toBe("server-owns-this");
		expect(applyLocalEdit.mock.calls[0]?.[1]).toBe("hello world"); // in-flight buffer, not disk
		// Editor rebound off the orphaned mint onto serverId; mint doc retired.
		expect(rebinds).toEqual(["Notes/collision-live.md"]);
		expect(removeDoc).toHaveBeenCalledWith(mintId);
		expect(reset).toHaveBeenCalledWith(mintId);
		expect(enroll).toHaveBeenCalledWith("server-owns-this");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("idle ADOPT (rebind wired but note NOT live-bound): uses the disk-seed path, no transfer/rebind/removeDoc", async () => {
		// No live editor owns the note → nothing to preserve → the transfer branch
		// must be skipped and the existing routeModify disk-seed runs unchanged.
		const noteIdMap = new NoteIdMap();
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async (_id: string, c: string) => c);
		const projectedText = mock(async (_id: string) => "hello world");
		const removeDoc = mock(async (_id: string) => {});
		engine.setCrdtManager({ applyLocalEdit, projectedText, removeDoc } as any);
		engine.setLiveBoundCheck(() => false); // idle
		engine.setCrdtEnrollment({ enroll: mock(() => {}), reset: mock(() => {}) } as any);
		const rebinds: string[] = [];
		engine.setCrdtEditorRebind((p: string) => rebinds.push(p));
		engine.setCrdtCreate(async (_id: string, _path: string) => "server-owns-this");

		const file = new TFile("Notes/collision-idle.md");
		await (
			engine as unknown as { pushFile: (f: TFile, force?: boolean) => Promise<boolean> }
		).pushFile(file);

		// Disk-seed path: applyLocalEdit gets the disk body + a reread fn; the
		// mint-transfer machinery never runs.
		expect(applyLocalEdit).toHaveBeenCalledWith(
			"server-owns-this",
			"body",
			undefined,
			expect.any(Function),
		);
		expect(projectedText).not.toHaveBeenCalled();
		expect(rebinds).toEqual([]);
		expect(removeDoc).not.toHaveBeenCalled();
	});

	test("ADOPT + post-create seed throw: must NOT REST-create under the stale mint id (review finding)", async () => {
		// Unlike the rejection case above, crdt_create here RESOLVES (with adopt:
		// server already owns the path under a different id) — the server row
		// exists before the seed throws. Falling through to REST under the local
		// mint would create a duplicate/misrouted row against a path the server
		// already owns. The fix treats a post-create throw like the seed-declined
		// branch: confirm the remapped id and return true (self-heals next edit).
		const noteIdMap = new NoteIdMap();
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async () => {
			throw new Error("seed boom");
		});
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setLiveBoundCheck(() => true);
		const enroll = mock((_id: string) => {});
		engine.setCrdtEnrollment({ enroll, reset: mock(() => {}) } as any);
		engine.setCrdtCreate(async (_id: string, _path: string) => "server-owns-this");

		const file = new TFile("Notes/collision-throw.md");
		const result = await (
			engine as unknown as { pushFile: (f: TFile, force?: boolean) => Promise<boolean> }
		).pushFile(file);

		// No stale-mint REST create.
		expect(mockApi.pushNote).not.toHaveBeenCalled();
		// The remap stuck: noteIdMap addresses the row the server actually owns.
		expect(noteIdMap.get("Notes/collision-throw.md")).toBe("server-owns-this");
		// Oracle-flip + return-true path taken: the row exists (a sentinel crdtHead
		// makes hasServerNote true immediately), the note is not lost, and the next
		// edit self-heals the body over the CRDT-op branch.
		expect(
			(engine as unknown as { getCrdtHead(p: string): string | undefined }).getCrdtHead(
				"Notes/collision-throw.md",
			),
		).toBe(CRDT_HEAD_CREATED);
		expect(result).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Task 4 (Plan B2): a local note delete ENQUEUES a durable crdt_delete on the
// CrdtOpQueue, never a REST deleteNote. The queue holds it until the crdt:
// topic is joined and retries transient failures (there is no REST delete
// fallback). Attachments are unaffected (REST deleteAttachment). A delete
// APPLIED locally because it arrived FROM the server (remotelyDeleted marks the
// path before the vault trash that fires handleDelete) must NOT echo a
// crdt_delete back. The server already knows.
// ---------------------------------------------------------------------------

describe("Task 4: local delete enqueues a durable crdt_delete", () => {
	test("deleting a synced note enqueues crdt_delete, not REST deleteNote", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/gone.md", "note-uuid");
		const engine = createEngine(noteIdMap);
		// #416 evidence rule: a delete push requires recorded sync evidence.
		(engine as any).syncState.set("Notes/gone.md", { hash: 1 });
		const enqueued: Array<{ kind: string; docId: string; path: string }> = [];
		engine.setCrdtEnqueue((op) => enqueued.push(op));

		const file = new TFile("Notes/gone.md");
		await engine.handleDelete(file);

		expect(enqueued).toEqual([{ kind: "delete", docId: "note-uuid", path: "Notes/gone.md" }]);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	// Plan B2: enqueue is a durable local hand-off that never throws and never
	// touches REST. The delete is HELD by the queue even when the topic isn't
	// joined (offline), delivered on join. No REST fallback, no offline REST
	// queue entry.
	test("delete enqueues durably even when offline (no REST fallback)", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/gone.md", "note-uuid");
		const engine = createEngine(noteIdMap);
		// #416 evidence rule: a delete push requires recorded sync evidence.
		(engine as any).syncState.set("Notes/gone.md", { hash: 1 });
		const enqueued: Array<{ kind: string; docId: string; path: string }> = [];
		engine.setCrdtEnqueue((op) => enqueued.push(op));

		const file = new TFile("Notes/gone.md");
		await engine.handleDelete(file);

		expect(enqueued).toEqual([{ kind: "delete", docId: "note-uuid", path: "Notes/gone.md" }]);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
		// The durable REST offline queue is NOT used for CRDT deletes.
		expect(engine.queue.size).toBe(0);
	});

	test("a remote-applied delete does not enqueue a crdt_delete", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Notes/gone.md", "note-uuid");
		const engine = createEngine(noteIdMap);
		const enqueued: Array<{ kind: string; docId: string; path: string }> = [];
		engine.setCrdtEnqueue((op) => enqueued.push(op));
		// Simulate trashRemotelyDeleted having marked the path before the vault
		// 'delete' event fires — the remote-echo early-return in handleDelete.
		(engine as unknown as { files: SyncedFileTable }).files.mark(
			"Notes/gone.md",
			"remotelyDeleted",
			60_000,
		);

		const file = new TFile("Notes/gone.md");
		await engine.handleDelete(file);

		expect(enqueued).toEqual([]);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Teardown fix — setupNoteStream must clear SyncEngine CRDT references
//
// Regression pin for the Important-1 review finding: the old teardown relied on
// setConnected(false) → setCrdtManager(null), but setConnected is transition-
// gated and is a no-op when the socket is already disconnected (the offline-
// retention branch). The fix calls setCrdtManager/setCrdtEnrollment explicitly.
// This test exercises the SyncEngine seam directly — no plugin scaffolding
// needed because both setters are public.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The REST batch-push duplication guard, channel-down seed+queue, and
// mint-relocation-guard suites that used to sit here exercised
// pushNotesViaBatch directly — deleted by Task 7 of the CRDT single-push-path
// rework (dead since Task 3 routed pushAll's genesis notes through
// crdtCreateBatch/pushGenesisBatch, leaving pushNotesViaBatch callerless).
// The underlying predicate (isCrdtManaged/isCrdtManagedOffline) was itself
// deleted as dead code in this same task (pushFile routes on hasServerNote
// directly, pinned below in "BUG 3"); the mint-relocation guard
// (shouldDeferMint) and channel-down seed+queue behavior are pinned for the
// surviving producers in "Task 3: new-note genesis routes through crdt_create"
// above (pushFile) and tests/sync-push-consolidation.test.ts
// ("pushGenesisBatch — direct").
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round 5 (e2e test_34, CI run 28919928915): concurrent materializations into
// the SAME new folder race ensureFolder's check-then-create. The loser's
// vault.createFolder rejects "Folder already exists." and flushFromCrdt's
// catch dropped the note entirely (received=yes materialized=no) until the
// next pull — past the 30s delivery window. Losing that race must be treated
// as success (the folder IS there); a real createFolder failure must still
// surface. Same class: vault.create rejecting "File already exists." when a
// concurrent path (pull vs WS) created the file between the existence check
// and the create — degrade to modify instead of dropping the body.
// ---------------------------------------------------------------------------
describe("flushFromCrdt survives check-then-create races (round 5, test_34)", () => {
	test("createFolder losing the concurrent-folder race still materializes the note", async () => {
		const engine = createEngine();
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);
		// Note1's ensureFolder won; Note2's createFolder rejects.
		(mockApp.vault.createFolder as ReturnType<typeof mock>)
			.mockReset()
			.mockRejectedValue(new Error("Folder already exists."));
		(mockApp.vault.create as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);

		await engine.flushFromCrdt("RenameFolder34/Note2.md", "# Note 2\nIn old folder");

		expect(mockApp.vault.create).toHaveBeenCalledWith(
			"RenameFolder34/Note2.md",
			"# Note 2\nIn old folder",
		);
	});

	test("a REAL createFolder failure still fails the write (guard is race-scoped)", async () => {
		const engine = createEngine();
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);
		(mockApp.vault.createFolder as ReturnType<typeof mock>)
			.mockReset()
			.mockRejectedValue(new Error("EACCES: permission denied"));
		(mockApp.vault.create as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);

		await engine.flushFromCrdt("Locked/Note.md", "body");

		// flushFromCrdt catches and logs; the point is we must NOT fake a create.
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("vault.create rejecting 'File already exists.' degrades to modify with the same content", async () => {
		const engine = createEngine();
		const raced = new TFile("E2E/ChannelCatchUp2.md");
		// Existence check misses (cache raced), create rejects, re-lookup finds it.
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
			.mockReset()
			.mockReturnValueOnce(null) // flushFromCrdt's own lookup
			.mockReturnValue(raced); // re-lookup after the create rejection
		(mockApp.vault.createFolder as ReturnType<typeof mock>)
			.mockReset()
			.mockResolvedValue(undefined);
		(mockApp.vault.create as ReturnType<typeof mock>)
			.mockReset()
			.mockRejectedValue(new Error("File already exists."));
		const processMock = mockApp.vault.process as ReturnType<typeof mock>;
		processMock.mockClear();

		await engine.flushFromCrdt("E2E/ChannelCatchUp2.md", "caught-up body");

		// modifyFile prefers vault.process when available.
		expect(processMock).toHaveBeenCalled();
		expect(processMock.mock.calls[0][0]).toBe(raced);
	});
});

// ---------------------------------------------------------------------------
// Discovery pull enrollment: STEP1 fires ONLY for live-bound notes. An idle
// (not-open) discovered note gets its body room-free via flushFromCrdt below;
// enrolling every discovered note on connect is the enrollment storm.
// ---------------------------------------------------------------------------

describe("discovery pull enrolls only live-bound notes", () => {
	async function discover(engine: SyncEngine): Promise<void> {
		await engine.applySyncChange({
			id: "id-disc",
			path: "Notes/Disc.md",
			title: "Disc",
			content: "# Disc\ndiscovered body",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
			version: 1,
		} as any);
	}

	test("idle (not live-bound) discovered note: enroll NOT called, body still materialized", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async (_id: string, c: string) => c) } as any);
		const enroll = mock((_id: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		engine.setCrdtLiveCheck(() => true);
		// isLiveBound defaults to () => false — idle.
		(mockApp.vault.create as ReturnType<typeof mock>).mockClear();

		await discover(engine);

		expect(enroll).not.toHaveBeenCalled();
		// Body still arrives room-free (flushFromCrdt creates the file).
		expect(mockApp.vault.create).toHaveBeenCalled();
	});

	test("live-bound discovered note: enroll IS called (STEP1 for the open note)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async (_id: string, c: string) => c) } as any);
		const enroll = mock((_id: string) => {});
		engine.setCrdtEnrollment({ enroll } as any);
		engine.setCrdtLiveCheck(() => true);
		engine.setLiveBoundCheck(() => true);

		await discover(engine);

		expect(enroll).toHaveBeenCalledWith("id-disc");
	});
});

// ---------------------------------------------------------------------------
// BUG 3 invariant (b#1 from the adversarial review): a note that WAS confirmed
// but whose syncState baseline is missing (evicted) must NEVER be routed to
// whole-doc last-write-wins — that would lose a concurrent remote edit (the
// anti-#230 failure this branch exists to prevent). needsColdReconcile returns
// false for a baseline-less note, so cold-start SKIPS seeding it; the concern
// is whether the fullSync/push fallback then routes it LWW. It does not:
// pushFile gates CRDT on hasServerNote(noteId) (the note's crdtHead), not the
// hash baseline. This pins that invariant.
//
// Investigation note: confirmedNoteIds is in-memory only (never serialized via
// saveData) and cleared on every reconnect (clearConfirmedNoteIds) — so it
// cannot outlive syncState across a restart in persistence. Within a session a
// note is confirmed only by a push-response or the pull feed, both of which
// set/refresh the baseline in the same operation. Even so, the routing does not
// depend on the baseline at all, so a transient confirmed-but-baseline-less
// note still stays on CRDT. Proven below.
//
// Task 7: the two batch-push variants of this pin ("skips a confirmed
// baseline-less note" / "DI-1: unconfirmed post-reconnect") were removed with
// pushNotesViaBatch. isCrdtManaged/isCrdtManagedOffline (the batch-era
// predicates that used to pin this) are gone too — pushFile's own oracle,
// hasServerNote, is what still gates routing, so the invariant is re-expressed
// against it directly below.
// ---------------------------------------------------------------------------

describe("BUG 3: a server-known note routes to CRDT even without a hash baseline (never whole-doc LWW)", () => {
	test("hasServerNote is true for a server-known note with no hash baseline", () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock(async (_id: string, c: string) => c) } as any);
		markServerKnown(engine, "p.md", "id-1");
		// crdtHead set (server-known), no hash baseline imported
		const managed = (
			engine as unknown as { hasServerNote(id: string | null): boolean }
		).hasServerNote("id-1");
		expect(managed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// b#2 (test-coverage review): the main.ts cold-start enroll seam. A drifted
// note gets its handshake enrolled ONLY when it is live-bound (open in the
// editor); an idle drifted note propagates room-free (no STEP1 storm on
// connect). main.ts wires this as the `enroll` callback passed to
// reconcileColdStart; we replicate that wiring inline (same style as the
// "cold-start loop gates reconcileColdStart on needsColdReconcile" test above).
// ---------------------------------------------------------------------------

describe("cold-start enroll gate: idle drifted note does NOT enroll, live-bound DOES", () => {
	async function run(bound: boolean) {
		const enroll = mock((_id: string) => {});
		// Replicate main.ts's enroll-callback wiring: enroll only when live-bound.
		await reconcileColdStart(
			{ path: "n.md", noteId: "id-n", diskContent: "drifted body" },
			{
				applyLocalEdit: mock(async (_id: string, c: string) => c),
				getText: mock(async () => "old baseline"),
				projectedText: mock(async () => "old baseline"),
				enroll: (id: string) => {
					if (bound) enroll(id);
				},
			} as any,
			() => {},
		);
		return enroll;
	}

	test("idle (not live-bound) drifted note: enroll NOT called (no STEP1 storm)", async () => {
		const enroll = await run(false);
		expect(enroll).not.toHaveBeenCalled();
	});

	test("live-bound drifted note: enroll IS called (STEP1 for the open note)", async () => {
		const enroll = await run(true);
		expect(enroll).toHaveBeenCalledWith("id-n");
	});
});

describe("genesis echo-cooldown window (repo-review 2026-08)", () => {
	test("a crdt_create whose body seed shipped opens the recently-pushed window", async () => {
		// The CRDT-op branch sets `success = true` when content is consumed, so
		// the finally opens the echo window (markRecentlyPushed). The genesis
		// branch returned early without it, leaving the create's own broadcast
		// unsuppressed — the exact self-echo class the window exists for.
		const noteIdMap = new NoteIdMap();
		const engine = createEngine(noteIdMap);
		engine.setCrdtManager({
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		} as any);
		engine.setCrdtCreate(async (id: string) => id);

		const file = new TFile("Notes/brand-new.md");
		engine.handleModify(file);
		await flush();

		const files = (engine as unknown as { files: { has(p: string, k: string): boolean } })
			.files;
		expect(files.has("Notes/brand-new.md", "pushed")).toBe(true);
	});
});
