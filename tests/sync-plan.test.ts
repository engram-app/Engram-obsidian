import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";
import type { SyncProgress } from "../src/types";

// Mock the API — mirrors the pattern from sync.test.ts
const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	// Legacy-backend shape: no batch endpoint — pushAll falls back to the
	// per-note path these tests assert.
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue(null),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: jest
		.fn()
		.mockResolvedValue({ id: "vault-1", name: "Test", slug: "test", is_default: true }),
} as unknown as EngramApi;

// Mock the Obsidian App
const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("# Test\n\nContent"),
		cachedRead: mock().mockResolvedValue("# Test\n\nContent"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null) as jest.Mock,
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_file: any, fn: (data: string) => string) => {
			fn("");
			return Promise.resolve("");
		}),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: {
		trashFile: mock().mockResolvedValue(undefined),
	},
	workspace: {
		getActiveViewOfType: mock().mockReturnValue(null),
	},
} as any;

const mockSaveData = mock().mockResolvedValue(undefined);

function makeTFile(path: string): TFile {
	return new TFile(path) as unknown as TFile;
}

function createEngine(overrides = {}): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 10, ...overrides },
		mockSaveData,
	);
	engine.setReady();
	return engine;
}

beforeEach(() => {
	jest.clearAllMocks();
	(mockApi.getManifest as jest.Mock).mockReset().mockResolvedValue(null);
	mockApp.vault.getFiles.mockReset().mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// enumerateServerState — the op-log fold that replaced GET /notes/changes +
// GET /attachments/changes as the preview's server inventory (#304).
// ---------------------------------------------------------------------------

function wireFeed(engine: SyncEngine, pages: any[][]) {
	let call = 0;
	engine.setCrdtManager({} as any);
	engine.setCrdtLiveCheck(() => true);
	engine.setCrdtCatchupSince(async (_cursor: number, _limit?: number) => {
		const changes = pages[call] ?? [];
		call++;
		return {
			changes,
			has_more: call < pages.length,
			next_seq: changes.length ? (changes[changes.length - 1].seq ?? null) : null,
		};
	});
}

describe("SyncEngine.enumerateServerState", () => {
	test("folds ops per note id — last seq wins (edit supersedes create)", async () => {
		const engine = createEngine();
		wireFeed(engine, [
			[
				{
					type: "note",
					id: "n1",
					seq: 1,
					path: "a.md",
					content: "v1",
					content_hash: "H1",
					deleted: false,
				},
				{
					type: "note",
					id: "n1",
					seq: 2,
					path: "a.md",
					content: "v2",
					content_hash: "H2",
					deleted: false,
				},
			],
		]);
		const s = await (engine as any).enumerateServerState();
		expect(s.notes.size).toBe(1);
		expect(s.notes.get("a.md")).toEqual({ deleted: false, content: "v2", contentHash: "H2" });
	});

	test("skips a row with a null path (leaked folder-marker op) — no bogus key", async () => {
		const engine = createEngine();
		wireFeed(engine, [
			[
				{ type: "note", id: "n1", seq: 1, path: null, content: "", deleted: false },
				{
					type: "note",
					id: "n2",
					seq: 2,
					path: "real.md",
					content: "v",
					content_hash: "H",
					deleted: false,
				},
			],
		]);
		const s = await (engine as any).enumerateServerState();
		expect(s.notes.size).toBe(1);
		expect(s.notes.has("real.md")).toBe(true);
		expect(s.notes.has(null as any)).toBe(false);
		expect(s.notes.has(undefined as any)).toBe(false);
	});

	test("a rename folds to the FINAL path only (no ghost old-path row)", async () => {
		const engine = createEngine();
		wireFeed(engine, [
			[
				{
					type: "note",
					id: "n1",
					seq: 1,
					path: "old.md",
					content: "x",
					content_hash: "H1",
					deleted: false,
				},
				{
					type: "note",
					id: "n1",
					seq: 2,
					path: "new.md",
					content: "x",
					content_hash: "H1",
					deleted: false,
				},
			],
		]);
		const s = await (engine as any).enumerateServerState();
		expect(s.notes.has("old.md")).toBe(false);
		expect(s.notes.get("new.md")?.deleted).toBe(false);
	});

	test("a tombstone folds to deleted:true; attachments fold by path", async () => {
		const engine = createEngine();
		wireFeed(engine, [
			[
				{
					type: "note",
					id: "n1",
					seq: 1,
					path: "gone.md",
					content: "x",
					content_hash: "H1",
					deleted: false,
				},
				{ type: "note", id: "n1", seq: 2, path: "gone.md", deleted: true },
				{ type: "attachment", seq: 3, path: "img.png", deleted: false },
				{ type: "attachment", seq: 4, path: "bye.png", deleted: true },
			],
		]);
		const s = await (engine as any).enumerateServerState();
		expect(s.notes.get("gone.md")?.deleted).toBe(true);
		expect(s.attachments.get("img.png")).toEqual({ deleted: false });
		expect(s.attachments.get("bye.png")).toEqual({ deleted: true });
	});

	test("walks every page (has_more pagination)", async () => {
		const engine = createEngine();
		wireFeed(engine, [
			[
				{
					type: "note",
					id: "n1",
					seq: 1,
					path: "a.md",
					content: "a",
					content_hash: "HA",
					deleted: false,
				},
			],
			[
				{
					type: "note",
					id: "n2",
					seq: 2,
					path: "b.md",
					content: "b",
					content_hash: "HB",
					deleted: false,
				},
			],
		]);
		const s = await (engine as any).enumerateServerState();
		expect([...s.notes.keys()].sort()).toEqual(["a.md", "b.md"]);
	});

	test("waits for the socket to become live, then enumerates (startup join race)", async () => {
		// On startup the preview can be computed before the crdt: join lands
		// (onCrdtJoined). Rather than fail the preview outright, enumerate waits
		// briefly for the socket to become enumerable.
		const engine = createEngine();
		engine.setCrdtManager({} as any);
		let live = false;
		engine.setCrdtLiveCheck(() => live);
		engine.setCrdtCatchupSince(async () => ({
			changes: [
				{
					type: "note",
					id: "n1",
					seq: 1,
					path: "a.md",
					content: "v",
					content_hash: "H",
					deleted: false,
				},
			] as any,
			has_more: false,
			next_seq: 1,
		}));
		setTimeout(() => {
			live = true;
		}, 120);
		const s = await (engine as any).enumerateServerState();
		expect(s.notes.get("a.md")).toEqual({ deleted: false, content: "v", contentHash: "H" });
	});

	test("throws after the wait budget when the socket never becomes live", async () => {
		const engine = createEngine();
		(engine as any).enumerateWaitMs = 150;
		engine.setCrdtManager({} as any);
		engine.setCrdtLiveCheck(() => false);
		engine.setCrdtCatchupSince(async () => ({ changes: [], has_more: false, next_seq: null }));
		await expect((engine as any).enumerateServerState()).rejects.toThrow(/live socket/);
	});

	test("threads the composite {seq,id} cursor to page past an equal-seq move pair (#312)", async () => {
		// An attachment move writes two rows at ONE seq. If the plugin pages by
		// seq only, the backend's `seq > cursor` skips the sibling. The plugin
		// must send `cursor_id` from the prior page's `next_id` so the backend
		// can continue at `(seq, id) > (cursor_seq, cursor_id)`.
		const engine = createEngine();
		engine.setCrdtManager({} as any);
		engine.setCrdtLiveCheck(() => true);
		const calls: Array<{ seq: number; id: string | null }> = [];
		let call = 0;
		engine.setCrdtCatchupSince(
			async (cursor: number, _limit?: number, cursorId?: string | null) => {
				calls.push({ seq: cursor, id: cursorId ?? null });
				if (call++ === 0) {
					return {
						changes: [
							{
								type: "note",
								id: "aaa",
								seq: 5,
								path: "new.md",
								content: "x",
								content_hash: "H",
								deleted: false,
							},
						] as any,
						has_more: true,
						next_seq: 5,
						next_id: "aaa",
					};
				}
				return {
					changes: [
						{ type: "note", id: "bbb", seq: 5, path: "old.md", deleted: true },
					] as any,
					has_more: false,
					next_seq: 5,
					next_id: "bbb",
				};
			},
		);

		const s = await (engine as any).enumerateServerState();

		// Page 2 was reached (not stopped by a seq-only `next_seq > cursor` guard)
		// AND fetched with the composite cursor from page 1's next_id.
		expect(calls[1]).toEqual({ seq: 5, id: "aaa" });
		expect(s.notes.has("new.md")).toBe(true);
		expect(s.notes.get("old.md")?.deleted).toBe(true);
	});

	test("does NOT touch the real catch-up cursor", async () => {
		const engine = createEngine();
		engine.setCatchupSeq(7);
		wireFeed(engine, [
			[
				{
					type: "note",
					id: "n1",
					seq: 99,
					path: "a.md",
					content: "a",
					content_hash: "H",
					deleted: false,
				},
			],
		]);
		await (engine as any).enumerateServerState();
		expect(engine.getCatchupSeq()).toBe(7);
	});
});

describe("SyncEngine.computeSyncPlan", () => {
	const row = (o: Partial<any> & { id: string; seq: number; path: string }) => ({
		type: "note",
		title: "t",
		folder: "",
		tags: [],
		mtime: 1,
		updated_at: "2026-01-01T00:00:00Z",
		deleted: false,
		...o,
	});

	test("empty vault and empty server returns zeroed plan", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);
		wireFeed(engine, [[]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.vaultName).toBe("Test Vault");
		expect(plan.serverNoteCount).toBe(0);
		expect(plan.localNoteCount).toBe(0);
		expect(plan.localAttachmentCount).toBe(0);
		expect(plan.toPush.notes).toEqual([]);
		expect(plan.toPush.attachments).toEqual([]);
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.toPull.attachments).toEqual([]);
		expect(plan.conflicts).toEqual([]);
		expect(plan.toDeleteLocal).toEqual([]);
		expect(plan.toDeleteRemote).toEqual([]);
	});

	test("channel down: the plan REJECTS instead of rendering a wrong empty preview", async () => {
		const engine = createEngine();
		(engine as any).enumerateWaitMs = 150;
		mockApp.vault.getFiles.mockReturnValue([]);
		engine.setCrdtManager({} as any);
		engine.setCrdtLiveCheck(() => false);
		engine.setCrdtCatchupSince(async () => ({ changes: [], has_more: false, next_seq: null }));

		await expect(engine.computeSyncPlan("full")).rejects.toThrow(/live socket/);
	});

	test("local files not on server are counted as toPush", async () => {
		const engine = createEngine();
		const files = [makeTFile("Notes/local-only.md"), makeTFile("Notes/another.md")];
		mockApp.vault.getFiles.mockReturnValue(files);
		wireFeed(engine, [[]]); // op-log knows neither path

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toContain("Notes/local-only.md");
		expect(plan.toPush.notes).toContain("Notes/another.md");
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.localNoteCount).toBe(2);
	});

	test("server rows not present locally are counted as toPull", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/remote-only.md",
					content: "# Remote",
					content_hash: "H1",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toContain("Notes/remote-only.md");
		expect(plan.toPush.notes).toEqual([]);
		expect(plan.serverNoteCount).toBe(1);
	});

	test("server tombstones are counted in toDeleteLocal — and never pushed", async () => {
		const engine = createEngine();
		const localFile = makeTFile("Notes/to-delete.md");
		mockApp.vault.getFiles.mockReturnValue([localFile]);
		mockApp.vault.getFileByPath.mockReturnValue(localFile);
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/to-delete.md",
					content: "x",
					content_hash: "H1",
				}),
				row({ id: "n1", seq: 2, path: "Notes/to-delete.md", deleted: true }),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toDeleteLocal).toContain("Notes/to-delete.md");
		expect(plan.toPull.notes).not.toContain("Notes/to-delete.md");
		// Delete-wins: a tombstoned path must not be re-pushed by the local-only leg.
		expect(plan.toPush.notes).not.toContain("Notes/to-delete.md");
	});

	test("a rename shows NO ghost work for the old path (id fold)", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);
		wireFeed(engine, [
			[
				row({ id: "n1", seq: 1, path: "Notes/old.md", content: "x", content_hash: "H1" }),
				row({ id: "n1", seq: 2, path: "Notes/new.md", content: "x", content_hash: "H1" }),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toEqual(["Notes/new.md"]);
		expect(plan.serverNoteCount).toBe(1);
	});

	test("push-all mode does not include toPull entries", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([makeTFile("Notes/local.md")]);
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/remote-only.md",
					content: "# Remote",
					content_hash: "H1",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("push-all");

		expect(plan.toPull.notes).toEqual([]);
		expect(plan.toPull.attachments).toEqual([]);
		expect(plan.toPush.notes).toContain("Notes/local.md");
	});

	test("file changed both locally and on server is a conflict", async () => {
		const engine = createEngine();
		const file = makeTFile("Notes/both-changed.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Modified locally");
		// Last converge recorded the ORIGINAL on both axes.
		engine.importSyncState({
			"Notes/both-changed.md": { hash: fnv1a("# Original"), serverHash: "OLD-HMAC" },
		});
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/both-changed.md",
					content: "# Modified on server",
					content_hash: "NEW-HMAC",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.conflicts).toContain("Notes/both-changed.md");
		expect(plan.toPull.notes).not.toContain("Notes/both-changed.md");
		expect(plan.toPush.notes).not.toContain("Notes/both-changed.md");
	});

	test("file changed only on server (local unchanged) is a pull, not conflict", async () => {
		const engine = createEngine();
		const content = "# Original";
		const file = makeTFile("Notes/server-updated.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue(content);
		engine.importHashes({ "Notes/server-updated.md": fnv1a(content) });
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/server-updated.md",
					content: "# New server content",
					content_hash: "NEW-HMAC",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toContain("Notes/server-updated.md");
		expect(plan.conflicts).not.toContain("Notes/server-updated.md");
	});

	test("fully-synced vault shows zero work (identical bytes → clean, no push storm)", async () => {
		// The PR-#31 bug shape: a fully-synced vault must never render
		// "server: 0 / local: N toPush". The op-log enumeration IS the
		// inventory, and identical bytes short-circuit to clean.
		const engine = createEngine();
		const file = makeTFile("Notes/already-synced.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Test\n\nContent");
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/already-synced.md",
					content: "# Test\n\nContent",
					content_hash: "H1",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual([]);
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.conflicts).toEqual([]);
		expect(plan.serverNoteCount).toBe(1);
		expect(plan.localNoteCount).toBe(1);
	});

	test("fresh install (no syncState) with identical server content is clean — no spurious push storm", async () => {
		const engine = createEngine();
		const file = makeTFile("Notes/fresh-install.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");
		// No syncState at all.
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/fresh-install.md",
					content: "# Content",
					content_hash: "H1",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual([]);
		expect(plan.conflicts).toEqual([]);
	});

	test("locally-modified note (server unchanged: row hash == recorded serverHash) is flagged toPush", async () => {
		const engine = createEngine();
		const file = makeTFile("Notes/edited.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("# Edited locally");
		engine.importSyncState({
			"Notes/edited.md": { hash: fnv1a("# Original"), serverHash: "SAME-HMAC" },
		});
		wireFeed(engine, [
			[
				row({
					id: "n1",
					seq: 1,
					path: "Notes/edited.md",
					content: "# Original",
					content_hash: "SAME-HMAC",
				}),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toContain("Notes/edited.md");
		expect(plan.conflicts).not.toContain("Notes/edited.md");
		expect(plan.toPull.notes).not.toContain("Notes/edited.md");
	});

	test("clean bookkeeping without row content: serverHash match + local hash match → no work", async () => {
		// A row that carries no content payload (e.g. oversized note) must still
		// classify as clean when BOTH the recorded serverHash matches the row's
		// hash AND the local hash matches the recorded one.
		const engine = createEngine();
		const content = "# Clean";
		const file = makeTFile("Notes/clean.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue(content);
		engine.importSyncState({
			"Notes/clean.md": { hash: fnv1a(content), serverHash: "SAME-HMAC" },
		});
		wireFeed(engine, [
			[row({ id: "n1", seq: 1, path: "Notes/clean.md", content_hash: "SAME-HMAC" })],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual([]);
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.conflicts).toEqual([]);
	});

	test("attachments ride the same feed: pull missing, delete tombstoned, push local-only", async () => {
		const engine = createEngine();
		const localImg = makeTFile("img/local-only.png");
		const localGone = makeTFile("img/server-deleted.png");
		mockApp.vault.getFiles.mockReturnValue([localImg, localGone]);
		wireFeed(engine, [
			[
				{ type: "attachment", seq: 1, path: "img/remote-only.png", deleted: false },
				{ type: "attachment", seq: 2, path: "img/server-deleted.png", deleted: true },
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.attachments).toContain("img/remote-only.png");
		expect(plan.toDeleteLocal).toContain("img/server-deleted.png");
		expect(plan.toPush.attachments).toContain("img/local-only.png");
		expect(plan.toPush.attachments).not.toContain("img/server-deleted.png");
	});

	test("ignored files (.obsidian/) are excluded from plan", async () => {
		const engine = createEngine();
		const files = [
			makeTFile(".obsidian/config.json"),
			makeTFile(".obsidian/plugins/some-plugin/main.js"),
			makeTFile("Notes/legit.md"),
		];
		mockApp.vault.getFiles.mockReturnValue(files);
		wireFeed(engine, [[]]);

		const plan = await engine.computeSyncPlan("full");

		const allPaths = [
			...plan.toPush.notes,
			...plan.toPush.attachments,
			...plan.toPull.notes,
			...plan.toPull.attachments,
		];
		expect(allPaths).not.toContain(".obsidian/config.json");
		expect(allPaths).not.toContain(".obsidian/plugins/some-plugin/main.js");
		expect(plan.toPush.notes).toContain("Notes/legit.md");
	});
});

describe("SyncEngine.pushAll with progress", () => {
	test("emits progress events during pushAll", async () => {
		// Set up mock files
		const file1 = makeTFile("notes/a.md");
		const file2 = makeTFile("notes/b.md");
		mockApp.vault.getFiles.mockReturnValue([file1, file2]);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");
		(mockApi.pushNote as jest.Mock).mockResolvedValue({ note: {}, chunks_indexed: 1 });

		const engine = createEngine();
		const progressEvents: SyncProgress[] = [];
		engine.onSyncProgress = (p) => progressEvents.push({ ...p });

		const { SyncLog } = await import("../src/sync-log");
		engine.syncLog = new SyncLog();

		await engine.pushAll();

		// Should have at least a start and complete event
		expect(progressEvents.length).toBeGreaterThanOrEqual(2);
		expect(progressEvents[0].phase).toBe("pushing");
		expect(progressEvents[0].current).toBe(0);
		expect(progressEvents[progressEvents.length - 1].phase).toBe("complete");

		// SyncLog should have entries
		expect(engine.syncLog.entries().length).toBeGreaterThan(0);
	});

	test("pullAll({ deleteLocalExtras: true }) trashes local extras absent from the replay's server id-set", async () => {
		// REST-purge Bucket B (Task 5): pullAll no longer blind-wipes every local
		// file before a REST re-fetch — it replays via
		// catchupViaSeqReplay({fromZero:true}) and trashes only local notes whose
		// mapped id is absent from the replay's serverIds (both files here have
		// no id mapping at all — createEngine() below never wires a noteIdMap —
		// so both count as extras, same as the old "no id learned yet" case).
		const file1 = makeTFile("notes/a.md");
		const file2 = makeTFile("notes/b.md");
		mockApp.vault.getFiles.mockReturnValue([file1, file2]);
		mockApp.vault.cachedRead.mockResolvedValue("# Content");
		mockApp.vault.getFileByPath.mockReturnValue(null);

		const engine = createEngine();
		const { SyncLog } = await import("../src/sync-log");
		engine.syncLog = new SyncLog();
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 1,
			serverIds: new Set<string>(),
			serverAttachmentPaths: new Set<string>(),
			ran: true,
		});

		// Seed some sync state that should be cleared
		engine.importHashes({ "notes/a.md": 12345 });

		const applied = await engine.pullAll({ deleteLocalExtras: true });

		expect(applied).toBe(1);
		// Both local files should have been trashed
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledTimes(2);

		// Sync log should have delete entries for the wipe
		const deleteEntries = engine.syncLog.entries().filter((e) => e.action === "delete");
		expect(deleteEntries).toHaveLength(2);
	});

	test("logs errors to syncLog when push fails", async () => {
		// An oversized .md takes the kept LWW single-note REST path (in-cap md/canvas
		// are CRDT-sole and never REST-push); the push-failure → syncLog logging under
		// test is transport-agnostic.
		const file = makeTFile("notes/fail.md");
		mockApp.vault.getFiles.mockReturnValue([file]);
		mockApp.vault.cachedRead.mockResolvedValue("a".repeat(5 * 1024 * 1024));
		(mockApi.pushNote as jest.Mock).mockRejectedValue(new Error("500 Internal Server Error"));

		const engine = createEngine();
		const { SyncLog } = await import("../src/sync-log");
		engine.syncLog = new SyncLog();

		await engine.pushAll();

		const errors = engine.syncLog.entries().filter((e) => e.result === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe("notes/fail.md");
		expect(errors[0].error).toContain("500");
	});
});
