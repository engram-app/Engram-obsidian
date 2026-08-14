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
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { destroyRemoteLog, initRemoteLog } from "../src/remote-log";
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

describe("first-sync progress honesty (#420 P2)", () => {
	test("multiple op-log rows for one note tick the file counter ONCE", async () => {
		// The plan's denominator is folded per note; a note with N ops must not
		// contribute N ticks or the bar pins at 100% while files keep arriving.
		const feed = [
			noteRow({ id: "id-a", seq: 1, path: "Notes/a.md", content: "v1" }),
			noteRow({ id: "id-a", seq: 2, path: "Notes/a.md", content: "v2" }),
			noteRow({ id: "id-b", seq: 3, path: "Notes/b.md" }),
		];
		const { engine, events } = makeEngine(feed);

		const res = await engine.catchUp({ reportProgress: true });

		expect(res.files).toBe(2);
		const pulls = events.filter((e) => e.phase === "pulling");
		expect(pulls.length).toBe(2);
		expect(pulls.map((e) => e.current)).toEqual([1, 2]);
	});

	test("a catch-up coalescing behind an in-flight replay reports the REAL file count", async () => {
		// Returning {files: 0} from the coalesced call made the one-click first
		// sync report "Already up to date" while the join-triggered replay was
		// still downloading the vault behind the modal.
		const feed = [
			noteRow({ id: "id-a", seq: 1, path: "Notes/a.md" }),
			noteRow({ id: "id-b", seq: 2, path: "Notes/b.md" }),
		];
		const { engine } = makeEngine(feed);
		let releaseFirstFetch!: () => void;
		const gate = new Promise<void>((r) => (releaseFirstFetch = r));
		let call = 0;
		engine.setCrdtCatchupSince(async () => {
			call += 1;
			if (call === 1) await gate;
			return { changes: call <= 2 ? feed : [], has_more: false, next_seq: null };
		});

		const first = engine.catchUp({ reportProgress: false });
		// Let the first call reach the (gated) fetch before the second starts.
		await new Promise((r) => setTimeout(r, 10));
		const second = engine.catchUp({ reportProgress: true });
		await new Promise((r) => setTimeout(r, 10));
		releaseFirstFetch();

		const [firstRes, secondRes] = await Promise.all([first, second]);
		expect(firstRes.files).toBe(2);
		// The coalesced caller waited for the running replay and reports what it
		// actually downloaded — not a fabricated "nothing to do".
		expect(secondRes.files).toBe(2);
	});

	test("a catch-up that dies at the boundary reports a failure, not success", async () => {
		const { engine } = makeEngine([]);
		(engine as unknown as { api: { getManifest: () => Promise<never> } }).api.getManifest =
			mock().mockRejectedValue(new Error("HTTP 401"));

		const res = await engine.catchUp({ reportProgress: true });

		// files 0 + failed 0 renders as "All synced" in the completion modal —
		// a dead-auth first sync must never claim success.
		expect(res.failed).toBeGreaterThan(0);
	});
});

describe("coalesce semantics are opt-in (#422 review round 1)", () => {
	const gatedEngine = () => {
		const feed = [
			noteRow({ id: "id-a", seq: 1, path: "Notes/a.md" }),
			noteRow({ id: "id-b", seq: 2, path: "Notes/b.md" }),
		];
		const { engine } = makeEngine(feed);
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		let call = 0;
		engine.setCrdtCatchupSince(async () => {
			call += 1;
			if (call === 1) await gate;
			return { changes: call <= 2 ? feed : [], has_more: false, next_seq: null };
		});
		return { engine, release };
	};

	test("a non-progress catch-up coalesces to zeros instantly (poll/join semantics)", async () => {
		const { engine, release } = gatedEngine();
		const owner = engine.catchUp({ reportProgress: true });
		await new Promise((r) => setTimeout(r, 10));

		// The 5-min poll and the topic-join handler depend on the old fast
		// return: blocking them behind a long replay defers the op-queue drain,
		// and real counts here fire a spurious "pulled N changes" toast.
		const start = Date.now();
		const polled = await engine.catchUp({ reportProgress: false });
		expect(polled.files).toBe(0);
		expect(Date.now() - start).toBeLessThan(200);

		release();
		await owner;
	});

	test("pull-all-keep refuses to fake success when the replay coalesces", async () => {
		const { engine, release } = gatedEngine();
		const owner = engine.catchUp({ reportProgress: true });
		await new Promise((r) => setTimeout(r, 10));

		// A coalesced pull-all never replays from zero — reporting the running
		// incremental session's counts would claim a full-vault restore that
		// did not happen.
		const pulled = await engine.pullAll({ deleteLocalExtras: false });
		expect(pulled).toBe(0);
		expect(engine.getStatus().error ?? "").toMatch(/another sync|contention|aborted/i);

		release();
		await owner;
	});

	test("attachment rows dedupe by id across a rename, like notes", async () => {
		const attRow = (over: Record<string, unknown>) =>
			({
				type: "attachment",
				id: "att-1",
				seq: 1,
				path: "Files/x.png",
				mime_type: "image/png",
				size_bytes: 3,
				mtime: 1,
				updated_at: "2026-01-01T00:00:00Z",
				deleted: false,
				...over,
			}) as unknown as SyncChange;
		const feed = [
			attRow({ seq: 1, path: "Files/x.png" }),
			attRow({ seq: 2, path: "Files/renamed.png" }),
		];
		const { engine } = makeEngine(feed);

		const res = await engine.catchUp({ reportProgress: true });
		// One attachment renamed mid-log is ONE planned file — two path-keyed
		// ticks would overrun the plan's denominator (the pinned-bar bug).
		expect(res.files).toBe(1);
	});
});

