import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as YDoc from "yjs";
import { isDestroyedError } from "../../src/crdt/destroyed-error";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

/** Hand a frame to the other device the way the REAL transport does.
 *
 *  `receive` is fire-and-forget here, so its rejection needs an observer or it
 *  becomes an unhandled rejection — and Bun blames those on whichever test is
 *  running, not the one that leaked it (which is why this surfaced as a ~1/8
 *  flake landing on unrelated tests). `destroyAll` ends every lifetime, and
 *  `Lifetime.guard` rejects any `receive` still hydrating at that moment, so a
 *  DestroyedError at teardown is expected.
 *
 *  Swallow exactly that and nothing else, mirroring the production call site
 *  (`onCrdtMessage` in src/crdt/wiring.ts, which drops `isDestroyedError` and
 *  re-surfaces everything else). A real fault must still fail the test. */
function deliver(to: () => ProviderRegistry, id: string, frame: string): void {
	queueMicrotask(() => {
		void to()
			.receive(id, frame)
			.catch((e: unknown) => {
				if (!isDestroyedError(e)) throw e;
			});
	});
}

// Two "devices", each its own ProviderRegistry with an isolated IndexedDB store
// (dbPrefix). An in-memory relay routes every frame one device sends for a
// note_id to the other device's `receive`, exercising the full Relay exchange
// (syncStep1/2 + updates) with no server double.
function twoDevices() {
	const flushedA: Record<string, string> = {};
	const flushedB: Record<string, string> = {};
	let up = true;
	// mutually referential wiring — assigned below, not at declaration
	let A: ProviderRegistry;
	let B: ProviderRegistry;
	A = new ProviderRegistry({
		dbPrefix: "devA",
		send: (id, frame) => {
			if (up) deliver(() => B, id, frame);
			return up;
		},
		onFlushToDisk: (id, content) => {
			flushedA[id] = content;
		},
	});
	B = new ProviderRegistry({
		dbPrefix: "devB",
		send: (id, frame) => {
			if (up) deliver(() => A, id, frame);
			return up;
		},
		onFlushToDisk: (id, content) => {
			flushedB[id] = content;
		},
	});
	return {
		A,
		B,
		flushedA,
		flushedB,
		setUp: (v: boolean) => {
			up = v;
		},
	};
}

const flush = () => new Promise<void>((r) => setTimeout(r, 15));

/** Poll until `cond` holds. The STEP1/STEP2 handshake spans several async turns
 *  — two `IndexeddbPersistence.whenSynced` resolutions plus the relay's
 *  queueMicrotask hops — so the fixed `flush()` sleep above is racy for anything
 *  that waits on the handshake COMPLETING (measured ~15% failure under parallel
 *  load, pre-existing on main: `synced` was still false when closeDoc ran, so
 *  isFullySynced refused to evict). Same helper, same reason, as the sibling
 *  wiring.test.ts. Use this — not a bigger sleep — for handshake preconditions. */
async function waitFor(cond: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (cond()) return;
		await new Promise<void>((r) => setTimeout(r, 5));
	}
	throw new Error(`waitFor timed out: ${label}`);
}

