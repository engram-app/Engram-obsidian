/**
 * Tests: crdtOpsAvailable capability latch on SyncEngine (mirrors
 * batchPushUnsupported). Latches OFF on a 404/405 from an /updates call;
 * stays on for other statuses; requires settings.enableCrdt.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CrdtManager } from "../src/crdt/manager";
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

	// Probe-race stranding (final review Minor-1): a CRDT note edited while the
	// channel is down schedules a flush WITHOUT a legacy push (pushFile routed
	// it to scheduleCrdtFlush because ops looked available at edit time). If
	// the capability probe latches crdtOpsUnsupported before the debounced
	// flush timer fires, flushCrdtState must NOT just early-return — that
	// silently strands the edit (durable in the local Y.Doc, never delivered
	// this session). It must re-drive delivery via the legacy whole-doc push.
	test("ops latch off mid-flush (probe fires before the timer) delivers via legacy push, not silently dropped", async () => {
		let pushNoteCalled = false;
		const testFile = new TFile("p.md");
		const localApp = {
			...mockApp,
			vault: {
				...mockApp.vault,
				getFileByPath: mock().mockImplementation((p: string) =>
					p === "p.md" ? testFile : null,
				),
			},
		};
		const api = {
			pushNote: async () => {
				pushNoteCalled = true;
				return { note: {}, chunks_indexed: 1 };
			},
			postUpdate: async () => {
				throw new Error("must not call postUpdate once ops are latched unsupported");
			},
		};
		const crdt = {
			encodeStateAsUpdate: async () => new Uint8Array([1]),
			applyLocalEdit: async () => true,
		};
		const e = new SyncEngine(
			localApp as any,
			api as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager(crdt as unknown as CrdtManager);
		e.setReady();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down — schedules a flush, no immediate push

		const result = await (e as any).pushFile(testFile);
		expect(result).toBe(true);
		expect(pushNoteCalled).toBe(false); // scheduled, not pushed yet

		// Capability probe latches ops-unsupported BEFORE the debounced flush fires.
		(e as any).markCrdtOpsUnsupported(404);

		await new Promise((r) => setTimeout(r, 20));

		expect(pushNoteCalled).toBe(true); // delivered via legacy path, not dropped
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

// ---------------------------------------------------------------------------
// Task 2: runFlushQueue delivers a durable `crdt`-tagged queue entry via
// noteId-keyed /updates ops. The original bug encoded the Y.Doc by PATH while
// docs are keyed by NOTEID, posting an empty doc — hidden previously because
// delivery tests mocked encodeStateAsUpdate. The round-trip test below uses a
// REAL CrdtManager end to end: no mocked encode.
// ---------------------------------------------------------------------------

describe("runFlushQueue: durable crdt queue entry delivery via /updates", () => {
	test("durable crdt queue entry delivers the SEEDED note content via postUpdate (noteId-keyed, real CrdtManager)", async () => {
		const posted: { noteId: string; update: Uint8Array }[] = [];
		const api = {
			postUpdate: async (noteId: string, update: Uint8Array) => {
				posted.push({ noteId, update });
				return { head: "h" };
			},
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const realCrdt = new CrdtManager({
			dbPrefix: "flush-roundtrip",
			onUpdate: () => {},
			onFlushToDisk: async () => {},
		});
		const e = engine({ enableCrdt: true, api, crdt: realCrdt });

		// Seed the note's Y.Doc BY NOTEID (never by path) — this is exactly what
		// a path/noteId key mismatch would fail to reproduce.
		await realCrdt.applyLocalEdit("id-1", "# T\n\nseeded body");

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		const flushed = await e.flushQueue();

		expect(flushed).toBe(1);
		expect(e.queue.size).toBe(0);
		expect(posted.length).toBe(1);
		expect(posted[0].noteId).toBe("id-1");

		// Apply the delivered update to a FRESH doc: it must reproduce the
		// seeded body. A path/noteId key bug or an unseeded doc fails this.
		const reader = new Y.Doc();
		Y.applyUpdate(reader, posted[0].update);
		expect(reader.getText("content").toString()).toContain("seeded body");

		await realCrdt.destroy();
	});

	test("a per-note 404 from postUpdate drops the entry as note-gone, without latching capability off", async () => {
		let postUpdateCalled = false;
		const api = {
			postUpdate: async () => {
				postUpdateCalled = true;
				const err: any = new Error("not found");
				err.status = 404;
				throw err;
			},
			// The file is present on disk, so a bug that skipped the crdt branch
			// and fell through to the legacy path would call pushNote instead of
			// hitting the "file missing" shortcut — fail loudly if that happens.
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
		const testFile = new TFile("T.md");
		const localApp = {
			...mockApp,
			vault: {
				...mockApp.vault,
				getFileByPath: mock().mockImplementation((p: string) =>
					p === "T.md" ? testFile : null,
				),
			},
		};
		const e = new SyncEngine(
			localApp as any,
			api as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager(crdt as unknown as CrdtManager);
		e.setReady();

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		const flushed = await e.flushQueue();

		expect(postUpdateCalled).toBe(true);
		expect(flushed).toBe(1);
		expect(e.queue.size).toBe(0);
		// A per-note 404 is NOT a capability signal — only probeCrdtOps latches.
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	test("crdt entry with ops unavailable clears the stale serverHash then falls through to the legacy push", async () => {
		let pushNoteArgs: any[] = [];
		const testFile = new TFile("T.md");
		const localApp = {
			...mockApp,
			vault: {
				...mockApp.vault,
				getFileByPath: mock().mockImplementation((p: string) =>
					p === "T.md" ? testFile : null,
				),
				cachedRead: mock().mockResolvedValue("legacy content"),
			},
		};
		const api = {
			pushNote: async (...args: any[]) => {
				pushNoteArgs = args;
				return { note: {}, chunks_indexed: 1 };
			},
			postUpdate: async () => {
				throw new Error("must not call postUpdate when ops are unavailable");
			},
		};
		const e = new SyncEngine(
			localApp as any,
			api as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setReady();
		(e as any).markCrdtOpsUnsupported(404); // ops unavailable (old backend)
		e.importSyncState({ "T.md": { hash: 1, version: 1, serverHash: "stale-hash" } });

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
		});
		const flushed = await e.flushQueue();

		expect(flushed).toBe(1);
		// The stale serverHash was cleared before the legacy push — a no-base
		// push overwrites deliberately instead of 409ing against the CAS base
		// that CRDT-ops delivery already advanced past.
		expect(pushNoteArgs[5]).toBeUndefined();
		expect(pushNoteArgs[1]).toBe("legacy content");
	});
});
