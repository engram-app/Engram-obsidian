/**
 * Tests: CRDT routing in SyncEngine.
 * - markdown modify → CrdtManager.applyLocalEdit, NOT api.pushNote
 * - binary modify → legacy path (NOT CrdtManager)
 * - flushFromCrdt → vault.modify + echo suppression
 * - onFlushToDisk echo: remote-applied disk write does not re-enqueue a local push
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
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
			{ isMarkdown: true, path: "n.md", readContent: async () => "body" },
			{ applyLocalEdit } as any,
			BIG,
		);
		expect(result).toBe(true);
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith("n.md", "body");
		expect(pushNote).not.toHaveBeenCalled();
	});

	test("binary modify does NOT route to CRDT, returns false", async () => {
		const applyLocalEdit = mock(async () => {});
		const pushNote = mock(async () => ({ note: {}, chunks_indexed: 1 }));
		const result = await routeModify(
			{ isMarkdown: false, path: "img.png", readContent: async () => "" },
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
			{ isMarkdown: true, path: "big.md", readContent: async () => huge },
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
			{ isMarkdown: true, path: "emoji.md", readContent: async () => emoji },
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

function flush(ms = 50): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: {}, chunks_indexed: 1 });
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
	(mockApp.vault.modify as ReturnType<typeof mock>).mockReset().mockResolvedValue(undefined);
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
});

describe("SyncEngine handleModify with CrdtManager", () => {
	test("markdown modify calls applyLocalEdit, NOT pushNote", async () => {
		const engine = createEngine();
		// applyLocalEdit must return true so pushFile treats the edit as consumed
		// and does NOT fall through to pushNote (handshake-gate fix: routeModify
		// now forwards applyLocalEdit's boolean, so a void/falsy mock falls through).
		const applyLocalEdit = mock(async () => true);
		const mockCrdt = { applyLocalEdit } as any;
		engine.setCrdtManager(mockCrdt);

		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith("note.md", "body");
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
		const engine = createEngine();
		// applyLocalEdit must return true so pushFile treats the edit as consumed
		// and does not fall through to pushNote (handshake-gate fix).
		const applyLocalEdit = mock(async () => true);
		engine.setCrdtManager({ applyLocalEdit } as any);

		const file = new TFile("Canvases/overview.md");
		engine.handleModify(file);
		await flush();

		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit).toHaveBeenCalledWith("Canvases/overview.md", "body");
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Review finding 3+4a: declined path — legacy push AND conditional enroll
// ---------------------------------------------------------------------------

describe("SyncEngine declined CRDT path (applyLocalEdit returns false)", () => {
	test("declined md fires legacy pushNote AND enroll for a small file", async () => {
		const engine = createEngine();
		// applyLocalEdit returns false → routeModify returns false → declined path.
		const applyLocalEdit = mock(async () => false);
		const enroll = mock((_path: string) => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		engine.setCrdtEnrollment({ enroll } as any);

		// Default cachedRead returns "body" (well under MAX_CRDT_NOTE_BYTES).
		const file = new TFile("note.md");
		engine.handleModify(file);
		await flush();

		// Legacy push must fire.
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		// Enroll must also fire (kicks off the STEP1 handshake for the declined note).
		expect(enroll).toHaveBeenCalledWith("note.md");
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
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(null);

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
		const engine = createEngine();
		const applyLocalEdit = mock(async () => {});
		engine.setCrdtManager({ applyLocalEdit } as any);

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
			{ path: "n.md", diskContent: "line one\nline two" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				corrupted = true;
			},
		);
		expect(applyLocalEdit).toHaveBeenCalledWith("n.md", "line one\nline two");
		expect(corrupted).toBe(false);
	});

	test("disk matches Y.Doc: applyLocalEdit NOT called (already in sync)", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "same content");
		const projectedText = mock(async () => "same content");
		let corrupted = false;
		await reconcileColdStart(
			{ path: "n.md", diskContent: "same content" },
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
			{ path: "n.md", diskContent: "some content" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				corrupted = true;
			},
		);
		expect(applyLocalEdit).not.toHaveBeenCalled();
		expect(corrupted).toBe(true);
	});

	test("CRDT does NOT invoke conflict modal on normal cold-start divergence", async () => {
		const applyLocalEdit = mock(async () => {});
		const getText = mock(async () => "old content");
		const projectedText = mock(async () => "old content");
		let conflictModalShown = false;
		await reconcileColdStart(
			{ path: "n.md", diskContent: "old content\nnew line" },
			{ applyLocalEdit, getText, projectedText } as any,
			() => {
				conflictModalShown = true;
			},
		);
		expect(conflictModalShown).toBe(false);
	});
});
