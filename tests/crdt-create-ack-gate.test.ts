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
import { CrdtManager } from "../src/crdt/manager";
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
