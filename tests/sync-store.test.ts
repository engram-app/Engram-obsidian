/**
 * Tests: SyncStore — the layered view over `filemeta_v0` (#362).
 *
 * The interesting behaviour is not "a map stores things". It is that local
 * state which is true-but-not-yet-agreed stays visible to reads and invisible
 * to peers until commit, and that the rename layer removes the window our
 * folder-rename-mint-resurrection bug lives in.
 */
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncStore } from "../src/crdt/sync-store";

function store_(): { store: SyncStore; doc: Y.Doc; map: Y.Map<any> } {
	const doc = new Y.Doc();
	const map = doc.getMap<any>("filemeta_v0");
	return { store: new SyncStore(map), doc, map };
}

describe("layered reads", () => {
	test("a staged entry is readable immediately", () => {
		const { store } = store_();
		store.set("a.md", { note_id: "id-a" });

		expect(store.get("a.md")).toBe("id-a");
		expect(store.has("a.md")).toBe(true);
	});

	test("a staged entry is INVISIBLE to the shared doc until commit", () => {
		const { store, map } = store_();
		store.set("a.md", { note_id: "id-a" });

		expect(map.has("a.md")).toBe(false);

		store.commit();
		expect(map.get("a.md")).toEqual({ note_id: "id-a" });
	});

	test("a committed entry from another device is readable", () => {
		const { store, map } = store_();
		map.set("remote.md", { note_id: "id-remote" });

		expect(store.get("remote.md")).toBe("id-remote");
	});

	test("the overlay wins over a committed entry for the same path", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "old" });
		store.set("a.md", { note_id: "new" });

		expect(store.get("a.md")).toBe("new");
	});

	test("a staged delete stops the path resolving straight away", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		store.delete("a.md");

		expect(store.get("a.md")).toBeNull();
		expect(store.has("a.md")).toBe(false);
		// ...but the peers have not been told yet.
		expect(map.has("a.md")).toBe(true);

		store.commit();
		expect(map.has("a.md")).toBe(false);
	});

	test("setting a path that is staged for deletion cancels the delete", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		store.delete("a.md");
		store.set("a.md", { note_id: "id-a2" });
		store.commit();

		expect(map.get("a.md")).toEqual({ note_id: "id-a2" });
	});
});

describe("the rename layer", () => {
	// The point of the layer: our folder-rename-mint-resurrection bug is a race
	// where the old path stops resolving before the rename is agreed, so anything
	// touching it mints a NEW id and resurrects the path on both devices. Here
	// there is no window to race.
	// The split contract. `get`/`has` mean "is there a note HERE" — a path the
	// user renamed away is gone, and the delete/ignore decisions built on that
	// answer depend on it. Not minting a SECOND id for the old path is a
	// different question, and lives in getOrMint.
	test("get() reports the OLD path as gone, and the new one as present", () => {
		const { store, map } = store_();
		map.set("Old/a.md", { note_id: "id-a" });

		store.rename("Old/a.md", "New/a.md");

		expect(store.get("Old/a.md")).toBeNull();
		expect(store.has("Old/a.md")).toBe(false);
		expect(store.get("New/a.md")).toBe("id-a");
	});

	test("getOrMint on the OLD path after a rename does not mint a second id", () => {
		const { store, map } = store_();
		map.set("Old/a.md", { note_id: "id-a" });
		store.rename("Old/a.md", "New/a.md");

		expect(store.getOrMint("Old/a.md")).toBe("id-a");
		expect(store.getOrMint("New/a.md")).toBe("id-a");
	});

	// The resurrection half: after commit the old key must be GONE from the
	// shared doc, or the next bind replays it and the folder reappears.
	test("commit removes the old path and lands only the new one", () => {
		const { store, map } = store_();
		map.set("Old/a.md", { note_id: "id-a" });
		store.rename("Old/a.md", "New/a.md");
		store.commit();

		expect(map.has("Old/a.md")).toBe(false);
		expect(map.get("New/a.md")).toEqual({ note_id: "id-a" });
	});

	test("a chain of renames before commit resolves to the final path", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });

		store.rename("a.md", "b.md");
		store.rename("b.md", "c.md");

		expect(store.get("a.md")).toBeNull();
		expect(store.getOrMint("a.md")).toBe("id-a");
		expect(store.get("c.md")).toBe("id-a");

		store.commit();
		expect(map.has("a.md")).toBe(false);
		expect(map.get("c.md")).toEqual({ note_id: "id-a" });
	});

	// A folder move renames a path this store has never seen (the descendant was
	// never opened). Both names must still converge on ONE id, or the move mints
	// a duplicate for the same file.
	test("renaming an UNKNOWN path still makes both names converge on one id", () => {
		const { store } = store_();

		store.rename("Old/never-seen.md", "New/never-seen.md");

		const viaNew = store.getOrMint("New/never-seen.md");
		const viaOld = store.getOrMint("Old/never-seen.md");
		expect(viaOld).toBe(viaNew);
	});

	test("renaming to the same path is a no-op", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		store.rename("a.md", "a.md");

		expect(store.get("a.md")).toBe("id-a");
		expect(store.dirty).toBe(false);
	});
});

