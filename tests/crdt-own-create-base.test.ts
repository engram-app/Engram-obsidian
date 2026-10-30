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
import { ProviderRegistry } from "../src/crdt/provider-registry";
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
		{
			vault: {
				cachedRead: mock().mockResolvedValue(disk),
				getFileByPath: () => ({ stat: { ctime: Date.now() } }),
			},
		} as any,
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

	test("a real local edit since the create merges three-way with the server's edit", async () => {
		const { engine, calls, doc } = makeEngine(LOCAL_EDIT, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);

		const consumed = await seed(engine, "occupied");

		// Never the lossy two-way diff of disk onto the server doc (#645).
		expect(calls.applyLocalEdit).toEqual([]);
		expect(doc()).toBe("# t0\nA: a2\n--\nS: s3\n");
		expect(consumed).toBe("# t0\nA: a2\n--\nS: s3\n");
	});

	test("an overlapping local edit keeps both: server text stays, disk goes to a copy", async () => {
		const overlapping = "# t0\nA: -\n--\nS: mine\n";
		const { engine, calls, doc } = makeEngine(overlapping, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);

		await seed(engine, "occupied");

		expect(doc()).toBe(SERVER);
		expect(calls.copies).toEqual([overlapping]);
	});

	test("the base is the FIRST create's body: a re-send does not move it", async () => {
		const { engine, doc } = makeEngine(LOCAL_EDIT, SERVER);
		engine.stampOwnGenesis("note-1", PATH, SENT);
		engine.stampOwnGenesis("note-1", PATH, LOCAL_EDIT); // the re-sent create's disk

		await seed(engine, "occupied");

		expect(doc()).toBe("# t0\nA: a2\n--\nS: s3\n");
	});

	test("a note created before this session has no own base: a restart's re-send keeps the edit", async () => {
		// The first create landed (body SENT), its ack was never saved, the user
		// edited to LOCAL_EDIT, the plugin restarted. The re-sent create would
		// stamp LOCAL_EDIT as "what we sent" and return the server's text over
		// the disk, losing the edit.
		const { engine, calls } = makeEngine(LOCAL_EDIT, SENT);
		engine.app = {
			vault: {
				cachedRead: async () => LOCAL_EDIT,
				getFileByPath: () => ({ stat: { ctime: 1 } }),
			},
		};
		engine.ownGenesisSince = 1000; // this session started after the file was created

		engine.stampOwnGenesis("note-1", PATH, LOCAL_EDIT);
		const consumed = await seed(engine, "occupied");

		expect(engine.ownGenesis.has("note-1")).toBe(false);
		// Falls to the two-way diff of disk onto the server's body: the edit stays.
		expect(calls.applyLocalEdit).toEqual([LOCAL_EDIT]);
		expect(consumed).toBe(LOCAL_EDIT);
	});

	test("an unknown creation time grants no base (fails closed)", () => {
		const { engine } = makeEngine(SENT, SENT);
		engine.app.vault.getFileByPath = () => null;
		engine.stampOwnGenesis("note-1", PATH, SENT);
		expect(engine.ownGenesis.has("note-1")).toBe(false);

		engine.app.vault.getFileByPath = () => ({ stat: {} });
		engine.stampOwnGenesis("note-1", PATH, SENT);
		expect(engine.ownGenesis.has("note-1")).toBe(false);
	});

	test("an oversized body is never held as a base", () => {
		const { engine } = makeEngine(SENT, SENT);
		engine.stampOwnGenesis("note-1", PATH, "x".repeat(4 * 1024 * 1024 + 1));
		expect(engine.ownGenesis.has("note-1")).toBe(false);
	});

	test("an abandoned create's base is forgotten", () => {
		const { engine } = makeEngine(SENT, SENT);
		engine.stampOwnGenesis("note-1", PATH, SENT);
		expect(engine.ownGenesis.has("note-1")).toBe(true);

		engine.forgetOwnGenesis("note-1");

		expect(engine.ownGenesis.has("note-1")).toBe(false);
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

describe("the three-way base is in the projection's form", () => {
	test("the registry projects a create's body the way the doc will", async () => {
		const reg = new ProviderRegistry({
			ackScope: () => "s",
			dbPrefix: "canon-1",
			send: () => true,
			onFlushToDisk: async () => true,
		} as any);

		// The frontmatter codec re-emits flow lists and spacing.
		expect(reg.canonicalText("---\ntitle:   x\ntags: [a,  b]\n---\nbody\n")).toBe(
			"---\ntitle: x\ntags:\n  - a\n  - b\n---\nbody\n",
		);
		await reg.destroyAll();
	});

	test("the drift merge hands the canonical base, not the raw one, to the merge", async () => {
		const { engine } = makeEngine(LOCAL_EDIT, SERVER);
		const seen: string[] = [];
		engine.crdt.canonicalText = (t: string) => `canon:${t}`;
		engine.crdt.mergeLocalEditFromBase = async (_i: string, base: string) => {
			seen.push(base);
			return "merged";
		};

		await engine.mergeOwnCreateDrift("note-1", PATH, SENT, SERVER, LOCAL_EDIT);

		expect(seen).toEqual([`canon:${SENT}`]);
	});
});