describe("ProviderRegistry destroyed-doc guard", () => {
	function oneDevice() {
		const flushed: Record<string, string> = {};
		const reg = new ProviderRegistry({
			dbPrefix: "devGuard",
			send: () => true,
			onFlushToDisk: (id, content) => {
				flushed[id] = content;
			},
		});
		return { reg, flushed };
	}

	test("applyLocalEdit on a removed note bails (does not resurrect)", async () => {
		const { reg } = oneDevice();
		await reg.applyLocalEdit("gone.md", "original"); // materialize
		await flush();
		await reg.removeDoc("gone.md"); // delete
		// A late edit for the just-deleted note must not re-create + re-seed it.
		const result = await reg.applyLocalEdit("gone.md", "resurrected");
		expect(result).toBeNull();
		expect(reg.hasDoc("gone.md")).toBe(false);
	});

	test("applyRemoteUpdate on a removed note does not flush it back to disk", async () => {
		const { reg, flushed } = oneDevice();
		await reg.applyLocalEdit("gone.md", "original");
		await flush();
		await reg.removeDoc("gone.md");
		// A late fan-out update for the deleted note must not resurrect the file.
		const scratch = new YDoc.Doc();
		scratch.getText("content").insert(0, "resurrected body");
		await reg.applyRemoteUpdate("gone.md", YDoc.encodeStateAsUpdate(scratch));
		await flush();
		expect(flushed["gone.md"]).toBeUndefined();
		expect(reg.hasDoc("gone.md")).toBe(false);
	});

	test("closeDoc evicts a FULLY-SYNCED idle doc; content rehydrates on next access", async () => {
		const { A, B } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);
		await A.applyLocalEdit("idle.md", "persistent content");
		await A.startSync("idle.md"); // advertise -> B replies syncStep2 -> A.synced
		await waitFor(() => A.isSynced("idle.md"), "A synced with B");
		expect(A.hasDoc("idle.md")).toBe(true);
		A.closeDoc("idle.md"); // fully synced -> safe to evict
		await flush();
		expect(A.hasDoc("idle.md")).toBe(false);
		// Not tombstoned — re-access rehydrates from IndexedDB (no data loss).
		expect(await A.getText("idle.md")).toBe("persistent content");
		expect(A.hasDoc("idle.md")).toBe(true);
		await A.destroyAll();
		await B.destroyAll();
	});

	test("closeDoc does NOT evict a doc with unsent offline edits (switch-away durability)", async () => {
		const { A } = twoDevices(); // A never connects
		await A.applyLocalEdit("offline.md", "offline edit");
		await A.startSync("offline.md"); // buffers (not connected -> not synced)
		await flush();
		A.closeDoc("offline.md");
		await flush();
		// Stays resident so the buffered edit re-advertises on reconnect.
		expect(A.hasDoc("offline.md")).toBe(true);
		await A.destroyAll();
	});
});

describe("ProviderRegistry (Relay-model engine)", () => {
	test("genesis edit on A syncs to B and flushes B's disk (no text-verify)", async () => {
		const { A, B, flushedB } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);

		// A is the origin of a brand-new note: applyLocalEdit seeds (empty doc).
		await A.applyLocalEdit("n1", "hello from A");
		await A.startSync("n1"); // advertise (a live edit normally rides an open note)
		await flush();

		// B adopted A's lineage via syncStep2 (never seeded); the remote merge
		// flushed to B's disk.
		expect(await B.getText("n1")).toBe("hello from A");
		expect(flushedB.n1).toContain("hello from A");
		await A.destroyAll();
		await B.destroyAll();
	});

	test("reconnect re-advertises via syncStep1 and does NOT double content", async () => {
		const dev = twoDevices();
		const { A, B } = dev;
		A.setConnected(true);
		B.setConnected(true);
		await A.applyLocalEdit("n2", "base");
		await A.startSync("n2");
		await flush();
		expect(await B.getText("n2")).toBe("base");

		// Socket drops on A. A edits offline (held in the provider buffer).
		dev.setUp(false);
		A.setConnected(false);
		const aDoc = await A.getDoc("n2");
		aDoc.getText("content").insert(4, " + offline");
		await flush();
		expect(await B.getText("n2")).toBe("base"); // B hasn't seen it

		// Reconnect: syncStep1 + buffered flush. Convergence must NOT double.
		dev.setUp(true);
		A.setConnected(true);
		B.setConnected(true);
		await flush();

		expect(await A.getText("n2")).toBe("base + offline");
		expect(await B.getText("n2")).toBe("base + offline");
		await A.destroyAll();
		await B.destroyAll();
	});

	test("adopt-first: a note whose disk bytes are already synced is NOT re-seeded", async () => {
		let synced = false;
		const reg = new ProviderRegistry({
			dbPrefix: "devAdopt",
			send: () => true,
			onFlushToDisk: () => {},
			isUnchangedSynced: (_id, content) => synced && content === "server body",
		});
		reg.setConnected(true);
		// The server already holds "server body"; the adopt-first gate must decline
		// to seed a second lineage — the doc stays empty (adopts via STEP2).
		synced = true;
		const consumed = await reg.applyLocalEdit("n3", "server body");
		expect(consumed).toBe("server body"); // "handled, nothing to push"
		expect(await reg.hasHistory("n3")).toBe(false); // never seeded
		await reg.destroyAll();
	});

	test("reset clears the synced mark so a re-handshake re-confirms (heal-room release)", async () => {
		// The diverged-cold-note heal is reset+enroll; its release fires from
		// onSynced on the re-handshake's syncStep2. The provider fires onSynced only
		// on the FIRST syncStep2, so reset must clear synced or the heal room never
		// releases (e2e wait_for_room_free timeout).
		const { A, B } = twoDevices();
		A.setConnected(true);
		B.setConnected(true);
		await A.applyLocalEdit("n4", "base");
		await A.startSync("n4");
		await B.startSync("n4"); // B enrolls → syncStep1/2 → synced
		await waitFor(() => B.isSynced("n4"), "B synced with A");
		expect(B.isSynced("n4")).toBe(true);

		B.reset("n4");
		expect(B.isSynced("n4")).toBe(false); // the fix: reset invalidates the mark

		await B.startSync("n4"); // re-handshake
		await waitFor(() => B.isSynced("n4"), "B re-synced after reset");
		expect(B.isSynced("n4")).toBe(true); // re-confirmed → onSynced re-fired
		await A.destroyAll();
		await B.destroyAll();
	});
});

