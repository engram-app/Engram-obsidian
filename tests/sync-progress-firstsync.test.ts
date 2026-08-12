/**
 * Tests: first-sync progress reporting over the op-log replay.
 *
 * The sync-options modal counts FILES (the plan), but the engine used to
 * report op-log ROWS: tombstones inflated the "N synced" recap, the pull leg
 * emitted no per-file progress at all (the Downloading row froze at 0/N),
 * and both pullAll and fullSync hardcoded failed:0 on completion. These pin
 * the fixed contract: per-file "pulling" events, file-unit completion counts,
 * and real failure tallies. Mock-engine pattern mirrors
 * tests/sync-socket-catchup.test.ts.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type SyncChange, type SyncProgress } from "../src/types";

const makeApi = () =>
	({
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
		getManifest: mock().mockResolvedValue({ unchanged: true }),
		registerVault: mock().mockResolvedValue({
			id: "v1",
			name: "Test",
			slug: "test",
			is_default: true,
		}),
	}) as unknown as EngramApi;

const makeApp = () =>
	({
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
	}) as any;

const noteRow = (over: Partial<Extract<SyncChange, { type: "note" }>>): SyncChange => ({
	type: "note",
	id: "id-x",
	seq: 1,
	path: "Notes/x.md",
	title: "x",
	content: "hello",
	content_hash: "h",
	folder: "Notes",
	tags: [],
	mtime: 1,
	updated_at: "2026-01-01T00:00:00Z",
	deleted: false,
	...over,
});

/** 2 live notes + 1 tombstone: 3 op-log rows, 2 files. */
const threeRowFeed = (): SyncChange[] => [
	noteRow({ id: "id-a", seq: 1, path: "Notes/a.md" }),
	noteRow({ id: "id-b", seq: 2, path: "Notes/b.md" }),
	noteRow({ id: "id-dead", seq: 3, path: "Notes/dead.md", deleted: true, content: undefined }),
];

function makeEngine(feed: SyncChange[]): { engine: SyncEngine; events: SyncProgress[] } {
	const crdt: Partial<CrdtManager> = {
		hasHistory: () => Promise.resolve(false),
		applyRemoteUpdate: () => Promise.resolve(),
		encodeStateVector: () => Promise.resolve(new Uint8Array([0])),
		encodeGenesisUpdate: () => new Uint8Array([1, 2]),
		projectedText: () => Promise.resolve(""),
		closeDoc: () => {},
	};
	const engine = new SyncEngine(
		makeApp(),
		makeApi(),
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager(crdt as unknown as CrdtManager);
	engine.setReady();
	engine.setNoteIdMap(new NoteIdMap());
	engine.setCrdtCatchupSince(async () => ({
		changes: feed,
		has_more: false,
		next_seq: null,
	}));
	const events: SyncProgress[] = [];
	engine.onSyncProgress = (p) => events.push({ ...p });
	return { engine, events };
}

describe("first-sync progress reporting (op-log replay)", () => {
	test("pullAll emits per-file pulling progress; tombstones are not counted", async () => {
		const { engine, events } = makeEngine(threeRowFeed());

		await engine.pullAll();

		const pulling = events.filter((p) => p.phase === "pulling" && p.current > 0);
		expect(pulling.map((p) => p.current)).toEqual([1, 2]);
		// The tombstone row must never show up as a third downloaded file.
		expect(Math.max(...pulling.map((p) => p.current))).toBe(2);
	});

	test("pullAll completion counts files, not op-log rows", async () => {
		const { engine, events } = makeEngine(threeRowFeed());

		const pulled = await engine.pullAll();

		const complete = events.find((p) => p.phase === "complete");
		expect(complete?.current).toBe(2);
		// The Notice reads the return value — same unit.
		expect(pulled).toBe(2);
	});

	test("pullAll completion reports replay apply failures", async () => {
		const { engine, events } = makeEngine(threeRowFeed());
		const apply = spyOn(engine, "applySyncChange");
		apply.mockRejectedValueOnce(new Error("boom"));

		await engine.pullAll();

		const complete = events.find((p) => p.phase === "complete");
		expect(complete?.failed).toBe(1);
		// The failed row is not a synced file.
		expect(complete?.current).toBe(1);
	});

	test("fullSync emits pulling progress and counts pulled files on completion", async () => {
		const { engine, events } = makeEngine(threeRowFeed());

		const { pulled } = await engine.fullSync();

		const pulling = events.filter((p) => p.phase === "pulling" && p.current > 0);
		expect(pulling.map((p) => p.current)).toEqual([1, 2]);
		const complete = events.find((p) => p.phase === "complete");
		expect(complete?.current).toBe(2);
		expect(pulled).toBe(2);
	});

	test("fullSync completion carries genesis-batch push failures", async () => {
		const { engine, events } = makeEngine([]);
		const file = new TFile("Notes/new.md", Date.now());
		(engine as any).app.vault.getFiles = mock().mockReturnValue([file]);
		engine.setCrdtCreateBatch(async () => ({
			results: [{ doc_id: "id-new", status: "error" as const, reason: "create_failed" }],
		}));

		await engine.fullSync();

		const complete = events.find((p) => p.phase === "complete");
		expect(complete?.failed).toBe(1);
	});
});

describe("pushGenesisBatch — a timed-out chunk is counted, not fatal", () => {
	// Root cause (measured on local dev): the server needs ~13s to create a
	// 100-note chunk, the channel deadline was a flat 10s, and the resulting
	// throw aborted the ENTIRE first sync — while the server kept committing
	// the creates. A chunk-level failure must degrade to counted failures so
	// the remaining chunks (and the rest of the sync) still run. Chunks are
	// 25 notes so the Uploading row ticks every few seconds instead of
	// per-hundred.
	test("first chunk rejects → its files count as failed, second chunk still pushes", async () => {
		const { engine } = makeEngine([]);
		const files = Array.from({ length: 26 }, (_, i) => new TFile(`Notes/n${i}.md`, Date.now()));
		let calls = 0;
		engine.setCrdtCreateBatch(async (creates) => {
			calls++;
			if (calls === 1) throw new Error("sendRequest timeout: crdt_create_batch");
			return {
				results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })),
			};
		});

		const out = await (engine as any).pushGenesisBatch(files);

		expect(calls).toBe(2); // the second chunk was still attempted
		expect(out.failed).toBe(25); // the whole first chunk, counted not thrown
		expect(out.pushed).toBe(1);
	});
});