describe("pendingUpload", () => {
	test("a minted id is pending until the server confirms it", () => {
		const { store } = store_();
		const id = store.getOrMint("fresh.md");

		expect(store.isPendingUpload(id)).toBe(true);

		store.confirmUpload(id);
		expect(store.isPendingUpload(id)).toBe(false);
	});

	// Publishing an id to other devices and the SERVER having stored the note
	// are different facts. Clearing on commit would report the second when only
	// the first happened.
	test("commit does not clear pendingUpload", () => {
		const { store } = store_();
		const id = store.getOrMint("fresh.md");
		store.commit();

		expect(store.isPendingUpload(id)).toBe(true);
	});

	test("an id learned from a peer is not pending", () => {
		const { store, map } = store_();
		map.set("theirs.md", { note_id: "id-theirs" });

		expect(store.isPendingUpload("id-theirs")).toBe(false);
	});
});

describe("commit atomicity", () => {
	// A folder move stages a rename per descendant. Promoting them individually
	// would reach observers as N updates — N chances to see a half-moved folder.
	test("a whole folder move arrives as ONE update", () => {
		const { store, map, doc } = store_();
		map.set("Old/a.md", { note_id: "id-a" });
		map.set("Old/b.md", { note_id: "id-b" });
		map.set("Old/c.md", { note_id: "id-c" });

		let updates = 0;
		doc.on("update", () => updates++);

		store.rename("Old/a.md", "New/a.md");
		store.rename("Old/b.md", "New/b.md");
		store.rename("Old/c.md", "New/c.md");
		store.commit();

		expect(updates).toBe(1);
		expect(map.has("Old/a.md")).toBe(false);
		expect(map.get("New/c.md")).toEqual({ note_id: "id-c" });
	});

	test("a commit with nothing staged produces no update at all", () => {
		const { store, doc } = store_();
		let updates = 0;
		doc.on("update", () => updates++);

		store.commit();

		expect(updates).toBe(0);
	});

	test("rollback discards staged state without publishing it", () => {
		const { store, map } = store_();
		store.set("a.md", { note_id: "id-a" });
		store.rollback();
		store.commit();

		expect(map.has("a.md")).toBe(false);
		expect(store.get("a.md")).toBeNull();
	});
});

describe("pathForId", () => {
	test("finds a committed path", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });

		expect(store.pathForId("id-a")).toBe("a.md");
	});

	test("finds a staged path before commit", () => {
		const { store } = store_();
		store.set("b.md", { note_id: "id-b" });

		expect(store.pathForId("id-b")).toBe("b.md");
	});

	test("follows a staged rename", () => {
		const { store, map } = store_();
		map.set("Old/a.md", { note_id: "id-a" });
		store.rename("Old/a.md", "New/a.md");

		expect(store.pathForId("id-a")).toBe("New/a.md");
	});

	test("a staged delete removes the id from the reverse view", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		store.delete("a.md");

		expect(store.pathForId("id-a")).toBeNull();
	});

	// The cache is invalidated by REMOTE updates too, or a path learned from
	// another device answers with a stale value (or nothing).
	test("sees an entry that arrives from a peer after the cache was built", () => {
		const { store, map } = store_();
		map.set("first.md", { note_id: "id-first" });
		expect(store.pathForId("id-first")).toBe("first.md");

		map.set("second.md", { note_id: "id-second" });
		expect(store.pathForId("id-second")).toBe("second.md");
	});

	test("returns null for an unknown id", () => {
		const { store } = store_();
		expect(store.pathForId("nope")).toBeNull();
	});
});