// ---------------------------------------------------------------------------
// enrolledIds must not outlive the doc (repo-review 2026-08). destroy paths
// previously left the id enrolled forever: the removed-implies-not-enrolled
// invariant WARNed every sweep and the e2e `enrolled` probe lied. The guard
// lives at the choke point so no caller has to remember the removeDoc+reset
// pair.
// ---------------------------------------------------------------------------

describe("enrollment cleared on teardown", () => {
	function oneDevice() {
		return new ProviderRegistry({
			dbPrefix: "devEnroll",
			send: () => true,
			onFlushToDisk: () => {},
		});
	}

	test("removeDoc clears the note's enrollment", async () => {
		const reg = oneDevice();
		await reg.applyLocalEdit("note.md", "body");
		reg.enroll("note.md");
		expect(reg.enrolled.has("note.md")).toBe(true);
		await reg.removeDoc("note.md");
		expect(reg.enrolled.has("note.md")).toBe(false);
	});

	test("destroyAll leaves no enrollments behind", async () => {
		const reg = oneDevice();
		await reg.applyLocalEdit("a.md", "a");
		await reg.applyLocalEdit("b.md", "b");
		reg.enroll("a.md");
		reg.enroll("b.md");
		await reg.destroyAll();
		expect(reg.enrolled.size).toBe(0);
	});
});

describe("hasAnyHistoryTransient residency", () => {
	function oneDevice(prefix: string) {
		return new ProviderRegistry({
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: () => true,
		});
	}

	// The #1409 genesis gate asks this about EVERY note in a first sync. The
	// plain `hasAnyHistory` routes through `entry()`, which is the one place a
	// doc comes into existence, and this registry has no LRU — so the probe
	// alone pinned a Y.Doc + an open IndexedDB connection per note and OOM'd
	// the Obsidian renderer on a large vault.
	test("probing a cold note leaves no resident doc behind", async () => {
		const reg = oneDevice("devTransientCold");

		expect(reg.hasDoc("cold.md")).toBe(false);
		const has = await reg.hasAnyHistoryTransient("cold.md");

		expect(has).toBe(false);
		expect(reg.hasDoc("cold.md")).toBe(false);
	});

	test("probing many cold notes does not grow residency", async () => {
		const reg = oneDevice("devTransientBulk");

		for (let i = 0; i < 50; i++) await reg.hasAnyHistoryTransient(`bulk-${i}.md`);

		// The leak this pins is proportional to notes probed, so a count is the
		// assertion — one stray retained doc is the same bug, just slower.
		const resident = Array.from({ length: 50 }, (_, i) => `bulk-${i}.md`).filter((id) =>
			reg.hasDoc(id),
		);
		expect(resident).toEqual([]);
	});

	// The gate's whole purpose: a note this device already has lineage for must
	// NOT be answered `false`, or it ships a rival-lineage genesis frame and the
	// server unions two lineages into doubled content (#846).
	test("still reports history for a note this device has edited", async () => {
		const reg = oneDevice("devTransientWarm");

		await reg.applyLocalEdit("warm.md", "some real content");
		await flush();

		expect(await reg.hasAnyHistoryTransient("warm.md")).toBe(true);
	});

	// A doc that was ALREADY resident (e.g. an open editor) must survive the
	// probe — tearing that down is the switch-away data-loss class.
	test("leaves an already-resident doc alone", async () => {
		const reg = oneDevice("devTransientResident");

		await reg.applyLocalEdit("open.md", "bound content");
		await flush();
		expect(reg.hasDoc("open.md")).toBe(true);

		await reg.hasAnyHistoryTransient("open.md");

		expect(reg.hasDoc("open.md")).toBe(true);
	});
});

