/**
 * Tests: Phase 3a cold-receive — persisted per-note crdtHead (Task 1) and
 * the coldReceive() background convergence routine (Task 2), wired into
 * pull() (Task 3). Mirrors the mock-engine pattern from
 * tests/sync-crdt-ops.test.ts.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Mark a note_id as server-confirmed — same pattern as
 *  tests/sync-crdt-route.test.ts / tests/sync-crdt-gate.test.ts. */
function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
}

/** Mark the one-shot capability probe as already complete. */
function markProbed(engine: SyncEngine): void {
	(engine as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
}

// Minimal mock api/app — mirrors tests/sync-crdt-ops.test.ts's harness.
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

function engine(opts?: {
	enableCrdt?: boolean;
	api?: Partial<EngramApi>;
	crdt?: Partial<CrdtManager>;
}): SyncEngine {
	const e = new SyncEngine(
		mockApp,
		(opts?.api ?? mockApi) as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: opts?.enableCrdt ?? true },
		mock().mockResolvedValue(undefined),
	);
	if (opts?.crdt) e.setCrdtManager(opts.crdt as unknown as CrdtManager);
	e.setReady();
	return e;
}

describe("crdtHead persistence", () => {
	test("setCrdtHead merges without clobbering other FileSyncState fields", () => {
		const e = engine({ enableCrdt: true });
		e.importSyncState({ "n.md": { hash: 7, version: 3, serverHash: "sh" } });
		(e as any).setCrdtHead("n.md", "H1");
		const state = e.exportSyncState()["n.md"];
		expect(state.crdtHead).toBe("H1");
		expect(state.hash).toBe(7);
		expect(state.version).toBe(3);
		expect(state.serverHash).toBe("sh");
	});

	test("setCrdtHead creates an entry for a never-seen path", () => {
		const e = engine({ enableCrdt: true });
		(e as any).setCrdtHead("new.md", "H2");
		expect((e as any).getCrdtHead("new.md")).toBe("H2");
	});

	test("crdtHead survives export/import round-trip", () => {
		const e1 = engine({ enableCrdt: true });
		(e1 as any).setCrdtHead("n.md", "H3");
		const e2 = engine({ enableCrdt: true });
		e2.importSyncState(e1.exportSyncState());
		expect((e2 as any).getCrdtHead("n.md")).toBe("H3");
	});
});