describe("coalesced callers still receive the per-file stream", () => {
	test("a progress-reporting catch-up that coalesces still gets per-file pulling events", async () => {
		// Prod 2026-08-13: on a first sync the topic-join handler always starts
		// the replay first (it is one of 11 bare `catchupViaSeqReplay()` call
		// sites), so the user's sync modal ALWAYS coalesces behind it. #422 made
		// the coalesced return report honest counts, but the early return never
		// reaches the `opts.onFileApplied` hand-off at the exclusive call site —
		// the callback is silently discarded. The modal therefore blocks for the
		// whole replay with a dead 0% bar and no filenames, then prints one
		// final number. Counts alone are not the contract; the STREAM is.
		const feed = [
			noteRow({ id: "id-a", seq: 1, path: "Notes/a.md" }),
			noteRow({ id: "id-b", seq: 2, path: "Notes/b.md" }),
		];
		const { engine, events } = makeEngine(feed);
		let releaseFirstFetch!: () => void;
		const gate = new Promise<void>((r) => (releaseFirstFetch = r));
		let call = 0;
		engine.setCrdtCatchupSince(async () => {
			call += 1;
			if (call === 1) await gate;
			return { changes: call <= 2 ? feed : [], has_more: false, next_seq: null };
		});

		// The background caller (join handler) wins the race and runs exclusively.
		const background = engine.catchUp({ reportProgress: false });
		await new Promise((r) => setTimeout(r, 10));
		// The user's modal arrives second and coalesces.
		const modal = engine.catchUp({ reportProgress: true });
		await new Promise((r) => setTimeout(r, 10));
		releaseFirstFetch();
		await Promise.all([background, modal]);

		const pulls = events.filter((e) => e.phase === "pulling");
		expect(pulls.map((e) => e.current)).toEqual([1, 2]);
		// The filenames the "Downloading <name>" row renders.
		expect(pulls.map((e) => e.currentPath)).toEqual(["Notes/a.md", "Notes/b.md"]);
	});
});

describe("hasServerNote after a handshake heal (#339)", () => {
	type Staged = {
		path: string;
		serverHash: string;
		content: string | null;
		version?: number;
		seq?: number;
	};
	const stage = (engine: SyncEngine, noteId: string, staged: Staged): void => {
		(engine as unknown as { pendingConvergence: Map<string, Staged> }).pendingConvergence.set(
			noteId,
			staged,
		);
	};

	test("a note that converged via STEP2 is known to exist on the server", async () => {
		// The server just handed us this note's full state, so it demonstrably
		// holds a row for it. Without a crdtHead the oracle says false and the
		// note's next push takes pushFile's genesis branch (the `!hasServerNote`
		// arm) instead of the live-CRDT arm — on a first sync that re-uploads the
		// WHOLE pulled vault, which surfaced as "122 files to upload" from an
		// empty local vault.
		const { engine } = makeEngine([]);
		const map = new NoteIdMap();
		map.set("Notes/a.md", "id-a");
		engine.setNoteIdMap(map);
		stage(engine, "id-a", {
			path: "Notes/a.md",
			serverHash: "h1",
			content: "server body",
			version: 3,
			seq: 7,
		});

		await engine.commitCrdtConvergence("id-a");

		expect(engine.hasServerNote("id-a")).toBe(true);
	});

	test("a note pulled by a first sync is known to exist on the server", async () => {
		// THE journey this issue is actually about, and the one my first fix
		// missed. A fresh vault materialises every note through the discovery
		// branch (`flushFromCrdt` -> `recordCrdtBaseline`, no markCreated) —
		// `commitCrdtConvergence` never runs, so driving that function directly
		// proved nothing. The row came off the server's own op-log feed, which
		// IS proof the server holds it; without a head the note's next push
		// takes pushFile's genesis branch and the whole pulled vault re-uploads.
		const { engine } = makeEngine([noteRow({ id: "id-a", seq: 1, path: "Notes/a.md" })]);

		await engine.catchUp({ reportProgress: true });

		expect(engine.hasServerNote("id-a")).toBe(true);
	});

	test("the sentinel never downgrades an authoritative crdtHead", async () => {
		// patchSyncedRow MERGES, so writing the placeholder over a real head
		// recorded by applyPushedNoteUpdate would invert the sentinel's contract
		// and defeat the convergence cost gate — re-firing STEP1 forever.
		const { engine } = makeEngine([]);
		const map = new NoteIdMap();
		map.set("Notes/a.md", "id-a");
		engine.setNoteIdMap(map);
		(engine as unknown as { setCrdtHead(p: string, h: string): void }).setCrdtHead(
			"Notes/a.md",
			"real-server-head-abc",
		);
		stage(engine, "id-a", {
			path: "Notes/a.md",
			serverHash: "h1",
			content: "server body",
			version: 3,
			seq: 7,
		});

		await engine.commitCrdtConvergence("id-a");

		const head = (
			engine as unknown as { getCrdtHead(p: string): string | undefined }
		).getCrdtHead("Notes/a.md");
		expect(head).toBe("real-server-head-abc");
	});

	test("an EMPTY converged doc does NOT claim the server has the note", async () => {
		// Boundary guard: a handshake that returns nothing is not proof of a
		// server row, and genesis is the correct route for it. Setting the
		// sentinel here would strand a genuinely-new note with no create.
		const { engine } = makeEngine([]);
		const map = new NoteIdMap();
		map.set("Notes/empty.md", "id-empty");
		engine.setNoteIdMap(map);
		stage(engine, "id-empty", {
			path: "Notes/empty.md",
			serverHash: "h0",
			content: "",
			version: 1,
			seq: 1,
		});

		await engine.commitCrdtConvergence("id-empty");

		expect(engine.hasServerNote("id-empty")).toBe(false);
	});
});

