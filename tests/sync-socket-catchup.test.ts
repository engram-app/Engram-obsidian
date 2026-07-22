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
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type SyncAttachmentChange, type SyncNoteChange } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
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
	getAttachment: mock().mockResolvedValue({
		path: "",
		content_base64: "",
		mime_type: "",
		size_bytes: 0,
		mtime: 0,
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
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
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(crdt as unknown as CrdtManager);
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
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
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
// via the socket-native socketConvergeLiveBound primitive (single-path D3),
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
		const converge = spyOn(engine as any, "socketConvergeLiveBound").mockImplementation(
			() => {},
		);

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
		const converge = spyOn(engine as any, "socketConvergeLiveBound").mockImplementation(
			() => {},
		);

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).not.toHaveBeenCalled();
	});

	test("skips an IDLE (not live-bound) diverged note — the op-log apply owns it", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck(() => false);
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });
		const converge = spyOn(engine as any, "socketConvergeLiveBound").mockImplementation(
			() => {},
		);

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
		const converge = spyOn(engine as any, "socketConvergeLiveBound").mockImplementation(
			() => {},
		);

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
		const converge = spyOn(engine as any, "socketConvergeLiveBound").mockImplementation(
			() => {},
		);

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

	test("consumed-but-unrecorded row (no syncState entry) rewinds the cursor to seq-1", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		const behind = (engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		expect(behind).toBe(1);
		expect(engine.getCatchupSeq()).toBe(13);
	});

	test("consumed row newer than the path's recorded seq rewinds", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		engine.importSyncState({ "Notes/a.md": { hash: 1, seq: 10 } });
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		expect(engine.getCatchupSeq()).toBe(13);
	});

	test("row beyond the cursor does NOT rewind — the next replay fetches it anyway", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 25 }]),
		);
		expect(engine.getCatchupSeq()).toBe(20);
	});

	test("legacy syncState entry without seq is NOT flagged (entry exists = it materialized)", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		engine.importSyncState({ "Notes/a.md": { hash: 1 } });
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]),
		);
		expect(engine.getCatchupSeq()).toBe(20);
	});

	test("row without seq (old backend) is skipped — never NaN-rewinds", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		(engine as any).validateFromManifest(
			manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H" }]),
		);
		expect(engine.getCatchupSeq()).toBe(20);
	});

	test("the SAME discrepancy does not rewind twice (bounded retry, no rewind loop)", () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setCatchupSeq(20);
		const m = manifest([{ id: "id-a", path: "Notes/a.md", content_hash: "H", seq: 14 }]);
		(engine as any).validateFromManifest(m);
		expect(engine.getCatchupSeq()).toBe(13);
		// replay re-consumed up to 20, apply still failed, same row still behind
		engine.setCatchupSeq(20);
		(engine as any).validateFromManifest(m);
		expect(engine.getCatchupSeq()).toBe(20);
	});
});

describe("catchUp manifestSeq short-circuit (Phase E1)", () => {
	function stubCatchUpInternals(engine: SyncEngine) {
		const reconcile = spyOn(engine as any, "reconcileFromManifest").mockResolvedValue(
			undefined,
		);
		const heal = spyOn(engine as any, "healDivergedLiveBoundNotes").mockResolvedValue(
			undefined,
		);
		const validate = spyOn(engine as any, "validateFromManifest").mockReturnValue(0);
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
		});
		const folders = spyOn(engine as any, "syncExplicitFolders").mockResolvedValue(undefined);
		return { reconcile, heal, validate, replay, folders };
	}

	test("unchanged response skips the manifest-driven steps but still replays", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		(engine as any).manifestSeq = 42;
		const { reconcile, heal, validate, replay } = stubCatchUpInternals(engine);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValueOnce({
			unchanged: true,
			change_seq: 42,
		});

		await engine.catchUp();

		expect((mockApi.getManifest as ReturnType<typeof mock>).mock.calls.at(-1)).toEqual([42]);
		expect(reconcile).not.toHaveBeenCalled();
		expect(heal).not.toHaveBeenCalled();
		expect(validate).not.toHaveBeenCalled();
		expect(replay).toHaveBeenCalledTimes(1);
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
});
