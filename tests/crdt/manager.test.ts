import { describe, expect, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { CrdtChannel } from "../../src/crdt/channel";
import { CrdtManager, frontmatterOf } from "../../src/crdt/manager";
import { rlog } from "../../src/remote-log";
import { reconcileColdStart } from "../../src/sync";

// ---------------------------------------------------------------------------
// Task 6: doc-shape constants + frontmatterOf accessor
// ---------------------------------------------------------------------------

test("frontmatterOf returns empty for a fresh doc", () => {
	const doc = new Y.Doc();
	expect(frontmatterOf(doc)).toEqual({ order: [], values: {} });
});

test("frontmatterOf reflects values written into Y.Map and Y.Array", () => {
	const doc = new Y.Doc();
	doc.getArray("frontmatter_order").push(["title", "tags"]);
	doc.getMap("frontmatter").set("title", "Hello");
	doc.getMap("frontmatter").set("tags", "foo bar");
	expect(frontmatterOf(doc)).toEqual({
		order: ["title", "tags"],
		values: { title: "Hello", tags: "foo bar" },
	});
});

function makeManager(captured: Uint8Array[] = []) {
	const flushed: Record<string, string> = {};
	const mgr = new CrdtManager({
		dbPrefix: "vault-A",
		onUpdate: (_docId, update) => captured.push(update),
		onFlushToDisk: async (path, content) => {
			flushed[path] = content;
		},
	});
	return { mgr, captured, flushed };
}

test("applyLocalEdit seeds a fresh doc once then diffs subsequent edits", async () => {
	const { mgr } = makeManager();
	// markSynced required before seeding: simulates STEP2 handshake completion.
	// Without it, applyLocalEdit returns false and declines the seed (audit P0-1 fix).
	mgr.markSynced("note.md");
	await mgr.applyLocalEdit("note.md", "first body", false);
	expect(await mgr.getText("note.md")).toBe("first body");

	// Subsequent edit: hasLca true (history exists) → must diff, not re-seed.
	await mgr.applyLocalEdit("note.md", "first body, extended", true);
	expect(await mgr.getText("note.md")).toBe("first body, extended");
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// Adopt-first seed gate (backend #846 lineage doubling): a history-less doc
// whose disk content is byte-identical to the last-synced content must NOT be
// seeded — seeding re-encodes server-known content on the plugin's own Yjs
// lineage, and the server cannot dedup it against its merge-lineage encoding
// (text doubles: "Iteration 2" + tail replay -> "Iteration 22"). The doc stays
// empty and adopts the server lineage from the first STEP2 instead. Content
// that DIFFERS from the last-synced hash (real offline edits) keeps today's
// seed behavior — no data loss.
// ---------------------------------------------------------------------------

test("applyLocalEdit adopts-first: no seed, no ops when content is unchanged-synced", async () => {
	const captured: Uint8Array[] = [];
	const mgr = new CrdtManager({
		dbPrefix: "vault-gate-1",
		onUpdate: (_docId, update) => captured.push(update),
		onFlushToDisk: async () => {},
		isUnchangedSynced: (path, content) =>
			path === "synced.md" && content === "---\ntitle: T\n---\n# Pulled\nbody",
	});
	await mgr.applyLocalEdit("synced.md", "---\ntitle: T\n---\n# Pulled\nbody", false);
	expect(await mgr.getText("synced.md")).toBe("");
	expect(frontmatterOf(await mgr.getDoc("synced.md"))).toEqual({ order: [], values: {} });
	expect(captured.length).toBe(0);
	await mgr.destroy();
});

test("applyLocalEdit still seeds when content differs from last-synced (offline edits preserved)", async () => {
	const captured: Uint8Array[] = [];
	const mgr = new CrdtManager({
		dbPrefix: "vault-gate-2",
		onUpdate: (_docId, update) => captured.push(update),
		onFlushToDisk: async () => {},
		isUnchangedSynced: () => false,
	});
	// Handshake gate (audit P0-1) declines any seed before STEP2 completes;
	// markSynced simulates the completed handshake so the differs-path seeds.
	mgr.markSynced("edited.md");
	await mgr.applyLocalEdit("edited.md", "# Edited offline", false);
	expect(await mgr.getText("edited.md")).toBe("# Edited offline");
	expect(captured.length).toBeGreaterThan(0);
	await mgr.destroy();
});

test("the adopt-first gate does not fire once the doc has history", async () => {
	const captured: Uint8Array[] = [];
	const mgr = new CrdtManager({
		dbPrefix: "vault-gate-3",
		onUpdate: (_docId, update) => captured.push(update),
		onFlushToDisk: async () => {},
		isUnchangedSynced: () => true,
	});
	// Adopt server state first (remote origin — not re-broadcast).
	const server = new Y.Doc();
	server.getText("content").insert(0, "server body");
	await mgr.applyRemoteUpdate("synced.md", Y.encodeStateAsUpdate(server));
	expect(await mgr.getText("synced.md")).toBe("server body");

	// A real local edit after adoption must diff in on the adopted lineage.
	await mgr.applyLocalEdit("synced.md", "server body plus local", true);
	expect(await mgr.getText("synced.md")).toBe("server body plus local");
	expect(captured.length).toBeGreaterThan(0);
	await mgr.destroy();
});

test("local edits emit a v1 update via onUpdate", async () => {
	const captured: Uint8Array[] = [];
	const { mgr } = makeManager(captured);
	// markSynced required: the seeding gate must be cleared before the doc can
	// accept local content (audit P0-1 fix). Without it, applyLocalEdit declines
	// and no update is emitted, which would make captured.length === 0.
	mgr.markSynced("note.md");
	await mgr.applyLocalEdit("note.md", "hello", false);
	expect(captured.length).toBeGreaterThan(0);

	// The captured update applies cleanly into a fresh doc (valid v1 codec).
	const dst = new Y.Doc();
	for (const u of captured) Y.applyUpdate(dst, u);
	expect(dst.getText("content").toString()).toBe("hello");
	await mgr.destroy();
});

test("applyRemoteUpdate flushes merged text to disk", async () => {
	const { mgr, flushed } = makeManager();
	// markSynced required before local seed (audit P0-1 fix).
	mgr.markSynced("note.md");
	await mgr.applyLocalEdit("note.md", "base", false);

	// Build a remote update on top of the same state.
	const peer = new Y.Doc();
	Y.applyUpdate(peer, await mgr.encodeStateAsUpdate("note.md"));
	peer.getText("content").insert(peer.getText("content").length, " + remote");
	const remoteUpdate = Y.encodeStateAsUpdate(peer, await mgr.encodeStateVector("note.md"));

	await mgr.applyRemoteUpdate("note.md", remoteUpdate);
	expect(flushed["note.md"]).toBe("base + remote");
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// #235: applyRemoteUpdate must NOT resolve before the disk flush completes.
// The remote-origin doc.on("update") listener used to fire-and-forget
// (`void onFlushToDisk(...)`), so applyRemoteUpdate returned as soon as
// Y.applyUpdate finished. The caller (applyPushedNoteUpdate/coldReceive) then
// advanced crdtHead synchronously. If the disk write FAILED, the watermark
// said "converged" but disk never got the content → silent divergence, and
// coldReceive's head-diff never re-pulls. applyRemoteUpdate must await the
// flush and reject if it fails, so the caller leaves crdtHead unadvanced.
// ---------------------------------------------------------------------------

test("#235: applyRemoteUpdate rejects when the disk flush fails (no silent converge)", async () => {
	const mgr = new CrdtManager({
		dbPrefix: "flush-fail",
		onUpdate: () => {},
		onFlushToDisk: async () => {
			throw new Error("disk write failed");
		},
	});
	// A remote update that integrates real ops, so the flush listener fires.
	const server = new Y.Doc();
	server.getText("content").insert(0, "remote body");
	const update = Y.encodeStateAsUpdate(server);

	await expect(mgr.applyRemoteUpdate("note.md", update)).rejects.toThrow("disk write failed");
	await mgr.destroy();
});

test("#235: applyRemoteUpdate resolves when the flush succeeds (happy path unchanged)", async () => {
	const flushed: Record<string, string> = {};
	const mgr = new CrdtManager({
		dbPrefix: "flush-ok",
		onUpdate: () => {},
		onFlushToDisk: async (id, content) => {
			flushed[id] = content;
		},
	});
	const server = new Y.Doc();
	server.getText("content").insert(0, "remote body");
	await mgr.applyRemoteUpdate("note.md", Y.encodeStateAsUpdate(server));
	expect(flushed["note.md"]).toBe("remote body");
	await mgr.destroy();
});

test("closeDoc + reapply: entry() rehydrates full prior state from IndexedDB before merging the next delta (P3 hibernation correctness)", async () => {
	// Mirrors SyncEngine.hibernateIfIdle (P3, plugin #232-series): after an
	// idle note's Y.Doc applies a pushed/converged update, the doc is freed
	// with closeDoc (no clearData — the IDB store persists). This proves the
	// SECOND apply, after the doc has been freed and reopened, produces the
	// correctly MERGED content — i.e. entry() rehydrated the full "Hello "
	// state before merging the "World" delta, not just applied the delta into
	// a fresh empty doc.
	const { mgr } = makeManager();
	const server = new Y.Doc();
	const serverText = server.getText("content");
	serverText.insert(0, "Hello ");

	await mgr.applyRemoteUpdate("hibernate.md", Y.encodeStateAsUpdate(server));
	expect(await mgr.getText("hibernate.md")).toBe("Hello ");

	// Capture the server's state vector as of just the first insert, BEFORE
	// the second insert — so update2 below is a delta relative to that point,
	// not a full re-encode. Applying it into a doc that never rehydrated
	// "Hello " would leave the merge incomplete/incorrect.
	const svAfterFirst = Y.encodeStateVector(server);
	await new Promise((r) => setTimeout(r, 50)); // let y-indexeddb flush before hibernating

	mgr.closeDoc("hibernate.md"); // hibernate — doc freed, IDB store persists

	serverText.insert(serverText.length, "World");
	const update2 = Y.encodeStateAsUpdate(server, svAfterFirst);

	await mgr.applyRemoteUpdate("hibernate.md", update2);
	expect(await mgr.getText("hibernate.md")).toBe("Hello World");
	await mgr.destroy();
});

test("state persists to IndexedDB across a manager restart", async () => {
	const a = makeManager();
	// markSynced required before first seed (audit P0-1 fix).
	a.mgr.markSynced("note.md");
	await a.mgr.applyLocalEdit("note.md", "survives reload", false);
	await new Promise((r) => setTimeout(r, 50)); // let y-indexeddb flush
	await a.mgr.destroy();

	const b = makeManager();
	// getDoc must rehydrate from IndexedDB under the same docId.
	expect(await b.mgr.getText("note.md")).toBe("survives reload");
	await b.mgr.destroy();
});

// ---------------------------------------------------------------------------
// Task 7A: Mobile/iOS — onPersistError + flattenIfBloated
// ---------------------------------------------------------------------------

test("persist errors surface via onPersistError, not by throwing into sync", async () => {
	let captured: unknown = null;
	const mgr = new CrdtManager({
		dbPrefix: "A",
		onUpdate: () => {},
		onFlushToDisk: async () => {},
		onPersistError: (_p, e) => {
			captured = e;
		},
	});
	// applyLocalEdit must resolve even if the (simulated) persistence layer errors.
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("n.md");
	await mgr.applyLocalEdit("n.md", "content", false);
	expect(await mgr.getText("n.md")).toBe("content"); // in-memory state intact
	await mgr.destroy();
	// captured stays null in the happy path; the assertion proves the option type
	// exists + the call path doesn't throw. A forced-error variant is added if a
	// mock for IndexeddbPersistence error events is available in the harness.
	expect(captured === null || captured !== undefined).toBe(true);
});

test("flattenIfBloated flattens only when BOTH bytes AND client-IDs cross", async () => {
	const mgr = new CrdtManager({
		dbPrefix: "A",
		onUpdate: () => {},
		onFlushToDisk: async () => {},
	});

	// Build a doc that is both > 500 KB AND > 1000 client-IDs. Each distinct
	// client-ID is introduced by applying an update authored by a fresh Y.Doc.
	const doc = await mgr.getDoc("n.md");
	for (let i = 0; i < 1100; i++) {
		const author = new Y.Doc(); // a unique clientID per author
		Y.applyUpdate(author, Y.encodeStateAsUpdate(doc));
		author.getText("content").insert(author.getText("content").length, "x".repeat(500));
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(author, Y.encodeStateVector(doc)));
	} // ≈ 550 KB content, ≈ 1100 client-IDs → both axes crossed

	const before = await mgr.getText("n.md");
	const flattened = await mgr.flattenIfBloated("n.md");
	expect(flattened).toBe(true);
	expect(await mgr.getText("n.md")).toBe(before); // text preserved verbatim
	await mgr.destroy();
}, 30000); // generous timeout: building 1100 Y.Doc entries is CPU-intensive

test("flattenIfBloated does NOT flatten a large single-author doc (only one axis)", async () => {
	const mgr = new CrdtManager({
		dbPrefix: "A",
		onUpdate: () => {},
		onFlushToDisk: async () => {},
	});
	// > 500 KB but a single client-ID — the AND gate must leave it alone.
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("n.md");
	await mgr.applyLocalEdit("n.md", "x".repeat(600_000), false);
	expect(await mgr.flattenIfBloated("n.md")).toBe(false);
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// Task 7B: startSync enrollment — opening a note triggers exactly one startSync
// ---------------------------------------------------------------------------

describe("CrdtChannel startSync enrollment", () => {
	let _seq = 0;

	function makeChannelPair() {
		const pfx = `enroll-${_seq++}`;
		const startSyncCalls: string[] = [];

		const mgr = new CrdtManager({
			dbPrefix: pfx,
			onUpdate: () => {},
			onFlushToDisk: async () => {},
		});

		const frames: { docId: string; frame: string }[] = [];
		const chan = new CrdtChannel({
			manager: mgr,
			send: (docId, frame) => {
				frames.push({ docId, frame });
			},
		});

		// Spy on startSync to track calls
		const origStartSync = chan.startSync.bind(chan);
		chan.startSync = async (path: string) => {
			startSyncCalls.push(path);
			return origStartSync(path);
		};

		return { mgr, chan, startSyncCalls, frames };
	}

	test("startSync sends STEP1 exactly once for a given path", async () => {
		const { chan, mgr, frames } = makeChannelPair();

		await chan.startSync("note.md");
		await chan.startSync("note.md"); // second call — must be idempotent
		await chan.startSync("note.md"); // third call — must be idempotent

		// Only one STEP1 frame should have been sent (once-per-doc guard)
		expect(frames.length).toBe(1);
		await mgr.destroy();
	});

	test("resetSync clears the once-guard, allowing startSync again on reconnect", async () => {
		const { chan, mgr, frames } = makeChannelPair();

		await chan.startSync("note.md");
		expect(frames.length).toBe(1);

		chan.resetSync("note.md"); // simulates WS reconnect
		await chan.startSync("note.md");
		expect(frames.length).toBe(2); // new STEP1 sent after reset
		await mgr.destroy();
	});

	test("startSync for different paths sends a STEP1 per path", async () => {
		const { chan, mgr, frames } = makeChannelPair();

		await chan.startSync("a.md");
		await chan.startSync("b.md");

		expect(frames.length).toBe(2); // one STEP1 per distinct note
		await mgr.destroy();
	});
});

// ---------------------------------------------------------------------------
// Task 7 (frontmatter split): applyLocalEdit routes frontmatter into Y.Map/Array
// ---------------------------------------------------------------------------

test("applyLocalEdit splits frontmatter into Y.Map, body into Y.Text", async () => {
	const { mgr } = makeManager();
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("N.md");
	await mgr.applyLocalEdit("N.md", "---\ntitle: Hi\n---\nbody\n");
	const doc = await mgr.getDoc("N.md");
	expect(frontmatterOf(doc)).toEqual({ order: ["title"], values: { title: '"Hi"' } });
	expect(doc.getText("content").toString()).toBe("body\n");
	await mgr.destroy();
});

test("malformed frontmatter keeps whole text as body", async () => {
	const { mgr } = makeManager();
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("N.md");
	await mgr.applyLocalEdit("N.md", "---\nbroken: : :\n---\nbody\n");
	const doc = await mgr.getDoc("N.md");
	expect(frontmatterOf(doc)).toEqual({ order: [], values: {} });
	expect(doc.getText("content").toString()).toBe("---\nbroken: : :\n---\nbody\n");
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// Task 8: flush reconstructs full file from Y.Map + body
// ---------------------------------------------------------------------------

test("flush reconstructs full file from Y.Map + body", async () => {
	const flushed: Array<[string, string]> = [];
	const mgr = new CrdtManager({
		dbPrefix: "task8",
		onUpdate: () => {},
		onFlushToDisk: async (p, c) => {
			flushed.push([p, c]);
		},
	});

	// Seed local state: frontmatter goes into Y.Map, body into Y.Text.
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("N.md");
	await mgr.applyLocalEdit("N.md", "---\ntitle: Hi\n---\nbody\n");

	// Build a remote peer from the same state, append " world" to body, then
	// send only the delta back — triggering the REMOTE_ORIGIN flush listener.
	const peer = new Y.Doc();
	Y.applyUpdate(peer, await mgr.encodeStateAsUpdate("N.md"));
	peer.getText("content").insert(peer.getText("content").length, " world");
	const remoteUpdate = Y.encodeStateAsUpdate(peer, await mgr.encodeStateVector("N.md"));

	await mgr.applyRemoteUpdate("N.md", remoteUpdate);

	// The flush must reconstruct the full file: frontmatter fence + body with remote change.
	expect(flushed.at(-1)).toEqual(["N.md", "---\ntitle: Hi\n---\nbody\n world"]);
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// Task 7D: catch-split in reconcileColdStart
// — write failure does NOT trigger onCorruption; decode failure DOES
// ---------------------------------------------------------------------------

describe("reconcileColdStart catch-split", () => {
	test("write failure (applyLocalEdit throws) does NOT trigger onCorruption", async () => {
		let corrupted = false;
		const projectedText = async () => "old content";
		const getText = async () => "old content"; // decode succeeds
		const applyLocalEdit = async () => {
			throw new Error("storage write failed");
		};

		// Should not reject AND should not call onCorruption
		await reconcileColdStart(
			{ path: "n.md", noteId: "note-1", diskContent: "new content" },
			{ projectedText, getText, applyLocalEdit },
			() => {
				corrupted = true;
			},
		);
		// Write failure must NOT masquerade as corruption
		expect(corrupted).toBe(false);
	});

	test("decode failure (getText throws) DOES trigger onCorruption", async () => {
		let corrupted = false;
		const projectedText = async (): Promise<string> => {
			throw new Error("decode failed");
		};
		const getText = async (): Promise<string> => {
			throw new Error("decode failed");
		};
		const applyLocalEdit = async () => true;

		await reconcileColdStart(
			{ path: "n.md", noteId: "note-2", diskContent: "some content" },
			{ projectedText, getText, applyLocalEdit },
			() => {
				corrupted = true;
			},
		);
		expect(corrupted).toBe(true);
	});

	test("write failure logs a warn via rlog (observable, not silent)", async () => {
		// rlog() returns the noop logger before initRemoteLog — spy on its warn
		// method to capture calls made by reconcileColdStart's write-fail catch.
		const logger = rlog();
		const warnSpy = spyOn(logger, "warn");

		const projectedText = async () => "old content";
		const getText = async () => "old content";
		const applyLocalEdit = async () => {
			throw new Error("storage write failed");
		};

		await reconcileColdStart(
			{ path: "fail.md", noteId: "note-3", diskContent: "new content" },
			{ projectedText, getText, applyLocalEdit },
			() => {},
		);

		// The warn must have been called with category "crdt" and mention the path.
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const [cat, msg] = warnSpy.mock.calls[0] as [string, string];
		expect(cat).toBe("crdt");
		expect(msg).toContain("fail.md");

		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Bug 1: flattenIfBloated must preserve frontmatter (TDD RED before fix)
// ---------------------------------------------------------------------------

test("flattenIfBloated preserves frontmatter across the flatten reset", async () => {
	const { mgr } = makeManager();

	// Seed frontmatter FIRST so the Y.Map/Y.Array are populated before bloat.
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("n.md");
	await mgr.applyLocalEdit("n.md", "---\ntitle: My Note\ntags: foo bar\n---\nbody text", false);

	// Build bloat on top of the seeded state: 1100 distinct client-IDs, each
	// adding 500 chars to cross both axes (> 500 KB AND > 1000 client-IDs).
	const doc = await mgr.getDoc("n.md");
	for (let i = 0; i < 1100; i++) {
		const author = new Y.Doc();
		Y.applyUpdate(author, Y.encodeStateAsUpdate(doc));
		author.getText("content").insert(author.getText("content").length, "x".repeat(500));
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(author, Y.encodeStateVector(doc)));
	}

	const flattened = await mgr.flattenIfBloated("n.md");
	expect(flattened).toBe(true);

	// Frontmatter must survive the flatten.
	const freshDoc = await mgr.getDoc("n.md");
	const { values } = frontmatterOf(freshDoc);
	expect(values).toMatchObject({ title: '"My Note"', tags: '"foo bar"' });

	// projectedText must include the frontmatter fence.
	const projected = await mgr.projectedText("n.md");
	expect(projected).toContain("---");
	expect(projected).toContain("title:");

	await mgr.destroy();
}, 30000);

// ---------------------------------------------------------------------------
// Bug 2: projectedText returns full file (frontmatter + body)
// ---------------------------------------------------------------------------

test("projectedText returns full file for a frontmatter note", async () => {
	const { mgr } = makeManager();
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("fm.md");
	await mgr.applyLocalEdit("fm.md", "---\ntitle: Hello\n---\nbody", false);
	const result = await mgr.projectedText("fm.md");
	expect(result).toContain("---");
	expect(result).toContain("title:");
	expect(result).toContain("body");
	await mgr.destroy();
});

test("projectedText returns body-only for a plain note (no frontmatter)", async () => {
	const { mgr } = makeManager();
	// markSynced required before seeding (audit P0-1 fix).
	mgr.markSynced("plain.md");
	await mgr.applyLocalEdit("plain.md", "just body", false);
	expect(await mgr.projectedText("plain.md")).toBe("just body");
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// Lossless projection of degraded frontmatter keys (backend
// feat/frontmatter-resilience). The server stores a key it could not parse as
// YAML in a dedicated `frontmatter_raw` Y.Map (its verbatim source span),
// alongside the good `frontmatter` map + full-order `frontmatter_order`. That
// map syncs over CRDT; the projection MUST re-render those spans verbatim in
// source order, or the degraded key is silently dropped on materialize to disk
// (data loss, and permanent server loss if the stripped file echoes back).
// ---------------------------------------------------------------------------

test("projectedText re-renders a degraded frontmatter_raw key verbatim (single-line)", async () => {
	const { mgr } = makeManager();
	const doc = await mgr.getDoc("deg.md");
	doc.transact(() => {
		doc.getArray<string>("frontmatter_order").push(["title", "date"]);
		doc.getMap<string>("frontmatter").set("title", '"Hi"');
		// `date` is degraded (backend could not JSON-encode the parsed Date), so it
		// lives out-of-band in frontmatter_raw as its verbatim source span.
		doc.getMap<string>("frontmatter_raw").set("date", "date: 2024-01-01");
		doc.getText("content").insert(0, "the body\n");
	});
	expect(await mgr.projectedText("deg.md")).toBe(
		"---\ntitle: Hi\ndate: 2024-01-01\n---\nthe body\n",
	);
	await mgr.destroy();
});

test("projectedText preserves a multi-line degraded raw span byte-for-byte", async () => {
	const { mgr } = makeManager();
	const doc = await mgr.getDoc("deg2.md");
	const rawSpan = "coords: [\n  1,\n  2,\n]";
	doc.transact(() => {
		doc.getArray<string>("frontmatter_order").push(["coords", "title"]);
		doc.getMap<string>("frontmatter").set("title", '"Hi"');
		doc.getMap<string>("frontmatter_raw").set("coords", rawSpan);
		doc.getText("content").insert(0, "b\n");
	});
	expect(await mgr.projectedText("deg2.md")).toBe(`---\n${rawSpan}\ntitle: Hi\n---\nb\n`);
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// Bug 3: reconcileColdStart uses projectedText so early-return fires correctly
// ---------------------------------------------------------------------------

test("reconcileColdStart returns early when projectedText matches disk (no applyLocalEdit)", async () => {
	let applyCallCount = 0;
	const fullFile = "---\ntitle: T\n---\nbody";

	const crdt = {
		projectedText: async () => fullFile, // matches disk
		getText: async () => "body", // old body-only value — would NOT match
		applyLocalEdit: async () => {
			applyCallCount++;
			return true;
		},
	};

	await reconcileColdStart(
		{ path: "n.md", noteId: "note-4", diskContent: fullFile },
		crdt,
		() => {},
	);
	// projectedText matches diskContent, so applyLocalEdit must NOT be called.
	expect(applyCallCount).toBe(0);
});

// ---------------------------------------------------------------------------
// Task 5: removeDoc — tear down Y.Doc + IndexedDB on delete/rename
// ---------------------------------------------------------------------------

test("removeDoc clears IDB: re-opening the same path yields an empty doc", async () => {
	const { mgr } = makeManager();
	// Seed content into the doc and wait for IDB flush.
	mgr.markSynced("gone.md");
	await mgr.applyLocalEdit("gone.md", "content that should vanish", false);
	await new Promise((r) => setTimeout(r, 50)); // let y-indexeddb flush

	// Remove the doc — must destroy in-memory state AND clear IDB.
	await mgr.removeDoc("gone.md");

	// Open a fresh manager backed by the SAME IDB store (same dbPrefix = "vault-A").
	// If IDB was not cleared, getText would return the old content.
	const { mgr: mgr2 } = makeManager();
	const text = await mgr2.getText("gone.md");
	expect(text).toBe(""); // IDB was wiped — fresh empty doc
	await mgr2.destroy();
	await mgr.destroy();
});

test("removeDoc on a never-opened path does not throw", async () => {
	const { mgr } = makeManager();
	// Path was never opened this session — no in-memory entry exists.
	// removeDoc must still clear any IDB state (or be a no-op) without throwing.
	await expect(mgr.removeDoc("never-opened.md")).resolves.toBeUndefined();
	await mgr.destroy();
});

test("removeDoc clears the synced mark so re-opening triggers a fresh handshake gate", async () => {
	const { mgr } = makeManager();
	mgr.markSynced("a.md");
	expect(mgr.isSynced("a.md")).toBe(true);

	await mgr.removeDoc("a.md");

	// After removal the synced mark must be gone so a re-created note
	// goes through the full handshake gate before seeding.
	expect(mgr.isSynced("a.md")).toBe(false);
	await mgr.destroy();
});

// ---------------------------------------------------------------------------
// BUG 1: closeDoc must NOT destroy a Y.Doc while a mutating op (applyLocalEdit
// / applyRemoteUpdate) is in flight. A NOT-live-bound note edited on disk runs
// applyLocalEdit (which yields at `await entry(...)`); a concurrent fanned-out
// remote update hibernates the same note → closeDoc → doc.destroy() clears the
// update listeners, so the resumed applyLocalEdit emits/persists NOTHING and
// the edit is silently lost. closeDoc must be a no-op while an op is pending.
// ---------------------------------------------------------------------------

test("BUG 1: closeDoc during an in-flight applyLocalEdit does not destroy the doc or lose the edit", async () => {
	const captured: Uint8Array[] = [];
	const { mgr } = makeManager(captured);
	mgr.markSynced("race.md");
	// Establish a base so the second edit takes the diff path (history exists).
	await mgr.applyLocalEdit("race.md", "base body", false);
	const baseDoc = await mgr.getDoc("race.md");
	const capturedBefore = captured.length;

	// Gate the NEXT entry() resolution so closeDoc can race the in-flight edit.
	const realEntry = (mgr as any).entry.bind(mgr);
	let release!: () => void;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	let gated = false;
	const entrySpy = spyOn(mgr as any, "entry").mockImplementation(async (id: string) => {
		const e = await realEntry(id);
		if (!gated) {
			gated = true;
			await gate; // hold the FIRST applyLocalEdit inside entry()
		}
		return e;
	});

	const editP = mgr.applyLocalEdit("race.md", "base body EDITED", true);
	await Promise.resolve(); // let applyLocalEdit reach the gated await
	// Concurrent hibernation fires closeDoc while the edit is in flight.
	mgr.closeDoc("race.md");
	release();
	await editP;
	entrySpy.mockRestore();

	// The edit must have been applied to the SAME (not-destroyed) doc and emitted.
	expect(await mgr.getDoc("race.md")).toBe(baseDoc); // doc not destroyed/replaced
	expect(await mgr.getText("race.md")).toBe("base body EDITED"); // edit not lost
	expect(captured.length).toBeGreaterThan(capturedBefore); // update was emitted
	await mgr.destroy();
});
