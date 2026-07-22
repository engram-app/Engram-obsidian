/**
 * Tests: crdtOpsAvailable capability latch on SyncEngine (mirrors
 * batchPushUnsupported). Latches OFF on a 404/405 from an /updates call;
 * stays on for other statuses; requires settings.enableCrdt.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Mark a note_id as server-confirmed — same pattern as
 *  tests/sync-crdt-route.test.ts / tests/sync-crdt-gate.test.ts. */
function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
	// CRDT-sole oracle: hasServerNote(noteId) = getCrdtHead(pathForId(noteId)) != null.
	// Record a server head under the note's path so a "server-known" note routes
	// through the CRDT path (the confirmed-set no longer gates CRDT routing).
	const e = engine as unknown as {
		noteIdMap?: { pathForId(id: string): string | null };
		setCrdtHead(path: string, head: string): void;
	};
	const p = e.noteIdMap?.pathForId(noteId);
	if (p) e.setCrdtHead(p, "server-head");
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

// ---------------------------------------------------------------------------
// applyCrdtCreateAck: a QUEUED crdt_create (offline-created note, held until the
// crdt: topic joined) must, on ack, seed the note BODY over CRDT, not merely
// flip the head. The live genesis path seeds inline after crdt_create; a queued
// create acked on (re)join has NO follow-up pushModifiedFiles (onCrdtTopicJoined
// is catch-up/pull-only), so a head-only flip leaves a 0-byte row on peers until
// the user edits again (the deaf-note / 0-byte-materialize class).
// ---------------------------------------------------------------------------
describe("applyCrdtCreateAck seeds the body on peers (not a 0-byte row)", () => {
	function seedHarness(opts: { localId: string; content: string }) {
		const applyLocalEdit = mock(async (_id: string, content: string) => content);
		const removeDoc = mock(async () => {});
		const crdt = { applyLocalEdit, removeDoc };
		const enroll = mock();
		const reset = mock();
		const testFile = new TFile(`${opts.localId}.md`);
		const localApp = {
			...mockApp,
			vault: {
				...mockApp.vault,
				getAbstractFileByPath: mock().mockReturnValue(testFile),
				cachedRead: mock().mockResolvedValue(opts.content),
			},
		};
		const e = new SyncEngine(
			localApp as any,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager(crdt as unknown as CrdtManager);
		e.setReady();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set(`${opts.localId}.md`, opts.localId);
		e.setNoteIdMap(noteIdMap);
		e.setCrdtEnrollment({ enroll, reset } as any);
		return { e, applyLocalEdit, removeDoc, reset, noteIdMap };
	}

	test("non-adopt: seeds the body under the local id AND marks it server-known", async () => {
		const { e, applyLocalEdit, removeDoc } = seedHarness({
			localId: "id-1",
			content: "# Note\n\nreal offline content",
		});
		await (e as any).applyCrdtCreateAck("id-1", "id-1", "id-1.md");

		// The body was pushed over CRDT (routeModify → applyLocalEdit), not dropped
		// as a 0-byte row: assert the CONTENT is sent, not just the head flipped.
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit.mock.calls[0]?.[0]).toBe("id-1");
		expect(applyLocalEdit.mock.calls[0]?.[1]).toBe("# Note\n\nreal offline content");
		// Head flipped → the server row is known.
		expect((e as any).hasServerNote("id-1")).toBe(true);
		// Non-adopt: no mint to retire.
		expect(removeDoc).not.toHaveBeenCalled();
	});

	test("adopt: remaps, seeds under the server id, and retires the orphaned mint doc + enrollment", async () => {
		const { e, applyLocalEdit, removeDoc, reset, noteIdMap } = seedHarness({
			localId: "id-1",
			content: "adopted body",
		});
		await (e as any).applyCrdtCreateAck("id-1", "srv-2", "id-1.md");

		// Remapped to the authoritative server id.
		expect(noteIdMap.get("id-1.md")).toBe("srv-2");
		// Body seeded under the SERVER id (not the stale mint).
		expect(applyLocalEdit.mock.calls[0]?.[0]).toBe("srv-2");
		expect(applyLocalEdit.mock.calls[0]?.[1]).toBe("adopted body");
		// Orphaned mint doc + its enrollment cleaned up (the queued path leaked both).
		expect(removeDoc).toHaveBeenCalledWith("id-1");
		expect(reset).toHaveBeenCalledWith("id-1");
		expect((e as any).hasServerNote("srv-2")).toBe(true);
	});
});

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

