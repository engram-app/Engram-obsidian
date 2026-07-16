/**
 * Tests: Plan B1 Task 5 — socket vault-catchup (`catchupViaSocket`), the
 * socket twin of the REST `coldReceive`. Mirrors the mock-engine pattern
 * from tests/sync-cold-receive.test.ts.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
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
		};
		const engine = makeEngineWithCrdt(crdt);
		(engine as any).setCrdtHead("Notes/a.md", "same"); // converged
		(engine as any).setCrdtHead("Notes/b.md", "old"); // diverged

		engine.setCrdtCatchup(
			async () => ({ heads: { "id-a": "same", "id-b": "new" } }),
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
		};
		const engine = makeEngineWithCrdt(crdt);

		engine.setCrdtCatchup(
			async () => ({ heads: { "id-a": "new", "id-b": "new" } }),
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
});
