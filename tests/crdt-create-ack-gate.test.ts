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
