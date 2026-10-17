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
import { expect, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import { type CrdtWiring, createCrdtWiring } from "../../src/crdt/wiring";
import { noteRef } from "../../src/note-ref";
import { rlog } from "../../src/remote-log";

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
function makeDevice(
	id: string,
	reconcile: () => number,
	opts?: {
		flushFromCrdt?: (path: string, content: string) => Promise<boolean>;
		/** Whether the engine's heal enqueued a fetch (false = a no-op ensure). */
		ensure?: (id: string) => boolean;
		/** The engine will never fetch for this id (refused / deleted here). */
		refuses?: (id: string) => boolean;
		/** Runs inside each heal wait, before the manifest step. */
		duringWait?: () => void;
		idMapEra?: () => number;
		isSyncBlocked?: () => boolean;
		whenGateOpens?: () => Promise<void>;
		/** Whether the heal's wait saw a fetch answer (false = timed out). */
		answered?: () => boolean;
		/** Records each awaitNoteIdMapped call's options. */
		waitOpts?: unknown[];
	},
): Device {
	const map = new NoteIdMap();
	const disk = new Map<string, string>();
	const flushedPaths: string[] = [];
	const relayTo = { send: (_docId: string, _frame: string) => {} };

	const syncEngine = {
		flushFromCrdt:
			opts?.flushFromCrdt ??
			(async (path: string, content: string) => {
				disk.set(path, content);
				flushedPaths.push(path);
				return true;
			}),
		// Real one folds disk drift in first; these scenarios have none.
		flushStrandedNote: async (path: string, noteId: string) =>
			syncEngine.flushFromCrdt(path, await wiring.manager.projectedText(noteId)),
		isUnchangedSynced: () => false,
		materializeEmptyDiscovered: async (path: string) => {
			disk.set(path, "");
		},
		isSyncBlocked: () => opts?.isSyncBlocked?.() ?? false,
		whenGateOpens: () => opts?.whenGateOpens?.() ?? Promise.resolve(),
		// Live id-map heal (announce/#955 note_not_found). The scenarios drive
		// the manifest explicitly: the trigger is a no-op, and the strand-heal's
		// wait is where `reconcile` (the manifest) teaches the map.
		ensureNoteIdMapped: (id: string) => opts?.ensure?.(id) ?? true,
		idMapRefuses: (id: string) => opts?.refuses?.(id) ?? false,
		awaitNoteIdMapped: async (_id: string, waitOpts?: unknown) => {
			opts?.waitOpts?.push(waitOpts);
			opts?.duringWait?.();
			reconcile();
			return opts?.answered?.() ?? true;
		},
		idMapEra: () => opts?.idMapEra?.() ?? 0,
		discoverAnnouncedNote: async () => {},
		// Fix wave 1: CrdtManager's onSynced fires this on every non-empty
		// inbound frame. These device-pair scenarios don't exercise the D3
		// live-bound staging path, so a no-op is enough.
		commitCrdtConvergence: async () => {},
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

	// Provider model: a device is "online" — the provider only sends frames while
	// connected (production fires this on the crdt: topic join). The in-memory
	// relay stands in for the fan-out below the WS layer, so both devices are
	// always connected here.
	wiring.manager.setConnected(true);

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
		await d.wiring.manager.destroyAll();
	}
}

// Vault-channel fan-out: onCrdtDocReady must NOT open a room for an idle note.
// Pre-fan-out, every crdt_doc_ready announce enrolled the note on every device
// (the connect-storm). Now an idle note converges over the note_yjs_update
// broadcast; only a live-bound (open) note enrolls. Enrollment fires STEP1 via
// sendCrdt, so a STEP1 frame is the observable "a room was opened" signal.
function fanoutStubEngine() {
	return {
		flushFromCrdt: async () => {},
		flushStrandedNote: async () => true,
		isUnchangedSynced: () => false,
		materializeEmptyDiscovered: async () => {},
		reconcileNoteIdMapFromManifest: async () => 0,
		isSyncBlocked: () => false,
		ensureNoteIdMapped: () => {},
		awaitNoteIdMapped: async () => {},
		idMapEra: () => 0,
		applyPushedNoteUpdate: async () => {},
		discoverAnnouncedNote: async () => {},
	};
}

test("onCrdtDocReady does NOT enroll an idle (unbound) note — fan-out delivers it", async () => {
	const map = new NoteIdMap();
	map.set("Idle.md", "id-idle");
	const sent: string[] = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: fanoutStubEngine(),
		sendCrdt: (docId) => sent.push(docId),
		isBound: () => false, // idle — not open in any editor
		strandHealDebounceMs: 100_000,
		dbPrefix: "docready-idle",
	});

	wiring.onCrdtDocReady("id-idle");
	await sleep(50);

	// No STEP1 frame → no room opened. The note stays room-free.
	expect(sent).not.toContain("id-idle");

	wiring.dispose();
	await wiring.manager.destroyAll();
});