describe("replay outcome summary (prod 2026-08-13 blindness)", () => {
	// initRemoteLog() installs a GLOBAL singleton. Leaving it configured leaks a
	// live logger into every later test file in the process — it made
	// crdt/wiring.test.ts fail in the full run while passing alone.
	afterEach(async () => {
		await destroyRemoteLog();
	});

	/** Capture what the plugin would ship, with diagnostics OFF — the default,
	 *  and the state Todd's install was in when 316 of 316 notes vanished with
	 *  zero client log lines to look at. */
	const captureShipped = () => {
		const sent: Array<{ level: string; category: string; message: string }> = [];
		const logger = initRemoteLog();
		logger.configure(
			async (batch: any[]) => {
				sent.push(...batch);
			},
			"test",
			"test",
		);
		logger.setEnabled(false);
		return { sent, flush: () => logger.flush() };
	};

	test("a replay that consumes rows but produces NOTHING reports itself", async () => {
		// applied > 0, files === 0, deletes === 0 — work went in, nothing came
		// out. That is the exact shape of the prod failure and it was silent.
		const { sent, flush } = captureShipped();
		const { engine } = makeEngine(threeRowFeed());
		spyOn(engine, "applySyncChange").mockResolvedValue(false);

		await engine.catchUp({ reportProgress: true });
		await flush();

		const anomaly = sent.find((e) => e.message.includes("produced no files"));
		expect(anomaly).toBeDefined();
		expect(anomaly?.level).toBe("warn");
		// Counts + reasons only — never a path. The diagnostics setting is
		// protecting the user from per-note telemetry and that stays intact.
		expect(anomaly?.message).not.toContain("Notes/");
		expect(anomaly?.message).toContain("applied=3");
	});

	test("a healthy replay stays silent with diagnostics off", async () => {
		const { sent, flush } = captureShipped();
		const { engine } = makeEngine(threeRowFeed());

		await engine.catchUp({ reportProgress: true });
		await flush();

		expect(sent.filter((e) => e.message.includes("produced no files")).length).toBe(0);
	});
});

describe("the sync gate must not fake success (prod 2026-08-13 root cause)", () => {
	afterEach(async () => {
		await destroyRemoteLog();
	});

	const captureShipped = () => {
		const sent: Array<{ level: string; message: string }> = [];
		const logger = initRemoteLog();
		logger.configure(
			async (b: any[]) => {
				sent.push(...b);
			},
			"test",
			"test",
		);
		logger.setEnabled(false);
		return { sent, flush: () => logger.flush() };
	};

	test("a gate-blocked pull writes nothing and does NOT count files", async () => {
		// THE bug. flushFromCrdt short-circuited on syncBlocked and returned
		// TRUE, so a write that never happened counted as a downloaded file:
		// the bar hit 100%, the recap claimed success, the anomaly could not
		// fire, and the only trace was a devLog that never leaves the machine.
		// Folders bypass the gate (direct vault.createFolder), which is why the
		// user saw folders arrive and not one note.
		const { sent, flush } = captureShipped();
		const { engine } = makeEngine(threeRowFeed());
		engine.setSyncBlocked(true);

		const res = await engine.catchUp({ reportProgress: true });
		await flush();

		expect(res.files).toBe(0);
		const anomaly = sent.find((e) => e.message.includes("produced no files"));
		expect(anomaly).toBeDefined();
		expect(anomaly?.level).toBe("warn");
	});

	test("with the gate open the same feed materialises normally", async () => {
		const { sent, flush } = captureShipped();
		const { engine } = makeEngine(threeRowFeed());
		engine.setSyncBlocked(false);

		const res = await engine.catchUp({ reportProgress: true });
		await flush();

		expect(res.files).toBe(2);
		expect(sent.filter((e) => e.message.includes("produced no files")).length).toBe(0);
	});
});