// #483, third defect. The teardown flushes (CrdtLiveViews.onLastViewerRelease
// and .destroy()) wrote `getText`/`residentText` — the body Y.Text ALONE.
// Frontmatter lives in separate shared types, so closing a note, or quitting
// with one open, rewrote its file with no `---` block at all.
//
// The damage is quiet and it escalates. The Y.Doc keeps its frontmatter, so the
// web app keeps showing the keys and nothing looks wrong until the file is
// reopened. Worse, `flushFromCrdt` banks the body-only hash as the baseline, so
// `pushFile`'s echo filter drops the modify event it just caused — the loss
// stays local. The NEXT edit to that note hashes differently, gets through, and
// `seedContentInto` reads a fenceless file as "the user removed all properties"
// and deletes them server-side, on every device.
//
// These pin the accessor contract that made the misuse possible: two neighbours
// on one object, one body-only and one whole-file, distinguishable by name only.
describe("teardown projection includes frontmatter (#483)", () => {
	function oneDevice(prefix: string) {
		return new ProviderRegistry({
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: () => {},
		});
	}

	const WITH_FM = "---\nstatus: published\nkeep: me\n---\n\nbody v1\n";

	test("projectedText round-trips the frontmatter block; getText is body-only", async () => {
		const reg = oneDevice("devProjectFm");
		await reg.applyLocalEdit("fm.md", WITH_FM);
		await flush();

		// What the teardown flush writes now.
		expect(await reg.projectedText("fm.md")).toBe(WITH_FM);

		// What it used to write. getText is not wrong, it is just not a file —
		// this asserts the difference is real so the two never look equivalent.
		const body = await reg.getText("fm.md");
		expect(body).toBe("\nbody v1\n");
		expect(body).not.toContain("status:");
	});

	test("residentProjection matches projectedText, synchronously", async () => {
		const reg = oneDevice("devResidentFm");
		await reg.applyLocalEdit("fm.md", WITH_FM);
		await flush();

		// destroy() cannot await: its caller destroys the manager immediately
		// after it returns. Same output, no await.
		expect(reg.residentProjection("fm.md")).toBe(await reg.projectedText("fm.md"));
		expect(reg.residentProjection("fm.md")).toContain("status: published");
	});

	test("a note with no frontmatter projects unchanged (no stray fence)", async () => {
		const reg = oneDevice("devNoFm");
		await reg.applyLocalEdit("plain.md", "just a body\n");
		await flush();

		expect(reg.residentProjection("plain.md")).toBe("just a body\n");
		expect(await reg.projectedText("plain.md")).toBe("just a body\n");
	});
});

