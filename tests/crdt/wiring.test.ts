/**
 * Two-device convergence through the REAL main.ts CRDT wiring.
 *
 * Unlike tests/crdt/integration.test.ts — which invented a `device-[AB]/`
 * docId keying and wrote its flush callback straight into a docId-keyed record
 * — this drives `createCrdtWiring` exactly as main.ts does: each device has its
 * OWN real NoteIdMap, resolves the wire's bare note_id to ITS OWN disk path via
 * `pathForId`, and the two wirings are connected by an in-memory frame relay
 * that pipes each side's outbound `sendCrdt` into the other's `onCrdtMessage`.
 * No regex rewriting of doc ids; frames carry whatever the wiring emits.
 *
 * The relay stands in for the backend SharedDoc fan-out and routes BELOW the WS
 * channel layer (the wiring's `sendCrdt` dep IS the relay), so P1's crdt-join
 * gate never applies — a real join ack is not needed for frames to flow here.
 *
 * Covers the three regressions the wiring is where they lived:
 *   1. genesis appears exactly once on the receiver (append-doubling);
 *   2. after a rename is applied to the receiver's map+disk (done here by hand,
 *      NOT via SyncEngine's relocate logic), a later flush resolves the note_id
 *      through the CURRENT path, not a stale one — the flush-time freshness half
 *      of receiver-move-dup (plugin #182). Full rename propagation through
 *      SyncEngine is pinned separately by e2e test_10, not here;
 *   3. an inbound frame for an id the receiver's map doesn't know strands, then
 *      heals via reconcile + retry (the #187 on-strand self-heal).
 */
import { expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import { type CrdtWiring, createCrdtWiring } from "../../src/crdt/wiring";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `cond` holds — the STEP1/STEP2 handshake plus a cold IndexedDB
 *  store open span several async turns, so a fixed sleep is racy. */
async function waitFor(cond: () => boolean | Promise<boolean>, label: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (await cond()) return;
		await sleep(10);
	}
	throw new Error(`waitFor timed out: ${label}`);
}

interface Device {
	id: string;
	map: NoteIdMap;
	/** Disk keyed by PATH (as the real SyncEngine writes it) — NOT by docId. */
	disk: Map<string, string>;
	/** Paths flushFromCrdt was invoked with, in order (proves where flushes land). */
	flushedPaths: string[];
	wiring: CrdtWiring;
	relayTo: { send: (docId: string, frame: string) => void };
}

/** A device: real NoteIdMap + real CrdtManager (via the wiring) + a fake
 *  SyncEngine that records flushes to a path-keyed disk. `reconcile` models the
 *  server manifest — it mutates this device's map and returns the note count. */
function makeDevice(id: string, reconcile: () => number): Device {
	const map = new NoteIdMap();
	const disk = new Map<string, string>();
	const flushedPaths: string[] = [];
	const relayTo = { send: (_docId: string, _frame: string) => {} };

	const syncEngine = {
		flushFromCrdt: async (path: string, content: string) => {
			disk.set(path, content);
			flushedPaths.push(path);
		},
		isUnchangedSynced: () => false,
		materializeEmptyDiscovered: async (path: string) => {
			disk.set(path, "");
		},
		reconcileNoteIdMapFromManifest: async () => reconcile(),
		isSyncBlocked: () => false,
		// Live id-map heal (announce/#955 note_not_found). The scenarios drive
		// the manifest reconcile explicitly, so the coalesced trigger is a no-op.
		ensureNoteIdMapped: () => {},
	};

	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine,
		sendCrdt: (docId, frame) => relayTo.send(docId, frame),
		isBound: () => false,
		// Park the auto heal-timer far out; scenario 3 drives drainStrandedFlushes
		// directly so the heal is deterministic, not clock-dependent.
		strandHealDebounceMs: 100_000,
		dbPrefix: id, // isolate the two devices' IndexedDB stores in one process
	});

	return { id, map, disk, flushedPaths, wiring, relayTo };
}

/** Wire A <-> B: each device's outbound frames land in the other's inbound
 *  `onCrdtMessage`, exactly as the backend fan-out would deliver them. */
function connect(a: Device, b: Device): void {
	a.relayTo.send = (docId, frame) => b.wiring.onCrdtMessage(docId, frame);
	b.relayTo.send = (docId, frame) => a.wiring.onCrdtMessage(docId, frame);
}

async function destroy(...devices: Device[]): Promise<void> {
	for (const d of devices) {
		d.wiring.dispose();
		await d.wiring.manager.destroy();
	}
}

test("#235: a flushFromCrdt write failure rejects applyRemoteUpdate (head stays unadvanced)", async () => {
	// The onFlushToDisk wrapper must propagate a disk-write failure so the
	// manager's applyRemoteUpdate rejects; the caller then leaves crdtHead
	// unadvanced and retries, instead of silently marking the note converged.
	const map = new NoteIdMap();
	const noteId = "note-flushfail";
	map.set("F/fail.md", noteId);
	const syncEngine = {
		// Real flushFromCrdt returns false when the disk write throws.
		flushFromCrdt: async () => false,
		isUnchangedSynced: () => false,
		materializeEmptyDiscovered: async () => {},
		reconcileNoteIdMapFromManifest: async () => 0,
		isSyncBlocked: () => false,
		ensureNoteIdMapped: () => {},
	};
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine,
		sendCrdt: () => {},
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "flushfail",
	});

	const server = new (await import("yjs")).Doc();
	server.getText("content").insert(0, "body that fails to land");
	const update = (await import("yjs")).encodeStateAsUpdate(server);

	await expect(wiring.manager.applyRemoteUpdate(noteId, update)).rejects.toThrow();

	wiring.dispose();
	await wiring.manager.destroy();
});