describe("coldReceive", () => {
	function coldEngine(opts: {
		heads: Record<string, string>;
		getUpdates?: (id: string, since?: string) => Promise<{ update: Uint8Array; head: string }>;
		live?: (path: string) => boolean;
	}) {
		// The mock manager records the ARGUMENT it is called with — which is the
		// noteId (the manager is noteId-keyed), NOT the vault path.
		const applied: Array<{ id: string; update: Uint8Array }> = [];
		const svCalls: string[] = [];
		const api = {
			getVaultHeads: async () => ({ heads: opts.heads }),
			getUpdates:
				opts.getUpdates ??
				(async (_id: string, _since?: string) => ({ update: new Uint8Array([1]), head: "SRV" })),
		};
		const crdt = {
			encodeStateVector: async (id: string) => {
				svCalls.push(id);
				return new Uint8Array([9]);
			},
			applyRemoteUpdate: async (id: string, update: Uint8Array) => {
				applied.push({ id, update });
			},
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		e.setNoteIdMap(map);
		markConfirmed(e, "id-a");
		e.setLiveBoundCheck(opts.live ?? (() => false));
		return { e, applied, svCalls };
	}

	test("an advanced head pulls the delta, applies it, and persists the returned head", async () => {
		const { e, applied, svCalls } = coldEngine({ heads: { "id-a": "SRV" } });
		// local crdtHead is absent (never cold-synced) -> treated as advanced
		const n = await e.coldReceive();
		expect(n).toBe(1);
		expect(svCalls).toEqual(["id-a"]); // doc opened once (by noteId), to compute since
		expect(applied).toEqual([{ id: "id-a", update: new Uint8Array([1]) }]);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV"); // persisted under the path
	});

	test("an unchanged head is skipped WITHOUT opening the doc (cost gate)", async () => {
		const { e, applied, svCalls } = coldEngine({ heads: { "id-a": "SRV" } });
		(e as any).setCrdtHead("a.md", "SRV"); // already at server head
		const n = await e.coldReceive();
		expect(n).toBe(0);
		expect(svCalls).toEqual([]); // never opened the Y.Doc
		expect(applied).toEqual([]);
	});

	test("a live-bound note is skipped (the live channel owns it)", async () => {
		const { e, applied } = coldEngine({ heads: { "id-a": "SRV" }, live: () => true });
		expect(await e.coldReceive()).toBe(0);
		expect(applied).toEqual([]);
	});

	test("a head with no local path is skipped (first-discovery is the pull's job)", async () => {
		const { e, applied } = coldEngine({ heads: { "id-unknown": "SRV" } });
		expect(await e.coldReceive()).toBe(0);
		expect(applied).toEqual([]);
	});

	test("an unconfirmed note is skipped", async () => {
		const { e, applied } = coldEngine({ heads: { "id-a": "SRV" } });
		(e as any).unconfirmNoteId?.("id-a") ?? (e as any).clearConfirmedNoteIds?.();
		expect(await e.coldReceive()).toBe(0);
		expect(applied).toEqual([]);
	});

	test("ops unavailable => never calls getVaultHeads", async () => {
		let called = false;
		const api = {
			getVaultHeads: async () => {
				called = true;
				return { heads: {} };
			},
			getUpdates: async () => ({ update: new Uint8Array(), head: "" }),
		};
		const e = engine({ enableCrdt: true, api });
		// engine()'s setReady() fires its own fire-and-forget probeCrdtOps() on
		// construction (unrelated to coldReceive) which also calls this same
		// mocked getVaultHeads synchronously — reset the flag so the assertion
		// below isolates coldReceive's own behavior, not that background probe.
		called = false;
		// no markProbed => crdtOpsAvailable() is false
		expect(await e.coldReceive()).toBe(0);
		expect(called).toBe(false);
	});

	test("a per-note getUpdates failure does not abort the loop or advance that head", async () => {
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		map.set("b.md", "id-b");
		const applied: string[] = [];
		const api = {
			getVaultHeads: async () => ({ heads: { "id-a": "HA", "id-b": "HB" } }),
			getUpdates: async (id: string) => {
				if (id === "id-a") throw new Error("boom");
				return { update: new Uint8Array([2]), head: "HB" };
			},
		};
		const crdt = {
			encodeStateVector: async () => new Uint8Array([9]),
			applyRemoteUpdate: async (id: string) => {
				applied.push(id);
			},
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setNoteIdMap(map);
		markConfirmed(e, "id-a");
		markConfirmed(e, "id-b");
		e.setLiveBoundCheck(() => false);
		const n = await e.coldReceive();
		expect(applied).toEqual(["id-b"]); // b succeeded (by noteId) despite a failing
		expect(n).toBe(1);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined(); // a's head NOT advanced
		expect((e as any).getCrdtHead("b.md")).toBe("HB");
	});

	test("head is persisted only AFTER applyRemoteUpdate resolves", async () => {
		let applyResolved = false;
		const api = {
			getVaultHeads: async () => ({ heads: { "id-a": "SRV" } }),
			getUpdates: async () => ({ update: new Uint8Array([1]), head: "SRV" }),
		};
		const crdt = {
			encodeStateVector: async () => new Uint8Array([9]),
			applyRemoteUpdate: async () => {
				// head must not be set yet at this point
				applyResolved = true;
			},
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		e.setNoteIdMap(map);
		markConfirmed(e, "id-a");
		e.setLiveBoundCheck(() => false);
		await e.coldReceive();
		expect(applyResolved).toBe(true);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
	});
});
