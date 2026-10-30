/**
 * A note's own create is its base until the create-ack stamps a baseline.
 *
 * The server can hold a note under this device's id with more than this
 * device sent: an MCP edit or another device writing to it while the create's
 * ack is in flight, then a second copy of the create (the orphan repair) or the
 * ack itself landing. Diffing disk onto that two-way reads the other writer's
 * edit as something disk removed and deletes it, on every device, with no
 * conflict copy (fuzz seed 3). These pin the three-way answer: from the body
 * this device sent.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { fnv1a } from "../src/content-hash";
import { merge3 } from "../src/crdt/lca-merge";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

const SENT = "# t0\nA: -\n--\nS: -\n";
/** The server after another writer edited the stored note. */
const SERVER = "# t0\nA: -\n--\nS: s3\n";
/** Disk after a local edit made during the create's round trip. */
const LOCAL_EDIT = "# t0\nA: a2\n--\nS: -\n";
const PATH = "Notes/t0.md";

function makeEngine(disk: string, server: string) {
	const calls = { applyLocalEdit: [] as string[], copies: [] as string[] };
	let doc = "";
	const engine = new SyncEngine(
		{ vault: { cachedRead: mock().mockResolvedValue(disk) } } as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;
	engine.crdt = {
		hasAnyHistory: async () => doc !== "",
		applyLocalEdit: async (_id: string, text: string) => {
			calls.applyLocalEdit.push(text);
			doc = text;
			return text;
		},
		// The genesis apply lands on a doc that already took the other writer's
		// edit (a catch-up won the race); the adopt reads the server's state.
		applyRemoteUpdate: async () => {
			doc = server;
			return true;
		},
		projectedText: async () => doc,
		mergeLocalEditFromBase: async (_id: string, base: string, expected: string, d: string) => {
			if (doc !== expected) return null;
			const m = merge3(base, d, doc);
			if (!m.clean) return null;
			doc = m.text;
			return m.text;
		},
		isCrdtEligible: () => true,
	};
	const map = new NoteIdMap();
	map.set(PATH, "note-1");
	engine.setNoteIdMap(map);
	engine.crdtDocState = async () => ({ b64: "" });
	engine.flushFromCrdt = async () => true;
	engine.writeDriftConflictCopy = async (_p: string, text: string) => {
		calls.copies.push(text);
		return "copy.md";
	};
	return { engine, calls, doc: () => doc };
}

function seed(engine: AnyEngine, outcome: string, genesisContent?: string) {
	return engine.seedBodyAfterCreate({
		effectiveId: "note-1",
		normalized: PATH,
		file: { path: PATH },
		seeded: outcome === "stored",
		sameId: true,
		genesisUpdate: outcome === "stored" ? new Uint8Array([1]) : undefined,
		genesisContent,
		genesisOutcome: outcome,
	});
}

describe("an occupied create under our own id", () => {
	test("disk still holding what we sent transmits nothing and keeps the server's edit", async () => {
		const { engine, calls } = makeEngine(SENT, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);

		const consumed = await seed(engine, "occupied");

		expect(calls.applyLocalEdit).toEqual([]);
		expect(consumed).toBe(SERVER);
	});

	test("the acked baseline is the base too (a second create after the first ack)", async () => {
		const { engine, calls } = makeEngine(SENT, SERVER);
		engine.stampSyncedRow(PATH, { hash: fnv1a(SENT) });

		const consumed = await seed(engine, "occupied");

		expect(calls.applyLocalEdit).toEqual([]);
		expect(consumed).toBe(SERVER);
	});

	test("a real local edit since the create still transmits", async () => {
		const { engine, calls } = makeEngine(LOCAL_EDIT, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);

		await seed(engine, "occupied");

		expect(calls.applyLocalEdit).toEqual([LOCAL_EDIT]);
	});

	test("the base is the FIRST create's body: a re-send does not move it", async () => {
		const { engine, calls } = makeEngine(LOCAL_EDIT, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);
		engine.stampOwnGenesis("note-1", PATH, LOCAL_EDIT); // the re-sent create's disk

		await seed(engine, "occupied");

		expect(calls.applyLocalEdit).toEqual([LOCAL_EDIT]);
	});
});

describe("a stored create whose disk moved during the round trip", () => {
	test("merges the local edit three-way, keeping a remote edit already in the doc", async () => {
		const { engine, calls, doc } = makeEngine(LOCAL_EDIT, SERVER);

		const consumed = await seed(engine, "stored", SENT);

		expect(calls.applyLocalEdit).toEqual([]);
		expect(doc()).toBe("# t0\nA: a2\n--\nS: s3\n");
		expect(consumed).toBe("# t0\nA: a2\n--\nS: s3\n");
	});

	test("overlapping edits keep both: disk goes to a conflict copy", async () => {
		const overlapping = "# t0\nA: -\n--\nS: mine\n";
		const { engine, calls, doc } = makeEngine(overlapping, SERVER);

		await seed(engine, "stored", SENT);

		expect(doc()).toBe(SERVER);
		expect(calls.copies).toEqual([overlapping]);
	});
});

describe("the first server load before the create-ack (fuzz seed 6)", () => {
	test("disk holding our own unacked create is not a held local edit", async () => {
		const { engine, calls } = makeEngine(SENT, SERVER);
		engine.syncState.set(PATH, { hash: 0, seq: 3 }); // the pre-ack placeholder row
		engine.stampOwnGenesis("note-1", PATH, SENT);

		expect(engine.needsColdReconcile(PATH, SENT)).toBe(false);
		expect(engine.needsColdReconcile(PATH, LOCAL_EDIT)).toBe(true);
		const written = await engine.resolveDriftOnLoad(PATH, { path: PATH }, "note-1", SERVER);

		expect(written).toBe(SERVER);
		expect(calls.copies).toEqual([]);
	});

	test("once the ack stamps the baseline, the create's own record is gone", async () => {
		const { engine } = makeEngine(SENT, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);

		await engine.adoptCreateAck("note-1", PATH, SERVER, { flushHeld: false });

		expect(engine.ownGenesis.has("note-1")).toBe(false);
		expect(engine.needsColdReconcile(PATH, SENT)).toBe(true);
	});
});