test("onCrdtDocReady DOES enroll a live-bound (open) note", async () => {
	const map = new NoteIdMap();
	map.set("Open.md", "id-open");
	const sent: string[] = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: fanoutStubEngine(),
		sendCrdt: (docId) => sent.push(docId),
		isBound: () => true, // note open in the editor
		strandHealDebounceMs: 100_000,
		dbPrefix: "docready-open",
	});
	wiring.manager.setConnected(true); // online — enroll can send STEP1

	wiring.onCrdtDocReady("id-open");
	await waitFor(() => sent.includes("id-open"), "STEP1 sent for the open note's room");

	wiring.dispose();
	await wiring.manager.destroyAll();
});

test("onCrdtDocReady with a path triggers per-note discovery (empty-note, test_27)", async () => {
	// An empty note's genesis emits crdt_doc_ready with a path but ZERO Y.Doc ops
	// (no note_yjs_update fan-out), so the announce path is the only immediate
	// signal. The handler must kick discoverAnnouncedNote so the empty note
	// materializes in seconds instead of ~30s later via the level pull.
	const map = new NoteIdMap();
	const discovered: Array<[string, string]> = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: {
			...fanoutStubEngine(),
			discoverAnnouncedNote: async (id: string, p: string) => {
				discovered.push([id, p]);
			},
		},
		sendCrdt: () => {},
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "docready-discover",
	});

	wiring.onCrdtDocReady("id-empty", "Notes/Empty.md");
	await waitFor(() => discovered.length > 0, "discoverAnnouncedNote called");

	expect(discovered).toEqual([["id-empty", "Notes/Empty.md"]]);

	wiring.dispose();
	await wiring.manager.destroyAll();
});

test("onCrdtDocReady WITHOUT a path does not trigger discovery (pre-path backend)", async () => {
	const map = new NoteIdMap();
	map.set("Idle.md", "id-idle");
	const discovered: string[] = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: {
			...fanoutStubEngine(),
			discoverAnnouncedNote: async (id: string) => {
				discovered.push(id);
			},
		},
		sendCrdt: () => {},
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "docready-nopath",
	});

	wiring.onCrdtDocReady("id-idle");
	await sleep(50);

	expect(discovered).toEqual([]); // no path on the announce → no discovery

	wiring.dispose();
	await wiring.manager.destroyAll();
});

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
		awaitNoteIdMapped: async () => {},
		idMapEra: () => 0,
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
	await wiring.manager.destroyAll();
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

test("onCrdtMessage with a malformed frame logs a warn instead of an unhandled rejection", async () => {
	const dev = makeDevice("GARBAGE", () => 0);
	const warnSpy = spyOn(rlog(), "warn");

	// Not valid base64 / not a valid yjs frame — handleFrame rejects. The wiring
	// must catch it (log + drop the frame), never leak an unhandled rejection.
	dev.wiring.onCrdtMessage("bad-frame-id", "!!!not-a-frame!!!");

	// Poll rather than `sleep(20)`. The rejection is caught and logged
	// asynchronously, so a fixed window is a bet on scheduler latency that a
	// loaded CI runner loses.
	const matching = () =>
		(warnSpy.mock.calls as unknown as [string, string][]).filter(([, m]) =>
			m?.includes("bad-frame-id"),
		);
	await waitFor(() => matching().length > 0, "warn logged for the malformed frame");

	// Match on OUR call, not the last one. `rlog()` is a module-level singleton,
	// so the spy sees every warn in the process — a room draining or a peer
	// reconnecting nearby would take the last slot and this would assert against
	// someone else's message.
	const [category, message] = matching()[0];
	expect(category).toBe("crdt");
	expect(message).toContain("bad-frame-id");

	warnSpy.mockRestore();
	await destroy(dev);
});

