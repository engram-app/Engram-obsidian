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

	test("fullSync completion carries genesis push failures", async () => {
		const { engine, events } = makeEngine([]);
		const file = new TFile("Notes/new.md", Date.now());
		(engine as any).app.vault.getFiles = mock().mockReturnValue([file]);
		(engine as any).pushFile = mock().mockRejectedValue(
			new Error("sendRequest timeout: crdt_create"),
		);

		await engine.fullSync();

		const complete = events.find((p) => p.phase === "complete");
		expect(complete?.failed).toBe(1);
	});
});

describe("progress-stream integrity (jumping-bar + phantom-download fixes)", () => {
	test("a no-op replay row (apply returned false) is not counted as a downloaded file", async () => {
		const { engine, events } = makeEngine(threeRowFeed());
		// Second row applies as a no-op (already up to date locally).
		const apply = spyOn(engine, "applySyncChange");
		apply.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);

		const pulled = await engine.pullAll();

		expect(pulled).toBe(1);
		const complete = events.find((p) => p.phase === "complete");
		expect(complete?.current).toBe(1);
		const pulling = events.filter((p) => p.phase === "pulling" && p.current > 0);
		expect(Math.max(...pulling.map((p) => p.current), 0)).toBe(1);
	});

	test("concurrent pushModifiedFiles runs never overlap (joiner coalesces into a follow-up)", async () => {
		const { engine } = makeEngine([]);
		const file = new TFile("Notes/one.md", Date.now());
		(engine as any).app.vault.getFiles = mock().mockReturnValue([file]);
		(engine as any).pushFile = mock().mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 20));
			return true;
		});
		// The invariant that killed the jumping progress bar: at most ONE push
		// loop at a time — a joiner waits and triggers a sequential follow-up,
		// never a second interleaved loop with its own counters.
		const inner = (engine as any).pushModifiedFilesInner.bind(engine);
		let active = 0;
		let maxActive = 0;
		(engine as any).pushModifiedFilesInner = async (s?: string) => {
			active++;
			maxActive = Math.max(maxActive, active);
			try {
				return await inner(s);
			} finally {
				active--;
			}
		};

		const [a, b] = await Promise.all([engine.pushModifiedFiles(), engine.pushModifiedFiles()]);

		expect(maxActive).toBe(1);
		// Joiner shares the coalesced counts (its result additionally carries
		// the `joined` marker — see the double-report finding test below).
		expect({ pushed: b.pushed, failed: b.failed }).toEqual({
			pushed: a.pushed,
			failed: a.failed,
		});
	});
});

test("a push requested mid-run is not swallowed — one follow-up run picks it up (e2e test_39)", async () => {
	const { engine } = makeEngine([]);
	const fileA = new TFile("Notes/A.md", Date.now());
	const fileB = new TFile("Notes/B.md", Date.now());
	const vaultFiles = [fileA];
	(engine as any).app.vault.getFiles = mock(() => [...vaultFiles]);
	const pushedPaths: string[] = [];
	(engine as any).pushFile = mock().mockImplementation(async (f: TFile) => {
		pushedPaths.push(f.path);
		await new Promise((r) => setTimeout(r, 20));
		return true;
	});

	const first = engine.pushModifiedFiles();
	// B is created while the first run is already in flight — its trigger
	// must cause a follow-up run, not vanish into the joined promise.
	await new Promise((r) => setTimeout(r, 5));
	vaultFiles.push(fileB);
	const second = engine.pushModifiedFiles();
	await Promise.all([first, second]);

	expect(pushedPaths).toContain("Notes/A.md");
	expect(pushedPaths).toContain("Notes/B.md");
});

