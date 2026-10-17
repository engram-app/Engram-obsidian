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
import { createCrdtWiring } from "../src/crdt/wiring";
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
		const saveData = mock().mockResolvedValue(undefined);
		const engine = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1 },
			saveData,
			time,
		);
		engine.setReady();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		const idSaves = () =>
			saveData.mock.calls.filter((c: unknown[]) => (c[0] as { noteIds?: unknown }).noteIds)
				.length;
		return { engine, map, time, saveData, idSaves };
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

	describe("announce: discoverAnnouncedNote first, throttled manifest only as fallback", () => {
		// The real engine behind the real wiring: the ORDER is the contract.
		function announceRig() {
			const rig = throttledEngine();
			const e = rig.engine as any;
			e.crdt = {}; // discovery requires a CRDT stack
			e.crdtCatchupSince = async () => null;
			e.catchupViaSeqReplay = async () => {};
			const wiring = createCrdtWiring({
				noteIdMap: rig.map,
				syncEngine: rig.engine,
				sendCrdt: () => {},
				isBound: () => false,
				strandHealDebounceMs: 100_000,
				dbPrefix: `announce-${Math.random()}`,
			});
			return { ...rig, wiring };
		}

		test("a note not on disk is mapped by discovery: zero manifest fetches", async () => {
			const { map, wiring } = announceRig();
			liveManifest([]);
			wiring.onCrdtDocReady("fresh", "fresh.md");
			await flush();
			expect(fetches()).toBe(0);
			expect(map.pathForId("fresh")).toBe("fresh.md");
			wiring.dispose();
		});

		test("a note with a pending offline delete is not mapped from the announce", async () => {
			const { engine, map, wiring } = announceRig();
			engine.queue.load([
				{
					path: "gone.md",
					action: "delete",
					evidenced: true,
					mtime: 1,
					timestamp: 1,
				} as any,
			]);
			// The server still lists it: the manifest fallback must not map it either.
			liveManifest([{ id: "gone-id", path: "gone.md" }]);
			wiring.onCrdtDocReady("gone-id", "gone.md");
			await flush();
			expect(map.pathForId("gone-id")).toBeNull();
			wiring.dispose();
		});

		test("an ignored path is not mapped from the announce", async () => {
			const { map, wiring } = announceRig();
			liveManifest([{ id: "cfg-id", path: ".obsidian/x.md" }]);
			wiring.onCrdtDocReady("cfg-id", ".obsidian/x.md");
			await flush();
			expect(map.pathForId("cfg-id")).toBeNull();
			wiring.dispose();
		});

		test("discovery throwing before its own try still runs the manifest fallback", async () => {
			const { engine, map, wiring } = announceRig();
			(engine as any).isLiveBound = () => {
				throw new Error("boom");
			};
			liveManifest([{ id: "t-id", path: "t.md" }]);
			wiring.onCrdtDocReady("t-id", "t.md");
			await flush();
			expect(fetches()).toBe(1);
			expect(map.pathForId("t-id")).toBe("t.md");
			wiring.dispose();
		});

		test("a file already on disk but unmapped falls back to one throttled fetch", async () => {
			const { map, wiring } = announceRig();
			(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockImplementation(
				(p: string) => (p === "disk.md" ? new TFile("disk.md") : null),
			);
			try {
				liveManifest([{ id: "disk-id", path: "disk.md" }]);
				wiring.onCrdtDocReady("disk-id", "disk.md");
				await flush();
				expect(fetches()).toBe(1);
				expect(map.pathForId("disk-id")).toBe("disk.md");
			} finally {
				(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
					.mockReset()
					.mockReturnValue(null);
				wiring.dispose();
			}
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
		expect(fetches()).toBe(1); // no waiter: an announce-only id keeps the cooldown

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

		engine.ensureNoteIdMapped("b"); // announce-only: armed for the window
		engine.setSyncBlocked(true);
		time.advance(60_000);
		await flush();

		// The reconcile can trash files (sweepPendingOrphans): never behind a
		// closed gate, even when it was armed while the gate was open.
		expect(fetches()).toBe(1);
	});

	test("a vault switch cancels the old vault's cooldown", async () => {
		const { engine, time } = throttledEngine();
		liveManifest([{ id: "a", path: "a.md" }]);
		engine.ensureNoteIdMapped("a");
		await flush();
		engine.ensureNoteIdMapped("old-vault-id"); // armed for the old vault

		await engine.resetForVaultChange();
		engine.setNoteIdMap(new NoteIdMap());

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

	test("a vault switch releases waiters at once", async () => {
		const { engine } = throttledEngine();
		heldManifest([]); // never answers
		engine.ensureNoteIdMapped("w");
		let released = false;
		void engine.awaitNoteIdMapped("w").then(() => {
			released = true;
		});
		await flush();
		expect(released).toBe(false);

		await engine.resetForVaultChange();
		await flush();
		expect(released).toBe(true);
	});

	describe("round 2", () => {
		test("failed fetches do not consume attempts: 3 failures then success maps the id", async () => {
			const { engine, map, time } = throttledEngine();
			const get = mockApi.getManifest as ReturnType<typeof mock>;
			get.mockRejectedValueOnce(new Error("503"))
				.mockRejectedValueOnce(new Error("503"))
				.mockRejectedValueOnce(new Error("503"))
				.mockImplementation(async () => manifestOf([{ id: "a", path: "a.md" }]));
			engine.ensureNoteIdMapped("a");
			for (let i = 0; i < 6; i++) {
				await flush();
				time.advance(60_000);
			}
			await flush();

			expect(fetches()).toBe(4);
			expect(map.pathForId("a")).toBe("a.md");
		});

		test("a vault switch mid-GET applies NOTHING from the old vault's manifest", async () => {
			const { engine, idSaves } = throttledEngine();
			const release = heldManifest([{ id: "old", path: "old.md" }]);
			engine.ensureNoteIdMapped("old");
			await flush();

			await engine.resetForVaultChange();
			const fresh = new NoteIdMap();
			engine.setNoteIdMap(fresh);
			const savesBefore = idSaves();
			release();
			await flush();

			expect(fresh.pathForId("old")).toBeNull();
			expect(idSaves()).toBe(savesBefore);
			// cacheManifestOwners is the apply's first step (and feeds the orphan sweep).
			expect((engine as any).manifestOwners.owners?.has("old.md") ?? false).toBe(false);
		});

		test("a fan-out waiting on an id that arrived mid-fetch is fetched right after completion", async () => {
			const { engine, map } = throttledEngine();
			const release = heldManifest([{ id: "a", path: "a.md" }]);
			engine.ensureNoteIdMapped("a");
			await flush();
			liveManifest([
				{ id: "a", path: "a.md" },
				{ id: "x", path: "x.md" },
			]);
			engine.ensureNoteIdMapped("x");
			let released = false;
			void engine.awaitNoteIdMapped("x").then(() => {
				released = true;
			});
			release();
			await flush();

			// No time advanced: the trailing fetch skipped the cooldown for the waiter.
			expect(fetches()).toBe(2);
			expect(map.pathForId("x")).toBe("x.md");
			expect(released).toBe(true);
		});

		test("a mapping learned by ANY path releases a waiting fan-out immediately", async () => {
			const { engine, map } = throttledEngine();
			heldManifest([]); // the fetch never answers in this test
			engine.ensureNoteIdMapped("y");
			let released = false;
			void engine.awaitNoteIdMapped("y").then(() => {
				released = true;
			});
			await flush();
			expect(released).toBe(false);

			map.set("y.md", "y"); // seq replay / discovery learns it
			await flush();

			expect(released).toBe(true);
		});

		test("closing the gate releases waiters and cancels the armed fetch at once", async () => {
			const { engine, time } = throttledEngine();
			liveManifest([{ id: "a", path: "a.md" }]);
			engine.ensureNoteIdMapped("a");
			await flush();
			const timersBefore = time.pendingCount;
			engine.ensureNoteIdMapped("b"); // armed for the window
			expect(time.pendingCount).toBe(timersBefore + 1);

			const release = heldManifest([]);
			engine.ensureNoteIdMapped("c");
			let released = false;
			void engine.awaitNoteIdMapped("c").then(() => {
				released = true;
			});
			await flush();

			engine.setSyncBlocked(true);
			await flush();
			expect(released).toBe(true);
			expect(time.pendingCount).toBe(timersBefore);
			release();
			time.advance(60_000);
			await flush();
		});
	});

	describe("round 3", () => {
		test("a gate closing during the apply's save stops before the orphan sweep", async () => {
			const { engine, saveData } = throttledEngine();
			const e = engine as any;
			const swept: string[] = [];
			e.trashRemotelyDeleted = async (f: { path: string }) => swept.push(f.path);
			(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation(
				(p: string) => (p === "orphan.md" ? new TFile("orphan.md") : null),
			);
			try {
				e.pendingOrphanSweep.add("orphan.md");
				let releaseSave: () => void = () => {};
				saveData.mockImplementation(
					() =>
						new Promise<void>((r) => {
							releaseSave = r;
						}),
				);
				liveManifest([{ id: "a", path: "a.md" }]);
				engine.ensureNoteIdMapped("a");
				await flush(); // fetched, applying, parked in saveData
				engine.setSyncBlocked(true);
				releaseSave();
				await flush();
				expect(swept).toEqual([]);
			} finally {
				(mockApp.vault.getFileByPath as ReturnType<typeof mock>)
					.mockReset()
					.mockReturnValue(null);
			}
		});

		test("a vault switch during the apply's save stops before the orphan sweep", async () => {
			const { engine, saveData } = throttledEngine();
			const e = engine as any;
			const swept: string[] = [];
			e.trashRemotelyDeleted = async (f: { path: string }) => swept.push(f.path);
			(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation(
				(p: string) => (p === "orphan.md" ? new TFile("orphan.md") : null),
			);
			try {
				let releaseSave: () => void = () => {};
				saveData.mockImplementationOnce(
					() =>
						new Promise<void>((r) => {
							releaseSave = r;
						}),
				);
				liveManifest([{ id: "a", path: "a.md" }]);
				engine.ensureNoteIdMapped("a");
				await flush();
				await engine.resetForVaultChange();
				e.pendingOrphanSweep.add("orphan.md"); // the NEW vault's deferred trash
				releaseSave();
				await flush();
				expect(swept).toEqual([]);
			} finally {
				(mockApp.vault.getFileByPath as ReturnType<typeof mock>)
					.mockReset()
					.mockReturnValue(null);
			}
		});

		test("5 consecutive failed fetches give up on pending ids; a later request starts fresh", async () => {
			const { engine, time } = throttledEngine();
			(mockApi.getManifest as ReturnType<typeof mock>).mockRejectedValue(new Error("503"));
			engine.ensureNoteIdMapped("a");
			for (let i = 0; i < 20; i++) {
				await flush();
				time.advance(60_000);
			}
			await flush();
			expect(fetches()).toBe(5);

			liveManifest([{ id: "a", path: "a.md" }]);
			engine.ensureNoteIdMapped("a");
			await flush();
			expect(fetches()).toBe(6);
		});

		test("a burst of id-map changes prunes pending ids once, not once per change", async () => {
			const { engine, map } = throttledEngine();
			heldManifest([]);
			for (let i = 0; i < 20; i++) engine.ensureNoteIdMapped(`p-${i}`);
			await flush();
			const spy = mock(map.pathForId.bind(map));
			map.pathForId = spy;
			for (let i = 0; i < 100; i++) map.set(`other-${i}.md`, `other-${i}`);
			await flush();
			// One scan of the 20 pending ids for the staged sets, one for the
			// microtask commit's index-doc update: independent of the 100 changes
			// (unbatched, this was a scan per change: 2,000+ lookups).
			expect(spy.mock.calls.length).toBeLessThanOrEqual(2 * 20);
		});

		test("a fan-out's first wait gets an urgent retry even during failure backoff", async () => {
			const { engine, map } = throttledEngine();
			(mockApi.getManifest as ReturnType<typeof mock>).mockRejectedValueOnce(
				new Error("503"),
			);
			engine.ensureNoteIdMapped("x");
			await flush(); // the covering fetch failed; backoff is now 4s
			expect(fetches()).toBe(1);

			liveManifest([{ id: "x", path: "x.md" }]);
			engine.ensureNoteIdMapped("x");
			void engine.awaitNoteIdMapped("x");
			await flush();
			// No time advanced.
			expect(fetches()).toBe(2);
			expect(map.pathForId("x")).toBe("x.md");
		});

		test("a later fan-out after a failed urgent fetch is not held through the backoff", async () => {
			const { engine, map, time } = throttledEngine();
			(mockApi.getManifest as ReturnType<typeof mock>)
				.mockRejectedValueOnce(new Error("503"))
				.mockRejectedValueOnce(new Error("503"));
			engine.ensureNoteIdMapped("x");
			await flush(); // leading fetch failed
			engine.ensureNoteIdMapped("x");
			void engine.awaitNoteIdMapped("x");
			await flush(); // urgent retry failed too: backoff is now 8s
			expect(fetches()).toBe(2);

			liveManifest([{ id: "x", path: "x.md" }]);
			time.advance(1_000);
			engine.ensureNoteIdMapped("x");
			void engine.awaitNoteIdMapped("x");
			await flush();
			time.advance(GAP / 2);
			await flush();
			expect(fetches()).toBe(3);
			expect(map.pathForId("x")).toBe("x.md");
		});

		test("a later fan-out after an answered-but-unmapped fetch is not held the cooldown", async () => {
			const { engine, map, time } = throttledEngine();
			liveManifest([]);
			engine.ensureNoteIdMapped("x");
			void engine.awaitNoteIdMapped("x");
			await flush(); // answered, x not listed yet
			expect(fetches()).toBe(1);

			liveManifest([{ id: "x", path: "x.md" }]);
			time.advance(100);
			engine.ensureNoteIdMapped("x");
			void engine.awaitNoteIdMapped("x");
			await flush();
			time.advance(GAP / 2);
			await flush();
			expect(fetches()).toBe(2);
			expect(map.pathForId("x")).toBe("x.md");
		});

		test("an apply failure is not a fetch failure: no backoff, no failure give-up", async () => {
			const { engine, time } = throttledEngine();
			(engine as any).applyManifestToNoteIdMap = async () => {
				throw new Error("disk full");
			};
			liveManifest([{ id: "a", path: "a.md" }]);
			engine.ensureNoteIdMapped("a");
			await flush();
			for (let i = 0; i < 4; i++) {
				time.advance(GAP);
				await flush();
			}
			// Three answered fetches at the base cooldown, then the attempt give-up;
			// fetch-failure backoff would have spaced them 4s, 8s apart.
			expect(fetches()).toBe(3);
			expect((engine as any).idMapPending.has("a")).toBe(false);
			expect((engine as any).idMapFailures).toBe(0);
		});

		test("a fetch does not credit an id that was settled and re-requested while it was in flight", async () => {
			const { engine, map } = throttledEngine();
			const release = heldManifest([]);
			heldManifest([]); // the trailing fetch never answers in this test
			engine.ensureNoteIdMapped("z");
			await flush();
			map.set("z.md", "z"); // settled by another path
			await flush();
			map.delete("z.md"); // ...and lost again
			engine.ensureNoteIdMapped("z"); // a NEW request
			let released = false;
			void engine.awaitNoteIdMapped("z").then(() => {
				released = true;
			});
			release(); // the old fetch answers, without z
			await flush();

			expect(released).toBe(false);
			expect((engine as any).idMapPending.get("z").attempts).toBe(0);
		});

		test("the manifest maps the same normalized path discovery would", async () => {
			const { engine, map } = throttledEngine();
			liveManifest([{ id: "n", path: "Folder//note.md" }]);
			engine.ensureNoteIdMapped("n");
			await flush();
			expect(map.pathForId("n")).toBe("Folder/note.md");
		});
	});
});