test("a refused stranded-flush disk write is logged, not silently dropped", async () => {
	// Same shape as the strand-heal scenario below, but the receiver's
	// flushFromCrdt REFUSES the write (returns false — e.g. the empty-over-content
	// gate). Pre-fix: `void syncEngine.flushFromCrdt(...)` discarded the result,
	// so content stranded in the Y.Doc with zero observability.
	const noteId = "note-failflush";
	const a = makeDevice("FA", () => 0);
	const b = makeDevice(
		"FB",
		() => {
			b.map.set("FB/fail.md", noteId);
			return 1;
		},
		{ flushFromCrdt: async () => false },
	);
	connect(a, b);

	a.map.set("FA/new.md", noteId);
	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, "refused body", false);

	b.wiring.onCrdtDocReady(noteId);
	await waitFor(
		async () => (await b.wiring.manager.getText(noteId)) === "refused body",
		"B integrates body into the Y.Doc",
	);

	const warnSpy = spyOn(rlog(), "warn");
	await b.wiring.drainStrandedFlushes();
	await sleep(20); // let the (un-awaited) flush promise settle

	const warns = warnSpy.mock.calls as unknown as Array<[string, string]>;
	// The note is named by its opaque ref, never its path — a folder name is
	// the most revealing thing this plugin knows, and log lines leave the
	// device. The assertion still pins WHICH note, which is what it was for.
	expect(warns.some(([cat, msg]) => cat === "crdt" && msg.includes(noteRef("FB/fail.md")))).toBe(
		true,
	);
	expect(warns.some(([, msg]) => msg.includes("FB/fail.md"))).toBe(false);

	warnSpy.mockRestore();
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
	await waitFor(async () => b.disk.has("B/discovered.md"), "the healed flush lands");

	expect(b.disk.get("B/discovered.md")).toBe("stranded body");
	expect(b.flushedPaths).toEqual(["B/discovered.md"]);

	await destroy(a, b);
});

test("a no-op heal (gate closed) does not burn the strand-heal attempts", async () => {
	const noteId = "note-gated";
	let gateOpen = false;
	const a = makeDevice("GA", () => 0);
	const b = makeDevice(
		"GB",
		() => {
			if (!gateOpen) return 0; // no fetch behind a closed gate
			b.map.set("GB/gated.md", noteId);
			return 1;
		},
		{
			ensure: () => gateOpen,
			isSyncBlocked: () => !gateOpen,
			whenGateOpens: () => new Promise<void>(() => {}), // the test drains by hand
		},
	);
	connect(a, b);
	a.map.set("GA/new.md", noteId);
	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, "gated body", false);
	b.wiring.onCrdtDocReady(noteId);
	await waitFor(
		async () => (await b.wiring.manager.getText(noteId)) === "gated body",
		"B integrates the body into the Y.Doc",
	);
	// More drains than STRAND_HEAL_MAX_ATTEMPTS (5) while every ensure is a no-op.
	for (let i = 0; i < 7; i++) await b.wiring.drainStrandedFlushes();
	gateOpen = true;
	await b.wiring.drainStrandedFlushes();
	await waitFor(async () => b.disk.has("GB/gated.md"), "the flush lands once the gate opens");
	await destroy(a, b);
});

async function strandOn(b: Device, a: Device, noteId: string, body: string): Promise<void> {
	connect(a, b);
	a.map.set(`${a.id}/new.md`, noteId);
	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, body, false);
	b.wiring.onCrdtDocReady(noteId);
	await waitFor(
		async () => (await b.wiring.manager.getText(noteId)) === body,
		"B integrates the body into the Y.Doc",
	);
}

