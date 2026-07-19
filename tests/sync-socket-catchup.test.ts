/**
 * Tests: Plan B1 Task 5 — socket vault-catchup (`catchupViaSocket`), the
 * socket twin of the REST `coldReceive`. Mirrors the mock-engine pattern
 * from tests/sync-cold-receive.test.ts.
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
	// No confirmed-set seeding: convergeNoteFromDelta is the sole convergence
	// path and no longer gates on isNoteConfirmed — a note in the server head
	// map is server-known by definition. This is exactly the reconnect
	// catch-up the confirmed gate used to break (a reconnect cleared the set).
	return e;
}

describe("catchupViaSocket", () => {
	test("pulls deltas only for diverged notes", async () => {
		const applied: string[] = [];
		const crdt = {
			applyRemoteUpdate: (id: string, _update: Uint8Array) => {
				applied.push(id);
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as any).setCrdtHead("Notes/a.md", "same"); // converged
		(engine as any).setCrdtHead("Notes/b.md", "old"); // diverged

		engine.setCrdtCatchup(
			async () => ({
				heads: {
					"id-a": { path: "Notes/a.md", head: "same" },
					"id-b": { path: "Notes/b.md", head: "new" },
				},
			}),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "new" }),
		);

		await engine.catchupViaSocket();

		expect(applied).toEqual(["id-b"]); // only the diverged note
		expect((engine as any).getCrdtHead("Notes/b.md")).toBe("new");
		expect((engine as any).getCrdtHead("Notes/a.md")).toBe("same"); // untouched
	});

	test("a per-note failure is caught, logged, and skipped — never throws", async () => {
		const crdt = {
			applyRemoteUpdate: (_id: string, _update: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.reject(new Error("boom")),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);

		engine.setCrdtCatchup(
			async () => ({
				heads: {
					"id-a": { path: "Notes/a.md", head: "new" },
					"id-b": { path: "Notes/b.md", head: "new" },
				},
			}),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "new" }),
		);

		await expect(engine.catchupViaSocket()).resolves.toBeUndefined();
		// Failed note's head is left unadvanced — retried next catch-up.
		expect((engine as any).getCrdtHead("Notes/a.md")).toBeUndefined();
	});

	test("a whole-vault heads-fetch failure is caught — never throws into the caller", async () => {
		const crdt = {
			applyRemoteUpdate: (_id: string, _update: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
		};
		const engine = makeEngineWithCrdt(crdt);
		engine.setCrdtCatchup(
			async () => {
				throw new Error("socket down");
			},
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "new" }),
		);
		// Must resolve (matching coldReceive), not reject — honors the never-throw contract.
		await expect(engine.catchupViaSocket()).resolves.toBeUndefined();
	});

	test("captures disk drift BEFORE applying the socket delta (#3 — un-pushed local edit not clobbered)", async () => {
		// The socket path now routes through the shared guarded apply, so an
		// un-pushed disk edit is merged into the Y.Doc before the remote delta
		// (captureDiskDriftBeforeRemote) instead of being overwritten.
		const order: string[] = [];
		const crdt = {
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => {
				order.push("apply");
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as any).setCrdtHead("Notes/b.md", "old");
		(engine as any).captureDiskDriftBeforeRemote = async () => {
			order.push("capture");
		};
		engine.setCrdtCatchup(
			async () => ({ heads: { "id-b": { path: "Notes/b.md", head: "new" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "new" }),
		);

		await engine.catchupViaSocket();

		expect(order).toEqual(["capture", "apply"]); // drift captured before the delta apply
	});

	test("a history-less note is adopted, not seeded+delta-applied (#234 — no content doubling)", async () => {
		const applied: string[] = [];
		let captured = false;
		let adopted = false;
		const crdt = {
			applyRemoteUpdate: (id: string, _u: Uint8Array) => {
				applied.push(id);
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
			closeDoc: () => {},
			hasHistory: (_id: string) => Promise.resolve(false), // never in IDB
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as any).setCrdtHead("Notes/b.md", "old");
		(engine as any).captureDiskDriftBeforeRemote = async () => {
			captured = true;
		};
		(engine as any).adoptHistoryLessNote = async (_p: string, _id: string) => {
			adopted = true;
			return "new";
		};
		engine.setCrdtCatchup(
			async () => ({ heads: { "id-b": { path: "Notes/b.md", head: "new" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "new" }),
		);

		await engine.catchupViaSocket();

		expect(adopted).toBe(true); // routed through adoptHistoryLessNote
		expect(applied).toEqual([]); // bare delta NOT applied over a history-less doc
		expect(captured).toBe(false); // and NOT seeded with disk drift (would double)
		expect((engine as any).getCrdtHead("Notes/b.md")).toBe("new");
	});

	test("a pending gap re-fetches and leaves the head unadvanced while still gapped", async () => {
		let deltaCalls = 0;
		const crdt = {
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
			closeDoc: () => {},
			hasPendingGap: (_id: string) => Promise.resolve(true), // never heals
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as any).setCrdtHead("Notes/b.md", "old");
		(engine as any).captureDiskDriftBeforeRemote = async () => {};
		engine.setCrdtCatchup(
			async () => ({ heads: { "id-b": { path: "Notes/b.md", head: "new" } } }),
			async (docId: string) => {
				deltaCalls++;
				return { doc_id: docId, b64: "AAE=", head: "new" };
			},
		);

		await engine.catchupViaSocket();

		expect(deltaCalls).toBe(2); // initial delta + gap-heal re-fetch
		expect((engine as any).getCrdtHead("Notes/b.md")).toBe("old"); // still gapped → NOT advanced
	});

	test("first-discovery: a head-map entry for an UNKNOWN id materializes the note at its path", async () => {
		// The head map is the sole discovery source now that REST receive is gone.
		// An id not in the noteIdMap must be learned from the entry's path and
		// converged (flushFromCrdt creates the missing file).
		const applied: string[] = [];
		const crdt = {
			applyRemoteUpdate: (id: string, _u: Uint8Array) => {
				applied.push(id);
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		const map = (engine as any).noteIdMap as NoteIdMap;

		engine.setCrdtCatchup(
			async () => ({ heads: { "id-new": { path: "Notes/new.md", head: "h1" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h1" }),
		);

		await engine.catchupViaSocket();

		// The unknown id was learned from the head-map path and converged.
		expect(map.pathForId("id-new")).toBe("Notes/new.md");
		expect(applied).toEqual(["id-new"]);
		expect((engine as any).getCrdtHead("Notes/new.md")).toBe("h1");
	});

	test("first-discovery history-less note materializes the FILE from the socket delta (no REST getUpdates)", async () => {
		// A note created on ANOTHER device while this one was offline: present in
		// the head map, absent locally (no id->path mapping, no file, empty Y.Doc =
		// history-less). Catch-up must materialize it from the SOCKET delta, never
		// fall back to REST getUpdates (dropped in the CRDT-authoritative rewire).
		const getUpdates = mock().mockRejectedValue(
			new Error("REST getUpdates must not be called on the socket catch-up path"),
		);
		const ref: { engine?: SyncEngine } = {};
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false), // never in IDB — first-discovery
			// Simulate the manager's onFlushToDisk wiring: a remote apply flushes the
			// projected server content to disk (createFileWithFolders for a new note).
			applyRemoteUpdate: (_id: string, _u: Uint8Array) =>
				ref.engine!.flushFromCrdt("Notes/new.md", "server body").then(() => undefined),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([0])),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		ref.engine = engine;
		(engine as unknown as { api: { getUpdates: unknown } }).api.getUpdates = getUpdates;
		mockApp.vault.create.mockClear();

		engine.setCrdtCatchup(
			async () => ({ heads: { "id-new": { path: "Notes/new.md", head: "h1" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h1" }),
		);

		await engine.catchupViaSocket();

		expect(getUpdates).not.toHaveBeenCalled(); // socket-native, no REST fallback
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/new.md", "server body");
		expect((engine as any).getCrdtHead("Notes/new.md")).toBe("h1");
	});

	test("does NOT resurrect a note with a pending local delete not yet synced (minimal Task C guard)", async () => {
		const applied: string[] = [];
		const crdt = {
			applyRemoteUpdate: (id: string, _u: Uint8Array) => {
				applied.push(id);
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		// handleDelete's offline path: the note's mapping is gone and a delete is
		// queued but not yet synced; the server still lists it in the head map.
		await (engine as any).queue.enqueue({
			path: "Notes/gone.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});
		engine.setCrdtCatchup(
			async () => ({ heads: { "id-gone": { path: "Notes/gone.md", head: "h1" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h1" }),
		);

		await engine.catchupViaSocket();

		expect(applied).toEqual([]); // NOT resurrected
		expect((engine as any).noteIdMap.pathForId("id-gone")).toBeNull(); // not learned/mapped
	});

	test("no-op when catchup deps or crdt manager are unset", async () => {
		const e = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setReady();
		await expect(e.catchupViaSocket()).resolves.toBeUndefined();
	});

	// FIX 2 (e2e test_27 — empty note never materializes).
	test("first-discovery of an EMPTY note materializes an empty file (test_27)", async () => {
		// An empty note created on another device while this one was offline:
		// present in the head map, absent locally (history-less). Its Y.Doc holds
		// NO content, so applying the full server state integrates ZERO ops —
		// unlike the non-empty case above, the manager's remote-update listener
		// never fires and NO onFlushToDisk/flushFromCrdt runs. The adopt path's
		// materialize backstop must still create the file: an empty markdown file
		// is valid content, not "nothing to do".
		const getUpdates = mock().mockRejectedValue(
			new Error("REST getUpdates must not be called on the socket catch-up path"),
		);
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false), // history-less first-discovery
			// Empty note: the full-state apply is a no-op, so (deliberately, unlike
			// the non-empty first-discovery test) this triggers NO disk flush.
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => Promise.resolve(),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([0])),
			projectedText: (_id: string) => Promise.resolve(""), // empty projected body
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as unknown as { api: { getUpdates: unknown } }).api.getUpdates = getUpdates;
		mockApp.vault.create.mockClear();

		engine.setCrdtCatchup(
			async () => ({ heads: { "id-empty": { path: "Notes/EmptyNote.md", head: "h1" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h1" }),
		);

		await engine.catchupViaSocket();

		expect(getUpdates).not.toHaveBeenCalled(); // socket-native, no REST fallback
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/EmptyNote.md", "");
		expect((engine as any).getCrdtHead("Notes/EmptyNote.md")).toBe("h1");
	});
});

describe("discoverAnnouncedNote (e2e test_27 — announce-driven immediate empty-note discovery)", () => {
	// An empty note's genesis emits crdt_doc_ready with a path but ZERO Y.Doc ops,
	// so no note_yjs_update ever fans out. Consuming the announce path runs the
	// SAME per-note adopt+materialize the whole-vault catch-up would, without
	// waiting ~30s for the level-triggered pull (the note landed at +31s in
	// test_27, 1s past the deadline). It targets ONE note — never the whole-vault
	// heads fetch — and is socket-native (no REST getUpdates).
	test("materializes an empty file from the announce path alone (test_27)", async () => {
		const getUpdates = mock().mockRejectedValue(
			new Error("REST getUpdates must not be called on the socket discovery path"),
		);
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false), // history-less first-discovery
			applyRemoteUpdate: (_id: string, _u: Uint8Array) => Promise.resolve(), // empty → no flush
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([0])),
			projectedText: (_id: string) => Promise.resolve(""), // empty projected body
			closeDoc: () => {},
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as unknown as { api: { getUpdates: unknown } }).api.getUpdates = getUpdates;
		mockApp.vault.create.mockClear();

		// Only the delta channel matters — discovery targets one announced note.
		let headsFetched = false;
		engine.setCrdtCatchup(
			async () => {
				headsFetched = true;
				return { heads: {} };
			},
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h1" }),
		);

		await engine.discoverAnnouncedNote("id-empty", "Notes/EmptyNote.md");

		expect(headsFetched).toBe(false); // per-note, NOT a whole-vault heads fetch
		expect(getUpdates).not.toHaveBeenCalled(); // socket-native, no REST fallback
		expect(mockApp.vault.create).toHaveBeenCalledWith("Notes/EmptyNote.md", "");
		// The id->path mapping was learned and the head recorded.
		expect((engine as any).noteIdMap.pathForId("id-empty")).toBe("Notes/EmptyNote.md");
		expect((engine as any).getCrdtHead("Notes/EmptyNote.md")).toBe("h1");
	});

	test("does NOT resurrect a note with a pending local delete", async () => {
		const applied: string[] = [];
		const crdt = {
			hasHistory: (_id: string) => Promise.resolve(false),
			applyRemoteUpdate: (id: string, _u: Uint8Array) => {
				applied.push(id);
				return Promise.resolve();
			},
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
		engine.setCrdtCatchup(
			async () => ({ heads: {} }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h1" }),
		);

		await engine.discoverAnnouncedNote("id-gone", "Notes/gone.md");

		expect(applied).toEqual([]); // not resurrected
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
		engine.setCrdtCatchup(
			async () => ({ heads: {} }),
			async () => {
				throw new Error("socket delta failed");
			},
		);

		await expect(engine.discoverAnnouncedNote("id-x", "Notes/x.md")).resolves.toBeUndefined();
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
// via restConvergeLiveBound, independent of the seq cursor.
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

	test("re-converges a diverged live-bound note independent of the seq cursor", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck((p) => p === "Notes/a.md");
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });
		const converge = spyOn(engine as any, "restConvergeLiveBound").mockResolvedValue(true);

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).toHaveBeenCalledTimes(1);
		expect(converge.mock.calls[0]).toEqual(["Notes/a.md", "id-a"]);
		// Convergence recorded (serverHash advanced) so the next catch-up skips it.
		expect(engine.exportSyncState()["Notes/a.md"].serverHash).toBe("H2");
	});

	test("skips a CONVERGED live-bound note (serverHash already matches the manifest)", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck(() => true);
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H2" } });
		const converge = spyOn(engine as any, "restConvergeLiveBound").mockResolvedValue(true);

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).not.toHaveBeenCalled();
	});

	test("skips an IDLE (not live-bound) diverged note — the op-log apply owns it", async () => {
		const engine = makeEngineWithCrdt({ closeDoc: () => {} });
		engine.setLiveBoundCheck(() => false);
		engine.importSyncState({ "Notes/a.md": { hash: 1, serverHash: "H1" } });
		const converge = spyOn(engine as any, "restConvergeLiveBound").mockResolvedValue(true);

		await (engine as any).healDivergedLiveBoundNotes(
			manifestOf([{ id: "id-a", path: "Notes/a.md", content_hash: "H2" }]),
		);

		expect(converge).not.toHaveBeenCalled();
	});
});
