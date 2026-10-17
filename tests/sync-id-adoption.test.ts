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
describe("ensureNoteIdMapped — announce path + throttled manifest fallback", () => {
	const GAP = 2_000; // SyncEngine.ID_MAP_RECONCILE_COOLDOWN_MS
	const flush = async () => {
		for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
	};
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

	function manifestOf(notes: Array<{ id: string; path: string }>) {
		return {
			notes: notes.map((n) => ({ ...n, content_hash: "h" })),
			attachments: [],
			total_notes: notes.length,
			total_attachments: 0,
			change_seq: notes.length,
		};
	}

	/** Manifest that lists whatever the server holds at the moment of the GET. */
	function liveManifest(created: Array<{ id: string; path: string }>) {
		(mockApi.getManifest as ReturnType<typeof mock>).mockImplementation(async () =>
			manifestOf(created),
		);
	}

	/** Next GET blocks until the returned release() is called. */
	function heldManifest(notes: Array<{ id: string; path: string }>) {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const snapshot = manifestOf(notes);
		(mockApi.getManifest as ReturnType<typeof mock>).mockImplementationOnce(async () => {
			await gate;
			return snapshot;
		});
		return () => release();
	}

	describe("announced path (primary)", () => {
		test("maps straight from the announce's server path: zero manifest fetches", async () => {
			const { engine, map } = throttledEngine();
			liveManifest([]);

			for (let i = 0; i < 50; i++) engine.ensureNoteIdMapped(`id-${i}`, `n${i}.md`);
			await flush();

			expect(fetches()).toBe(0);
			for (let i = 0; i < 50; i++) expect(map.pathForId(`id-${i}`)).toBe(`n${i}.md`);
		});

		test("a path this device maps to ANOTHER id falls back to the manifest", async () => {
			// Locally-minted id vs server id for one path (create race), or a stale
			// announce racing a rename: only the full snapshot can arbitrate.
			const { engine, map } = throttledEngine();
			map.set("taken.md", "local-id");
			liveManifest([{ id: "server-id", path: "taken.md" }]);

			engine.ensureNoteIdMapped("server-id", "taken.md");
			await flush();

			expect(fetches()).toBe(1);
			expect(map.pathForId("server-id")).toBe("taken.md");
		});
	});

	test("N concurrent unmapped ids without a path cost exactly one fetch", async () => {
		const { engine, map, time } = throttledEngine();
		const notes = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, path: `n${i}.md` }));
		liveManifest(notes);

		for (const n of notes) engine.ensureNoteIdMapped(n.id);
		await flush();
		time.advance(60_000);
		await flush();

		expect(fetches()).toBe(1);
		for (const n of notes) expect(map.pathForId(n.id)).toBe(n.path);
	});

	test("back-to-back ids (each after the last fetch settled) share a trailing fetch", async () => {
		const { engine, map, time } = throttledEngine();
		const created: Array<{ id: string; path: string }> = [];
		liveManifest(created);

		for (let i = 0; i < 20; i++) {
			created.push({ id: `id-${i}`, path: `n${i}.md` });
			engine.ensureNoteIdMapped(`id-${i}`);
			await flush();
		}
		expect(fetches()).toBe(1);

		time.advance(60_000);
		await flush();

		expect(fetches()).toBe(2);
		for (const n of created) expect(map.pathForId(n.id)).toBe(n.path);
	});

	test("a note missing from an in-flight fetch is picked up by the trailing fetch", async () => {
		const { engine, map, time } = throttledEngine();
		const created = [{ id: "early", path: "early.md" }];
		const release = heldManifest(created);
		engine.ensureNoteIdMapped("early");
		await flush();
		created.push({ id: "late", path: "late.md" });
		liveManifest(created);
		engine.ensureNoteIdMapped("late");
		release();
		await flush();

		expect(map.pathForId("early")).toBe("early.md");
		expect(map.pathForId("late")).toBeNull(); // not dropped, just waiting

		time.advance(GAP);
		await flush();

		expect(fetches()).toBe(2);
		expect(map.pathForId("late")).toBe("late.md");
	});

	test("the gap is measured from fetch COMPLETION, not start", async () => {
		// A GET slower than the window must not turn the throttle off: that is
		// exactly the contended-server case the throttle exists for.
		const { engine, time } = throttledEngine();
		const release = heldManifest([{ id: "a", path: "a.md" }]);
		engine.ensureNoteIdMapped("a");
		await flush();
		time.advance(5_000); // the GET takes 5s
		liveManifest([{ id: "b", path: "b.md" }]);
		release();
		await flush();
		expect(fetches()).toBe(1);

		engine.ensureNoteIdMapped("b");
		await flush();
		time.advance(GAP - 1);
		await flush();
		expect(fetches()).toBe(1);

		time.advance(1);
		await flush();
		expect(fetches()).toBe(2);
	});

	test("a row not visible yet gets bounded retries, then is given up", async () => {
		const { engine, map, time } = throttledEngine();
		liveManifest([]);
		engine.ensureNoteIdMapped("slow");
		await flush();
		expect(fetches()).toBe(1);

		// Visible to the second fetch: picked up.
		liveManifest([{ id: "slow", path: "slow.md" }]);
		time.advance(GAP);
		await flush();
		expect(fetches()).toBe(2);
		expect(map.pathForId("slow")).toBe("slow.md");

		// A ghost that never appears costs a bounded number of fetches.
		liveManifest([]);
		engine.ensureNoteIdMapped("ghost");
		for (let i = 0; i < 10; i++) {
			time.advance(60_000);
			await flush();
		}
		expect(fetches()).toBe(2 + 3);
	});

	test("a failed fetch keeps pending ids and retries once after a backoff", async () => {
		const { engine, map, time } = throttledEngine();
		(mockApi.getManifest as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("503"));
		engine.ensureNoteIdMapped("a");
		await flush();
		expect(fetches()).toBe(1);

		liveManifest([{ id: "a", path: "a.md" }]);
		time.advance(2 * GAP - 1); // backoff doubles the gap after a failure
		await flush();
		expect(fetches()).toBe(1);

		time.advance(1);
		await flush();
		expect(fetches()).toBe(2);
		expect(map.pathForId("a")).toBe("a.md");
	});

	test("an awaiting caller is released by the fetch that maps ITS id, while others keep arriving", async () => {
		const { engine, map, time } = throttledEngine();
		const created = [{ id: "first", path: "first.md" }];
		liveManifest(created);
		engine.ensureNoteIdMapped("first");
		await flush();

		created.push({ id: "mine", path: "mine.md" });
		engine.ensureNoteIdMapped("mine"); // inside the window: waits
		let released = false;
		void engine.awaitNoteIdMapped("mine").then(() => {
			released = true;
		});

		// Other ids keep arriving for the rest of the import and are never
		// visible, so the pending set never drains.
		for (let i = 0; i < 3; i++) {
			engine.ensureNoteIdMapped(`other-${i}`);
			time.advance(GAP);
			await flush();
			if (i === 0) {
				expect(map.pathForId("mine")).toBe("mine.md");
				expect(released).toBe(true);
			}
		}
	});

	test("a waiter is released by the first fetch covering its id even if it stays unmapped", async () => {
		// The retry schedule (and any failure backoff) is for the MAP; a live
		// fan-out awaiting it must not be held for seconds per unknown id.
		const { engine } = throttledEngine();
		(mockApi.getManifest as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("503"));
		engine.ensureNoteIdMapped("ghost");
		let released = false;
		void engine.awaitNoteIdMapped("ghost").then(() => {
			released = true;
		});
		await flush();
		expect(fetches()).toBe(1);
		expect(released).toBe(true);
	});

	test("awaitNoteIdMapped resolves immediately for an id that is not pending", async () => {
		const { engine } = throttledEngine();
		let released = false;
		void engine.awaitNoteIdMapped("nobody").then(() => {
			released = true;
		});
		await flush();
		expect(released).toBe(true);
	});

	test("an id mapped elsewhere during the window costs no fetch", async () => {
		const { engine, map, time } = throttledEngine();
		liveManifest([{ id: "a", path: "a.md" }]);
		engine.ensureNoteIdMapped("a");
		await flush();

		engine.ensureNoteIdMapped("b");
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
		let released = false;
		void engine.awaitNoteIdMapped("b").then(() => {
			released = true;
		});
		engine.setSyncBlocked(true);
		time.advance(60_000);
		await flush();

		// The reconcile can trash files (sweepPendingOrphans): never behind a
		// closed gate, even when it was armed while the gate was open.
		expect(fetches()).toBe(1);
		expect(released).toBe(true);
	});

	test("a vault switch cancels the old vault's cooldown and pending ids", async () => {
		const { engine, time } = throttledEngine();
		liveManifest([{ id: "a", path: "a.md" }]);
		engine.ensureNoteIdMapped("a");
		await flush();
		engine.ensureNoteIdMapped("old-vault-id"); // armed for the old vault
		let released = false;
		void engine.awaitNoteIdMapped("old-vault-id").then(() => {
			released = true;
		});

		await engine.resetForVaultChange();
		await flush();
		expect(released).toBe(true);

		// The new vault's first unmapped id is not held by the old cooldown...
		liveManifest([{ id: "new", path: "new.md" }]);
		engine.ensureNoteIdMapped("new");
		await flush();
		expect(fetches()).toBe(2);
		// ...and the old timer never fires a fetch of its own.
		time.advance(60_000);
		await flush();
		expect(fetches()).toBe(2);
	});
});