test("r9#1 a strand id the heal refuses (gate open) is given up at once, not retried", async () => {
	const a = makeDevice("RA", () => 0);
	const b = makeDevice("RB", () => 0, { ensure: () => false, refuses: () => true }); // refused / recently deleted
	await strandOn(b, a, "note-refused", "refused body");
	const warn = spyOn(rlog(), "warn");
	try {
		await b.wiring.drainStrandedFlushes();
		await b.wiring.drainStrandedFlushes();
		const msgs = (warn.mock.calls as unknown as Array<[string, string]>).map(([, m]) => m);
		expect(msgs.filter((m) => m.includes("retrying"))).toEqual([]);
		expect(msgs.filter((m) => m.includes("giving up on note_id=note-refused")).length).toBe(1);
	} finally {
		warn.mockRestore();
		await destroy(a, b);
	}
});

test("r9#1 a closed gate pauses the strand heal quietly and resumes it when the gate opens", async () => {
	let blocked = true;
	let open: () => void = () => {};
	const gate = new Promise<void>((r) => {
		open = r;
	});
	const a = makeDevice("PA", () => 0);
	const b = makeDevice(
		"PB",
		() => {
			if (blocked) return 0;
			b.map.set("PB/paused.md", "note-paused");
			return 1;
		},
		{ ensure: () => !blocked, isSyncBlocked: () => blocked, whenGateOpens: () => gate },
	);
	await strandOn(b, a, "note-paused", "paused body");
	const warn = spyOn(rlog(), "warn");
	try {
		for (let i = 0; i < 7; i++) await b.wiring.drainStrandedFlushes();
		expect(warn.mock.calls.length).toBe(0);
		blocked = false;
		open();
		await waitFor(async () => b.disk.has("PB/paused.md"), "the heal resumes on gate open");
	} finally {
		warn.mockRestore();
		await destroy(a, b);
	}
});

test("r9#4 the strand heal waits on the non-urgent path (no fan-out probe)", async () => {
	const waitOpts: unknown[] = [];
	const a = makeDevice("UA", () => 0);
	const b = makeDevice(
		"UB",
		() => {
			b.map.set("UB/u.md", "note-u");
			return 1;
		},
		{ waitOpts },
	);
	await strandOn(b, a, "note-u", "u body");
	await b.wiring.drainStrandedFlushes();
	expect(waitOpts).toEqual([{ urgent: false }]);
	await destroy(a, b);
});

test("r9#5 a strand wait no fetch answered does not burn an attempt", async () => {
	let up = false;
	const a = makeDevice("TA", () => 0);
	const b = makeDevice(
		"TB",
		() => {
			if (!up) return 0;
			b.map.set("TB/t.md", "note-t");
			return 1;
		},
		{ answered: () => up },
	);
	await strandOn(b, a, "note-t", "t body");
	for (let i = 0; i < 7; i++) await b.wiring.drainStrandedFlushes(); // an outage
	up = true;
	await b.wiring.drainStrandedFlushes();
	await waitFor(async () => b.disk.has("TB/t.md"), "the flush lands after the outage");
	await destroy(a, b);
});

test("r10#1 a gate closing during the wait re-parks every id from the cycle", async () => {
	let blocked = false;
	let closedOnce = false;
	let reopened = false;
	let open: () => void = () => {};
	const gate = new Promise<void>((r) => {
		open = r;
	});
	const a = makeDevice("KA", () => 0);
	const b = makeDevice(
		"KB",
		() => {
			if (blocked) return 0;
			b.map.set("KB/one.md", "note-one");
			b.map.set("KB/two.md", "note-two");
			return 2;
		},
		{
			// note-two is parked as never listed: no fetch this cycle, not terminal
			ensure: (id) => id !== "note-two" || reopened,
			isSyncBlocked: () => blocked,
			whenGateOpens: () => gate,
			duringWait: () => {
				if (closedOnce) return;
				closedOnce = true;
				blocked = true; // the gate closes while the first heal waits
			},
		},
	);
	await strandOn(b, a, "note-one", "one body");
	await strandOn(b, a, "note-two", "two body");
	await b.wiring.drainStrandedFlushes();
	blocked = false;
	reopened = true;
	open();
	await waitFor(
		async () => b.disk.has("KB/one.md") && b.disk.has("KB/two.md"),
		"both ids heal once the gate reopens",
	);
	await destroy(a, b);
});

