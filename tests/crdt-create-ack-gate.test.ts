/**
 * Task 1 (crdt-rename-as-move): gate a note's live `crdt_msg` send on its
 * create-ack. A brand-new note's live editor edits currently stream a
 * crdt_msg to the server BEFORE its crdt_create has created the DB row, so
 * the server drops it (note_not_found). The `canSendLive` gate lets the caller
 * hold a local update in the Y.Doc (safe — never lost) until the note is
 * confirmed created; the default (`undefined` → always send) keeps every
 * pre-existing test unaffected.
 *
 * Ported to the Relay-model ProviderRegistry: the old `onUpdate` outbound seam
 * is the provider's `send` now, which only fires while connected — so every
 * test marks the registry connected. On create-ack the held state is delivered
 * by `flushHeldState` (a syncStep1 re-advertise + buffered frame flush), which
 * the caller opens the gate for by confirming first.
 *
 * The gate itself lives in ONE place — the `send` closure built by
 * `createCrdtWiring` — and these tests stand in for it via `gatedSend` below.
 * ProviderRegistry used to carry a duplicate `canSendLive` opt that only tests
 * ever set; it was deleted (#1130 follow-up) because the suite exercised the
 * duplicate while the shipped gate went uncovered.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { type FrameKind, NoteProvider } from "../src/crdt/note-provider";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { CRDT_HEAD_CREATED, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type Send = (noteId: string, frame: string, kind: FrameKind) => boolean;

/** Wrap a transport in the create-before-edit gate, mirroring the PRODUCTION
 *  closure in `wiring.ts` (`kind === "op" && !canSendLive(docId)` -> refuse).
 *
 *  ProviderRegistry deliberately has no `canSendLive` opt of its own: one gate,
 *  no drift. These tests used to configure that duplicate, which meant the whole
 *  gate suite could stay green while the SHIPPED gate regressed — exactly the
 *  #1130 hole. The shipped closure is pinned directly by
 *  `tests/crdt/wiring.test.ts`; this helper keeps these provider-level tests
 *  honest about the shape they are standing in for. */
function gatedSend(canSendLive: (noteId: string) => boolean, send: Send): Send {
	return (noteId, frame, kind) =>
		kind === "op" && !canSendLive(noteId) ? false : send(noteId, frame, kind);
}

/** Minimal SyncEngine for flush tests — app/api are untouched by
 *  flushHeldEditsOnCreateAck, so bare stubs are enough. */
function makeEngine(): SyncEngine {
	return new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	);
}

