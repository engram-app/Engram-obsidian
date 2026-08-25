/**
 * Tests: single-path convergence — announce-driven discovery
 * (`discoverAnnouncedNote`) and the seq-ordered op-log replay
 * (`catchupViaSeqReplay`, crdt_catchup_since). The retired `crdt_catchup_delta`
 * socket path and its `catchupViaSocket`/`convergeNoteFromDelta` machinery were
 * deleted (their bad_frame reply against the single-path backend caused a
 * 0-byte materialize). Mirrors the mock-engine pattern from
 * tests/sync-cold-receive.test.ts.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type SyncAttachmentChange, type SyncNoteChange } from "../src/types";

const mockApi = {
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

function makeEngineWithCrdt(crdt: Partial<CrdtManager>): SyncEngine {
	const e = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	// The real registry always answers `hasUndeliveredOps`; partial doubles do
	// not. Default it to false (nothing local pending) so existing tests keep
	// exercising the room-free read, and let a caller override to assert the
	// opposite. Spread FIRST so an explicit value in `crdt` wins.
	e.setCrdtManager({
		hasUndeliveredOps: () => false,
		...crdt,
	} as unknown as CrdtManager);
	e.setReady();
	const map = new NoteIdMap();
	map.set("Notes/a.md", "id-a");
	map.set("Notes/b.md", "id-b");
	e.setNoteIdMap(map);
	// No confirmed-set seeding: the seq-replay op-log is the sole convergence
	// path and does not gate on isNoteConfirmed — an op in the feed is
	// server-known by definition. This is exactly the reconnect catch-up the
	// confirmed gate used to break (a reconnect cleared the set).
	return e;
}

describe("discoverAnnouncedNote (e2e test_27 — announce-driven immediate empty-note discovery)", () => {
	// An empty note's genesis emits crdt_doc_ready with a path but ZERO Y.Doc ops,
	// so no note_yjs_update ever fans out. Consuming the announce path runs the
	// SAME per-note adopt+materialize the whole-vault catch-up would, without
	// waiting ~30s for the level-triggered pull (the note landed at +31s in
	// test_27, 1s past the deadline). It targets ONE note — never the whole-vault
	// heads fetch — and is socket-native (no REST getUpdates).
	test("does NOT replay for a note with a pending local delete (no resurrection)", async () => {
		// The announce for a note THIS device is deleting must not trigger a
		// catch-up that re-materializes it — discoverAnnouncedNote returns before
		// the seq-replay for a recentlyDeleted / queued-delete note.
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false),
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([0])),
			projectedText: (_id: string) => Promise.resolve(""),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		await (engine as any).queue.enqueue({
			path: "Notes/gone.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
			// Legit queued deletes carry the #416 evidence stamp; only those
			// suppress announce-driven discovery (unevidenced ones are doomed
			// to be dropped by the drain gate and must not hide live notes).
			evidenced: true,
		});
		mockApp.vault.create.mockClear();
		let replayed = false;
		engine.setCrdtCatchupSince(async () => {
			replayed = true;
			return { changes: [], has_more: false, next_seq: null };
		});

		await engine.discoverAnnouncedNote("id-gone", "Notes/gone.md");

		expect(replayed).toBe(false); // early-returned; no catch-up ran
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("does NOT replay for a note in the recentlyDeleted window (delete-wins #970)", async () => {
		// The sibling of the queued-delete guard: a delete already SENT (dequeued)
		// still holds recentlyDeleted for RECENT_DELETE_COOLDOWN_MS — an announce
		// for that id in the window must not trigger a catch-up that resurrects it.
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false),
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([0])),
			projectedText: (_id: string) => Promise.resolve(""),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as any).recentlyDeleted.set("id-gone", Date.now());
		mockApp.vault.create.mockClear();
		let replayed = false;
		engine.setCrdtCatchupSince(async () => {
			replayed = true;
			return { changes: [], has_more: false, next_seq: null };
		});

		await engine.discoverAnnouncedNote("id-gone", "Notes/gone.md");

		expect(replayed).toBe(false); // early-returned; no catch-up ran
		expect(mockApp.vault.create).not.toHaveBeenCalled();
	});

	test("never throws when the delta fetch fails (failure-isolated)", async () => {
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false),
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([0])),
			projectedText: (_id: string) => Promise.resolve(""),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		engine.setCrdtCatchupSince(async () => {
			throw new Error("seq replay failed");
		});

		await expect(engine.discoverAnnouncedNote("id-x", "Notes/x.md")).resolves.toBeUndefined();
	});

	test("routes announce discovery through the seq-replay op-log, not the retired socket delta", async () => {
		// The announce is a latency SIGNAL — run the one catch-up path
		// (crdt_catchup_since). The announced note's op carries full content
		// (empty notes included) and materializes via applySyncChange. The old
		// crdt_catchup_delta socket frame was deleted server-side; sending it now
		// gets a bad_frame reply (the 0-byte-materialize e2e regression).
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const applied: string[] = [];
		(engine as any).applySyncChange = mock(async (c: any) => {
			applied.push(c.path);
			return true;
		});
		let sinceCalled = false;
		engine.setCrdtCatchupSince(async () => {
			sinceCalled = true;
			return {
				changes: [
					{
						type: "note",
						id: "id-empty",
						seq: 5,
						path: "Notes/EmptyNote.md",
						title: "EmptyNote",
						content: "",
						folder: "",
						tags: [],
						mtime: 5,
						updated_at: "2026-01-01T00:00:00Z",
						deleted: false,
					},
				],
				has_more: false,
				next_seq: null,
			};
		});

		await engine.discoverAnnouncedNote("id-empty", "Notes/EmptyNote.md");

		expect(sinceCalled).toBe(true); // converged via crdt_catchup_since
		expect(applied).toContain("Notes/EmptyNote.md");
	});
});

// Single-path convergence: replay the seq-ordered op-log over the socket. Each
// op carries full content and is applied via applySyncChange (spied here), so a
// reconnecting device gets every missed op IN ORDER — the deaf-note fix. The
// applySyncChange internals are covered by sync.test.ts; these tests pin the
// replay loop: order, cursor advance/persist, pagination, failure isolation.
describe("catchupViaSeqReplay", () => {
	function op(seq: number, id: string, path: string): SyncNoteChange {
		return {
			type: "note",
			id,
			seq,
			path,
			title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
			content: `c${seq}`,
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		};
	}

	function attachmentOp(
		seq: number,
		id: string,
		path: string,
		deleted = false,
	): SyncAttachmentChange {
		return {
			type: "attachment",
			id,
			seq,
			path,
			mime_type: "image/png",
			size_bytes: 10,
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted,
		};
	}

	test("applies each op in seq order and advances the persisted cursor", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const applied: number[] = [];
		(engine as any).applySyncChange = mock(async (c: any) => {
			applied.push(c.seq);
			return true;
		});

		engine.setCrdtCatchupSince(async () => ({
			changes: [op(5, "id-a", "Notes/a.md"), op(7, "id-b", "Notes/b.md")],
			has_more: false,
			next_seq: null,
		}));

		await engine.catchupViaSeqReplay();

		expect(applied).toEqual([5, 7]);
		expect(engine.getCatchupSeq()).toBe(7);
	});

	test("threads + persists the composite {seq,id} cursor across an equal-seq pair (#312)", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		const seen: Array<{ seq: number; id: string | null }> = [];
		const pages = [
			{
				changes: [attachmentOp(5, "id-new", "new.png")],
				has_more: true,
				next_seq: 5,
				next_id: "id-new",
			},
			{
				changes: [attachmentOp(5, "id-old", "old.png", true)],
				has_more: false,
				next_seq: null,
				next_id: null,
			},
		];
		let i = 0;
		engine.setCrdtCatchupSince(
			async (cursor: number, _limit?: number, cursorId?: string | null) => {
				seen.push({ seq: cursor, id: cursorId ?? null });
				return pages[i++];
			},
		);

		await engine.catchupViaSeqReplay();

		// Page 2 was fetched with the composite cursor from page 1's next_id. A
		// seq-only cursor would send {5, null}, and the backend's `seq > 5` would
		// drop the sibling old.png.
		expect(seen).toEqual([
			{ seq: 0, id: null },
			{ seq: 5, id: "id-new" },
		]);
		// The persisted resume point is the last row's {seq, id} — an interrupted
		// replay resumes at (5, id-old), not seq-only.
		expect(engine.getCatchupSeq()).toBe(5);
		expect(engine.getCatchupId()).toBe("id-old");
	});

	test("paginates while has_more, resuming each page from next_seq", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		const cursorsSeen: number[] = [];
		const pages = [
			{ changes: [op(3, "id-a", "Notes/a.md")], has_more: true, next_seq: 3 },
			{ changes: [op(9, "id-b", "Notes/b.md")], has_more: false, next_seq: null },
		];
		let i = 0;
		engine.setCrdtCatchupSince(async (cursor: number) => {
			cursorsSeen.push(cursor);
			return pages[i++];
		});

		await engine.catchupViaSeqReplay();

		expect(cursorsSeen).toEqual([0, 3]);
		expect(engine.getCatchupSeq()).toBe(9);
	});

	test("a per-op apply failure is caught and the cursor still advances past it", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async (c: any) => {
			if (c.seq === 5) throw new Error("illegal filename");
			return true;
		});
		engine.setCrdtCatchupSince(async () => ({
			changes: [op(5, "id-a", "Notes/a.md"), op(6, "id-b", "Notes/b.md")],
			has_more: false,
			next_seq: null,
		}));

		// seq=5 throws, seq=6 applies → 1 applied, cursor still advances past both.
		const { applied } = await engine.catchupViaSeqReplay();
		expect(applied).toBe(1);
		expect(engine.getCatchupSeq()).toBe(6);
	});

	test("replays from genesis when the cursor belongs to a DIFFERENT vault (OAuth swap)", async () => {
		// seq is per-vault: a cursor from vault-old is meaningless in vault-new, so
		// a stale high value must NOT suppress the new vault's catch-up (e2e test_48).
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		engine.setCatchupSeq(500); // stale cursor from the previous vault
		(engine as any).syncStateVaultId = "vault-old";
		(engine as any).settings.vaultId = "vault-new";

		const cursorsSeen: number[] = [];
		engine.setCrdtCatchupSince(async (cursor: number) => {
			cursorsSeen.push(cursor);
			return { changes: [op(2, "id-a", "Notes/a.md")], has_more: false, next_seq: null };
		});

		await engine.catchupViaSeqReplay();

		expect(cursorsSeen).toEqual([0]); // genesis, NOT the stale 500
	});

	test("uses the persisted cursor when the vault matches", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		engine.setCatchupSeq(42);
		(engine as any).syncStateVaultId = "vault-x";
		(engine as any).settings.vaultId = "vault-x";

		const cursorsSeen: number[] = [];
		engine.setCrdtCatchupSince(async (cursor: number) => {
			cursorsSeen.push(cursor);
			return { changes: [], has_more: false, next_seq: null };
		});

		await engine.catchupViaSeqReplay();

		expect(cursorsSeen).toEqual([42]);
	});

	test("single-flights concurrent calls and re-runs once for a mid-flight trigger", async () => {
		// A folder rename fires the per-relocation trigger N times; they must
		// coalesce into one in-flight replay, plus exactly one re-run to pick up
		// anything committed during the first pass.
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		let calls = 0;
		let releaseFirst: () => void = () => {};
		const firstHeld = new Promise<void>((r) => {
			releaseFirst = r;
		});
		engine.setCrdtCatchupSince(async () => {
			calls += 1;
			if (calls === 1) await firstHeld; // hold the first pass open
			return { changes: [], has_more: false, next_seq: null };
		});

		const p1 = engine.catchupViaSeqReplay(); // starts, blocks on firstHeld
		const p2 = engine.catchupViaSeqReplay(); // coalesced → schedules one re-run
		const p3 = engine.catchupViaSeqReplay(); // also coalesced (no extra pass)
		releaseFirst();
		await Promise.all([p1, p2, p3]);

		expect(calls).toBe(2); // first pass + exactly one coalesced re-run
	});

	test("no-op (never throws) when the socket fetcher is unwired", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		await expect(engine.catchupViaSeqReplay()).resolves.toEqual({
			applied: 0,
			files: 0,
			failed: 0,
			deletes: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
			// NOT complete: the walk never happened, so the empty sets describe our
			// ignorance, not the server. A destructive caller reading these as
			// "server has nothing" would trash the vault.
			complete: false,
		});
	});

	test("(#5b) collects non-deleted attachment paths into serverAttachmentPaths, excludes deleted", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		engine.setCrdtCatchupSince(async () => ({
			changes: [
				attachmentOp(1, "att-1", "Attachments/a.png"),
				attachmentOp(2, "att-2", "Attachments/b.png", true), // deleted — excluded
				op(3, "id-a", "Notes/a.md"), // a note change must not pollute the set
			],
			has_more: false,
			next_seq: null,
		}));

		const { serverAttachmentPaths, serverIds } = await engine.catchupViaSeqReplay({
			fromZero: true,
		});

		expect([...serverAttachmentPaths]).toEqual(["Attachments/a.png"]);
		expect([...serverIds]).toEqual(["id-a"]);
	});

	test("catchupViaSeqReplay({fromZero}) starts at 0 and returns the server id-set", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		engine.setCatchupSeq(999); // stale high cursor must be ignored under fromZero

		const cursorsSeen: number[] = [];
		engine.setCrdtCatchupSince(async (cursor: number) => {
			cursorsSeen.push(cursor);
			return {
				changes: [op(1, "n1", "A.md"), { ...op(2, "n2", "B.md"), deleted: true }],
				has_more: false,
				next_seq: null,
			};
		});

		const { applied, serverIds } = await engine.catchupViaSeqReplay({ fromZero: true });

		expect(cursorsSeen).toEqual([0]); // NOT the stale 999
		expect(applied).toBe(2);
		expect([...serverIds]).toEqual(["n1"]); // deleted n2 excluded
	});

	// Task 6 fix: a push/replace enumeration must walk the server set WITHOUT
	// applying it locally (that would download every remote extra into the
	// vault as an orphan, which then resurrects on the next sync) and without
	// moving the real catch-up cursor (a later genuine catch-up must still see
	// every op this enumeration walked past).
	test("enumerateOnly collects the server set but never applies locally and never moves the cursor", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const applySpy = mock(async () => true);
		(engine as any).applySyncChange = applySpy;
		engine.setCatchupSeq(3); // real cursor, must be untouched by an enumerate pass

		engine.setCrdtCatchupSince(async () => ({
			changes: [op(9, "id-a", "Notes/a.md"), attachmentOp(10, "att-1", "Attachments/a.png")],
			has_more: false,
			next_seq: null,
		}));

		const { applied, serverIds, serverAttachmentPaths } = await engine.catchupViaSeqReplay({
			fromZero: true,
			enumerateOnly: true,
		});

		expect(applySpy).not.toHaveBeenCalled();
		expect(applied).toBe(0);
		expect([...serverIds]).toEqual(["id-a"]);
		expect([...serverAttachmentPaths]).toEqual(["Attachments/a.png"]);
		expect(engine.getCatchupSeq()).toBe(3); // untouched, NOT advanced to 10
	});

	test("without enumerateOnly, catchupViaSeqReplay still applies (no regression from option threading)", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const applySpy = mock(async () => true);
		(engine as any).applySyncChange = applySpy;

		engine.setCrdtCatchupSince(async () => ({
			changes: [op(4, "id-a", "Notes/a.md")],
			has_more: false,
			next_seq: null,
		}));

		const { applied } = await engine.catchupViaSeqReplay({ fromZero: true });

		expect(applySpy).toHaveBeenCalledTimes(1);
		expect(applied).toBe(1);
		expect(engine.getCatchupSeq()).toBe(4); // cursor DOES advance for a real apply pass
	});
});

// Phase C Step 1 — the single deterministic apply. `applyOp` is the seam BOTH
// live fan-out and catch-up replay route through; `applySyncChange` becomes a
// thin adapter that maps a merged-feed entry to an op. These tests pin applyOp's
// OWN responsibilities (id learning on upsert, id retirement on delete, dispatch
// to the shared applyChange core) — the deep converge/merge/resurrection logic
// stays owned + tested by applyChange.
describe("applyOp", () => {
	test("upsert op learns the note id, confirms it, and dispatches an upsert to applyChange", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const map = (engine as any).noteIdMap as NoteIdMap;
		const changes: any[] = [];
		(engine as any).applyChange = mock(async (nc: any) => {
			changes.push(nc);
			return true;
		});

		const applied = await (engine as any).applyOp({
			kind: "upsert",
			id: "id-new",
			path: "Notes/new.md",
			title: "new",
			content: "hello",
			content_hash: "h1",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		});

		expect(applied).toBe(true);
		expect(map.pathForId("id-new")).toBe("Notes/new.md"); // id learned from the op
		expect((engine as any).isNoteConfirmed("id-new")).toBe(true); // confirmed for CRDT routing
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			path: "Notes/new.md",
			content: "hello",
			deleted: false,
		});
	});

	test("delete op dispatches a tombstone to applyChange, then retires the id mapping", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const map = (engine as any).noteIdMap as NoteIdMap;
		map.set("Notes/a.md", "id-a");
		let mappedAtApply: string | null = "unset";
		(engine as any).applyChange = mock(async (nc: any) => {
			// The delete branch of applyChange needs the path->id mapping intact to
			// classify the note as CRDT-managed — retirement is DEFERRED until after.
			mappedAtApply = map.pathForId("id-a");
			expect(nc.deleted).toBe(true);
			return true;
		});

		await (engine as any).applyOp({
			kind: "delete",
			id: "id-a",
			path: "Notes/a.md",
			title: "a",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		});

		expect(mappedAtApply).toBe("Notes/a.md"); // still mapped DURING applyChange
		expect(map.pathForId("id-a")).toBeNull(); // retired AFTER
	});

	test("a null-path op (folder marker) is skipped quietly, never reaching applyChange", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const applyChange = mock(async () => true);
		(engine as any).applyChange = applyChange;

		const applied = await (engine as any).applyOp({
			kind: "upsert",
			id: "id-marker",
			path: null,
			title: "",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		});

		expect(applied).toBe(false);
		expect(applyChange).not.toHaveBeenCalled();
	});
});

// REST-purge Bucket A regression guard (e2e test_deaf_live_bound_note_converges):
// unifying fullSync's pull cursor and the socket replay's catchupSeq onto ONE
// watermark removed a live-bound note's second delivery chance. catchUp now
// re-detects a diverged live-bound note from the manifest and re-converges it
// via the socket-native socketConverge primitive (single-path D3),
// independent of the seq cursor.
describe("healDivergedLiveBoundNotes (cursor-independent live-bound re-converge)", () => {
	function manifestOf(notes: Array<{ id: string; path: string; content_hash: string }>) {
		return {
			notes,
			attachments: [],
			total_notes: notes.length,
			total_attachments: 0,
			change_seq: 1,
		};
	}

	test("re-fires the socket re-handshake for a diverged live-bound note independent of the seq cursor", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck((p) => p === "Notes/a.md");
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).toHaveBeenCalledTimes(1);
		expect(converge.mock.calls[0]).toEqual(["Notes/a.md", "id-a"]);
		// The manifest carries hashes only (keyed HMAC — uncomputable
		// client-side), so this leg cannot verify convergence — serverHash
		// stays unrecorded until a real STEP2/update commit lands (fix wave 1).
		expect(engine.exportSyncState()["Notes/a.md"].serverHash).toBe("H1");
	});

	test("fix wave 1 (e) / fix wave 5 (3): stages the manifest's content_hash (content:null — hash-only, uncomputable client-side) and commits UNVERIFIED on the next real STEP2/update, preserving the pre-wave-5 best-effort manifest-heal behavior", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck((p) => p === "Notes/a.md");
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);
		// Staged, not recorded — the manifest heal alone cannot prove the doc
		// holds the server's ops.
		expect(engine.exportSyncState()["Notes/a.md"].serverHash).toBe("H1");

		// Simulates CrdtManager's onSynced firing after a real inbound frame
		// applies non-empty. content:null means commitCrdtConvergence has no
		// plaintext to content-verify against — it commits unverified, exactly
		// like before fix wave 5 (the manifest heal's recording stays
		// best-effort).
		await engine.commitCrdtConvergence("id-a");

		expect(engine.exportSyncState()["Notes/a.md"].serverHash).toBe("H2");
	});

	test("skips a CONVERGED live-bound note (serverHash already matches the manifest)", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck(() => true);
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H2" } });
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).not.toHaveBeenCalled();
	});

	test("skips an IDLE (not live-bound) diverged note — the op-log apply owns it", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck(() => false);
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).not.toHaveBeenCalled();
	});

	test("E1: skips when the manifest crdt_head equals the recorded crdtHead — op-level converged, no STEP1 refire", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck((p) => p === "Notes/a.md");
		// serverHash is stale (a fan-out recorded crdtHead but not serverHash),
		// yet the head matches — the doc provably holds the server state.
		engine.importSyncState({
			"Notes/a.md": { hash: 1, serverHash: "H1", crdtHead: "HEAD-X" },
		});
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).healDivergedLiveBoundNotes({
			...manifestOf([
				{ id: "id-a", path: "Notes/a.md", content_hash: "H2", crdt_head: "HEAD-X" } as any,
			]),
		});

		expect(converge).not.toHaveBeenCalled();
	});

	test("E1: fires STEP1 when the manifest crdt_head DIFFERS from the recorded crdtHead", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck((p) => p === "Notes/a.md");
		engine.importSyncState({
			"Notes/a.md": { hash: 1, serverHash: "H1", crdtHead: "HEAD-X" },
		});
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).healDivergedLiveBoundNotes({
			...manifestOf([
				{ id: "id-a", path: "Notes/a.md", content_hash: "H2", crdt_head: "HEAD-Y" } as any,
			]),
		});

		expect(converge).toHaveBeenCalledTimes(1);
	});
});

// Phase E1 (#1065): the whole-vault seq-diff validator. A manifest row whose
// seq the replay has ALREADY consumed (row.seq <= cursor) but this path never
// recorded is a silent apply-loss (the test_10 "received=yes materialized=no"
// class) — rewind the cursor so the next replay re-serves it. Rows with
// seq > cursor need nothing: the imminent replay fetches them anyway.
describe("validateFromManifest (Phase E1 seq integer diff)", () => {
	function manifest(notes: Array<Record<string, unknown>>) {
		return {
			notes,
			attachments: [],
			total_notes: notes.length,
			total_attachments: 0,
			change_seq: 100,
		} as any;
	}

	test("consumed-but-unrecorded row (no syncState entry) floors the next replay at seq-1", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		const behind = (engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		expect(behind).toBe(1);
		// The validator never writes the cursor directly (an in-flight replay's
		// per-page persist would clobber it) — it hands a floor to the sole
		// cursor writer, runSeqReplayOnce.
		expect((engine as any).seqRewindFloor).toBe(13);
		expect(engine.getCatchupSeq()).toBe(20);
	});

	test("the next replay consumes the floor: crdt_catchup_since is called from the rewound cursor", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		const catchupSince = mock(async () => ({ changes: [], has_more: false, next_seq: null }));
		engine.setCrdtCatchupSince(catchupSince as any);
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		await engine.catchupViaSeqReplay();
		expect(catchupSince.mock.calls[0]?.[0]).toBe(13);
		expect((engine as any).seqRewindFloor).toBeNull();
	});

	test("consumed row newer than the path's recorded seq floors the replay", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		engine.importSyncState({ "Notes/a.md": { hash: 1, seq: 10 } });
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		expect((engine as any).seqRewindFloor).toBe(13);
	});

	test("row beyond the cursor does NOT rewind — the next replay fetches it anyway", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 25 }]),
		);
		expect((engine as any).seqRewindFloor).toBeNull();
	});

	test("legacy syncState entry without seq is NOT flagged (entry exists = it materialized)", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		engine.importSyncState({ "Notes/a.md": { hash: 1 } });
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		expect((engine as any).seqRewindFloor).toBeNull();
	});

	test("row without seq (old backend) is skipped — never NaN-rewinds", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H" }]),
		);
		expect((engine as any).seqRewindFloor).toBeNull();
	});

	test("the SAME discrepancy does not rewind twice (bounded retry, no rewind loop)", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		const m = manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]);
		(engine as any).validateFromManifest(m);
		expect((engine as any).seqRewindFloor).toBe(13);
		// replay consumed the floor, apply still failed, same row still behind
		(engine as any).seqRewindFloor = null;
		(engine as any).validateFromManifest(m);
		expect((engine as any).seqRewindFloor).toBeNull();
	});
});

describe("catchUp manifestSeq short-circuit (Phase E1)", () => {
	function stubCatchUpInternals(engine: SyncEngine) {
		const reconcile = spyOn(engine as any, "reconcileFromManifest").mockResolvedValue(
			undefined,
		);
		const heal = spyOn(engine as any, "healDivergedLiveBoundNotes").mockResolvedValue(0);
		const validate = spyOn(engine as any, "validateFromManifest").mockReturnValue(0);
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
			complete: true,
		});
		const folders = spyOn(engine as any, "syncExplicitFolders").mockResolvedValue(undefined);
		return { reconcile, heal, validate, replay, folders };
	}

	test("unchanged response skips the server→local manifest steps but still replays AND still seeds local empty folders", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).manifestSeq = 42;
		const { reconcile, heal, validate, replay } = stubCatchUpInternals(engine);
		// seedEmptyFolders is LOCAL→SERVER (retry backstop for a failed folder
		// push) — the server watermark says nothing about local state, so the
		// unchanged fast path must NOT skip it (review finding, agent #3).
		const seed = spyOn(engine as any, "seedEmptyFolders").mockResolvedValue(undefined);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValueOnce({
			unchanged: true,
			change_seq: 42,
		});

		await engine.catchUp();

		expect((mockApi.getManifest as ReturnType<typeof mock>).mock.calls.at(-1)).toEqual([42]);
		expect(reconcile).not.toHaveBeenCalled();
		expect(heal).not.toHaveBeenCalled();
		expect(validate).not.toHaveBeenCalled();
		expect(seed).toHaveBeenCalledTimes(1);
		expect(replay).toHaveBeenCalledTimes(1);
	});

	test("a seq-0 behind row floors at genesis (sentinel does not mask target -1)", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(5);
		(engine as any).validateFromManifest({
			notes: [{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 0 }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
			change_seq: 5,
		} as any);
		// target = -1, clamped to 0 — replay from genesis.
		expect((engine as any).seqRewindFloor).toBe(0);
	});

	test("a full manifest pass runs all steps and records change_seq as the new watermark", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const { reconcile, heal, validate, replay } = stubCatchUpInternals(engine);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValueOnce({
			notes: [],
			attachments: [],
			total_notes: 0,
			total_attachments: 0,
			change_seq: 7,
		});

		await engine.catchUp();

		expect(reconcile).toHaveBeenCalledTimes(1);
		expect(validate).toHaveBeenCalledTimes(1);
		expect(heal).toHaveBeenCalledTimes(1);
		expect(replay).toHaveBeenCalledTimes(1);
		expect((engine as any).manifestSeq).toBe(7);
	});

	test("an UNCLEAN pass (heal poked / validator behind) does NOT record the watermark — the retry net stays live", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		const { heal, validate } = stubCatchUpInternals(engine);
		heal.mockResolvedValue(1); // one diverged live-bound note was poked
		validate.mockReturnValue(0);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValueOnce({
			notes: [],
			attachments: [],
			total_notes: 0,
			total_attachments: 0,
			change_seq: 7,
		});

		await engine.catchUp();

		// Fire-and-forget heal hasn't proven convergence — recording now would
		// let every later poll short-circuit and never re-check an idle vault.
		expect((engine as any).manifestSeq).toBe(0);
	});
});

describe("catchUp identity-swap delete guard (#283)", () => {
	// The production wiring: catchUp captures the auth generation BEFORE fetching
	// the manifest and threads it into reconcileFromManifest. If an OAuth swap
	// lands while that fetch is in flight, the manifest can be a stale snapshot
	// missing a live note — trashing it as "server-deleted" is the #283 data loss.
	// This guards the THREADING specifically: drop the authGenAtFetch argument at
	// the reconcileFromManifest call and this test goes red (reconcile would then
	// capture the post-swap generation and run the destructive pass).
	test("does NOT trash a live note when an OAuth swap races catchUp's manifest fetch", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.importSyncState({ "Notes/gone.md": { hash: 123 } });
		const gone = new TFile("Notes/gone.md");
		(mockApp.vault.getFiles as ReturnType<typeof mock>).mockReturnValueOnce([gone]);
		const trashFile = mockApp.fileManager.trashFile as ReturnType<typeof mock>;
		trashFile.mockClear();
		// Stub the non-reconcile downstream steps so catchUp runs to completion.
		spyOn(engine as any, "validateFromManifest").mockReturnValue(0);
		spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
			complete: true,
		});
		spyOn(engine as any, "healDivergedLiveBoundNotes").mockResolvedValue(0);
		spyOn(engine as any, "syncExplicitFolders").mockResolvedValue(undefined);
		spyOn(engine as any, "seedEmptyFolders").mockResolvedValue(undefined);
		// Manifest resolves AFTER an identity swap bumped the generation, and omits
		// the still-live note (stale snapshot from the racing swap).
		(mockApi.getManifest as ReturnType<typeof mock>).mockImplementationOnce(async () => {
			engine.bumpAuthGeneration();
			return {
				notes: [],
				attachments: [],
				total_notes: 0,
				total_attachments: 0,
				change_seq: 99,
			};
		});

		await engine.catchUp();

		expect(trashFile).not.toHaveBeenCalled();
		expect(engine.exportSyncState()["Notes/gone.md"]).toBeDefined();
	});
});

describe("validateFromManifest (E1 #1065) — hash-aware seq-stamp closes the no-progress stall", () => {
	// Prod (device a75644e9): the manifest validator re-served the same 3-4 rows
	// ~100x/24h ("still behind after a re-serve — not rewinding again"). The rows
	// carried a NEWER server seq but the SAME content_hash the client already
	// recorded (a meta/seq-only advance): not stale (newer seq), not diverged
	// (hash matches), so catch-up fell through every branch and never stamped the
	// seq — the validator re-served forever. Content is already converged; only
	// the seq bookkeeping lagged.
	function freshEngine(): SyncEngine {
		const e = makeEngineWithCrdt({ closeDoc: () => {} });
		e.setCatchupSeq(1000); // cursor well past the rows below (they're "consumed")
		return e;
	}

	test("a converged row (manifest hash == recorded serverHash, newer seq) records seq instead of re-serving", () => {
		const e = freshEngine();
		const path = "Workflows/stuck.md";
		(e as unknown as { syncState: Map<string, unknown> }).syncState.set(path, {
			serverHash: "H1",
			hash: 111,
			version: 4,
			seq: 800, // older than the manifest's 900
		});

		const behind = (
			e as unknown as { validateFromManifest: (m: unknown) => number }
		).validateFromManifest({ notes: [{ path, seq: 900, content_hash: "H1" }] });

		expect(behind).toBe(0); // converged — do NOT flag/re-serve
		expect(e.exportSyncState()[path]?.seq).toBe(900); // seq bookkeeping recorded
	});

	test("a genuinely-diverged row (manifest hash != recorded serverHash) is still flagged + not stamped", () => {
		const e = freshEngine();
		const path = "Workflows/diverged.md";
		(e as unknown as { syncState: Map<string, unknown> }).syncState.set(path, {
			serverHash: "H1",
			hash: 111,
			version: 4,
			seq: 800,
		});

		const behind = (
			e as unknown as { validateFromManifest: (m: unknown) => number }
		).validateFromManifest({ notes: [{ path, seq: 900, content_hash: "H2" }] });

		expect(behind).toBe(1); // real content divergence — must re-serve
		expect(e.exportSyncState()[path]?.seq).toBe(800); // untouched
	});
});

/**
 * The op-log pager contract shared by BOTH walkers of `crdt_catchup_since`:
 * `runSeqReplayOnce` (applies + persists the cursor) and
 * `enumerateServerState` (pure read for the sync preview). #378 extracted the
 * pagination mechanics they used to duplicate — page size, loop ceiling,
 * composite {seq,id} advance, stuck-cursor guard. These tests pin the parts
 * that must stay identical, and the ONE part that must stay different (fetch
 * error policy), so the two callers cannot drift apart again.
 *
 * The stuck-cursor tests are self-limiting: the mock THROWS once the walker
 * has fetched more pages than the guard should ever allow. A removed guard
 * fails the test in milliseconds instead of spinning the 100k-page ceiling.
 */
