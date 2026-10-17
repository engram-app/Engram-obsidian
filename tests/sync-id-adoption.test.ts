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
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "server-minted-id" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
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

// Task 7 (CRDT single-push-path): the "batch push adopts the authoritative
// note id" and "batch push does not revert a mid-flight local rename (#245)"
// suites that used to sit here exercised pushNotesViaBatch directly —
// deleted along with it (dead since Task 3 routed pushAll's genesis notes
// through crdtCreateBatch/pushGenesisBatch). Their invariants (create-race
// id-adoption, #245 mid-flight-rename path snapshot) are pinned for the
// surviving producer in tests/sync-push-consolidation.test.ts
// ("pushGenesisBatch — direct": "id-adoption: an id_conflict..." and "#245: a
// mid-flight rename during crdt_create_batch...").

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

	// #1550: `getOrMint` publishes a claim into filemeta_v0 as soon as it mints,
	// without waiting for crdt_create to be acked. A create that then fails to
	// land leaves the claim behind — the note exists on ONE device, every
	// crdt_msg for it is dropped note_not_found, and the server's projection
	// worker retries the unresolvable entry forever for that whole vault.
	// Measured in prod 2026-09-01: two notes stranded for 16+ hours.
	describe("an orphaned index claim re-drives the create (#1550)", () => {
		function orphanEngine(opts: { fileExists: boolean; path?: string; size?: number }) {
			const path = opts.path ?? "stranded.md";
			const enqueue = mock();
			const app = {
				...mockApp,
				vault: {
					...mockApp.vault,
					getFileByPath: mock().mockReturnValue(
						opts.fileExists ? { path, stat: { size: opts.size ?? 64 } } : null,
					),
				},
			};
			const engine = new SyncEngine(
				app as any,
				mockApi,
				{ ...DEFAULT_SETTINGS, debounceMs: 1 },
				mock().mockResolvedValue(undefined),
			);
			engine.setReady();
			const map = new NoteIdMap();
			map.set(path, "orphan-id");
			engine.setNoteIdMap(map);
			engine.setCrdtPorts({ manager: {} as any, enqueue });
			return { engine, enqueue };
		}

		test("re-enqueues the create under the SAME id", () => {
			const { engine, enqueue } = orphanEngine({ fileExists: true });

			expect(engine.repairOrphanedClaim("orphan-id")).toBe(true);

			// The SAME id, not a fresh mint: the local Y.Doc holding the user's
			// content is keyed by it, and the existing claim already names it.
			expect(enqueue).toHaveBeenCalledWith({
				kind: "create",
				docId: "orphan-id",
				path: "stranded.md",
			});
		});

		test("only ONCE per id — the durable queue owns the retrying", () => {
			// Re-enqueuing on every later note_not_found would add nothing but a
			// Loki warn per reconnect.
			const { engine, enqueue } = orphanEngine({ fileExists: true });

			expect(engine.repairOrphanedClaim("orphan-id")).toBe(true);
			expect(engine.repairOrphanedClaim("orphan-id")).toBe(false);
			expect(enqueue).toHaveBeenCalledTimes(1);
		});

		test("a note the server DOES know is left alone", () => {
			const { engine, enqueue } = orphanEngine({ fileExists: true });
			// A server-delivered head is the one thing this device cannot forge.
			(engine as any).setCrdtHead("stranded.md", "real-server-head");

			expect(engine.repairOrphanedClaim("orphan-id")).toBe(false);
			expect(enqueue).not.toHaveBeenCalled();
		});

		test("an OVER-CAP note is left alone (it is off the CRDT path by design)", () => {
			// A >4 MB note never enters the Yjs doc, so it never gets a crdtHead and
			// satisfies every other condition here. Without the size gate the queue
			// would build an over-cap genesis frame and burn its whole retry budget
			// before surfacing a drop to the user.
			const { engine, enqueue } = orphanEngine({ fileExists: true, size: 5 * 1024 * 1024 });

			expect(engine.repairOrphanedClaim("orphan-id")).toBe(false);
			expect(enqueue).not.toHaveBeenCalled();
		});

		// Canvas is deliberately NOT the example here: it IS CRDT-eligible
		// (`isCrdtEligiblePath` = markdown OR canvas), so it is a note this repair
		// SHOULD cover. An attachment is the real ineligible case — it stays on the
		// REST path and so never carries a crdtHead either.
		test("an ATTACHMENT is left alone (ineligible, so never head-stamped either)", () => {
			const { engine, enqueue } = orphanEngine({ fileExists: true, path: "img/shot.png" });

			expect(engine.repairOrphanedClaim("orphan-id")).toBe(false);
			expect(enqueue).not.toHaveBeenCalled();
		});

		test("a claim with no file behind it is NOT re-created", () => {
			// Nothing to create, and inventing a row for a note that does not exist
			// locally would be the projection worker's job, which it deliberately
			// refuses for the same reason.
			const { engine, enqueue } = orphanEngine({ fileExists: false });

			expect(engine.repairOrphanedClaim("orphan-id")).toBe(false);
			expect(enqueue).not.toHaveBeenCalled();
		});
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

// Receiver manifest storm (local A/B of e2e test_77, 1,000-note bulk first
// sync): device B's first crdt_doc_ready for nearly every new note names an
// unmapped id. The old coalescing only merged calls that overlapped an
// IN-FLIGHT fetch, so announces arriving back-to-back (each after the previous
// fetch settled) cost one whole-vault manifest GET apiece: ~970 per run, O(N^2)
// bytes, landing on the server exactly when it is busiest.
describe("ensureNoteIdMapped — manifest fetches are throttled across a burst", () => {
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const fetches = () => (mockApi.getManifest as ReturnType<typeof mock>).mock.calls.length;

	function throttledEngine() {
		const time = new ManualTimeProvider(1_000_000);
		const engine = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1 },
			mock().mockResolvedValue(undefined),
			time,
		);
		engine.setReady();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		return { engine, map, time };
	}

	/** Manifest that lists whatever the server holds at the moment of the GET. */
	function liveManifest(created: Array<{ id: string; path: string }>) {
		(mockApi.getManifest as ReturnType<typeof mock>).mockImplementation(async () => ({
			notes: created.map((n) => ({ ...n, content_hash: "h" })),
			attachments: [],
			total_notes: created.length,
			total_attachments: 0,
			change_seq: created.length,
		}));
	}

	test("N concurrent unmapped announces cost exactly one fetch", async () => {
		const { engine, map, time } = throttledEngine();
		const notes = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, path: `n${i}.md` }));
		liveManifest(notes);

		for (const n of notes) engine.ensureNoteIdMapped(n.id);
		await flush();
		time.advance(60_000);
		await flush();

		// Every id was covered by the one snapshot: no trailing rerun is owed.
		expect(fetches()).toBe(1);
		for (const n of notes) expect(map.pathForId(n.id)).toBe(n.path);
	});

	test("back-to-back announces (each after the last fetch settled) share a trailing fetch", async () => {
		const { engine, map, time } = throttledEngine();
		const created: Array<{ id: string; path: string }> = [];
		liveManifest(created);

		// The server learns one note at a time and announces it; B's previous
		// fetch has already returned when the next announce lands.
		for (let i = 0; i < 20; i++) {
			created.push({ id: `id-${i}`, path: `n${i}.md` });
			engine.ensureNoteIdMapped(`id-${i}`);
			await flush();
		}
		// Leading fetch only, so far: the rest wait out the window.
		expect(fetches()).toBe(1);

		time.advance(60_000);
		await flush();
		await flush();

		expect(fetches()).toBe(2);
		for (const n of created) expect(map.pathForId(n.id)).toBe(n.path);
	});

	test("a note missing from an in-flight fetch is picked up by the trailing fetch", async () => {
		const { engine, map, time } = throttledEngine();
		const created = [{ id: "early", path: "early.md" }];
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		// First GET snapshots BEFORE "late" exists, and is still in flight when
		// "late" is announced.
		const snapshot = created.map((n) => ({ ...n, content_hash: "h" }));
		(mockApi.getManifest as ReturnType<typeof mock>).mockImplementationOnce(async () => {
			await gate;
			return {
				notes: snapshot,
				attachments: [],
				total_notes: 1,
				total_attachments: 0,
				change_seq: 1,
			};
		});
		engine.ensureNoteIdMapped("early");
		await flush();
		created.push({ id: "late", path: "late.md" });
		liveManifest(created);
		engine.ensureNoteIdMapped("late");
		release();
		await flush();
		await flush();

		expect(map.pathForId("early")).toBe("early.md");
		expect(map.pathForId("late")).toBeNull(); // not dropped, just waiting

		time.advance(60_000);
		await flush();
		await flush();

		expect(fetches()).toBe(2);
		expect(map.pathForId("late")).toBe("late.md");
	});

	test("an id absent from a fetch that started after it was seen is not refetched forever", async () => {
		const { engine, time } = throttledEngine();
		liveManifest([]);

		engine.ensureNoteIdMapped("ghost");
		await flush();
		time.advance(60_000);
		await flush();
		time.advance(60_000);
		await flush();

		expect(fetches()).toBe(1);
	});

	test("an announce whose id gets mapped elsewhere during the window costs no fetch", async () => {
		const { engine, map, time } = throttledEngine();
		liveManifest([{ id: "a", path: "a.md" }]);
		engine.ensureNoteIdMapped("a");
		await flush();

		engine.ensureNoteIdMapped("b"); // inside the window: waits
		map.set("b.md", "b"); // the pull feed maps it first
		time.advance(60_000);
		await flush();

		expect(fetches()).toBe(1);
	});

	test("a gate that closes during the window cancels the trailing fetch", async () => {
		const { engine, time } = throttledEngine();
		liveManifest([{ id: "a", path: "a.md" }]);
		engine.ensureNoteIdMapped("a");
		await flush();

		engine.ensureNoteIdMapped("b");
		(engine as any).syncBlocked = true;
		time.advance(60_000);
		await flush();

		// The reconcile can trash files (sweepPendingOrphans): never behind a
		// closed gate, even when it was armed while the gate was open.
		expect(fetches()).toBe(1);
	});
});