test("create on A materializes on B with genesis exactly once", async () => {
	const a = makeDevice("A", () => 0);
	const b = makeDevice("B", () => 0);
	connect(a, b);

	// A creates the note; B learned the id->path from a prior pull. Crucially the
	// two paths DIFFER — B must flush to ITS path, resolved through its own map,
	// never A's.
	const noteId = "note-genesis";
	a.map.set("A/genesis.md", noteId);
	b.map.set("B/genesis.md", noteId);

	// A seeds. markSynced first (A is the originator — mirrors the STEP2 that in a
	// real flow establishes A's lineage before it edits).
	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, "genesis", false);

	// The backend announces A's open room to B → B enrolls, sending STEP1; A
	// replies STEP2 carrying the body.
	b.wiring.onCrdtDocReady(noteId);
	await waitFor(() => b.disk.get("B/genesis.md") === "genesis", "B materializes genesis");

	expect(await b.wiring.manager.getText(noteId)).toBe("genesis");
	// Flushed to B's OWN path, resolved via B's NoteIdMap — not A's path.
	expect(b.disk.get("B/genesis.md")).toBe("genesis");
	expect(b.disk.has("A/genesis.md")).toBe(false);
	// Genesis appears exactly once — no append-doubling.
	expect(b.disk.get("B/genesis.md")?.match(/genesis/g)?.length).toBe(1);

	await destroy(a, b);
});

test("rename on A leaves B with exactly one file at the new path", async () => {
	const a = makeDevice("A", () => 0);
	const b = makeDevice("B", () => 0);
	connect(a, b);

	const noteId = "note-rename";
	a.map.set("A/original.md", noteId);
	b.map.set("B/original.md", noteId);

	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, "body v1", false);
	b.wiring.onCrdtDocReady(noteId);
	await waitFor(() => b.disk.get("B/original.md") === "body v1", "B materializes body v1");

	// Rename propagates as a disk move on B: the id is stable (id-keying), so the
	// map renames and the on-disk file moves with it. The CRDT doc_id is untouched.
	b.map.rename("B/original.md", "B/renamed.md");
	b.disk.set("B/renamed.md", b.disk.get("B/original.md") as string);
	b.disk.delete("B/original.md");

	// A edits again AFTER the rename → inbound frame relays to B, whose wiring must
	// resolve the note_id to the CURRENT (new) path only. This pins the flush-time
	// pathForId-freshness half of receiver-move-dup (plugin #182); the rename above
	// is applied directly to B's map+disk, so SyncEngine's relocate logic is NOT
	// exercised here — full rename propagation is covered by e2e test_10.
	await a.wiring.manager.applyLocalEdit(noteId, "body v1 + edit", false);
	await waitFor(
		() => b.disk.get("B/renamed.md") === "body v1 + edit",
		"B flushes post-rename edit to new path",
	);

	expect(await b.wiring.manager.getText(noteId)).toBe("body v1 + edit");
	// Exactly one file, at the new path, with converged content.
	expect([...b.disk.keys()]).toEqual(["B/renamed.md"]);
	expect(b.disk.get("B/renamed.md")).toBe("body v1 + edit");
	// The post-rename flush went to the new path, never the old one.
	expect(a.map.pathForId(noteId)).toBe("A/original.md");
	expect(b.map.pathForId(noteId)).toBe("B/renamed.md");

	await destroy(a, b);
});

test("inbound frame for an unknown id strands, then heals on reconcile", async () => {
	// B's map starts NOT knowing the note. `reconcile` models the manifest fetch
	// that teaches it the id->path mapping (as the real once-per-connect / strand
	// reconcile does), so the retry after heal resolves.
	const noteId = "note-strand";
	const a = makeDevice("A", () => 0);
	const b = makeDevice("B", () => {
		b.map.set("B/discovered.md", noteId);
		return 1;
	});
	connect(a, b);

	a.map.set("A/new.md", noteId);
	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, "stranded body", false);

	// B enrolls and pulls the content, but its map does not know the id yet, so the
	// flush strands (unknown id -> no path). Nothing hits disk.
	b.wiring.onCrdtDocReady(noteId);
	// Content is safe in the Y.Doc meanwhile; the flush strands (no path yet).
	await waitFor(
		async () => (await b.wiring.manager.getText(noteId)) === "stranded body",
		"B integrates stranded body into the Y.Doc",
	);
	expect(b.disk.size).toBe(0);

	// Heal: reconcile teaches B the mapping, then the retry flush lands.
	await b.wiring.drainStrandedFlushes();

	expect(b.disk.get("B/discovered.md")).toBe("stranded body");
	expect(b.flushedPaths).toEqual(["B/discovered.md"]);

	await destroy(a, b);
});