describe("create-ack gate on live send", () => {
	test("a local edit for an UN-acked note does NOT send", async () => {
		const send = mock(() => true);
		const acked = new Set<string>(); // nothing acked yet
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-unacked",
			send: gatedSend((id: string) => acked.has(id), send),
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		await mgr.applyLocalEdit("note-1", "hello");
		expect(send).not.toHaveBeenCalled(); // edit held in the Y.Doc, not streamed
		await mgr.destroyAll();
	});

	test("a local edit for an ACKed note DOES send", async () => {
		const send = mock(() => true);
		const acked = new Set<string>(["note-1"]);
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-acked",
			send: gatedSend((id: string) => acked.has(id), send),
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		await mgr.applyLocalEdit("note-1", "hello");
		expect(send).toHaveBeenCalled();
		await mgr.destroyAll();
	});

	test("an UNWRAPPED transport always sends — the registry adds no gate", async () => {
		const send = mock(() => true);
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-default",
			send,
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		await mgr.applyLocalEdit("note-1", "hello");
		expect(send).toHaveBeenCalled();
		await mgr.destroyAll();
	});

	// #1130 (e2e test_48): the gate is CREATE-BEFORE-EDIT — it holds outbound
	// OPS for a note whose server row may not exist yet. syncStep1 is a bare
	// state vector carrying no content, and it is the ONLY way a diverged note
	// whose Yjs fan-out this device missed can ever converge. Gating it made
	// `socketConverge`'s re-handshake a silent no-op for exactly those notes:
	// a REST-created note discovered via note_changed sets no crdtHead, so
	// hasServerNote stays false forever and the heal never reaches the wire.
	// The server answers an unknown doc_id with note_not_found, so an
	// un-acked handshake is harmless.
	test("enroll's syncStep1 is NOT held by the create-ack gate", async () => {
		const send = mock(() => true);
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-step1-pull",
			// no crdtHead recorded for this note -> the gate holds every op
			send: gatedSend(() => false, send),
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		await mgr.startSync("note-1");
		expect(send).toHaveBeenCalled();
		await mgr.destroyAll();
	});

	// The whole #1130 shape end-to-end through the real sync protocol: this
	// device holds no crdtHead for the note (its Yjs fan-out landed while the
	// socket was down), the op-log row says the server's copy diverged, and the
	// only recovery is socketConverge's reset+enroll. With the pull gated the
	// server never hears the handshake and disk stays stale forever.
	test("a headless note heals from the server over the enroll handshake", async () => {
		const server = new Y.Doc();
		server.getText(CONTENT_KEY).insert(0, "# V2\nUpdated while disconnected");
		const peer = new NoteProvider(server);
		const flushed: string[] = [];
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-step1-heal",
			// no crdtHead — the note is "unknown" to the gate
			send: gatedSend(
				() => false,
				(_id, frame) => {
					queueMicrotask(() => peer.receive(frame));
					return true;
				},
			),
			onFlushToDisk: async (_id, content) => {
				flushed.push(content);
			},
		});
		peer.setSend((frame) => {
			void mgr.receive("note-1", frame);
			return true;
		});
		peer.connect(); // the stand-in server's transport is up (it never advertises)
		mgr.setConnected(true);

		await mgr.startSync("note-1"); // socketConverge's enroll
		await new Promise<void>((r) => setTimeout(r, 20));

		expect(await mgr.projectedText("note-1")).toContain("Updated while disconnected");
		expect(flushed.at(-1)).toContain("Updated while disconnected");
		await mgr.destroyAll();
		peer.destroy();
	});

	// The reply half. When the PEER advertises, its syncStep1 reaches us and
	// readSyncMessage writes a syncStep2 back. That reply must NOT be gated:
	// the server only sends a syncStep1 for a doc_id it already resolved through
	// `note_in_vault?`, so the row provably exists. Gating it also never drains
	// the provider buffer, which pins isFullySynced false and makes closeDoc a
	// permanent no-op — the doc can never be evicted for the rest of the session.
	test("the syncStep2 REPLY is not held, and the buffer drains", async () => {
		const local = new Y.Doc();
		const peerDoc = new Y.Doc();
		const peer = new NoteProvider(peerDoc);
		const registrySend = mock((_id: string, frame: string) => {
			queueMicrotask(() => peer.receive(frame));
			return true;
		});
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-step2-reply",
			send: gatedSend(() => false, registrySend), // ops held for the whole test
			onFlushToDisk: async () => {},
		});
		peer.setSend((frame) => {
			void mgr.receive("note-1", frame);
			return true;
		});
		// Seed OUR doc so the reply carries real ops, then hand it to the registry.
		local.getText(CONTENT_KEY).insert(0, "local state the peer lacks");
		await mgr.applyRemoteUpdate("note-1", Y.encodeStateAsUpdate(local));
		mgr.setConnected(true);
		peer.setAdvertised(true);
		peer.connect(); // fires the peer's syncStep1 at us

		await new Promise<void>((r) => setTimeout(r, 20));

		// Our reply landed: the peer converged on content it never had.
		expect(peerDoc.getText(CONTENT_KEY).toJSON()).toContain("local state the peer lacks");
		// ...and a local EDIT is still held, so the gate is intact.
		const before = registrySend.mock.calls.length;
		await mgr.applyLocalEdit("note-1", "a brand new local edit");
		expect(registrySend.mock.calls.length).toBe(before);

		await mgr.destroyAll();
		peer.destroy();
		local.destroy();
	});

	test("a held note still pulls on reconnect while its ops stay held", async () => {
		const frames: string[] = [];
		const send = mock((_id: string, frame: string) => {
			frames.push(frame);
			return true;
		});
		const mgr = new ProviderRegistry({
			dbPrefix: "gate-step1-reconnect",
			send: gatedSend(() => false, send),
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		await mgr.startSync("note-1");
		const afterEnroll = frames.length;
		await mgr.applyLocalEdit("note-1", "local edit"); // op — still held
		expect(frames.length).toBe(afterEnroll);
		mgr.setConnected(false);
		mgr.setConnected(true); // reconnect re-advertises
		expect(frames.length).toBeGreaterThan(afterEnroll);
		await mgr.destroyAll();
	});
});