describe("op-log pager — contract shared by replay + enumerate", () => {
	function noteRow(seq: number, id: string, path: string) {
		return {
			type: "note" as const,
			id,
			seq,
			path,
			title: path.replace(/\.md$/, ""),
			content: `c${seq}`,
			content_hash: `h${seq}`,
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		};
	}

	/** An engine wired for `enumerateServerState` (needs a live crdt socket). */
	function makeEnumerableEngine(): SyncEngine {
		const e = makeEngineWithCrdt({ closeDoc: () => {} });
		e.setCrdtLiveCheck(() => true);
		return e;
	}

	test("both walkers request the same op-log page size", async () => {
		const limits: Array<number | undefined> = [];
		const feed = async (_cursor: number, limit?: number) => {
			limits.push(limit);
			return { changes: [], has_more: false, next_seq: null, next_id: null };
		};

		const replayEngine = makeEngineWithCrdt({ closeDoc: () => {} });
		replayEngine.setCrdtCatchupSince(feed);
		await replayEngine.catchupViaSeqReplay();

		const previewEngine = makeEnumerableEngine();
		previewEngine.setCrdtCatchupSince(feed);
		await (previewEngine as any).enumerateServerState();

		expect(limits).toEqual([500, 500]);
	});

	test("replay stops when a page fails to advance the composite cursor", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		let calls = 0;
		engine.setCrdtCatchupSince(async () => {
			calls += 1;
			if (calls > 2) throw new Error("stuck-cursor guard did not fire (replay)");
			// Page 2 re-serves page 1's final row: the composite cursor cannot
			// advance past the page start, so the walk must stop rather than
			// refetch the same page forever.
			return {
				changes: [noteRow(5, "id-a", "Notes/a.md")],
				has_more: true,
				next_seq: 5,
				next_id: "id-a",
			};
		});

		await engine.catchupViaSeqReplay();

		expect(calls).toBe(2);
	});

	test("enumerate stops when a page fails to advance the composite cursor", async () => {
		const engine = makeEnumerableEngine();
		let calls = 0;
		engine.setCrdtCatchupSince(async () => {
			calls += 1;
			if (calls > 2) throw new Error("stuck-cursor guard did not fire (enumerate)");
			return {
				changes: [noteRow(5, "id-a", "Notes/a.md")],
				has_more: true,
				next_seq: 5,
				next_id: "id-a",
			};
		});

		await (engine as any).enumerateServerState();

		expect(calls).toBe(2);
	});

	test("an exclusive replay refuses a walk that stopped early (partial server sets)", async () => {
		// The destructive pull-all-delete path trusts serverIds/serverAttachmentPaths
		// to decide which local files are server-absent "extras" and trash them. It
		// guards against a COALESCED replay (empty sets) — but a walk cut short by a
		// mid-walk socket drop returns partial, NON-empty sets, sails past that
		// guard, and every note the walk never reached looks like an extra.
		// catchupViaSeqReplayExclusive must return null so the caller aborts.
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		let calls = 0;
		engine.setCrdtCatchupSince(async () => {
			calls += 1;
			if (calls === 1) {
				return {
					changes: [noteRow(5, "id-a", "Notes/a.md")],
					has_more: true,
					next_seq: 5,
					next_id: "id-a",
				};
			}
			throw new Error("socket dropped");
		});

		const res = await (engine as any).catchupViaSeqReplayExclusive({ fromZero: true });

		expect(res).toBeNull();
	});

	test("a persist failure is not swallowed as a fetch failure", async () => {
		// The replay deliberately swallows FETCH errors so it keeps the pages it
		// already applied. It must not also swallow errors from its OWN work: a
		// saveData failure means the resume cursor never landed, and reporting
		// success anyway hands a destructive caller (catchupViaSeqReplayExclusive
		// -> pull-all-delete) a serverIds set built from a walk that stopped early.
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).applySyncChange = mock(async () => true);
		(engine as any).saveData = mock(async () => {
			throw new Error("disk full");
		});
		engine.setCrdtCatchupSince(async () => ({
			changes: [noteRow(5, "id-a", "Notes/a.md")],
			has_more: false,
			next_seq: null,
			next_id: null,
		}));

		await expect(engine.catchupViaSeqReplay()).rejects.toThrow("disk full");
	});

	test("a mid-walk fetch failure surfaces to the preview but not to the replay", async () => {
		// The one place the two walkers MUST differ. The preview renders a plan
		// the user acts on, so a partial walk has to error visibly rather than
		// under-report server state. The replay keeps the pages it already
		// applied and resumes from the persisted cursor on the next pass.
		const boom = () => {
			let calls = 0;
			return async () => {
				calls += 1;
				if (calls === 1) {
					return {
						changes: [noteRow(5, "id-a", "Notes/a.md")],
						has_more: true,
						next_seq: 5,
						next_id: "id-a",
					};
				}
				throw new Error("socket dropped");
			};
		};

		const replayEngine = makeEngineWithCrdt({ closeDoc: () => {} });
		(replayEngine as any).applySyncChange = mock(async () => true);
		replayEngine.setCrdtCatchupSince(boom());
		const { applied } = await replayEngine.catchupViaSeqReplay();
		expect(applied).toBe(1);
		expect(replayEngine.getCatchupSeq()).toBe(5);

		const previewEngine = makeEnumerableEngine();
		previewEngine.setCrdtCatchupSince(boom());
		await expect((previewEngine as any).enumerateServerState()).rejects.toThrow(
			"socket dropped",
		);
	});
});