// The in-memory `scheduleCrdtFlush`/`flushCrdtState`/`crdtFlushTimers` debounce
// was retired (Task 3, Phase 2b remediation) in favor of routing every
// channel-down CRDT edit through the DURABLE offline queue: pushFile seeds the
// Y.Doc via routeModify then persists a content-free `crdt: true` + `noteId`
// queue entry (survives plugin unload) that runFlushQueue delivers via
// noteId-keyed /updates ops (Task 2). The tests below exercise that full
// pushFile -> durable queue -> runFlushQueue chain in place of the old
// in-memory-timer tests.
describe("channel-down CRDT edit routes through the durable queue, delivered over the socket (Phase E3)", () => {
	test("pushFile durably queues the edit; channel still down → entry STAYS queued (the socket is the only delivery path)", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not whole-doc push a channel-down CRDT note");
			},
		};
		const crdt = {
			applyLocalEdit: async () => true,
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
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

		// pushFile fires an immediate flush attempt — with the channel down the
		// entry must SURVIVE it (no REST side-channel exists to deliver it).
		await new Promise((r) => setTimeout(r, 20));
		expect(e.queue.size).toBe(1);
	});

	test("channel back up: the flush fires the re-handshake (reset+enroll) and dequeues — the durable Y.Doc carries the ops", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { applyLocalEdit: async () => true };
		const enroll = mock();
		const reset = mock();
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setCrdtEnrollment({ enroll, reset } as any);
		e.setCrdtLiveCheck(() => true); // channel live now

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		const flushed = await e.flushQueue();

		// The sv-exchange is bidirectional: the server answers the client STEP1
		// with [STEP2, server-STEP1], and the client's reply to the server's
		// STEP1 carries the pending local ops. One re-handshake = delivery.
		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
		expect(flushed).toBe(1);
		expect(e.queue.size).toBe(0);
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
		};
		const crdt = {
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
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down

		const result = await (e as any).pushFile(testFile);
		expect(result).toBe(true);
		await new Promise((r) => setTimeout(r, 20)); // auto-flush: channel down → stays queued

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
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
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
// Task 5: CRDT-managed notes never whole-doc push. A channel-down edit with ops
// available is durably queued (Task 3) and delivered over the socket once the
// channel returns — pushNote is never called. (The old base_hash/CAS whole-doc
// fallback for md is gone: an in-cap md note that reaches neither CRDT path
// stays on disk and re-pushes on reconnect, so there is no REST-md path left.)
// ---------------------------------------------------------------------------

describe("CRDT notes never whole-doc push (channel down → durable queue)", () => {
	test("a CRDT-managed note with ops available never calls pushNote (channel down → durably queued)", async () => {
		let pushNoteCalled = false;
		const api = {
			pushNote: async () => {
				pushNoteCalled = true;
				return { note: {}, chunks_indexed: 1 };
			},
		};
		const crdt = {
			applyLocalEdit: async () => true,
		};
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("p.md", "id-1");
		e.setNoteIdMap(noteIdMap);
		markConfirmed(e, "id-1");
		e.setCrdtLiveCheck(() => false); // channel down — would have whole-doc pushed before

		const result = await (e as any).pushFile(new TFile("p.md"));

		expect(result).toBe(true);
		expect(pushNoteCalled).toBe(false); // routed to the durable crdt queue, not whole-doc push

		// The entry waits for the channel — never delivered over REST.
		await new Promise((r) => setTimeout(r, 20));
		expect(e.queue.all().find((q) => q.path === "p.md")?.crdt).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// runFlushQueue delivers a durable `crdt`-tagged queue entry over the SOCKET
// (Phase E3 — REST /updates deleted): the Y.Doc (keyed by noteId, durable in
// IndexedDB) holds the ops; a fresh re-handshake ships them (the client's
// reply to the server's STEP1 carries the local diff).
// ---------------------------------------------------------------------------

describe("runFlushQueue: durable crdt queue entry delivery over the socket", () => {
	test("live channel: fires reset+enroll per entry and dequeues (real CrdtManager holds the ops durably)", async () => {
		const api = {
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
		const enroll = mock();
		const reset = mock();
		e.setCrdtEnrollment({ enroll, reset } as any);
		e.setCrdtLiveCheck(() => true);

		// Seed the note's Y.Doc BY NOTEID (never by path) — the doc, not the
		// queue entry, is the durable carrier of the edit.
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
		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
		// The seeded content survives in the durable doc for the handshake to ship.
		expect(await realCrdt.getText("id-1")).toContain("seeded body");

		await realCrdt.destroy();
	});

	test("channel down: the entry stays queued (no REST side-channel) and no re-handshake fires", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { applyLocalEdit: async () => true };
		const enroll = mock();
		const e = engine({ enableCrdt: true, api, crdt });
		markProbed(e);
		e.setCrdtEnrollment({ enroll, reset: mock() } as any);
		e.setCrdtLiveCheck(() => false);

		await e.queue.enqueue({
			path: "T.md",
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
		const flushed = await e.flushQueue();

		expect(flushed).toBe(0);
		expect(e.queue.size).toBe(1); // waits for the channel — not dropped, not parked
		expect(enroll).not.toHaveBeenCalled();
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

	test("a crdt entry whose file was renamed away (ops unavailable, legacy fallback) re-enrolls for channel convergence instead of silently dropping", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a vanished file");
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
