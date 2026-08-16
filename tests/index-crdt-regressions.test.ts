/**
 * Regressions for the four criticals two adversarial reviews found in #431.
 *
 * Each of these was verified with a throwaway probe when it was fixed. That is
 * how the first one shipped: the behaviour was proven once, by hand, and
 * nothing was left behind to prove it again. These are the tests that would
 * have caught them.
 */
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { IndexRoom } from "../src/crdt/index-room";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncStore } from "../src/crdt/sync-store";

describe("the room must PULL, not only push", () => {
	// It never advertised, so connect() sent nothing and `synced` could never
	// become true. A device knew only its own data.json and minted fresh ids for
	// notes the server already owned — duplicates, which the server's projection
	// then repathed the row to match.
	test("connect() advertises syncStep1", () => {
		const frames: string[] = [];
		const room = new IndexRoom({
			send: (f) => {
				frames.push(f);
				return true;
			},
		});

		room.connect();

		expect(frames.length).toBe(1);
	});

	// The trap in the obvious fix: setConnected(true) consumes the false->true
	// edge the handshake fires on, so advertising inside connect() would have
	// reintroduced the bug for any caller that flipped connected first.
	test("advertising survives a caller that sets connected first", () => {
		const frames: string[] = [];
		const room = new IndexRoom({
			send: (f) => {
				frames.push(f);
				return true;
			},
		});

		room.setConnected(true);

		expect(frames.length).toBeGreaterThan(0);
	});
});

describe("a vault switch must not touch the shared doc", () => {
	// clear() deleted every key in the SHARED map with no origin, so the provider
	// broadcast it — to whichever room the socket was still joined to. On a
	// switch that is the OLD vault's index, emptied.
	test("clear() publishes nothing", () => {
		const doc = new Y.Doc();
		const store = new SyncStore(doc.getMap("filemeta_v0"));
		store.set("a.md", { note_id: "id-a" });
		store.commit();

		let updates = 0;
		doc.on("update", () => updates++);
		store.clear();

		expect(updates).toBe(0);
	});

	// One Y.Doc across vaults strands every later claim: its clock is ahead of
	// the new room, so Yjs parks the update awaiting deps from the other vault.
	// The map must follow a REPLACED room, in place — holders captured it.
	test("rebind points the map at a fresh store", () => {
		const first = new SyncStore(new Y.Doc().getMap("filemeta_v0"));
		const map = new NoteIdMap(first);
		map.set("a.md", "id-a");
		map.flushNow();

		const second = new SyncStore(new Y.Doc().getMap("filemeta_v0"));
		map.rebind(second);

		expect(map.get("a.md")).toBeNull();
		map.set("b.md", "id-b");
		map.flushNow();
		expect(map.get("b.md")).toBe("id-b");
	});
});

describe("data.json is evidence, not a claim", () => {
	// Seeding through set() staged and PUBLISHED. A Y.Map is last-write-wins by
	// causality with no notion of cache versus claim, so a stale entry could
	// evict a fresh one and publish the eviction.
	test("a stale seed cannot evict a fresher claim", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);

		shared.set("new/a.md", { note_id: "id1" }); // a peer moved it
		store.seed("old/a.md", { note_id: "id1" }); // our stale cache

		expect(store.get("new/a.md")).toBe("id1");
		expect(store.pathForId("id1")).toBe("new/a.md");
	});

	// Precedence at the SAME path, which the test above does not exercise: it
	// seeds a different key. If the cache were consulted first, a stale
	// data.json entry would shadow the id the vault actually agreed on.
	test("the shared doc outranks the cache for the same path", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);

		store.seed("a.md", { note_id: "stale" });
		shared.set("a.md", { note_id: "agreed" });

		expect(store.get("a.md")).toBe("agreed");
		expect(store.pathForId("agreed")).toBe("a.md");
	});

	test("seeding publishes nothing", () => {
		const doc = new Y.Doc();
		const map = new NoteIdMap(new SyncStore(doc.getMap("filemeta_v0")));
		let updates = 0;
		doc.on("update", () => updates++);

		map.seed({ "a.md": "id-a", "b.md": "id-b" });

		expect(updates).toBe(0);
		expect(map.get("a.md")).toBe("id-a");
	});

	test("a seeded id round-trips through toJSON", () => {
		const map = new NoteIdMap();
		map.seed({ "a.md": "id-a" });

		expect(map.toJSON()).toEqual({ "a.md": "id-a" });
	});
});

describe("a rename of an unknown path", () => {
	// It published a bare DELETE of the old path and claimed nothing at the new
	// one — silently unclaiming a note that exists on other devices.
	test("publishes no deletion", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap("filemeta_v0");
		const store = new SyncStore(shared);
		let updates = 0;
		doc.on("update", () => updates++);

		store.rename("Inbox/x.md", "Archive/x.md");
		store.commit();

		expect(updates).toBe(0);
		expect(shared.has("Inbox/x.md")).toBe(false);
	});

	// ...while still converging, which is what stops a folder cascade minting a
	// duplicate for a descendant this device never opened.
	test("still converges both names on one id", () => {
		const store = new SyncStore(new Y.Doc().getMap("filemeta_v0"));
		store.rename("Inbox/x.md", "Archive/x.md");

		expect(store.getOrMint("Inbox/x.md")).toBe(store.getOrMint("Archive/x.md"));
	});
});

describe("inbound frames from the socket", () => {
	// It threw out of the socket's message handler, escaping to window.onerror —
	// which never reaches rlog(), so it was invisible in Loki. The note path
	// already guarantees the opposite.
	test.each(["!!!not-base64!!!", btoa("\x00\x63garbage")])(
		"a malformed frame is reported, not thrown: %p",
		(frame) => {
			const room = new IndexRoom({ send: () => true });
			expect(room.receive(frame)).toBe(false);
		},
	);

	test("a well-formed frame is accepted", () => {
		let captured = "";
		const a = new IndexRoom({
			send: (f) => {
				captured = f;
				return true;
			},
		});
		a.connect();

		const b = new IndexRoom({ send: () => true });
		expect(b.receive(captured)).toBe(true);
	});
});
