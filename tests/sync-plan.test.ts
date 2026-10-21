import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { CRDT_HEAD_CREATED, fnv1a, SyncEngine } from "../src/sync";
import type { SyncProgress } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

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

	// A re-plan mid-run (a reconnect fires one) enumerates a server snapshot that
	// can predate the pull that just landed these files. Classifying on the
	// snapshot ALONE then offers the freshly-downloaded vault straight back as an
	// upload — the "N files to upload" symptom, reported again 2026-08-19 as the
	// preview flipping to uploading what it had just downloaded.
	//
	// `crdtHead` is the second half of the answer and the pull path already
	// records it (`markServerKnown`), but `computeSyncPlan` never consulted it:
	// one question, two predicates, and only one of them was wired up. The
	// 2026-08-13 fix taught the WRITE-ROUTING leg (`hasServerNote`) and left the
	// planner reading the snapshot alone, which is why `test_90` stayed green
	// (it asserts `pushed == 0`, downstream of the miscount) while the number the
	// modal renders stayed wrong.
	test("a freshly PULLED note is not offered back as an upload when the server snapshot lags", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([makeTFile("Notes/pulled.md")]);
		// Snapshot predates the pull: the op-log knows nothing about this path.
		wireFeed(engine, [[]]);
		// What the pull path leaves behind for a note the server demonstrably holds.
		(engine as any).syncState.set("Notes/pulled.md", { crdtHead: CRDT_HEAD_CREATED });

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).not.toContain("Notes/pulled.md");
	});

	// The fence above must not swallow genuinely local-only notes: absent a
	// recorded head, an unknown path is still new and still uploads.
	test("a local-only note with no recorded head still counts as toPush", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([makeTFile("Notes/brand-new.md")]);
		wireFeed(engine, [[]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toContain("Notes/brand-new.md");
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
			files: 1,
			failed: 0,
			serverIds: new Set<string>(),
			serverAttachmentPaths: new Set<string>(),
			ran: true,
			complete: true,
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

// ---------------------------------------------------------------------------
// The plan reads ONE ignore-filtered view of both sides. Local files were
// always filtered through shouldIgnore; server rows were not, so a server note
// at an ignored path read as "server has it, local is missing" — a planned
// pull the sync then skipped, and a server count no local count could match.
// ---------------------------------------------------------------------------

let seqCounter = 0;
function noteRow(path: string, opts: { id?: string; deleted?: boolean } = {}) {
	seqCounter++;
	return opts.deleted
		? { type: "note", id: opts.id ?? `id-${path}`, seq: seqCounter, path, deleted: true }
		: {
				type: "note",
				id: opts.id ?? `id-${path}`,
				seq: seqCounter,
				path,
				content: `body of ${path}`,
				content_hash: `H-${path}`,
				deleted: false,
			};
}
function attRow(path: string, deleted = false) {
	seqCounter++;
	return { type: "attachment", seq: seqCounter, path, deleted };
}

/** Every path the plan names anywhere — counts are checked separately. */
function everyPlanPath(plan: Awaited<ReturnType<SyncEngine["computeSyncPlan"]>>): string[] {
	return [
		...plan.localPaths,
		...plan.serverPaths,
		...plan.toPush.notes,
		...plan.toPush.attachments,
		...plan.toPull.notes,
		...plan.toPull.attachments,
		...plan.conflicts,
		...plan.toDeleteLocal,
		...plan.toDeleteRemote,
	];
}

describe("computeSyncPlan respects the ignore list on the SERVER side", () => {
	test("server notes and attachments at ignored paths are absent from every count and list", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/\nsecret.md" });
		mockApp.vault.getFiles.mockReturnValue([makeTFile("local.md")]);
		wireFeed(engine, [
			[
				noteRow("keep.md"),
				noteRow("drafts/a.md"),
				noteRow("deep/drafts/b.md"),
				noteRow("notes/secret.md"),
				noteRow(".trash/old.md"),
				noteRow(".git/HEAD.md"),
				noteRow(".obsidian/workspace.md"),
				attRow("img/keep.png"),
				attRow("drafts/pic.png"),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.serverNoteCount).toBe(1);
		expect(plan.serverAttachmentCount).toBe(1);
		expect(plan.serverFolderCount).toBe(1); // "img" only
		expect(plan.serverPaths.sort()).toEqual(["img/keep.png", "keep.md"]);
		expect(plan.toPull.notes).toEqual(["keep.md"]);
		expect(plan.toPull.attachments).toEqual(["img/keep.png"]);
		for (const p of everyPlanPath(plan)) expect(engine.shouldIgnore(p)).toBe(false);
		// USER ignores only: drafts/a.md, deep/drafts/b.md, notes/secret.md,
		// drafts/pic.png. The built-ins (.trash/, .git/, configDir) are hidden
		// but never counted.
		expect(plan.ignoredCount).toBe(4);
	});

	test("tombstones at ignored paths do not produce local deletes", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		mockApp.vault.getFiles.mockReturnValue([
			makeTFile("drafts/gone.md"),
			makeTFile("drafts/gone.png"),
			makeTFile("real-gone.md"),
		]);
		wireFeed(engine, [
			[
				noteRow("drafts/gone.md", { deleted: true }),
				attRow("drafts/gone.png", true),
				noteRow("real-gone.md", { deleted: true }),
			],
		]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toDeleteLocal).toEqual(["real-gone.md"]);
		// A tombstone is not a file: only the two ignored LOCAL files count.
		expect(plan.ignoredCount).toBe(2);
	});

	test("a path ignored on both sides counts once", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		mockApp.vault.getFiles.mockReturnValue([makeTFile("drafts/both.md")]);
		wireFeed(engine, [[noteRow("drafts/both.md")]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.ignoredCount).toBe(1);
		expect(plan.localNoteCount).toBe(0);
		expect(plan.serverNoteCount).toBe(0);
	});

	test("local and server counts agree when the only differences are ignored", async () => {
		const engine = createEngine({ ignorePatterns: "private/" });
		const shared = makeTFile("shared.md");
		mockApp.vault.getFiles.mockReturnValue([shared, makeTFile("private/local-only.md")]);
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "shared.md" ? shared : null,
		);
		mockApp.vault.cachedRead.mockResolvedValue("body of shared.md");
		wireFeed(engine, [[noteRow("shared.md"), noteRow("private/server-only.md")]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.localNoteCount).toBe(plan.serverNoteCount);
		expect(plan.toPull.notes).toEqual([]);
		expect(plan.toPush.notes).toEqual([]);
		expect(plan.ignoredCount).toBe(2);
		mockApp.vault.getFileByPath.mockReset().mockReturnValue(null);
	});

	test("an empty ignore list ignores only the built-ins", async () => {
		const engine = createEngine({ ignorePatterns: "" });
		mockApp.vault.getFiles.mockReturnValue([makeTFile("a.md")]);
		wireFeed(engine, [[noteRow("drafts/b.md"), noteRow(".trash/c.md")]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toEqual(["drafts/b.md"]);
		expect(plan.serverNoteCount).toBe(1);
		expect(plan.ignoredCount).toBe(0); // .trash/ is a built-in, not counted
	});

	test('leading-slash patterns keep main\'s semantics: "/" and "/x/" match nothing', async () => {
		const engine = createEngine({ ignorePatterns: "/\n/x/\n/top.md" });
		for (const p of ["a.md", "x/a.md", "sub/x/b.md", "top.md", "sub/top.md"]) {
			expect(engine.shouldIgnore(p)).toBe(false);
		}
		mockApp.vault.getFiles.mockReturnValue([makeTFile("x/l.md")]);
		wireFeed(engine, [[noteRow("x/s.md")]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPush.notes).toEqual(["x/l.md"]);
		expect(plan.toPull.notes).toEqual(["x/s.md"]);
		expect(plan.ignoredCount).toBe(0);
	});

	test("a path both built-in and user-ignored is not counted, on either side", async () => {
		const engine = createEngine({ ignorePatterns: ".trash/\nlocal-trash/" });
		mockApp.vault.getFiles.mockReturnValue([
			makeTFile(".trash/l.md"),
			makeTFile("local-trash/l.md"),
		]);
		wireFeed(engine, [[noteRow(".trash/s.md"), noteRow("local-trash/s.md")]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.ignoredCount).toBe(2); // local-trash/l.md + local-trash/s.md
	});

	test("per-file ignores from Sync Center apply to server rows too", async () => {
		const engine = createEngine();
		engine.ignoredFiles.add("remote/odd.md");
		wireFeed(engine, [[noteRow("remote/odd.md")]]);

		const plan = await engine.computeSyncPlan("full");

		expect(plan.toPull.notes).toEqual([]);
		expect(plan.serverNoteCount).toBe(0);
		expect(plan.ignoredCount).toBe(1);
	});
});

describe("reconcile respects the ignore list on the server side", () => {
	test("server notes at ignored paths are not reported as extraOnServer", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		(mockApi.getManifest as jest.Mock).mockResolvedValue({
			notes: [
				{ path: "drafts/x.md", content_hash: "h1" },
				{ path: "real.md", content_hash: "h2" },
			],
			attachments: [],
			total_notes: 2,
			total_attachments: 0,
		});

		const result = await engine.reconcile();

		expect(result?.extraOnServer).toEqual(["real.md"]);
	});
});

describe("pushAll({ replaceRemote }) never deletes server rows at ignored paths", () => {
	test("server-only notes and attachments at ignored paths survive the replace", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		mockApp.vault.getFiles.mockReturnValue([]);
		const crdtDelete = mock().mockResolvedValue(undefined);
		engine.setCrdtDelete(crdtDelete);
		wireFeed(engine, [
			[
				noteRow("extra.md", { id: "n-extra" }),
				noteRow("drafts/keep.md", { id: "n-ignored" }),
				// Renamed INTO an ignored folder: its final path is what counts.
				noteRow("moved.md", { id: "n-moved" }),
				noteRow("drafts/moved.md", { id: "n-moved" }),
				attRow("drafts/pic.png"),
				attRow("extra.png"),
			],
		]);

		await engine.pushAll({ replaceRemote: true });

		expect(crdtDelete.mock.calls.map((c) => c[0])).toEqual(["n-extra"]);
		expect((mockApi.deleteAttachment as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
			"extra.png",
		]);
	});
});

describe("seq replay server sets: the LAST row decides, tombstones included", () => {
	test("replace-remote does not re-delete a note the server already tombstoned", async () => {
		const engine = createEngine();
		mockApp.vault.getFiles.mockReturnValue([]);
		const crdtDelete = mock().mockResolvedValue(undefined);
		engine.setCrdtDelete(crdtDelete);
		wireFeed(engine, [
			[
				noteRow("dead.md", { id: "n-dead" }),
				noteRow("dead.md", { id: "n-dead", deleted: true }),
				attRow("dead.png"),
				attRow("dead.png", true),
				noteRow("extra.md", { id: "n-extra" }),
			],
		]);

		await engine.pushAll({ replaceRemote: true });

		expect(crdtDelete.mock.calls.map((c) => c[0])).toEqual(["n-extra"]);
		expect(mockApi.deleteAttachment as jest.Mock).not.toHaveBeenCalled();
	});

	test("pull-all-delete trashes a local note whose id the server tombstoned", async () => {
		const engine = createEngine();
		const { NoteIdMap } = await import("../src/crdt/note-id-map");
		const map = new NoteIdMap();
		map.set("dead.md", "n-dead");
		map.set("live.md", "n-live");
		engine.setNoteIdMap(map);
		mockApp.vault.getFiles.mockReturnValue([makeTFile("dead.md"), makeTFile("live.md")]);
		// Isolate the set decision from the replay's own apply of the tombstone.
		(engine as any).applySyncChange = async () => false;
		wireFeed(engine, [
			[
				noteRow("dead.md", { id: "n-dead" }),
				noteRow("dead.md", { id: "n-dead", deleted: true }),
				noteRow("live.md", { id: "n-live" }),
			],
		]);

		await engine.pullAll({ deleteLocalExtras: true });

		const trashed = (mockApp.fileManager.trashFile as jest.Mock).mock.calls.map(
			(c) => (c[0] as TFile).path,
		);
		expect(trashed).toEqual(["dead.md"]);
	});
});

// ---------------------------------------------------------------------------
// Adversarial review: the destructive passes must not act on what the ignore
// list hides, even when the two sides disagree about a note's path or the
// ignore list changes while the sync runs.
// ---------------------------------------------------------------------------

describe("destructive passes vs ignored server rows", () => {
	test("pull-all-delete keeps a local note whose server row moved INTO an ignored folder", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		const { NoteIdMap } = await import("../src/crdt/note-id-map");
		const map = new NoteIdMap();
		map.set("notes/a.md", "n-a");
		engine.setNoteIdMap(map);
		mockApp.vault.getFiles.mockReturnValue([makeTFile("notes/a.md")]);
		(engine as any).applySyncChange = async () => false;
		wireFeed(engine, [
			[noteRow("notes/a.md", { id: "n-a" }), noteRow("drafts/a.md", { id: "n-a" })],
		]);

		await engine.pullAll({ deleteLocalExtras: true });

		// The server still has the note (at a path this device cannot see), so
		// it is not a local extra. Main kept it; trashing it is a regression.
		expect(mockApp.fileManager.trashFile as jest.Mock).not.toHaveBeenCalled();
	});

	test("pull-all-delete trashes nothing the server holds when the ignore list is cleared mid-replay", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		const { NoteIdMap } = await import("../src/crdt/note-id-map");
		const map = new NoteIdMap();
		map.set("drafts/n.md", "n-d");
		engine.setNoteIdMap(map);
		mockApp.vault.getFiles.mockReturnValue([
			makeTFile("drafts/n.md"),
			makeTFile("drafts/pic.png"),
		]);
		(engine as any).applySyncChange = async () => false;
		(engine as any).applyAttachmentChange = async () => false;
		let call = 0;
		engine.setCrdtManager({} as any);
		engine.setCrdtLiveCheck(() => true);
		const pages = [
			[noteRow("drafts/n.md", { id: "n-d" }), attRow("drafts/pic.png")],
			[noteRow("other.md", { id: "n-o" })],
		];
		engine.setCrdtCatchupSince(async () => {
			// The user un-ignores drafts/ while the replay walks the feed.
			if (call === 1) engine.updateSettings({ ...DEFAULT_SETTINGS, ignorePatterns: "" });
			const changes = pages[call] ?? [];
			call++;
			return {
				changes,
				has_more: call < pages.length,
				next_seq: changes.length ? changes[changes.length - 1].seq : null,
			};
		});

		await engine.pullAll({ deleteLocalExtras: true });

		expect(mockApp.fileManager.trashFile as jest.Mock).not.toHaveBeenCalled();
	});

	test("replace-remote deletes nothing when the ignore list changes during the sync", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		mockApp.vault.getFiles.mockReturnValue([]);
		const crdtDelete = mock().mockResolvedValue(undefined);
		engine.setCrdtDelete(crdtDelete);
		const localSnapshot = engine.snapshotLocalPaths();
		const ignoreKey = engine.ignoreKey();
		let call = 0;
		engine.setCrdtManager({} as any);
		engine.setCrdtLiveCheck(() => true);
		const pages = [[noteRow("drafts/s.md", { id: "n-s" }), attRow("drafts/s.png")]];
		engine.setCrdtCatchupSince(async () => {
			if (call === 0) engine.updateSettings({ ...DEFAULT_SETTINGS, ignorePatterns: "" });
			const changes = pages[call] ?? [];
			call++;
			return {
				changes,
				has_more: call < pages.length,
				next_seq: changes.length ? changes[changes.length - 1].seq : null,
			};
		});

		await engine.pushAll({ replaceRemote: true, localSnapshot, ignoreKey });

		// The preview promised drafts/ survives; the run must not disagree.
		expect(crdtDelete).not.toHaveBeenCalled();
		expect(mockApi.deleteAttachment as jest.Mock).not.toHaveBeenCalled();
	});

	test("replace-remote deletes nothing when the ignore list changed after the snapshot", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		mockApp.vault.getFiles.mockReturnValue([]);
		const crdtDelete = mock().mockResolvedValue(undefined);
		engine.setCrdtDelete(crdtDelete);
		const localSnapshot = engine.snapshotLocalPaths();
		const ignoreKey = engine.ignoreKey();
		engine.updateSettings({ ...DEFAULT_SETTINGS, ignorePatterns: "" });
		wireFeed(engine, [[noteRow("drafts/s.md", { id: "n-s" })]]);

		await engine.pushAll({ replaceRemote: true, localSnapshot, ignoreKey });

		expect(crdtDelete).not.toHaveBeenCalled();
	});

	test("replace-remote stops deleting the moment the ignore list changes mid-loop", async () => {
		const engine = createEngine({ ignorePatterns: "drafts/" });
		mockApp.vault.getFiles.mockReturnValue([]);
		const crdtDelete = mock().mockImplementation(async () => {
			engine.updateSettings({ ...DEFAULT_SETTINGS, ignorePatterns: "" });
		});
		engine.setCrdtDelete(crdtDelete);
		wireFeed(engine, [
			[noteRow("a.md", { id: "n-a" }), noteRow("b.md", { id: "n-b" }), attRow("c.png")],
		]);

		await engine.pushAll({ replaceRemote: true, localSnapshot: engine.snapshotLocalPaths() });

		expect(crdtDelete).toHaveBeenCalledTimes(1);
		expect(mockApi.deleteAttachment as jest.Mock).not.toHaveBeenCalled();
	});

	test("the preview's server and local paths equal what replace-remote and pull-all-delete execute", async () => {
		const ignorePatterns = "drafts/\nsecret.md";
		const files = [makeTFile("both.md"), makeTFile("local-only.md"), makeTFile("drafts/l.md")];
		const { NoteIdMap } = await import("../src/crdt/note-id-map");
		const rows = () => [
			noteRow("both.md", { id: "n-both" }),
			noteRow("server-only.md", { id: "n-so" }),
			noteRow("drafts/s.md", { id: "n-ds" }),
			noteRow("x/secret.md", { id: "n-sec" }),
			noteRow("was.md", { id: "n-mv" }),
			noteRow("drafts/was.md", { id: "n-mv" }),
			attRow("server.png"),
			attRow("drafts/s.png"),
		];
		const freshMap = () => {
			const m = new NoteIdMap();
			m.set("both.md", "n-both");
			m.set("drafts/l.md", "n-dl");
			return m;
		};

		// Preview.
		const planner = createEngine({ ignorePatterns });
		planner.setNoteIdMap(freshMap());
		mockApp.vault.getFiles.mockReturnValue(files);
		wireFeed(planner, [rows()]);
		const plan = await planner.computeSyncPlan("push-all");
		const serverOnly = plan.serverPaths.filter((p) => !plan.localPaths.includes(p)).sort();
		const localOnly = plan.localPaths.filter((p) => !plan.serverPaths.includes(p)).sort();
		expect(serverOnly).toEqual(["server-only.md", "server.png"]);
		expect(localOnly).toEqual(["local-only.md"]);

		// Replace-remote: deletes exactly the preview's server-only paths.
		const pusher = createEngine({ ignorePatterns });
		pusher.setNoteIdMap(freshMap());
		const crdtDelete = mock().mockResolvedValue(undefined);
		pusher.setCrdtDelete(crdtDelete);
		wireFeed(pusher, [rows()]);
		await pusher.pushAll({ replaceRemote: true, localSnapshot: pusher.snapshotLocalPaths() });
		expect(crdtDelete.mock.calls.map((c) => c[0])).toEqual(["n-so"]);
		expect((mockApi.deleteAttachment as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
			"server.png",
		]);

		// Pull-all-delete: trashes exactly the preview's local-only paths.
		const puller = createEngine({ ignorePatterns });
		puller.setNoteIdMap(freshMap());
		(puller as any).applySyncChange = async () => false;
		(puller as any).applyAttachmentChange = async () => false;
		wireFeed(puller, [rows()]);
		await puller.pullAll({ deleteLocalExtras: true });
		const trashed = (mockApp.fileManager.trashFile as jest.Mock).mock.calls.map(
			(c) => (c[0] as TFile).path,
		);
		expect(trashed).toEqual(localOnly);
	});
});