test("r10#2 an id parked as never listed is retried, not given up", async () => {
	let listed = false;
	const a = makeDevice("MA", () => 0);
	const b = makeDevice(
		"MB",
		() => {
			if (!listed) return 0;
			b.map.set("MB/m.md", "note-m");
			return 1;
		},
		{ ensure: () => listed },
	);
	await strandOn(b, a, "note-m", "m body");
	await b.wiring.drainStrandedFlushes(); // nothing fetched: parked in the engine
	listed = true;
	await b.wiring.drainStrandedFlushes();
	await waitFor(async () => b.disk.has("MB/m.md"), "the retried id heals");
	await destroy(a, b);
});

test("r10#3 an id that never maps is given up after a bounded number of drains, with one warning", async () => {
	const a = makeDevice("NA", () => 0);
	const b = makeDevice("NB", () => 0, { answered: () => false }); // an endless outage
	await strandOn(b, a, "note-never", "never body");
	const warn = spyOn(rlog(), "warn");
	try {
		for (let i = 0; i < 30; i++) await b.wiring.drainStrandedFlushes();
		const msgs = (warn.mock.calls as unknown as Array<[string, string]>).map(([, m]) => m);
		expect(msgs.filter((m) => m.includes("note-never")).length).toBe(1);
		expect(msgs.some((m) => m.includes("giving up on note_id=note-never"))).toBe(true);
	} finally {
		warn.mockRestore();
		await destroy(a, b);
	}
});

test("r10#4 a wiring disposed during the heal wait does nothing after it", async () => {
	let wiring: CrdtWiring | null = null;
	const a = makeDevice("DA", () => 0);
	const b = makeDevice(
		"DB",
		() => {
			b.map.set("DB/d.md", "note-d");
			return 1;
		},
		{ duringWait: () => wiring?.dispose() },
	);
	wiring = b.wiring;
	await strandOn(b, a, "note-d", "d body");
	await b.wiring.drainStrandedFlushes();
	await sleep(20);
	expect(b.disk.size).toBe(0);
	await a.wiring.manager.destroyAll();
	await b.wiring.manager.destroyAll();
});

test("a vault switch during the strand-heal wait aborts the drain", async () => {
	const noteId = "note-switch";
	let era = 0;
	const a = makeDevice("SA", () => 0);
	const b = makeDevice(
		"SB",
		() => {
			b.map.set("SB/switch.md", noteId); // the wait returns, but in a new vault
			era++;
			return 1;
		},
		{ idMapEra: () => era },
	);
	connect(a, b);
	a.map.set("SA/new.md", noteId);
	a.wiring.manager.markSynced(noteId);
	await a.wiring.manager.applyLocalEdit(noteId, "old vault body", false);
	b.wiring.onCrdtDocReady(noteId);
	await waitFor(
		async () => (await b.wiring.manager.getText(noteId)) === "old vault body",
		"B integrates the body into the Y.Doc",
	);
	await b.wiring.drainStrandedFlushes();
	await sleep(20);
	expect(b.disk.size).toBe(0);
	await destroy(a, b);
});

