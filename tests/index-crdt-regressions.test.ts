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

describe("round 2: the fixes had their own defects", () => {
	// The first fix worked only for the first connect of a session. Nothing
	// called setConnected(false), so on rejoin `wasConnected` was already true
	// and the syncStep1 edge never fired — write-only again, one drop later.
	test("re-handshakes after a drop and rejoin", () => {
		let frames = 0;
		const room = new IndexRoom({
			send: () => {
				frames++;
				return true;
			},
		});
		room.connect();
		const afterFirst = frames;

		room.setConnected(false); // what main.ts now does on disconnect
		room.connect();

		expect(frames).toBeGreaterThan(afterFirst);
	});

	// `evicted` was never cleared, so a peer re-claiming a displaced id at
	// another path stayed invisible to pathForId for the rest of the session —
	// inbound frames for that note had no disk path to resolve to.
	test("eviction does not outlive the commit that caused it", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);

		shared.set("A.md", { note_id: "Y" });
		store.set("A.md", { note_id: "X" }); // displaces Y
		store.commit();
		shared.set("B.md", { note_id: "Y" }); // peer re-claims Y elsewhere

		expect(store.pathForId("Y")).toBe("B.md");
	});

	test("rollback un-evicts, because nothing was published", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);

		shared.set("A.md", { note_id: "Y" });
		store.set("A.md", { note_id: "X" });
		store.rollback();

		expect(store.pathForId("Y")).toBe("A.md");
	});

	// The reverse index is keyed by ID, so a committed entry only displaces a
	// cache entry when it knows the SAME id. Where the path was reassigned to a
	// different note, the stale cached id kept resolving onto the new note's
	// file — the wrong-mint cross-file overwrite shape.
	test("a stale cached id does not resolve onto another note's file", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);

		store.seed("a.md", { note_id: "X" }); // stale data.json
		shared.set("a.md", { note_id: "Y" }); // the vault reassigned a.md

		expect(store.get("a.md")).toBe("Y");
		expect(store.pathForId("X")).toBeNull();
		expect(store.pathForId("Y")).toBe("a.md");
	});
});

