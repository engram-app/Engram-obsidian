/**
 * Lifecycle for the index room: destroy, and the vault-change replacement.
 *
 * These were the last two uncovered behaviours in #362, and one of them
 * (`resetIndexRoomForVault`) is the fix for a critical — a single `Y.Doc`
 * reused across vaults strands every later claim as a Yjs pending struct,
 * because its clock is already ahead of the room it is now talking to.
 *
 * Driven through `EngramSyncPlugin.prototype` with a minimal `this`, the same
 * shape the other main.ts wiring tests use.
 */
import { describe, expect, test } from "bun:test";
import { IndexRoom } from "../src/crdt/index-room";
import { NoteIdMap } from "../src/crdt/note-id-map";
import EngramSyncPlugin from "../src/main";

describe("IndexRoom.destroy", () => {
	test("a destroyed room stops publishing", () => {
		let frames = 0;
		const room = new IndexRoom({
			send: () => {
				frames++;
				return true;
			},
		});
		room.connect();
		const afterConnect = frames;

		room.destroy();
		room.store.set("a.md", { note_id: "id-a" });
		room.store.commit();

		expect(frames).toBe(afterConnect);
	});

	test("a destroyed room does not throw on an inbound frame", () => {
		const room = new IndexRoom({ send: () => true });
		room.destroy();

		// Reported, never thrown — this runs on the socket's message path.
		expect(() => room.receive("!!!garbage!!!")).not.toThrow();
	});
});

describe("resetIndexRoomForVault", () => {
	function fakePlugin() {
		const fake = Object.create(EngramSyncPlugin.prototype) as EngramSyncPlugin & {
			indexChannel: unknown;
		};
		fake.indexRoom = new IndexRoom({ send: () => true });
		fake.noteIdMap = new NoteIdMap(fake.indexRoom.store);
		fake.indexChannel = { sendIndexCrdt: () => true };
		return fake;
	}

	test("replaces the room with a fresh doc", () => {
		const fake = fakePlugin();
		const before = fake.indexRoom;
		const beforeClientId = before.doc.clientID;

		fake.resetIndexRoomForVault();

		expect(fake.indexRoom).not.toBe(before);
		// A fresh doc: a reused one keeps a clock the new room has never seen, so
		// every later claim parks as a pending struct and never applies.
		expect(fake.indexRoom.doc.clientID).not.toBe(beforeClientId);
	});

	test("the map follows the new room, and the old vault's ids are gone", () => {
		const fake = fakePlugin();
		fake.noteIdMap.set("vaultA.md", "id-a");
		fake.noteIdMap.flushNow();
		expect(fake.noteIdMap.get("vaultA.md")).toBe("id-a");

		fake.resetIndexRoomForVault();

		// Carrying ids across vaults routes CRDT frames at another vault's notes
		// (plugin #200) — the map must be looking at the NEW vault's store.
		expect(fake.noteIdMap.get("vaultA.md")).toBeNull();
		expect(fake.noteIdMap.store).toBe(fake.indexRoom.store);

		fake.noteIdMap.set("vaultB.md", "id-b");
		fake.noteIdMap.flushNow();
		expect(fake.noteIdMap.get("vaultB.md")).toBe("id-b");
	});

	test("drops the stale channel so nothing is sent to the old vault's topic", () => {
		const fake = fakePlugin();

		fake.resetIndexRoomForVault();

		// setupNoteStream re-points this at the new vault's channel. Until then a
		// retained one would deliver the new vault's claims to the OLD topic.
		expect(fake.indexChannel).toBeNull();
	});

	test("the discarded room publishes nothing on the way out", () => {
		const fake = fakePlugin();
		let framesFromOld = 0;
		fake.indexRoom = new IndexRoom({
			send: () => {
				framesFromOld++;
				return true;
			},
		});
		fake.noteIdMap.rebind(fake.indexRoom.store);
		fake.noteIdMap.set("a.md", "id-a");
		fake.noteIdMap.flushNow();
		const before = framesFromOld;

		fake.resetIndexRoomForVault();

		// The old code called store.clear(), which deleted every key in the SHARED
		// doc and broadcast it to whichever room the socket was still joined to.
		expect(framesFromOld).toBe(before);
	});
});