// #516: a refused live frame hands the edit to the DURABLE queue instead of an
// in-memory "re-enroll on rejoin" set. That set STEP1'd every tracked doc on each
// rejoin — a server room per note, uncapped by the sync gate — and on 2026-09-14
// put ~500 rooms/minute on one prod task. It was also lossy: memory-only and
// capped at 500, so a restart or the 501st held note dropped the recovery.
// The queue survives restarts, respects the sync gate, dedups by path, and
// delivers an idle note room-free (`deliverQueuedOpsRoomFree`).
test("a refused live frame records a durable delivery, not a rejoin enroll", async () => {
	const map = new NoteIdMap();
	const noteId = map.getOrMint("held.md");
	const recorded: string[] = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: {
			flushFromCrdt: async () => true,
			isUnchangedSynced: () => false,
			materializeEmptyDiscovered: async () => {},
			reconcileNoteIdMapFromManifest: async () => 0,
			isSyncBlocked: () => false,
			ensureNoteIdMapped: () => {},
			awaitNoteIdMapped: async () => {},
			idMapEra: () => 0,
			discoverAnnouncedNote: async () => {},
			commitCrdtConvergence: async () => {},
			recordUndeliveredCrdtEdit: (id: string) => recorded.push(id),
		},
		sendCrdt: () => false, // topic not joined: every frame is refused
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "held-edit-durable",
	});
	wiring.manager.setConnected(true);

	await wiring.manager.applyLocalEdit(noteId, "edited while offline\n");
	await sleep(30);

	expect(recorded).toContain(noteId);
	expect("reEnrollUnsent" in wiring).toBe(false);

	wiring.dispose();
	await wiring.manager.destroyAll();
});

test("a create-gated op frame also records a durable delivery", async () => {
	const map = new NoteIdMap();
	const noteId = map.getOrMint("unacked.md");
	const recorded: string[] = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: {
			flushFromCrdt: async () => true,
			isUnchangedSynced: () => false,
			materializeEmptyDiscovered: async () => {},
			reconcileNoteIdMapFromManifest: async () => 0,
			isSyncBlocked: () => false,
			ensureNoteIdMapped: () => {},
			awaitNoteIdMapped: async () => {},
			idMapEra: () => 0,
			discoverAnnouncedNote: async () => {},
			commitCrdtConvergence: async () => {},
			recordUndeliveredCrdtEdit: (id: string) => recorded.push(id),
		},
		sendCrdt: () => true,
		canSendLive: () => false, // server row not acked yet
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "held-edit-create-gate",
	});
	wiring.manager.setConnected(true);

	await wiring.manager.applyLocalEdit(noteId, "typed before the create-ack\n");
	await sleep(30);

	expect(recorded).toContain(noteId);

	wiring.dispose();
	await wiring.manager.destroyAll();
});

// #1130: the create-ack gate that production actually runs lives in THIS file's
// `send` closure (main.ts passes `canSendLive` to createCrdtWiring; the wiring
// never forwards it to ProviderRegistry, whose own `canSendLive` opt is a
// test/sim-only seam). Every other gate test drives that second seam, so a
// regression here would ship green. This pins the shipped one: a doc the gate
// holds must still get its syncStep1 out, while its ops stay held.
test("wiring gate: syncStep1 reaches sendCrdt for a held doc, ops do not", async () => {
	const map = new NoteIdMap();
	const noteId = "019fa000-0000-7000-8000-00000000d130";
	map.set("Held.md", noteId);

	const sent: string[] = [];
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: {
			flushFromCrdt: async () => true,
			isUnchangedSynced: () => false,
			materializeEmptyDiscovered: async () => {},
			reconcileNoteIdMapFromManifest: async () => 0,
			isSyncBlocked: () => false,
			ensureNoteIdMapped: () => {},
			awaitNoteIdMapped: async () => {},
			idMapEra: () => 0,
			discoverAnnouncedNote: async () => {},
			commitCrdtConvergence: async () => {},
			recordUndeliveredCrdtEdit: () => {},
		},
		sendCrdt: (_docId, frame) => {
			sent.push(frame);
			return true;
		},
		isBound: () => false,
		// The production wiring: no crdtHead for this note -> hasServerNote false.
		canSendLive: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "wiring-gate-1130",
	});
	wiring.manager.setConnected(true);

	// A local EDIT is held by the gate — nothing on the wire.
	await wiring.manager.applyLocalEdit(noteId, "an edit before the row exists\n");
	await sleep(20);
	expect(sent).toHaveLength(0);

	// socketConverge's re-handshake: reset + enroll. The syncStep1 MUST get out
	// even though canSendLive is still false, or the note can never converge.
	wiring.enrollment.reset(noteId);
	wiring.enrollment.enroll(noteId);
	await waitFor(() => sent.length > 0, "syncStep1 reached sendCrdt");

	// y-protocols messageSync(0) + messageYjsSyncStep1(0) — the first two
	// varuints, which base64 renders as a leading "AA".
	expect(sent[0].startsWith("AA")).toBe(true);

	wiring.dispose();
	await wiring.manager.destroyAll();
});

