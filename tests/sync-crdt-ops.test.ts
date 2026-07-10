/**
 * Tests: crdtOpsAvailable capability latch on SyncEngine (mirrors
 * batchPushUnsupported). Latches OFF on a 404/405 from an /updates call;
 * stays on for other statuses; requires settings.enableCrdt.
 */
import { describe, expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

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