describe("round 3: rename chains and cache-only ids", () => {
	// #434. A path-keyed chain crosses lineages whenever one rename's NEW path is
	// another's OLD path. A same-tick rotation walked a->b->c and resolved `a`
	// onto c's id — the wrong-mint cross-file overwrite shape, in the staged
	// window before commit.
	test("a same-tick rotation does not resolve onto the other note's id", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		shared.set("note.md", { note_id: "X" });
		shared.set("new.md", { note_id: "C" });

		store.rename("note.md", "note-old.md");
		store.rename("new.md", "note.md");

		expect(store.getOrMint("new.md")).toBe("C");
		expect(store.getOrMint("note-old.md")).toBe("X");
	});

	test("a rename round trip does not strand the original path", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		shared.set("a.md", { note_id: "X" });

		store.rename("a.md", "b.md");
		store.rename("b.md", "a.md");

		// Back where it started: it must NOT mint a second id for a note that
		// already has one.
		expect(store.getOrMint("a.md")).toBe("X");
	});

	// An id known only from data.json has never been asserted to the vault.
	// Handing it out without staging a claim leaves it live locally and absent
	// from the authoritative index, so another device mints a duplicate.
	// INVERTED after round 4. This used to assert that getOrMint publishes a
	// claim for a cache-only id. That is actively harmful: `set` runs id-keyed
	// removal, so when another device has already moved the note, the live path
	// gets staged for DELETION — the stale cache publishing a delete of the very
	// claim it should defer to. main.ts's cold-start loop calls getOrMint for
	// every markdown file before the room syncs, so it was whole-vault.
	test("getOrMint does NOT publish a claim for a cache-only id", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		store.seed("a.md", { note_id: "cached" });

		expect(store.getOrMint("a.md")).toBe("cached");
		store.commit();

		expect(shared.has("a.md")).toBe(false);
	});

	// The failure that revert protects: a peer moved the note, our data.json is
	// stale, and the cold-start loop resolves the old path.
	test("a stale cache does not delete the path the note actually lives at", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		shared.set("new.md", { note_id: "N" }); // a peer renamed old.md -> new.md
		store.seed("old.md", { note_id: "N" }); // our stale data.json

		store.getOrMint("old.md"); // cold-start loop over on-disk files
		store.commit();

		expect(shared.get("new.md")).toEqual({ note_id: "N" });
		expect(shared.has("new.md")).toBe(true);
	});

	// F2: a folder moved twice, over descendants this device never opened. Both
	// hops are id: null, and refusing to chain them minted a fresh id per hop.
	test("a twice-moved unknown folder converges on ONE id", () => {
		const store = new SyncStore(new Y.Doc().getMap("filemeta_v0"));

		store.rename("A/x.md", "B/x.md");
		store.rename("B/x.md", "C/x.md");

		expect(store.getOrMint("A/x.md")).toBe(store.getOrMint("C/x.md"));
	});

	// F5: the pivot — the one path that is simultaneously a rename source and a
	// rename target. The original rotation test asserted only the two paths that
	// were never at risk.
	test("the rotation pivot resolves to its new occupant, not the old one", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		shared.set("note.md", { note_id: "X" });
		shared.set("new.md", { note_id: "C" });

		store.rename("note.md", "note-old.md");
		store.rename("new.md", "note.md");

		expect(store.getOrMint("note.md")).toBe("C");
	});

	// F3: the third move takes the file now AT the pivot. It must not follow the
	// previous occupant's redirect.
	test("moving off a re-occupied path does not strand the other note", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		shared.set("a.md", { note_id: "A" });
		shared.set("b.md", { note_id: "B" });

		store.rename("b.md", "c.md");
		store.rename("a.md", "b.md");
		store.rename("b.md", "d.md");
		store.commit();

		expect(shared.get("d.md")).toEqual({ note_id: "A" });
		expect(shared.get("c.md")).toEqual({ note_id: "B" });
		expect(shared.has("b.md")).toBe(false);
	});

	// An unknown-source rename must still un-delete its target, or a same-tick
	// delete+rename leaves the destination reading unclaimed and it re-mints.
	test("an unknown-source rename un-deletes its target", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const store = new SyncStore(shared);
		shared.set("b.md", { note_id: "id-b" });

		store.delete("b.md");
		store.rename("unknown.md", "b.md");

		expect(store.get("b.md")).toBe("id-b");
	});
});

// The e2e drift self-heal failure (test_drifted_map_self_heals_on_inbound_edit).
// It was the first test to run this code against a real backend, and it failed
// immediately — the class of bug unit tests with our code on both ends cannot
// see.
describe("a local forget is local", () => {
	test("delete() does not publish, so drift on one device stays there", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const map = new NoteIdMap(new SyncStore(shared));
		map.set("a.md", "id-a");
		map.flushNow();

		map.delete("a.md");
		map.flushNow();

		// Locally forgotten...
		expect(map.get("a.md")).toBeNull();
		expect(map.pathForId("id-a")).toBeNull();
		// ...but the vault's claim is untouched. Publishing it removed the path
		// from every other device's index, so the drift injected on one device
		// propagated and there was no healthy peer left to heal from.
		expect(shared.get("a.md")).toEqual({ note_id: "id-a" });
	});

	test("re-learning the path heals it", () => {
		const doc = new Y.Doc();
		const map = new NoteIdMap(new SyncStore(doc.getMap("filemeta_v0")));
		map.set("a.md", "id-a");
		map.flushNow();
		map.delete("a.md");

		map.set("a.md", "id-a");
		map.flushNow();

		expect(map.get("a.md")).toBe("id-a");
		expect(map.pathForId("id-a")).toBe("a.md");
	});

	test("release() DOES publish, for a note the user actually deleted", () => {
		const doc = new Y.Doc();
		const shared = doc.getMap<{ note_id: string }>("filemeta_v0");
		const map = new NoteIdMap(new SyncStore(shared));
		map.set("a.md", "id-a");
		map.flushNow();

		map.release("a.md");
		map.flushNow();

		expect(shared.has("a.md")).toBe(false);
	});
});
