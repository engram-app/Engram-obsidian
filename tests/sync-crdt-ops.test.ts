/**
 * Tests: socket-native CRDT op delivery on SyncEngine — create-ack body
 * seeding, the channel-down durable queue chain, and TOCTOU liveness.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
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

// Minimal mock api/app — mirrors tests/sync-crdt-route.test.ts's harness.
// Only the fields SyncEngine's constructor/setup touches are needed here
// since these tests never drive a real sync cycle.
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

function engine(opts?: { api?: Partial<EngramApi>; crdt?: Partial<CrdtManager> }): SyncEngine {
	const e = new SyncEngine(
		mockApp,
		(opts?.api ?? mockApi) as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
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
			{ ...DEFAULT_SETTINGS, debounceMs: 1 },
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

	// H4 (adversarial review, #1409): a REPLAYED create (buildGenesisFrame +
	// crdt_create over the durable queue) must apply its genesis body locally
	// the same seeded-gated way pushFile's inline create does — otherwise
	// EVERY queued create seeds over crdt_msg (opening a room), which is the
	// exact case #1409 was written to eliminate: any create that fails its
	// first attempt (rate limit, offline, pre-join) always goes through here.
	// Real ProviderRegistry (not the fake `crdt` stub above), asserting on
	// the transport's own `send` callback: `applyRemoteUpdate`'s provider
	// origin does NOT trigger a wire send (no room), whereas the OLD
	// unconditional routeModify -> applyLocalEdit path (default/local
	// origin) DOES — content equality alone can't tell the two mechanisms
	// apart when there's nothing to double against yet, so this has to
	// observe the actual wire behaviour, not just the resulting text.
	test("H4: seeded:true applies the genesis update locally instead of reseeding over crdt_msg (no room)", async () => {
		const content = "queued genesis body\n";
		const wireSends: string[] = [];
		const registry = new ProviderRegistry({
			dbPrefix: `sync-crdt-ops-h4-${Math.random().toString(36).slice(2)}`,
			send: (noteId) => {
				wireSends.push(noteId);
				return true;
			},
			onFlushToDisk: async () => true,
		});
		registry.setConnected(true);
		const testFile = new TFile("id-1.md");
		const localApp = {
			...mockApp,
			vault: {
				...mockApp.vault,
				getAbstractFileByPath: mock().mockReturnValue(testFile),
				cachedRead: mock().mockResolvedValue(content),
			},
		};
		const e = new SyncEngine(
			localApp as any,
			mockApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1 },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager(registry);
		e.setReady();
		const noteIdMap = new NoteIdMap();
		noteIdMap.set("id-1.md", "id-1");
		e.setNoteIdMap(noteIdMap);

		// What buildGenesisFrame would have produced, sent, and gotten confirmed
		// (seeded:true — the server's row already/now holds `content`).
		const update = registry.encodeGenesisUpdate(content);
		await (e as any).applyCrdtCreateAck("id-1", "id-1", "id-1.md", true, { update, content });

		expect(await registry.projectedText("id-1")).toBe(content);
		expect((e as any).hasServerNote("id-1")).toBe(true);
		// The fix: no crdt_msg went out — the body reached the server over
		// crdt_create's b64, not a room-opening wire send.
		expect(wireSends).toEqual([]);
	});

	test("H4: seeded:false (server declined — e.g. the note gained content) falls back to the disk-seed path", async () => {
		const { e, applyLocalEdit } = seedHarness({
			localId: "id-1",
			content: "disk content after the frame was built",
		});
		await (e as any).applyCrdtCreateAck("id-1", "id-1", "id-1.md", false, {
			update: new Uint8Array([9, 9, 9]),
			content: "stale frame content",
		});

		// Falls through to the existing disk-seed path (routeModify), reading
		// current disk — never trusts the stale genesis frame content.
		expect(applyLocalEdit).toHaveBeenCalledTimes(1);
		expect(applyLocalEdit.mock.calls[0]?.[1]).toBe("disk content after the frame was built");
	});
});

// ---------------------------------------------------------------------------
// buildGenesisFrame must fail closed to `undefined` on ANY throw, not just a
// disk-read error. makeCrdtOpSend's own try/catch treats a thrown
// buildGenesisFrame as a failed crdt_create (retried, then dropped at max
// attempts) — that defeats the documented "falls back to a bodyless create"
// degradation, which only holds when buildGenesisFrame *returns* undefined.
// ---------------------------------------------------------------------------
describe("buildGenesisFrame fails closed (#1409 round 3, LOW)", () => {
	test("an unexpected throw from encodeGenesisUpdate resolves to undefined, never rejects", async () => {
		const testFile = new TFile("id-1.md");
		const e = engine({
			crdt: {
				encodeGenesisUpdate: () => {
					throw new Error("boom");
				},
			},
		});
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockReturnValue(testFile);
		(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("body");

		await expect(e.buildGenesisFrame("id-1.md")).resolves.toBeUndefined();
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
		const e = engine({ api, crdt });
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

	test("channel back up: the flush fires the re-handshake, and the entry settles only when an inbound frame proves the round-trip", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { applyLocalEdit: async () => true };
		const enroll = mock();
		const reset = mock();
		const e = engine({ api, crdt });
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
		// STEP1 carries the pending local ops.
		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
		// Firing is NOT proof: the entry survives until an inbound frame for
		// the note arrives (a nudge lost to a socket drop re-fires next flush).
		expect(flushed).toBe(0);
		expect(e.queue.size).toBe(1);

		// An inbound frame fires commitCrdtConvergence — the round-trip is
		// proven and the entry settles out of the durable queue.
		await e.commitCrdtConvergence("id-1");
		expect(e.queue.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// #1493: the drain above is correct and allocates a server room PER QUEUED
// NOTE, because every `crdt_msg` routes through the backend's `ensure_room`.
// A 1.4k-note flush put prod at 314 resident rooms against a cap of 64.
// `crdt_doc_update` delivers the same ops without leaving a room behind.
// ---------------------------------------------------------------------------
describe("room-free queue delivery (#1493)", () => {
	function queuedEngine(opts: {
		docUpdate?: (docId: string, b64: string) => Promise<{ head: string }>;
		liveBound?: (path: string) => boolean;
		encode?: (noteId: string) => Promise<Uint8Array>;
	}) {
		const crdt = {
			applyLocalEdit: async () => true,
			encodeStateAsUpdate: opts.encode ?? (async () => new Uint8Array([1, 2, 3])),
		};
		const enroll = mock();
		const reset = mock();
		const e = engine({
			api: {
				pushNote: async () => {
					throw new Error("must not legacy-push a crdt entry");
				},
			} as Partial<EngramApi>,
			crdt,
		});
		e.setCrdtEnrollment({ enroll, reset } as any);
		e.setCrdtLiveCheck(() => true);
		e.setCrdtPorts({
			...(opts.docUpdate ? { docUpdate: opts.docUpdate } : {}),
			...(opts.liveBound ? { liveBound: opts.liveBound } : {}),
		});
		return { e, enroll, reset };
	}

	async function enqueueOne(e: SyncEngine, path = "T.md") {
		await e.queue.enqueue({
			path,
			action: "upsert",
			noteId: "id-1",
			crdt: true,
			timestamp: 1,
			vaultId: "v",
		});
	}

	test("an IDLE note delivers over crdt_doc_update, dequeues on the ack, and fires NO handshake", async () => {
		const docUpdate = mock(async () => ({ head: "h1" }));
		const { e, enroll, reset } = queuedEngine({ docUpdate });
		await enqueueOne(e);

		const flushed = await e.flushQueue();

		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(docUpdate.mock.calls[0]?.[0]).toBe("id-1");
		// The ack IS the delivery proof — unlike the handshake path there is no
		// inbound frame to wait for, so the entry settles inline.
		expect(flushed).toBe(1);
		expect(e.queue.size).toBe(0);
		// THE assertion: no room was asked for.
		expect(reset).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("a LIVE-BOUND note keeps the handshake — its room already exists", async () => {
		const docUpdate = mock(async () => ({ head: "h1" }));
		const { e, enroll, reset } = queuedEngine({ docUpdate, liveBound: () => true });
		await enqueueOne(e);

		await e.flushQueue();

		// Nothing is saved by going room-free on a note that already holds a
		// room, and the handshake also pulls, so the live path stays as it was.
		expect(docUpdate).not.toHaveBeenCalled();
		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
	});

	test("a REFUSED write falls back to the re-handshake and leaves the entry queued", async () => {
		const docUpdate = mock(async () => {
			throw new Error("rate_limited");
		});
		const { e, enroll, reset } = queuedEngine({ docUpdate });
		await enqueueOne(e);

		const flushed = await e.flushQueue();

		// Convergence is the invariant; the room saving is the optimization.
		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
		expect(flushed).toBe(0);
		expect(e.queue.size).toBe(1);
	});

	test("an unwired port (backend too old) degrades straight to the handshake", async () => {
		const { e, enroll, reset } = queuedEngine({});
		await enqueueOne(e);

		await e.flushQueue();

		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
		expect(e.queue.size).toBe(1);
	});

	test("repeated TIMEOUTS latch the frame off, so an old backend is paid for twice, not once per note", async () => {
		// Without the latch a backend that predates the frame costs a full
		// request timeout on EVERY queued note — a slower drain than never
		// having the feature.
		const docUpdate = mock(async () => {
			throw new Error("sendRequest timeout: crdt_doc_update");
		});
		const { e } = queuedEngine({ docUpdate });

		for (const path of ["A.md", "B.md", "C.md", "D.md"]) {
			await enqueueOne(e, path);
			await e.flushQueue();
		}

		expect(docUpdate).toHaveBeenCalledTimes(2);
	});

	test("a rejected write must NOT dequeue — the edit is only durable while queued", async () => {
		// The failure that matters: dequeuing on anything short of an ack loses
		// the edit if the fallback handshake never round-trips.
		const docUpdate = mock(async () => {
			throw new Error("doc_update_failed");
		});
		const { e } = queuedEngine({ docUpdate });
		await enqueueOne(e);

		await e.flushQueue();

		expect(e.queue.all().find((q) => q.path === "T.md")?.noteId).toBe("id-1");
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
		const e = engine({ api, crdt });
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
		const e = engine({ api, crdt });
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
	test("live channel: fires reset+enroll, keeps the entry until proof, and the durable doc carries the ops (real CrdtManager)", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const realCrdt = new ProviderRegistry({
			dbPrefix: "flush-roundtrip",
			send: () => true,
			onFlushToDisk: async () => {},
		});
		const e = engine({ api, crdt: realCrdt });
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
		await e.flushQueue();

		expect(reset).toHaveBeenCalledWith("id-1");
		expect(enroll).toHaveBeenCalledWith("id-1");
		expect(e.queue.size).toBe(1); // not settled until an inbound frame proves it
		// The seeded content survives in the durable doc for the handshake to ship.
		expect(await realCrdt.getText("id-1")).toContain("seeded body");

		// Inbound frame → settle.
		await e.commitCrdtConvergence("id-1");
		expect(e.queue.size).toBe(0);

		await realCrdt.destroyAll();
	});

	test("channel down: the entry stays queued (no REST side-channel) and no re-handshake fires", async () => {
		const api = {
			pushNote: async () => {
				throw new Error("must not legacy-push a crdt entry when ops are available");
			},
		};
		const crdt = { applyLocalEdit: async () => true };
		const enroll = mock();
		const e = engine({ api, crdt });
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
});