// #1409: a diverged COLD note (nobody has it open) used to converge via a
// STEP1 re-handshake, and the backend routes every STEP1 through ensure_room —
// so a bulk first sync allocated one server room per such note. Attribution on
// a 250-note import put 100% of the rooms at this one call site. The room-free
// `crdt_doc_state` read returns the same Yjs state off the persisted snapshot,
// and applying it is the same monotonic merge STEP2's ops would have been.
describe("convergeColdNoteRoomFree (#1409 — cold notes converge without a room)", () => {
	const CHANGE = {
		id: "id-a",
		path: "Notes/a.md",
		content_hash: "H2",
		version: 2,
		seq: 7,
	} as unknown as SyncNoteChange;

	// `markSynced` on the real registry re-enters SyncEngine via the onSynced
	// port (crdt/wiring.ts), which is what drives commitCrdtConvergence. The
	// double mirrors that so a test can prove the helper COMMITS, not merely
	// that it stages — an earlier revision of these tests called
	// commitCrdtConvergence by hand and would have passed against a version
	// that never triggered it at all.
	function coldEngine(applied: Array<[string, Uint8Array]>) {
		const engine: SyncEngine = makeEngineWithCrdt({
			applyRemoteUpdate: (id: string, u: Uint8Array) => {
				applied.push([id, u]);
				return Promise.resolve();
			},
			markSynced: (id: string) => void engine.commitCrdtConvergence(id),
			closeDoc: () => {},
			// The real registry always answers this; the room-free read is only
			// legal when it is false (the frame cannot carry local ops upward).
			hasUndeliveredOps: () => false,
		} as unknown as Partial<CrdtManager>);
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });
		return engine;
	}

	test("a note with UNDELIVERED local ops takes the room, not the read", async () => {
		// `crdt_doc_state` is a READ. The handshake it replaces is bidirectional
		// — the server answers syncStep1 with [syncStep2, syncStep1] and the
		// client's reply to that second step1 IS the upload half.
		//
		// So taking this path with undelivered local ops downloads, marks the
		// note synced, and never transmits them: complete on this device, blank
		// on every other, and stamped in-sync so every later catch-up compares
		// equal hashes and skips it. Permanently, with no error anywhere.
		const applied: Array<[string, Uint8Array]> = [];
		const engine = coldEngine(applied);
		const docState = mock().mockResolvedValue({ b64: "AQID", head: "h" });
		engine.setCrdtPorts({ docState });
		(engine as any).crdt.hasUndeliveredOps = () => true;
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).convergeColdNoteRoomFree(
			"id-a",
			"Notes/a.md",
			CHANGE,
			"server body",
			"H2",
		);

		// The read is never even attempted, and the bidirectional path runs.
		expect(docState).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
		expect(converge).toHaveBeenCalledTimes(1);
	});

	test("applies the room-free state and never fires the room handshake", async () => {
		const applied: Array<[string, Uint8Array]> = [];
		const engine = coldEngine(applied);
		const docState = mock().mockResolvedValue({ b64: "AQID", head: "h" });
		engine.setCrdtPorts({ docState });
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).convergeColdNoteRoomFree(
			"id-a",
			"Notes/a.md",
			CHANGE,
			"server body",
			"H2",
		);

		expect(docState).toHaveBeenCalledWith("id-a");
		expect(applied).toEqual([["id-a", new Uint8Array([1, 2, 3])]]);
		// THE assertion this whole change exists for.
		expect(converge).not.toHaveBeenCalled();
	});

	test("DRIVES the convergence commit — applyRemoteUpdate does not fire onSynced, so an untriggered stage would leave the note diverged forever", async () => {
		const engine = coldEngine([]);
		engine.setCrdtPorts({ docState: mock().mockResolvedValue({ b64: "", head: "h" }) });
		await (engine as any).convergeColdNoteRoomFree(
			"id-a",
			"Notes/a.md",
			CHANGE,
			"server body",
			"H2",
		);

		await Promise.resolve();
		expect(engine.exportSyncState()["Notes/a.md"].serverHash).toBe("H2");
	});

	test("falls back to the room handshake when the frame fails (old backend, rate limit, dropped socket)", async () => {
		const engine = coldEngine([]);
		engine.setCrdtPorts({
			docState: mock().mockRejectedValue(new Error("unmatched topic")),
		});
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).convergeColdNoteRoomFree(
			"id-a",
			"Notes/a.md",
			CHANGE,
			"server body",
			"H2",
		);

		expect(converge).toHaveBeenCalledTimes(1);
		expect(converge.mock.calls[0]).toEqual(["Notes/a.md", "id-a"]);
	});

	test("falls back to the room handshake when the port is unwired entirely", async () => {
		const engine = coldEngine([]);
		engine.setCrdtPorts({ docState: null });
		const converge = spyOn(engine as any, "socketConverge").mockImplementation(() => {});

		await (engine as any).convergeColdNoteRoomFree(
			"id-a",
			"Notes/a.md",
			CHANGE,
			"server body",
			"H2",
		);

		expect(converge).toHaveBeenCalledTimes(1);
	});
});
