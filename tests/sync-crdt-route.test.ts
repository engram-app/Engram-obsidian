/**
 * Tests: CRDT routing in SyncEngine.
 * - markdown modify → CrdtManager.applyLocalEdit, NOT api.pushNote
 * - binary modify → legacy path (NOT CrdtManager)
 * - flushFromCrdt → vault.modify + echo suppression
 * - onFlushToDisk echo: remote-applied disk write does not re-enqueue a local push
 * - offline CRDT capture: consumed md edits do NOT enter the legacy offline queue
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { MAX_CRDT_NOTE_BYTES, SyncEngine, reconcileColdStart, routeModify } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// ---------------------------------------------------------------------------
// routeModify unit tests (pure, no SyncEngine needed)
// ---------------------------------------------------------------------------

describe("routeModify helper", () => {
	const BIG = 8 * 1024 * 1024;

	test("markdown modify routes to CRDT, never to pushNote", async () => {
		// applyLocalEdit must return true (consumed) so routeModify returns true.
		// After the handshake-gate fix, routeModify forwards the boolean from
		// applyLocalEdit; a mock returning void (undefined/falsy) would make the
		// result false, breaking the consumed assertion.
		const applyLocalEdit = mock(async () => true);
		const pushNote = mock(async () => ({ note: {}, chunks_indexed: 1 }));
		const result = await routeModify(
			{ isMarkdown: true, noteId: "id-n", readContent: async () => "body" },
			{ applyLocalEdit } as any,
			BIG,
		);
		expect(result).toBe(true);
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		// routeModify routes by note_id (Task 6), not path — "id-n" here, never
		// the file's vault path.
		expect(applyLocalEdit).toHaveBeenCalledWith("id-n", "body");
		expect(pushNote).not.toHaveBeenCalled();
	});

	test("binary modify does NOT route to CRDT, returns false", async () => {
		const applyLocalEdit = mock(async () => {});
		const pushNote = mock(async () => ({ note: {}, chunks_indexed: 1 }));
		const result = await routeModify(
			{ isMarkdown: false, noteId: "id-img", readContent: async () => "" },
			{ applyLocalEdit } as any,
			BIG,
		);
		expect(result).toBe(false);
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("oversized markdown does NOT route to CRDT (would crash the WS frame)", async () => {
		const applyLocalEdit = mock(async () => {});
		// 5 MB of ASCII exceeds the 4 MB CRDT transport cap. Routing it into the
		// Yjs doc would produce a base64 crdt_msg over Bandit's 8 MB frame limit,
		// killing the socket. Must fall through to the legacy push path instead.
		const huge = "x".repeat(5 * 1024 * 1024);
		const result = await routeModify(
			{ isMarkdown: true, noteId: "id-big", readContent: async () => huge },
			{ applyLocalEdit } as any,
			4 * 1024 * 1024,
		);
		expect(result).toBe(false);
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("multi-byte content is measured in UTF-8 bytes, not code units", async () => {
		const applyLocalEdit = mock(async () => {});
		// 2M emoji × 4 UTF-8 bytes = 8 MB > 6 MB cap, but only 2M UTF-16 units.
		// A naive .length check (code units) would wrongly let it through.
		const emoji = "😀".repeat(2 * 1024 * 1024);
		const result = await routeModify(
			{ isMarkdown: true, noteId: "id-emoji", readContent: async () => emoji },
			{ applyLocalEdit } as any,
			6 * 1024 * 1024,
		);
		expect(result).toBe(false);
		expect(applyLocalEdit).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// SyncEngine integration: handleModify routing through CrdtManager
// ---------------------------------------------------------------------------

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
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
	getAttachment: mock().mockResolvedValue({
		path: "",
		content_base64: "",
		mime_type: "",
		size_bytes: 0,
		mtime: 0,
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
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
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApi.pushAttachment as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ attachment: {} });
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
		const applyLocalEdit = mock(async () => true);
		const mockCrdt = { applyLocalEdit } as any;
		engine.setCrdtManager(mockCrdt);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-note");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith("id-note", "body");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("binary attachment modify does NOT call applyLocalEdit", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);

		const file = new TFile("image.png");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).not.toHaveBeenCalled();
	});

	test("markdown modify without CrdtManager falls back to pushNote", async () => {
		const engine = createEngine();
		// No CRDT manager wired

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});

	test(".canvas modify uses legacy pushNote, NOT applyLocalEdit, even when CRDT is wired", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

		const file = new TFile("Canvases/board.canvas");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});

	test(".md modify still routes through CRDT applyLocalEdit when CRDT is wired", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("Canvases/overview.md", "id-overview");
		const engine = createEngine(noteIdMap);
		// applyLocalEdit must return true so pushFile treats the edit as consumed
		// and does not fall through to pushNote (handshake-gate fix).
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-overview");

		const file = new TFile("Canvases/overview.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith("id-overview", "body");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Review finding 3+4a: declined path — legacy push AND conditional enroll
// ---------------------------------------------------------------------------

describe("SyncEngine declined CRDT path (applyLocalEdit returns false)", () => {
	test("declined md fires legacy pushNote AND enroll for a small file", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		// applyLocalEdit returns false → routeModify returns false → declined path.
		const applyLocalEdit = mock(async () => false);
		const enroll = mock((_id: string) => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll } as any);
		// rest-first fix: this test exercises the DECLINED-inside-CRDT-block
		// behavior (routeModify itself returns false), which requires the note
		// to have entered the CRDT gate in the first place — confirm it.
		markConfirmed(engine, "id-note");

		// Default cachedRead returns "body" (well under MAX_CRDT_NOTE_BYTES).
		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		// Legacy push must fire.
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		// Enroll must also fire (kicks off the STEP1 handshake for the declined
		// note), keyed by note_id (Task 6) not path.
		expect(enroll).toHaveBeenCalledWith("id-note");
	});

	test("declined md does NOT enroll for a >MAX_CRDT_NOTE_BYTES file", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => false);
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
		const engine = createEngine();
		const file = new TFile("note.md");

		// First edit → pushes → marks recentlyPushed in the push finally.
		engine.handleModify(file);
		await flush();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);

		// A real, diverging edit to the same file within the cooldown MUST push.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("edited body");
		engine.handleModify(file);
		await flush();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(2);
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
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-note");

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(engine.queue.size).toBe(0);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});

	test("(b) declined md edit (applyLocalEdit false) + network failure → queue entry EXISTS", async () => {
		// Regression guard for the T1 interplay: a declined edit (empty doc, no
		// handshake yet) falls through to legacy pushNote. If the network is down
		// pushNote throws, which must enqueue so the note retries on reconnect.
		const engine = createEngine();
		const applyLocalEdit = mock(async () => false);
		engine.setCrdtManager({ applyLocalEdit } as any);

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
		const applyLocalEdit = mock(async () => true);
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
		const applyLocalEdit = mock(async () => true);
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
// REST-first fix (engram e2e delivery bug): the backend's CRDT channel now
// requires a note to already exist (note_in_vault?) and silently drops a
// crdt_msg for an unknown note_id — it can no longer bootstrap a note row
// from a bare wire doc_id (no path on the frame). A brand-new / never-synced
// note's first push must therefore go through REST (which creates the row
// and adopts the client-minted id as note_id), NOT straight to CRDT. Only
// once the id is server-confirmed may subsequent edits route through CRDT.
// ---------------------------------------------------------------------------

describe("REST-first fix: new-note gate confirms via REST before CRDT", () => {
	function echoClientIdPushNote(
		_path: string,
		_content: string,
		_mtime: number,
		_version?: number,
		clientId?: string,
	) {
		return Promise.resolve({ note: { id: clientId }, chunks_indexed: 1 });
	}

	test("first edit of a never-synced note pushes via REST with the minted id, NOT through CRDT", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		(mockApi.pushNote as ReturnType<typeof mock>).mockImplementation(echoClientIdPushNote);

		const file = new TFile("brand-new.md");
		engine.handleModify(file);
		await flush();

		// Never confirmed by the server yet → REST owns the first write, CRDT
		// is not touched (a crdt_msg for an unknown note_id would be dropped).
		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		const mintedId = noteIdMap.get("brand-new.md");
		expect(mintedId).not.toBeNull();
		expect(mockApi.pushNote).toHaveBeenCalledWith(
			"brand-new.md",
			"body",
			expect.any(Number),
			undefined,
			mintedId,
		);
	});

	test("after the REST push confirms the note, a subsequent edit routes through CRDT (not REST again)", async () => {
		const engine = createEngine();
		const noteIdMap = new NoteIdMap();
		engine.setNoteIdMap(noteIdMap);
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		(mockApi.pushNote as ReturnType<typeof mock>).mockImplementation(echoClientIdPushNote);

		const file = new TFile("brand-new.md");

		// First edit: unconfirmed → REST creates the row and confirms the id.
		engine.handleModify(file);
		await flush();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).not.toHaveBeenCalled();

		// Second edit (genuinely different content, so echo suppression doesn't
		// short-circuit it): now confirmed → must route through CRDT, not REST.
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("edited body");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith(noteIdMap.get("brand-new.md"), "edited body");
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
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
// Duplication guard (manual sync right after a live CRDT edit):
// the REST batch push (fullSync → pushModifiedFiles → pushNotesViaBatch) must
// skip a CRDT-owned note — one the socket already delivers (crdt wired && known
// note_id && confirmed && live, within the CRDT size cap). Re-POSTing the full
// body duplicates it: the server re-seeds it into the live CRDT room and the
// doubled line flushes back. Mirrors pushFile's own CRDT gate. Notes CRDT does
// NOT own (unconfirmed, or over the size cap) must still reach REST.
// ---------------------------------------------------------------------------

describe("batch push skips CRDT-owned notes so a live edit is not re-sent", () => {
	test("a confirmed, live, in-cap note is skipped by pushNotesViaBatch (no duplicate re-send)", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("note.md", "id-note");
		const engine = createEngine(noteIdMap);
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		// rest-first fix: only a server-confirmed note routes through CRDT.
		markConfirmed(engine, "id-note");

		// Clean batch mock: resolve OK so a stray call registers a call (and does
		// not flip batchPushUnsupported via the shared 404-reject default).
		const batch = mockApi.pushNotesBatch as ReturnType<typeof mock>;
		batch.mockReset().mockResolvedValue({ results: [{ path: "note.md", status: "ok" }] });

		// Live edit: routed through CRDT, delivered over the socket.
		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);

		// Manual sync's batch push must NOT re-send the note the socket already
		// delivered.
		await (
			engine as unknown as {
				pushNotesViaBatch: (f: TFile[], force: boolean) => Promise<unknown>;
			}
		).pushNotesViaBatch([file], false);

		expect(batch).not.toHaveBeenCalled();
	});

	test("a confirmed note over the CRDT size cap is NOT skipped — CRDT declined it, so REST must still deliver", async () => {
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("big.md", "id-big");
		const engine = createEngine(noteIdMap);
		engine.setCrdtManager({ applyLocalEdit: mock(async () => true) } as any);
		markConfirmed(engine, "id-big");

		const batch = mockApi.pushNotesBatch as ReturnType<typeof mock>;
		batch.mockReset().mockResolvedValue({ results: [{ path: "big.md", status: "ok" }] });

		// Over MAX_CRDT_NOTE_BYTES (4 MB), under the 10 MB batch cap: routeModify
		// declines it in the live path (WS frame limit), so pushFile falls through
		// to REST. The batch guard must NOT treat it as CRDT-owned, or manual Sync
		// silently drops a note the socket never carried.
		const file = new TFile("big.md");
		(file as unknown as { stat: unknown }).stat = {
			mtime: Date.now(),
			ctime: 0,
			size: 5 * 1024 * 1024,
		};

		await (
			engine as unknown as {
				pushNotesViaBatch: (f: TFile[], force: boolean) => Promise<unknown>;
			}
		).pushNotesViaBatch([file], false);

		expect(batch).toHaveBeenCalledTimes(1);
	});
});

describe("teardown: setCrdtManager(null) degrades subsequent edits to legacy", () => {
	test("after teardown clears the crdt manager, handleModify routes to pushNote", async () => {
		const engine = createEngine();
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll: mock() } as any);

		// Simulate the teardown calls from setupNoteStream (the Important-1 fix).
		// A destroyed manager must not be reachable — teardown clears both seams.
		engine.setCrdtManager(null);
		engine.setCrdtEnrollment(null);

		// A subsequent md edit must fall through to the legacy pushNote path,
		// NOT call applyLocalEdit on the now-nulled (formerly-destroyed) manager.
		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
	});
});

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
