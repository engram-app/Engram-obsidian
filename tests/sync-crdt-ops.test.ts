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

/** Mark the one-shot capability probe as already complete, for tests that
 *  exercise post-probe latch behavior directly without driving a real
 *  getVaultHeads round-trip (Phase 2b: crdtOpsAvailable() now requires
 *  crdtOpsProbed, not just an unlatched crdtOpsUnsupported). */
function markProbed(engine: SyncEngine): void {
	(engine as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
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
	test("is available when enableCrdt, probed, and not latched", () => {
		const e = engine();
		markProbed(e);
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	test("latches off on a 404/405 from an updates call", () => {
		const e = engine();
		markProbed(e);
		(e as any).markCrdtOpsUnsupported(404);
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});

	test("stays available on other statuses", () => {
		const e = engine();
		markProbed(e);
		(e as any).markCrdtOpsUnsupported(500);
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	test("405 also latches off", () => {
		const e = engine();
		markProbed(e);
		(e as any).markCrdtOpsUnsupported(405);
		expect((e as any).crdtOpsAvailable()).toBe(false);
	});

	test("unavailable when enableCrdt is false, even unlatched and probed", () => {
		const e = new SyncEngine(
			mockApp,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: false },
			mock().mockResolvedValue(undefined),
		);
		e.setReady();
		markProbed(e);
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

	// Phase 2b remediation: capability comes SOLELY from the probe. Ops must
	// read unavailable while the probe is in flight, not just after a failure.
	test("ops are unavailable until the probe completes, then available on success", async () => {
		let resolveHeads: (v: unknown) => void = () => {};
		const api = {
			getVaultHeads: () =>
				new Promise((r) => {
					resolveHeads = r;
				}),
		};
		const e = engine({ enableCrdt: true, api });
		expect((e as any).crdtOpsAvailable()).toBe(false); // not probed yet
		const p = e.probeCrdtOps();
		resolveHeads({ heads: {} });
		await p;
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});
});

// Probe-race close (final review carryover): a channel-down edit on a CRDT
// note made BEFORE the one-shot capability probe has resolved must not be
// treated as ops-available (crdtOpsProbed still false at that point). It has
// to take the durable legacy whole-doc push, exactly like a confirmed
// pre-Phase-1 backend, so it is never queued as a `crdt:true` entry the
// engine has no confirmed way to deliver.
describe("probe race: an edit before the probe resolves is never stranded", () => {
	test("a channel-down edit made while the probe is still pending takes the legacy base_hash path, not the durable ops queue", async () => {
		let pushNoteCalled = false;
		let baseHashArg: string | undefined;
		const api = {
			// Never resolves within the test — models a probe that is still in
			// flight when the edit happens.
			getVaultHeads: () => new Promise(() => {}),
			pushNote: async (...args: any[]) => {
				pushNoteCalled = true;
				baseHashArg = args[5];
				return { note: {}, chunks_indexed: 1 };
			},
			postUpdate: async () => {
				throw new Error("must not flush via REST /updates before the probe resolves");
			},
		} as unknown as EngramApi;
		const crdt = {
			encodeStateAsUpdate: async () => new Uint8Array([1]),
			applyLocalEdit: async () => true,
		};
		const e = engine({ enableCrdt: true, api, crdt });
		expect((e as any).crdtOpsAvailable()).toBe(false); // probe still pending
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down too
		e.importSyncState({ "p.md": { hash: 1, version: 1, serverHash: "sh" } });

		await (e as any).pushFile(new TFile("p.md"));

		expect(pushNoteCalled).toBe(true);
		expect(baseHashArg).toBeDefined();
		const queued = e.queue.all().find((q) => q.path === "p.md");
		expect(queued).toBeUndefined(); // never durably queued as an ops entry
	});
});

// The in-memory `scheduleCrdtFlush`/`flushCrdtState`/`crdtFlushTimers` debounce
// was retired (Task 3, Phase 2b remediation) in favor of routing every
// channel-down CRDT edit through the DURABLE offline queue: pushFile seeds the
// Y.Doc via routeModify then persists a content-free `crdt: true` + `noteId`
// queue entry (survives plugin unload) that runFlushQueue delivers via
// noteId-keyed /updates ops (Task 2). The tests below exercise that full
// pushFile -> durable queue -> runFlushQueue chain in place of the old
// in-memory-timer tests.
describe("channel-down CRDT edit routes through the durable queue via REST /updates", () => {
	test("pushFile durably queues the edit, then the auto-triggered flush posts the encoded Y.Doc state and never sends plaintext", async () => {
		const posted: Array<{ noteId: string; update: Uint8Array }> = [];
		const api = {
			postUpdate: async (noteId: string, update: Uint8Array) => {
				posted.push({ noteId, update });
				return { head: "h" };
			},
			pushNote: async () => {
				throw new Error("must not whole-doc push a channel-down CRDT note");
			},
		};
		const crdt = {
			applyLocalEdit: async () => true,
			encodeStateAsUpdate: async () => new Uint8Array([9, 9, 9]),
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setLiveBoundCheck(() => true); // open note: pushFile routes CRDT ops
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down

		const result = await (e as any).pushFile(new TFile("p.md"));
		expect(result).toBe(true);

		// Persisted immediately as a durable crdt-tagged entry (survives unload
		// even before delivery) — never merely an in-memory timer.
		const queued = e.queue.all().find((q) => q.path === "p.md");
		expect(queued?.crdt).toBe(true);
		expect(queued?.noteId).toBe("id-1");

		// pushFile also fires an immediate flush attempt; give it a tick.
		await new Promise((r) => setTimeout(r, 20));
		expect(posted).toEqual([{ noteId: "id-1", update: new Uint8Array([9, 9, 9]) }]);
		expect(e.queue.size).toBe(0);
	});

	test("a per-note 404 on the auto-triggered flush drops the entry as note-gone, without latching capability off", async () => {
		const api = {
			postUpdate: async () => {
				const err: any = new Error("not found");
				err.status = 404;
				throw err;
			},
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = {
			applyLocalEdit: async () => true,
			encodeStateAsUpdate: async () => new Uint8Array([1]),
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setLiveBoundCheck(() => true); // open note: pushFile routes CRDT ops
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down

		await (e as any).pushFile(new TFile("p.md"));
		await new Promise((r) => setTimeout(r, 20));

		// Global Constraint: a per-note postUpdate 404 means "that note is gone",
		// NEVER a capability signal — only the getVaultHeads probe may latch
		// crdtOpsUnsupported.
		expect(e.queue.size).toBe(0);
		expect((e as any).crdtOpsAvailable()).toBe(true);
	});

	// Probe-race stranding (final review Minor-1, carried over from the retired
	// scheduleCrdtFlush test): a CRDT note edited while the channel is down is
	// durably queued while ops still look available. If the capability probe
	// latches crdtOpsUnsupported AFTER the entry is queued but BEFORE it is
	// delivered, the next flush must NOT strand it — it must re-drive delivery
	// via the legacy whole-doc push (runFlushQueue's ops-unavailable fallback).
	test("ops latch off after a channel-down edit is durably queued: the next flush delivers via legacy push, not silently stranded", async () => {
		let pushNoteCalled = false;
		let pushNoteArgs: any[] = [];
		const testFile = new TFile("p.md");
		const localApp = {
			...mockApp,
			vault: {
				...mockApp.vault,
				getFileByPath: mock().mockImplementation((p: string) =>
					p === "p.md" ? testFile : null,
				),
				cachedRead: mock().mockResolvedValue("body"),
			},
		};
		const api = {
			pushNote: async (...args: any[]) => {
				pushNoteCalled = true;
				pushNoteArgs = args;
				return { note: {}, chunks_indexed: 1 };
			},
			// The auto-triggered first attempt fails transiently (no HTTP status)
			// — leaves the entry queued without touching capability at all.
			postUpdate: async () => {
				throw new Error("network down");
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
		markProbed(e);
		e.setLiveBoundCheck(() => true); // open note: pushFile routes CRDT ops
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down

		const result = await (e as any).pushFile(testFile);
		expect(result).toBe(true);
		await new Promise((r) => setTimeout(r, 20)); // let the auto-triggered flush fail transiently

		expect(pushNoteCalled).toBe(false); // still queued, not stranded to legacy yet
		expect(e.queue.size).toBe(1);

		// Capability probe latches ops-unsupported (e.g. a pre-Phase-1 backend
		// discovered mid-session) AFTER the edit was already durably queued.
		(e as any).markCrdtOpsUnsupported(404);

		const flushed = await e.flushQueue();

		expect(flushed).toBe(1);
		expect(pushNoteCalled).toBe(true); // delivered via legacy path, not dropped
		expect(pushNoteArgs[1]).toBe("body");
		expect(e.queue.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Task 5 (folded into Task 3, same pushFile branch): a stale PRE-AWAIT
// `crdtLive` snapshot must not decide live-vs-durable-queue. The channel can
// drop DURING the awaited `routeModify` seed; pushFile must re-check liveness
// AFTER the seed (`crdtLiveNow`) to decide whether the edit is already carried
// live or must be durably queued.
// ---------------------------------------------------------------------------

describe("Task 5: crdtLive is re-checked AFTER the awaited seed (TOCTOU)", () => {
	test("a channel drop DURING routeModify routes the edit to the durable queue, not the dead live path", async () => {
		let live = true;
		const api = {
			postUpdate: async () => ({ head: "h" }),
			pushNote: async () => {
				throw new Error("must not whole-doc push a CRDT note");
			},
		};
		const crdt = {
			// The channel drops WHILE the seed is in flight — simulates a
			// disconnect that lands between the pre-await crdtLive snapshot and
			// the post-await decision.
			applyLocalEdit: async () => {
				live = false;
				return true;
			},
			encodeStateAsUpdate: async () => new Uint8Array([1]),
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setLiveBoundCheck(() => true); // open note: pushFile routes CRDT ops
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("T.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => live); // live=true at branch entry

		const result = await (e as any).pushFile(new TFile("T.md"));

		expect(result).toBe(true);
		// Because crdtLive is re-checked AFTER the await, the edit is enqueued
		// durably instead of being (wrongly) treated as already delivered by a
		// live channel that no longer exists.
		const queued = e.queue.all().find((q) => q.path === "T.md");
		expect(queued?.crdt).toBe(true);
		expect(queued?.noteId).toBe("id-1");
	});
});

// ---------------------------------------------------------------------------
// Task 5: CRDT-managed notes bypass the whole-doc base_hash push. Live channel
// → the edit already went out as a channel op (unchanged pre-Task-5 behavior).
// Channel down + ops available → durably queued (Task 3), no base_hash body built.
// Non-CRDT / ops-unavailable notes keep sending base_hash unchanged.
// ---------------------------------------------------------------------------

describe("CRDT notes bypass the whole-doc base_hash push", () => {
	test("a CRDT-managed note with ops available never calls pushNote (channel down → durably queued)", async () => {
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
		markProbed(e);
		e.setLiveBoundCheck(() => true); // open note: pushFile routes CRDT ops
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down — would have whole-doc pushed before

		const result = await (e as any).pushFile(new TFile("p.md"));

		expect(result).toBe(true);
		expect(pushNoteCalled).toBe(false); // routed to the durable crdt queue, not whole-doc push

		// The durable entry is delivered by the auto-triggered flush — give it a
		// tick and confirm it actually posts the encoded Y.Doc state via REST
		// /updates.
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
		markProbed(e);

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
		markProbed(e);

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

	test("a TERMINAL postUpdate error (413 too-large) records a Sync Center issue and dequeues, instead of retrying forever", async () => {
		const api = {
			postUpdate: async () => {
				const err: any = new Error("too large");
				err.status = 413;
				throw err;
			},
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		await e.flushQueue();

		// Dequeued — must not silently retry forever on every future flush.
		expect(e.queue.size).toBe(0);
		// Recorded as a Sync Center issue instead of vanishing silently.
		const issue = e.issues.all().find((i) => i.path === "T.md");
		expect(issue).toBeDefined();
		expect(issue?.category).toBe("too_large");
	});

	test("a TRANSIENT postUpdate error (network) leaves the entry queued for retry", async () => {
		const api = {
			postUpdate: async () => {
				throw new Error("network down"); // no .status → categorized as network/transient
			},
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		await e.flushQueue();

		// Still queued — transient failures must retry, not vanish.
		expect(e.queue.size).toBe(1);
		expect(e.issues.all().find((i) => i.path === "T.md")).toBeUndefined();
	});

	test("a persistently transient postUpdate error is parked after RETRY_CAP attempts, not retried forever", async () => {
		const api = {
			postUpdate: async () => {
				throw new Error("network down"); // transient, no .status
			},
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});

		// RETRY_CAP is 5: the first 4 passes re-queue the entry (silent) with a
		// persisted, bumped attempt count; the 5th exhausts the cap and parks it.
		for (let i = 0; i < 4; i++) {
			await (e as any).runFlushQueue();
			expect(e.queue.size).toBe(1); // still queued for retry
			expect(e.issues.all()).toHaveLength(0); // silent while retrying
			expect(e.queue.all()[0].attempts).toBe(i + 1); // count persisted on the entry
		}
		await (e as any).runFlushQueue();
		expect(e.queue.size).toBe(0); // parked: no longer retried
		expect(e.issues.all().find((i) => i.path === "T.md")).toBeDefined();
	});

	test("a TERMINAL postUpdate error (413) re-enrolls the note so the CRDT channel can still converge, then parks", async () => {
		const api = {
			postUpdate: async () => {
				const err: any = new Error("too large");
				err.status = 413;
				throw err;
			},
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
		const enroll = mock();
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setCrdtEnrollment({ enroll, reset: mock() } as any);
		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		await e.flushQueue();

		// The Y.Doc (keyed by noteId) still holds the edit, so re-enrolling
		// re-drives delivery over the CRDT channel: a too-large /updates is not a
		// silent loss.
		expect(enroll).toHaveBeenCalledWith("id-1");
		expect(e.queue.size).toBe(0); // parked (dequeued)
		const issue = e.issues.all().find((i) => i.path === "T.md");
		expect(issue?.category).toBe("too_large");
	});

	test("a crdt entry whose file was renamed away (ops unavailable, legacy fallback) re-enrolls for channel convergence instead of silently dropping", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a vanished file");
			},
			postUpdate: async () => {
				throw new Error("ops unavailable, must not postUpdate");
			},
		};
		const localApp = {
			...mockApp,
			vault: { ...mockApp.vault, getFileByPath: mock().mockReturnValue(null) },
		};
		const enroll = mock();
		const e = new SyncEngine(
			localApp as any,
			api as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setReady();
		(e as any).markCrdtOpsUnsupported(404); // ops unavailable: legacy fallback path
		e.setCrdtEnrollment({ enroll, reset: mock() } as any);
		// Content-free crdt entry; its file is no longer on disk (renamed away).
		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
		});
		const flushed = await e.flushQueue();

		expect(enroll).toHaveBeenCalledWith("id-1"); // Y.Doc retained: channel delivers
		expect(e.queue.size).toBe(0); // dequeued (not looping)
		expect(flushed).toBe(1);
	});
});