describe("getOrMint", () => {
	test("mints once and is stable across calls", () => {
		const { store } = store_();
		const a = store.getOrMint("a.md");

		expect(store.getOrMint("a.md")).toBe(a);
	});

	test("reuses a committed id rather than minting", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });

		expect(store.getOrMint("a.md")).toBe("id-a");
	});

	// A literal "null" key was found minted and CRDT-enrolled in a prod
	// data.json (2026-07-07). Minting for a phantom path binds a real doc to a
	// file that does not exist, so the caller's bug has to surface here.
	test.each(["", "null", "undefined"])("refuses the garbage path %p", (bad) => {
		const { store } = store_();
		expect(() => store.getOrMint(bad)).toThrow();
	});
});

// #451, observed in prod 2026-08-28: a claimed path stopped resolving
// mid-session, `getOrMint` read that as "new path" and minted a second
// UUIDv7, and every op sent under it was dropped `note_not_found` by a
// backend that never issued it. `forget()` cannot remove a COMMITTED entry
// without publishing, so it hides one — and the hide outranked a live claim.
describe("getOrMint never mints over a live committed claim", () => {
	test("a forgotten path resolves to the committed id instead of minting", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });

		store.forget("a.md");
		expect(store.get("a.md")).toBeNull(); // the hide is still doing its job

		expect(store.getOrMint("a.md")).toBe("id-a");
	});

	test("resolving it clears the local hide, so the reverse index answers again", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		store.forget("a.md");

		store.getOrMint("a.md");

		expect(store.pathForId("id-a")).toBe("a.md");
	});

	test("it publishes nothing — no claim, no id-keyed removal", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		store.forget("a.md");

		store.getOrMint("a.md");

		expect(store.dirty).toBe(false);
		store.commit();
		expect(map.get("a.md")).toEqual({ note_id: "id-a" });
	});

	// The two local states that ARE verdicts keep their mint.
	test("a DELETED path still mints — a recreate there is a new note", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });

		store.delete("a.md");

		expect(store.getOrMint("a.md")).not.toBe("id-a");
	});

	test("an EVICTED id is stale and still mints", () => {
		const { store, map } = store_();
		map.set("a.md", { note_id: "id-a" });
		// Another path claims id-a, so a.md's committed entry no longer holds it.
		store.set("b.md", { note_id: "id-a" });
		store.forget("a.md");

		expect(store.getOrMint("a.md")).not.toBe("id-a");
	});
});

// NoteIdMap-level behaviour: the coalescing that makes a folder move ONE update.
describe("NoteIdMap publication", () => {
	async function tick() {
		await new Promise<void>((r) => queueMicrotask(() => r()));
		await new Promise<void>((r) => queueMicrotask(() => r()));
	}

	test("N renames in one tick publish as ONE update", async () => {
		const doc = new Y.Doc();
		const store = new SyncStore(doc.getMap<any>("filemeta_v0"));
		const map = new NoteIdMap(store);

		map.batch(() => {
			for (let i = 0; i < 5; i++) map.set(`Old/${i}.md`, `id-${i}`);
		});

		let updates = 0;
		doc.on("update", () => updates++);

		// Exactly what Obsidian does for a folder rename: one event per descendant.
		for (let i = 0; i < 5; i++) map.rename(`Old/${i}.md`, `New/${i}.md`);
		await tick();

		expect(updates).toBe(1);
		expect(map.get("New/3.md")).toBe("id-3");
		expect(map.get("Old/3.md")).toBeNull();
	});

	test("reads do not wait for the publication tick", () => {
		const doc = new Y.Doc();
		const map = new NoteIdMap(new SyncStore(doc.getMap<any>("filemeta_v0")));

		map.set("a.md", "id-a");

		// Deferring publication must not defer visibility to THIS device.
		expect(map.get("a.md")).toBe("id-a");
	});

	test("flushNow publishes without waiting", () => {
		const doc = new Y.Doc();
		const store = new SyncStore(doc.getMap<any>("filemeta_v0"));
		const map = new NoteIdMap(store);

		map.set("a.md", "id-a");
		map.flushNow();

		expect(doc.getMap<any>("filemeta_v0").get("a.md")).toEqual({ note_id: "id-a" });
	});
});