describe("SyncEngine.flushHeldEditsOnCreateAck", () => {
	test("on create-ack, the note's held state reaches the wire", async () => {
		const sentMsgs: string[] = [];
		const send = mock((docId: string) => {
			sentMsgs.push(docId);
			return true;
		});
		const engine = makeEngine();
		const confirmed = new Set<string>();
		const mgr = new ProviderRegistry({
			dbPrefix: "flush-ack",
			send: gatedSend((id: string) => confirmed.has(id), send),
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		engine.setCrdtManager(mgr);

		await mgr.applyLocalEdit("note-1", "typed before ack");
		expect(sentMsgs).toHaveLength(0); // gated (Task 1)

		confirmed.add("note-1"); // create just acked — the caller opens the gate
		await engine.flushHeldEditsOnCreateAck("note-1", "n.md");
		expect(sentMsgs).toContain("note-1"); // held state delivered on the wire

		await mgr.destroyAll();
	});

	test("a note with no held edits flushes nothing and opens NO room (create-ack is a SEND, not an enroll)", async () => {
		const sentMsgs: string[] = [];
		const send = mock((docId: string) => {
			sentMsgs.push(docId);
			return true;
		});
		const engine = makeEngine();
		const mgr = new ProviderRegistry({
			dbPrefix: "flush-ack-empty",
			send,
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		engine.setCrdtManager(mgr);

		await expect(engine.flushHeldEditsOnCreateAck("note-2", "n2.md")).resolves.toBeUndefined();
		// Nothing was held, so nothing goes out — and crucially NO syncStep1: a
		// freshly-created note stays room-free (fan-out invariant) until the editor
		// binds it. A create-ack that enrolled would leak a permanent room.
		expect(sentMsgs).toHaveLength(0);
		expect(mgr.enrolled.has("note-2")).toBe(false);

		await mgr.destroyAll();
	});

	test("never throws into the caller when no CrdtManager is wired", async () => {
		const engine = makeEngine();
		await expect(engine.flushHeldEditsOnCreateAck("note-3", "n3.md")).resolves.toBeUndefined();
	});

	// Defect 2 hardening: a thrown flush must not strand the note. It triggers
	// the existing reset+enroll re-handshake pairing (the same one every other
	// re-handshake site in sync.ts uses) as a self-heal backstop, instead of
	// only warn-logging and giving up.
	test("on flush failure, re-enrollment (reset+enroll) fires as a self-heal backstop", async () => {
		const engine = makeEngine();
		const failingCrdt = {
			flushHeldState: mock().mockRejectedValue(new Error("boom")),
		};
		engine.setCrdtManager(failingCrdt as any);
		const reset = mock();
		const enroll = mock();
		engine.setCrdtEnrollment({ reset, enroll });

		await expect(engine.flushHeldEditsOnCreateAck("note-4", "n4.md")).resolves.toBeUndefined(); // still never throws into the caller

		expect(reset).toHaveBeenCalledWith("note-4");
		expect(enroll).toHaveBeenCalledWith("note-4");
	});
});

// ---------------------------------------------------------------------------
// Defect 1 (post-crdt-rename-as-move review): canSendLive was wired to
// isNoteConfirmed, but confirmedNoteIds is CLEARED on every WS reconnect
// (clearConfirmedNoteIds) while re-enrollment (reEnrollOpenCrdtNotes) does NOT
// re-confirm — so an EXISTING, already-server-known note edited after a
// reconnect stayed held forever (mid-session sync stall). The fix wires
// canSendLive to hasServerNote instead: it reads crdtHead, which is set once
// by the create-ack and SURVIVES reconnect (clearConfirmedNoteIds never
// touches syncState).
// ---------------------------------------------------------------------------

describe("Defect 1: gate must survive reconnect for server-known notes", () => {
	test("a server-known but session-unconfirmed note's edit reaches the wire (post-reconnect regression)", async () => {
		const send = mock(() => true);
		const engine = makeEngine();
		engine.setNoteIdMap(new NoteIdMap());
		(engine as unknown as { noteIdMap: NoteIdMap }).noteIdMap.set(
			"existing.md",
			"note-existing",
		);
		// The server already has this note (crdtHead persists in syncState,
		// which a reconnect does NOT clear)...
		(engine as unknown as { setCrdtHead(path: string, head: string): void }).setCrdtHead(
			"existing.md",
			CRDT_HEAD_CREATED,
		);
		// ...but a WS reconnect just cleared confirmedNoteIds, and re-enrollment
		// does not re-confirm — so isNoteConfirmed is false even though the
		// server row exists.
		engine.clearConfirmedNoteIds();
		expect(engine.isNoteConfirmed("note-existing")).toBe(false);
		expect(engine.hasServerNote("note-existing")).toBe(true);

		const mgr = new ProviderRegistry({
			dbPrefix: "gate-reconnect",
			send: gatedSend((id: string) => engine.hasServerNote(id), send),
			onFlushToDisk: async () => {},
			// main.ts createCrdtWiring's canSendLive — mirrors the production wiring.
		});
		mgr.setConnected(true);
		engine.setCrdtManager(mgr);

		await mgr.applyLocalEdit("note-existing", "edited after reconnect");
		expect(send).toHaveBeenCalled(); // must NOT stall: server already has this note

		await mgr.destroyAll();
	});
});

// ---------------------------------------------------------------------------
// Task 3: ordering-invariant regression test. Drives the REAL pushFile ->
// crdtCreate -> ack-flush path (the genesis branch in sync.ts) and asserts the
// send ORDER a peer actually observes: crdt_create strictly before any
// crdt_msg for that note_id. `send`/`crdtCreate` are the exact transport seams
// the registry is wired to in production (main.ts createCrdtWiring).
// ---------------------------------------------------------------------------

describe("Task 3: create-before-edit wire ordering (regression)", () => {
	test("a brand-new note's crdt_create is sent before any crdt_msg for it (no note_not_found window)", async () => {
		const wire: Array<{ kind: "create" | "msg"; id: string }> = [];

		const noteIdMap = new NoteIdMap();
		noteIdMap.set("n.md", "note-1");

		const mockApp = {
			vault: { cachedRead: mock().mockResolvedValue("disk body") },
		} as any;
		const mockApi = { pushNote: mock() } as any;
		const engine = new SyncEngine(
			mockApp,
			mockApi,
			DEFAULT_SETTINGS,
			mock().mockResolvedValue(undefined),
		);
		engine.setNoteIdMap(noteIdMap);

		const mgr = new ProviderRegistry({
			dbPrefix: "order-genesis",
			// The gate is what enforces the ordering under test: an op for a
			// not-yet-confirmed note must not reach the wire ahead of its create.
			send: gatedSend(
				(id: string) => engine.isNoteConfirmed(id),
				(docId: string) => {
					wire.push({ kind: "msg", id: docId });
					return true;
				},
			),
			onFlushToDisk: async () => {},
		});
		mgr.setConnected(true);
		engine.setCrdtManager(mgr);
		engine.setCrdtCreate(async (id: string, _path: string) => {
			wire.push({ kind: "create", id });
			return { docId: id, seeded: false }; // server adopts the client-minted id (no ADOPT remap)
		});

		// Fast typing: a local edit lands in the Y.Doc BEFORE the note's
		// crdt_create has even been requested, let alone acked. The canSendLive
		// gate holds it (note-1 not confirmed) — no msg before create.
		await mgr.applyLocalEdit("note-1", "fast typing");

		const file = new TFile("n.md");
		const result = await (
			engine as unknown as { pushFile: (f: TFile) => Promise<boolean> }
		).pushFile(file);
		expect(result).toBe(true);

		// A further edit once the note is confirmed — a genuinely post-ack send.
		await mgr.applyLocalEdit("note-1", "typed after ack");

		const kinds = wire.filter((w) => w.id === "note-1").map((w) => w.kind);
		expect(kinds[0]).toBe("create"); // create FIRST
		expect(kinds.length).toBeGreaterThan(1); // at least one edit send observed
		expect(kinds.slice(1).every((k) => k === "msg")).toBe(true); // then only edits

		await mgr.destroyAll();
	});
});