// ---------------------------------------------------------------------------
// #1493: room-free delivery removed the room on the way UP and the note asked
// for one straight back, because `synced` is one flag carrying two facts —
// "the server has my ops" and "I hold the server's state". The room handshake
// establishes both at once, so nothing ever had to separate them; a
// `crdt_doc_update` establishes only the first. The receipt is that missing
// half, and nothing else: it must never imply the second.
// ---------------------------------------------------------------------------
describe("room-free delivery receipt (#1493)", () => {
	/** The exact state a room-free delivery starts from: the transport ACCEPTS
	 *  frames (so nothing is stuck in the provider's offline buffer), but no
	 *  syncStep2 ever comes back, so `synced` stays false and the note reads as
	 *  undelivered. `send: () => false` would be wrong here — it buffers every
	 *  frame, and a buffered frame correctly vetoes the receipt. */
	function unhandshookDevice(prefix: string) {
		const reg = new ProviderRegistry({
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: () => {},
		});
		// CONNECTED, or the provider buffers instead of sending and a buffered
		// frame correctly vetoes the receipt.
		reg.setConnected(true);
		return reg;
	}

	test("an acked delivery stops the note demanding a room", async () => {
		const reg = unhandshookDevice("receipt-ack");
		await reg.applyLocalEdit("n1", "hello");
		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(false);

		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));

		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(true);
	});

	test("an INSERT after the delivery voids the receipt", async () => {
		const reg = unhandshookDevice("receipt-insert");
		await reg.applyLocalEdit("n1", "hello");
		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));

		await reg.applyLocalEdit("n1", "hello world");

		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(false);
	});

	test("a DELETE after the delivery voids the receipt", async () => {
		// THE case a state vector cannot see. `Y.encodeStateVector` encodes
		// clientID -> clock of structs a client CREATED; a delete advances no
		// clock, so the vector is byte-identical afterwards (measured). A receipt
		// built on one would report this note delivered, the next catch-up would
		// take the read-only converge path, and the DELETION would be stamped
		// in-sync and never transmitted. Permanently. Hence a snapshot.
		const reg = unhandshookDevice("receipt-delete");
		await reg.applyLocalEdit("n1", "secret note");
		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));
		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(true);

		await reg.applyLocalEdit("n1", "");

		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(false);
	});

	test("a PARTIAL delete voids the receipt", async () => {
		const reg = unhandshookDevice("receipt-partial-delete");
		await reg.applyLocalEdit("n1", "keep this, drop that");
		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));

		await reg.applyLocalEdit("n1", "keep this");

		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(false);
	});

	test("a receipt does NOT claim we hold the server's state", async () => {
		// The whole reason `markSynced` was the wrong instrument. A receipt says
		// the server received us; it must not mark the doc synced, because that
		// is what licenses committing convergence at a serverHash whose content
		// was never applied — the deaf-note class.
		const reg = unhandshookDevice("receipt-not-synced");
		await reg.applyLocalEdit("n1", "hello");

		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));

		expect(reg.isSynced("n1")).toBe(false);
	});

	test("a receipt does NOT relax hasUndeliveredOps — the destructive paths keep their answer", async () => {
		// hasUndeliveredOps gates the drift keep-both copy and the empty-placeholder
		// overwrite, where it means "would tearing this down destroy something".
		// A receipt does not answer that: the doc still holds the only copy the
		// room path would re-advertise. Folding the receipt into this predicate
		// would trade a wasted room for a lost file.
		const reg = unhandshookDevice("receipt-not-destructive");
		await reg.applyLocalEdit("n1", "hello");

		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));

		expect(reg.hasUndeliveredOps("n1")).toBe(true);
	});

	test("a BUFFERED frame vetoes the receipt", async () => {
		// `buffer.length > 0` is a hard fact about frames that never reached the
		// transport — unlike `synced`, which is only a handshake proxy. No ack for
		// the doc's state can speak for a frame that went nowhere, so the receipt
		// must not override it.
		const reg = new ProviderRegistry({
			dbPrefix: "receipt-buffered",
			send: () => true,
			onFlushToDisk: () => {},
		});
		// NOT setConnected(true): the provider buffers instead of sending.
		await reg.applyLocalEdit("n1", "hello");
		expect(reg.docs.get("n1")?.provider.hasBufferedFrames()).toBe(true);

		reg.markDelivered("n1", await reg.encodeDeliveryReceipt("n1"));

		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(false);
	});

	test("a receipt for an unknown note is a no-op, not a throw", async () => {
		const reg = unhandshookDevice("receipt-unknown");
		await reg.applyLocalEdit("n1", "hello");
		const receipt = await reg.encodeDeliveryReceipt("n1");
		reg.markDelivered("n1", receipt);

		reg.markDelivered("gone", receipt);

		// Asserted on the RECEIPT query, not hasUndeliveredOps — the latter
		// returns false for any unknown note whether or not markDelivered ran,
		// so it could not tell a no-op from a recorded receipt.
		expect(reg.hasCurrentDeliveryReceipt("gone")).toBe(false);
		expect(reg.hasCurrentDeliveryReceipt("n1")).toBe(true);
	});
});
