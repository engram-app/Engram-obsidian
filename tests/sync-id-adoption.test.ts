/**
 * Fresh-note identity adoption + live reconcile (2026-07-07 prod incident).
 *
 * A create-race mints two ids for one path: another writer (MCP/web) creates
 * the note first with a server-minted id, while the plugin holds its own
 * locally-minted uuidv7. The single-note pushFile path already adopts the
 * authoritative `resp.note.id` — but the BATCH push and the OFFLINE-QUEUE
 * replay never did (and never even sent the minted id), leaving the note
 * cross-wired: sends work (REST by path), receives are dead (announces are
 * keyed by the server id the plugin never learned). The announce path also
 * only healed at cold start.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "server-minted-id" }, chunks_indexed: 1 }),
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
		create: mock().mockResolvedValue(undefined),
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

function manifestWith(notes: Array<{ id: string; path: string }>) {
	(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValue({
		notes: notes.map((n) => ({ ...n, content_hash: "h" })),
		attachments: [],
		total_notes: notes.length,
		total_attachments: 0,
		change_seq: 1,
	});
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: { id: "server-minted-id" }, chunks_indexed: 1 });
	(mockApi.pushNotesBatch as ReturnType<typeof mock>)
		.mockReset()
		.mockRejectedValue({ status: 404 });
	(mockApi.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
	(mockApp.vault.getFiles as ReturnType<typeof mock>).mockReset().mockReturnValue([]);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
});

describe("batch push adopts the authoritative note id (create-race heal)", () => {
	test("sends the minted id per entry and adopts result.id into the map + confirms it", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);

		const files = [new TFile("fresh.md")];
		mockApp.vault.getFiles.mockReturnValue(files);
		(mockApi.pushNotesBatch as ReturnType<typeof mock>).mockReset().mockResolvedValue({
			results: [
				{
					path: "fresh.md",
					status: "ok",
					// The create-race: another writer owns the path; the server
					// keeps ITS id and echoes it — different from the plugin mint.
					id: "server-won-the-race",
					version: 1,
					content_hash: "srv-h",
					server_path: "fresh.md",
				},
			],
		});

		await engine.pushAll();

		// The request carried the plugin's minted uuidv7 (so a clean create
		// keeps the client id — parity with pushFile).
		const sent = (mockApi.pushNotesBatch as ReturnType<typeof mock>).mock.calls[0][0];
		expect(sent[0].id).toMatch(UUID_RE);

		// The response id WON: the map is rebound to the server's identity and
		// the id is confirmed so subsequent edits route CRDT (receive path alive).
		expect(map.get("fresh.md")).toBe("server-won-the-race");
		expect((engine as any).isNoteConfirmed("server-won-the-race")).toBe(true);
	});
});

describe("batch push does not revert a mid-flight local rename (#245)", () => {
	test("skips the sanitize-rename and state recording when the file moved during the batch", async () => {
		const engine = createEngine();
		const file = new TFile("RenameOld.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>)
			.mockReset()
			.mockImplementation((p: string) => (p === file.path ? file : null));
		(mockApi.pushNotesBatch as ReturnType<typeof mock>)
			.mockReset()
			.mockImplementation(async (entries: Array<{ path: string }>) => {
				// The user renames the file while the batch request is in flight.
				file.path = "RenameNew.md";
				return {
					results: entries.map((e) => ({
						path: e.path,
						status: "ok",
						id: "srv-id",
						version: 1,
						content_hash: "srv-h",
						server_path: e.path, // no sanitization — echoes the pushed path
					})),
				};
			});

		const pushed = await engine.pushAll();

		// Pre-fix failure modes: (a) server_path (RenameOld) !== live file.path
		// (RenameNew) reads as "server sanitized" and renames the file BACK,
		// losing the rename; (b) the result row is matched by LIVE path, misses,
		// and a successful push is mis-counted as "missing batch result" failed.
		expect(mockApp.vault.rename).not.toHaveBeenCalled();
		expect(file.path).toBe("RenameNew.md");
		expect(pushed).toBe(1);
	});
});

describe("offline-queue replay adopts the authoritative note id", () => {
	test("sends the minted id and adopts resp.note.id into the map + confirms it", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);

		engine.queue.load([
			{ path: "queued.md", action: "upsert", content: "X", mtime: 100, timestamp: 1 },
		]);
		(mockApi.pushNote as ReturnType<typeof mock>)
			.mockReset()
			.mockResolvedValue({ note: { id: "server-won-the-race" }, chunks_indexed: 1 });

		await engine.flushQueue();

		// pushNote(path, content, mtime, version?, clientId?) — the replay must
		// carry the minted id like a live push does.
		const call = (mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0];
		expect(call[call.length - 1]).toMatch(UUID_RE);

		expect(map.get("queued.md")).toBe("server-won-the-race");
		expect((engine as any).isNoteConfirmed("server-won-the-race")).toBe(true);
	});
});

describe("ensureNoteIdMapped — live reconcile on an unmappable announce id", () => {
	test("unknown id triggers a manifest reconcile that learns the mapping", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		manifestWith([{ id: "announced-id", path: "made-elsewhere.md" }]);

		engine.ensureNoteIdMapped("announced-id");
		await new Promise((r) => setTimeout(r, 50));

		expect(map.pathForId("announced-id")).toBe("made-elsewhere.md");
	});

	test("a known id is a no-op (no manifest fetch)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		map.set("known.md", "known-id");
		engine.setNoteIdMap(map);

		engine.ensureNoteIdMapped("known-id");
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.getManifest).not.toHaveBeenCalled();
	});

	test("a burst of unknown ids coalesces into bounded manifest fetches", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		manifestWith([
			{ id: "id-1", path: "a.md" },
			{ id: "id-2", path: "b.md" },
			{ id: "id-3", path: "c.md" },
		]);

		engine.ensureNoteIdMapped("id-1");
		engine.ensureNoteIdMapped("id-2");
		engine.ensureNoteIdMapped("id-3");
		await new Promise((r) => setTimeout(r, 100));

		// One in-flight reconcile plus at most one trailing rerun.
		expect(
			(mockApi.getManifest as ReturnType<typeof mock>).mock.calls.length,
		).toBeLessThanOrEqual(2);
		expect(map.pathForId("id-1")).toBe("a.md");
		expect(map.pathForId("id-2")).toBe("b.md");
		expect(map.pathForId("id-3")).toBe("c.md");
	});
});
