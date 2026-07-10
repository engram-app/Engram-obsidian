/**
 * Tests: crdtOpsAvailable capability latch on SyncEngine (mirrors
 * batchPushUnsupported). Latches OFF on a 404/405 from an /updates call;
 * stays on for other statuses; requires settings.enableCrdt.
 */
import { describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
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

// Minimal mock api/app — mirrors tests/sync-crdt-route.test.ts's harness.
// Only the fields SyncEngine's constructor/setup touches are needed here
// since these tests never drive a real sync cycle.
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

describe("crdtOpsAvailable latch", () => {
	test("is available when enableCrdt and not latched", () => {
		const e = engine();
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	test("latches off on a 404/405 from an updates call", () => {
		const e = engine();
		(e as any).markCrdtOpsUnsupported(404);
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});

	test("stays available on other statuses", () => {
		const e = engine();
		(e as any).markCrdtOpsUnsupported(500);
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	test("405 also latches off", () => {
		const e = engine();
		(e as any).markCrdtOpsUnsupported(405);
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});

	test("unavailable when enableCrdt is false, even unlatched", () => {
		const e = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: false },
			mock().mockResolvedValue(undefined),
		);
		e.setReady();
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});
});

describe("probeCrdtOps — one-shot capability probe", () => {
	test("a getVaultHeads 404 pre-latches ops-unsupported", async () => {
		const api = {
			getVaultHeads: async () => {
				const err: any = new Error("nf");
				err.status = 404;
				throw err;
			},
		};
		const e = engine({ enableCrdt: true, api });
		await (e as any).probeCrdtOps();
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});

	test("a getVaultHeads success leaves ops available", async () => {
		const api = { getVaultHeads: async () => ({ heads: {} }) };
		const e = engine({ enableCrdt: true, api });
		await (e as any).probeCrdtOps();
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	test("no-op when enableCrdt is false", async () => {
		let called = false;
		const api = {
			getVaultHeads: async () => {
				called = true;
				return { heads: {} };
			},
		};
		const e = engine({ enableCrdt: false, api });
		await (e as any).probeCrdtOps();
		expect(called).toBe(false);
	});
});

describe("channel-down CRDT flush via REST /updates", () => {
	test("flushCrdtState posts the encoded Y.Doc state and never sends plaintext", async () => {
		const posted: Array<{ noteId: string; update: Uint8Array }> = [];
		const api = {
			postUpdate: async (noteId: string, update: Uint8Array) => {
				posted.push({ noteId, update });
				return { head: "h" };
			},
			pushNote: async () => {
				throw new Error("must not whole-doc push a CRDT note");
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([9, 9, 9]) };
		const e = engine({ enableCrdt: true, api, crdt });
		await (e as any).flushCrdtState("p.md", "id-1");
		expect(posted).toEqual([{ noteId: "id-1", update: new Uint8Array([9, 9, 9]) }]);
	});

	test("flushCrdtState latches ops-unsupported on a 404", async () => {
		const api = {
			postUpdate: async () => {
				const err: any = new Error("not found");
				err.status = 404;
				throw err;
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
		const e = engine({ enableCrdt: true, api, crdt });
		await (e as any).flushCrdtState("p.md", "id-1");
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Task 5: CRDT-managed notes bypass the whole-doc base_hash push. Live channel
// → the edit already went out as a channel op (unchanged pre-Task-5 behavior).
// Channel down + ops available → scheduleCrdtFlush, no base_hash body built.
// Non-CRDT / ops-unavailable notes keep sending base_hash unchanged.
// ---------------------------------------------------------------------------

describe("CRDT notes bypass the whole-doc base_hash push", () => {
	test("a CRDT-managed note with ops available never calls pushNote (channel down → scheduled flush)", async () => {
		let pushNoteCalled = false;
		let flushedNoteId: string | null = null;
		const api = {
			pushNote: async () => {
				pushNoteCalled = true;
				return { note: {}, chunks_indexed: 1 };
			},
			postUpdate: async (noteId: string) => {
				flushedNoteId = noteId;
				return { head: "h" };
			},
		};
		const crdt = {
			encodeStateAsUpdate: async () => new Uint8Array([1]),
			applyLocalEdit: async () => true,
		};
		const e = engine({ enableCrdt: true, api, crdt });
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down — would have whole-doc pushed before

		const result = await (e as any).pushFile(new TFile("p.md"));

		expect(result).toBe(true);
		expect(pushNoteCalled).toBe(false); // routed to CRDT flush, not whole-doc push

		// The flush is debounced (debounceMs: 1) — let the timer fire and confirm
		// it actually posts the encoded Y.Doc state via REST /updates.
		await new Promise((r) => setTimeout(r, 20));
		expect(flushedNoteId).toBe("id-1");
	});

	test("a CRDT-wired note with ops UNAVAILABLE and channel DOWN still sends base_hash via pushNote (safety fallback, no behavior change on a pre-Phase-1 backend)", async () => {
		let baseHashArg: string | undefined;
		let pushNoteCalled = false;
		const api = {
			pushNote: async (...args: any[]) => {
				pushNoteCalled = true;
				baseHashArg = args[5];
				return { note: {}, chunks_indexed: 1 };
			},
			postUpdate: async () => {
				throw new Error("must not flush via REST /updates when ops are unavailable");
			},
		} as unknown as EngramApi;
		const crdt = {
			encodeStateAsUpdate: async () => new Uint8Array([1]),
			applyLocalEdit: async () => true,
		};
		const e = engine({ enableCrdt: true, api, crdt });
		(e as any).markCrdtOpsUnsupported(404); // pre-Phase-1 backend: ops unavailable
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down too
		e.importSyncState({ "p.md": { hash: 1, version: 1, serverHash: "sh" } });

		await (e as any).pushFile(new TFile("p.md"));

		expect(pushNoteCalled).toBe(true);
		expect(baseHashArg).toBeDefined();
	});

	test("a NON-CRDT note still sends base_hash (unchanged)", async () => {
		let sawBaseHash = false;
		const api = {
			pushNote: async (...args: any[]) => {
				if (args[5] !== undefined) sawBaseHash = true;
				return { note: {}, chunks_indexed: 1 };
			},
		};
		const e = engine({ enableCrdt: false, api }); // enableCrdt false → legacy path
		e.importSyncState({ "p.md": { hash: 1, version: 1, serverHash: "sh" } });

		await (e as any).pushFile(new TFile("p.md"));

		expect(sawBaseHash).toBe(true);
	});
});