// #1550: the repair is only correct if it is actually WIRED. Deleting the call
// in onCrdtNoteNotFound left every other test in this repo green, which is the
// same shape as the mutation that once removed a rate-limit check unnoticed —
// so this pins the wiring itself, not the method.
test("#1550: a note_not_found reply drives the orphaned-claim repair, ahead of the id-map reconcile", async () => {
	const map = new NoteIdMap();
	const noteId = "note-orphan";
	map.set("O/orphan.md", noteId);

	const calls: string[] = [];
	const syncEngine = {
		flushFromCrdt: async () => true,
		isUnchangedSynced: () => false,
		materializeEmptyDiscovered: async () => {},
		reconcileNoteIdMapFromManifest: async () => 0,
		isSyncBlocked: () => false,
		clearPushedBaselineForId: () => calls.push("clearBaseline"),
		repairOrphanedClaim: (id: string) => {
			calls.push(`repair:${id}`);
			return true; // handled — the server said it has no row for this id
		},
		ensureNoteIdMapped: (id: string) => calls.push(`reconcile:${id}`),
		awaitNoteIdMapped: async () => {},
		idMapEra: () => 0,
	};
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine,
		sendCrdt: () => {},
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "orphanclaim",
	});

	wiring.onCrdtNoteNotFound(noteId);

	// The echo baseline must be un-banked first either way, then the repair
	// short-circuits the manifest sweep: that sweep iterates the notes the
	// SERVER lists, so an id the server has never had appears in none of them.
	expect(calls).toEqual(["clearBaseline", `repair:${noteId}`]);

	wiring.dispose();
	await wiring.manager.destroyAll();
});

// Receiver manifest storm (e2e test_77): discovery maps an announced note from
// its path (with the delete/ignore checks); the whole-vault manifest heal is
// only the fallback for an id discovery left unmapped, so it must run AFTER.
test("crdt_doc_ready runs discovery before the id-map heal, and only falls back", async () => {
	const map = new NoteIdMap();
	const calls: string[] = [];
	const syncEngine = {
		flushFromCrdt: async () => true,
		isUnchangedSynced: () => false,
		materializeEmptyDiscovered: async () => {},
		reconcileNoteIdMapFromManifest: async () => 0,
		isSyncBlocked: () => false,
		discoverAnnouncedNote: async (id: string, path: string) => {
			calls.push(`discover:${id}:${path}`);
			if (id === "mapped-by-discovery") map.set(path, id);
		},
		// Like the real engine: a no-op (no fetch) for an id already mapped.
		ensureNoteIdMapped: (...args: unknown[]) => {
			if (map.pathForId(String(args[0])) !== null) return false;
			calls.push(`heal:${args.join(":")}`);
			return true;
		},
		awaitNoteIdMapped: async () => {},
		idMapEra: () => 0,
	};
	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine,
		sendCrdt: () => {},
		isBound: () => false,
		strandHealDebounceMs: 100_000,
		dbPrefix: "announceorder",
	});

	wiring.onCrdtDocReady("mapped-by-discovery", "a.md");
	wiring.onCrdtDocReady("left-unmapped", "b.md");
	wiring.onCrdtDocReady("no-path");
	await new Promise((r) => setTimeout(r, 0));

	expect(calls).toEqual([
		"discover:mapped-by-discovery:a.md",
		"discover:left-unmapped:b.md",
		"heal:no-path",
		"heal:left-unmapped",
	]);

	wiring.dispose();
	await wiring.manager.destroyAll();
});