describe("review findings — genesis rejection semantics", () => {
	function genesisEngine() {
		const made = makeEngine([]);
		const trashed: string[] = [];
		(made.engine as any).trashRemotelyDeleted = async (f: TFile) => trashed.push(f.path);
		const enqueued: unknown[] = [];
		(made.engine as any).setCrdtEnqueue?.((op: unknown) => enqueued.push(op));
		if (!(made.engine as any).crdtEnqueue) {
			(made.engine as any).crdtEnqueue = (op: unknown) => enqueued.push(op);
		}
		return { ...made, trashed, enqueued };
	}

	test("crdt_create rejected recently_deleted → local copy trashed, NOT pushed, NOT enqueued (delete-wins)", async () => {
		const { engine, trashed, enqueued } = genesisEngine();
		(engine as any).crdtCreate = async () => {
			throw new Error('request failed: {"reason":"recently_deleted"}');
		};
		const file = new TFile("Notes/Deleted.md", Date.now());

		const ok = await (engine as any).pushFile(file, true);

		expect(ok).toBe(false);
		expect(trashed).toEqual(["Notes/Deleted.md"]);
		expect(enqueued).toHaveLength(0);
	});

	test("crdt_create rejected for a transient reason → enqueued for retry but NOT counted pushed", async () => {
		const { engine, trashed, enqueued } = genesisEngine();
		(engine as any).crdtCreate = async () => {
			throw new Error('request failed: {"reason":"rate_limited"}');
		};
		const file = new TFile("Notes/Limited.md", Date.now());

		const ok = await (engine as any).pushFile(file, true);

		expect(ok).toBe(false); // queued is not synced — the recap must not count it
		expect(enqueued).toHaveLength(1);
		expect(trashed).toHaveLength(0);
	});
});

describe("review findings — vault-scoped error escalation + delete counting", () => {
	test("a per-file 404 reaches onVaultScopedError even though the loop swallows it", async () => {
		const { engine } = makeEngine([]);
		const file = new TFile("Notes/x.md", Date.now());
		(engine as any).app.vault.getFiles = mock().mockReturnValue([file]);
		(engine as any).pushFile = mock().mockRejectedValue(
			Object.assign(new Error("HTTP 404"), { status: 404 }),
		);
		const seen: unknown[] = [];
		(engine as any).onVaultScopedError = (e: unknown) => seen.push(e);

		await engine.pushModifiedFiles();

		expect(seen).toHaveLength(1);
		expect((seen[0] as { status?: number }).status).toBe(404);
	});

	test("catchUp reports tombstone applies as deletes so a delete-only poll is visible", async () => {
		const { engine } = makeEngine([
			noteRow({
				id: "id-gone",
				seq: 9,
				path: "Notes/gone.md",
				deleted: true,
				content: undefined,
			}),
		]);
		const apply = spyOn(engine, "applySyncChange").mockResolvedValue(true);

		const res = await engine.catchUp();

		expect(apply).toHaveBeenCalled();
		expect(res.files).toBe(0);
		expect((res as { deletes?: number }).deletes).toBe(1);
	});
});

describe("review findings — rerun progress continuity + joiner marker", () => {
	test("a coalesced rerun continues counters from the first run instead of resetting to 0", async () => {
		const { engine, events } = makeEngine([]);
		const fileA = new TFile("Notes/A.md", Date.now());
		const fileB = new TFile("Notes/B.md", Date.now());
		const vaultFiles = [fileA];
		(engine as any).app.vault.getFiles = mock(() => [...vaultFiles]);
		(engine as any).pushFile = mock().mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 15));
			return true;
		});

		const first = engine.pushModifiedFiles();
		await new Promise((r) => setTimeout(r, 5));
		vaultFiles.push(fileB);
		const second = engine.pushModifiedFiles();
		await Promise.all([first, second]);

		const pushing = events.filter((p) => p.phase === "pushing");
		// After any event reports N pushed, no later event may report fewer.
		let high = 0;
		for (const p of pushing) {
			expect(p.current).toBeGreaterThanOrEqual(high === 0 ? 0 : Math.min(high, p.current));
			if (p.current < high) throw new Error(`progress regressed: ${p.current} after ${high}`);
			high = Math.max(high, p.current);
		}
		// Both runs' work visible cumulatively. The mocked pushFile records no
		// syncState, so the rerun legitimately re-pushes A too — the invariant
		// is monotonicity plus B's push being visible, not an exact count.
		expect(high).toBeGreaterThanOrEqual(2);
	});

	test("a joiner's result is marked joined so callers don't double-report the same push", async () => {
		const { engine } = makeEngine([]);
		const file = new TFile("Notes/one.md", Date.now());
		(engine as any).app.vault.getFiles = mock().mockReturnValue([file]);
		(engine as any).pushFile = mock().mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 15));
			return true;
		});

		const [a, b] = await Promise.all([engine.pushModifiedFiles(), engine.pushModifiedFiles()]);

		expect((a as { joined?: boolean }).joined).toBeUndefined();
		expect((b as { joined?: boolean }).joined).toBe(true);
	});
});
