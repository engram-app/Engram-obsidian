/**
 * Task 1 (crdt-rename-as-move): gate a note's live `crdt_msg` send on its
 * create-ack. A brand-new note's live editor edits currently stream a
 * crdt_msg to the server BEFORE its crdt_create has created the DB row, so
 * the server drops it (note_not_found). CrdtManagerOptions.canSendLive lets
 * the caller hold a local update in the Y.Doc (safe — never lost) until the
 * note is confirmed created; the default (`undefined` → always send) keeps
 * every pre-existing test unaffected.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Minimal SyncEngine for flush tests — app/api are untouched by
 *  flushHeldEditsOnCreateAck, so bare stubs are enough (mirrors the lean
 *  construction other sync.ts test files use, e.g. sync-crdt-route.test.ts). */
function makeEngine(): SyncEngine {
	return new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS, enableCrdt: false },
		mock().mockResolvedValue(undefined),
	);
}

describe("create-ack gate on live send", () => {
	test("a local edit for an UN-acked note does NOT call onUpdate", async () => {
		const onUpdate = mock(() => {});
		const acked = new Set<string>(); // nothing acked yet
		const mgr = new CrdtManager({
			dbPrefix: "gate-unacked",
			onUpdate,
			onFlushToDisk: async () => {},
			canSendLive: (id: string) => acked.has(id),
		});
		await mgr.applyLocalEdit("note-1", "hello");
		expect(onUpdate).not.toHaveBeenCalled(); // edit held in the Y.Doc, not streamed
		await mgr.destroy();
	});

	test("a local edit for an ACKed note DOES call onUpdate", async () => {
		const onUpdate = mock(() => {});
		const acked = new Set<string>(["note-1"]);
		const mgr = new CrdtManager({
			dbPrefix: "gate-acked",
			onUpdate,
			onFlushToDisk: async () => {},
			canSendLive: (id: string) => acked.has(id),
		});
		await mgr.applyLocalEdit("note-1", "hello");
		expect(onUpdate).toHaveBeenCalled();
		await mgr.destroy();
	});

	test("omitting canSendLive keeps the pre-existing always-send behavior", async () => {
		const onUpdate = mock(() => {});
		const mgr = new CrdtManager({
			dbPrefix: "gate-default",
			onUpdate,
			onFlushToDisk: async () => {},
		});
		await mgr.applyLocalEdit("note-1", "hello");
		expect(onUpdate).toHaveBeenCalled();
		await mgr.destroy();
	});
});

describe("SyncEngine.flushHeldEditsOnCreateAck", () => {
	test("on create-ack, the note's held state is flushed once via crdt_msg", async () => {
		const sentMsgs: string[] = [];
		const onUpdate = mock((docId: string) => sentMsgs.push(docId));
		const engine = makeEngine();
		const mgr = new CrdtManager({
			dbPrefix: "flush-ack",
			onUpdate,
			onFlushToDisk: async () => {},
			canSendLive: (id: string) => engine.isNoteConfirmed(id),
		});
		engine.setCrdtManager(mgr);

		await mgr.applyLocalEdit("note-1", "typed before ack");
		expect(sentMsgs).toHaveLength(0); // gated (Task 1)

		await engine.flushHeldEditsOnCreateAck("note-1", "n.md"); // create just acked
		expect(sentMsgs).toEqual(["note-1"]); // exactly one flush of current state

		await mgr.destroy();
	});

	test("a note with no held edits still flushes without error", async () => {
		const sentMsgs: string[] = [];
		const onUpdate = mock((docId: string) => sentMsgs.push(docId));
		const engine = makeEngine();
		const mgr = new CrdtManager({
			dbPrefix: "flush-ack-empty",
			onUpdate,
			onFlushToDisk: async () => {},
		});
		engine.setCrdtManager(mgr);

		await expect(engine.flushHeldEditsOnCreateAck("note-2", "n2.md")).resolves.toBeUndefined();
		expect(sentMsgs).toEqual(["note-2"]);

		await mgr.destroy();
	});

	test("never throws into the caller when no CrdtManager is wired", async () => {
		const engine = makeEngine();
		await expect(engine.flushHeldEditsOnCreateAck("note-3", "n3.md")).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Task 3: ordering-invariant regression test. Tasks 1+2 above are unit-level
// (CrdtManager / flushHeldEditsOnCreateAck in isolation) — this drives the
// REAL pushFile -> crdtCreate -> ack-flush path (the genesis branch in
// sync.ts, mirrors "Task 3: new-note genesis" in sync-crdt-route.test.ts) and
// asserts the send ORDER a peer actually observes: crdt_create strictly
// before any crdt_msg for that note_id. `onUpdate`/`crdtCreate` are the exact
// transport seams CrdtChannel is wired to in production (main.ts
// createCrdtWiring), so this is the nearest honest wire boundary without a
// real socket.
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

		const mgr = new CrdtManager({
			dbPrefix: "order-genesis",
			onUpdate: (docId: string) => wire.push({ kind: "msg", id: docId }),
			onFlushToDisk: async () => {},
			canSendLive: (id: string) => engine.isNoteConfirmed(id),
		});
		engine.setCrdtManager(mgr);
		engine.setCrdtCreate(async (id: string, _path: string) => {
			wire.push({ kind: "create", id });
			return id; // server adopts the client-minted id (no ADOPT remap)
		});

		// Fast typing: a local edit lands in the Y.Doc BEFORE the note's
		// crdt_create has even been requested, let alone acked. Without Task 1's
		// canSendLive gate, this would call onUpdate synchronously right here —
		// before pushFile (and its crdtCreate call) has run at all.
		await mgr.applyLocalEdit("note-1", "fast typing");

		const file = new TFile("n.md");
		const result = await (
			engine as unknown as { pushFile: (f: TFile) => Promise<boolean> }
		).pushFile(file);
		expect(result).toBe(true);

		// A further edit once the note is confirmed — a genuinely post-ack send,
		// so "then only msg sends" isn't trivially satisfied by the single
		// create-ack flush alone.
		await mgr.applyLocalEdit("note-1", "typed after ack");

		const kinds = wire.filter((w) => w.id === "note-1").map((w) => w.kind);
		expect(kinds[0]).toBe("create"); // create FIRST
		expect(kinds.length).toBeGreaterThan(1); // at least one edit send observed
		expect(kinds.slice(1).every((k) => k === "msg")).toBe(true); // then only edits

		await mgr.destroy();
	});
});
