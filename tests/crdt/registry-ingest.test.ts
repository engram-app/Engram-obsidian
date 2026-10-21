/**
 * The single ingest gate (ProviderRegistry.ingest + onLineage replay).
 *
 * A fresh device's catch-up writes a body to disk without touching the Y.Doc.
 * No local text may enter that history-less doc while the server holds the
 * note: it waits as a pending entry until the server lineage arrives, then
 * replays as a diff on top of it. Real registry, fake-indexeddb, and a server
 * Y.Doc standing in for the server's lineage S.
 */
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { fnv1a } from "../../src/content-hash";
import { DiscoveryBaseStore } from "../../src/crdt/discovery-base-store";
import { CONTENT_KEY } from "../../src/crdt/frontmatter-codec";
import { docHasAnyHistory } from "../../src/crdt/note-seed";
import { PendingIngestStore } from "../../src/crdt/pending-ingest-store";
import { ProviderRegistry, type ProviderRegistryOpts } from "../../src/crdt/provider-registry";
import { rootClients } from "../../src/crdt/root-clients";
import { MESSAGE_SYNC, toB64 } from "../../src/crdt/wire";

const ID = "n1";
let seq = 0;

function serverDoc(text: string): Y.Doc {
	const d = new Y.Doc();
	d.clientID = 999;
	d.getText(CONTENT_KEY).insert(0, text);
	return d;
}

function harness(over: Partial<ProviderRegistryOpts> = {}) {
	const tag = `ingest-${++seq}-${Date.now()}`;
	const disk = new Map<string, string>();
	const flushes: string[] = [];
	const copies: string[] = [];
	const lineage: string[] = [];
	const baselines = new Map<string, number>();
	const ctl = { refuse: false };
	const pending = new PendingIngestStore(
		() => [],
		async () => {},
	);
	const discoveryBase = new DiscoveryBaseStore(tag);
	const reg = new ProviderRegistry({
		dbPrefix: tag,
		send: () => true,
		onFlushToDisk: async (id, content) => {
			if (ctl.refuse) return false;
			flushes.push(content);
			disk.set(id, content);
			return undefined;
		},
		isServerKnown: (id) => id !== "local",
		baselineHash: (id) => baselines.get(id),
		pending,
		discoveryBase,
		requestLineage: (id) => lineage.push(id),
		writeConflictCopy: async (_id, text) => {
			copies.push(text);
			return true;
		},
		readDisk: async (id) => disk.get(id) ?? null,
		...over,
	});
	/** Deliver the server's state as the lineage arrival. */
	const arrive = (server: Y.Doc) => reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	/** Ship the local doc's ops to the server, as the provider would. */
	const pushTo = async (server: Y.Doc) => {
		const local = await reg.getDoc(ID);
		Y.applyUpdate(server, Y.encodeStateAsUpdate(local, Y.encodeStateVector(server)));
	};
	return {
		reg,
		disk,
		flushes,
		copies,
		lineage,
		baselines,
		ctl,
		pending,
		discoveryBase,
		arrive,
		pushTo,
	};
}

const C1 = "line one\nline two\n";
const C2 = "line one\nline two\nline three\n";

describe("ProviderRegistry.ingest", () => {
	test("awaiting: ingest queues and mints no ops", async () => {
		const h = harness();
		h.disk.set(ID, C2);
		const r = await h.reg.ingest(ID, { text: C2, base: C1, source: "disk" });
		expect(r).toEqual({ pending: true });
		const doc = await h.reg.getDoc(ID);
		expect(docHasAnyHistory(doc, "note")).toBe(false);
		expect(doc.store.clients.size).toBe(0);
		expect(h.pending.get(ID)?.base).toBe(C1);
		expect(h.lineage).toEqual([ID]);
		await h.reg.destroyAll();
	});

	test("arrival replays once and server == C2 with one root client", async () => {
		const h = harness();
		h.baselines.set(ID, fnv1a(C1));
		await h.discoveryBase.put(ID, C1);
		h.disk.set(ID, C2);
		const server = serverDoc(C1);
		expect(await h.reg.ingest(ID, { text: C2, base: null, source: "disk" })).toEqual({
			pending: true,
		});

		await h.arrive(server);

		expect(h.flushes).toEqual([C2]);
		expect(await h.reg.projectedText(ID)).toBe(C2);
		await h.pushTo(server);
		expect(server.getText(CONTENT_KEY).toJSON()).toBe(C2);
		expect([...rootClients(server)]).toEqual([999]);
		expect(h.pending.get(ID)).toBeUndefined();
		expect(await h.discoveryBase.get(ID)).toBeNull();
		await h.reg.destroyAll();
	});

	test("arrival with server moved merges", async () => {
		const h = harness();
		h.baselines.set(ID, fnv1a(C1));
		h.disk.set(ID, C2);
		const server = serverDoc(`REMOTE\n${C1}`);
		await h.reg.ingest(ID, { text: C2, base: C1, source: "disk" });

		await h.arrive(server);

		const want = `REMOTE\n${C2}`;
		expect(h.disk.get(ID)).toBe(want);
		expect(await h.reg.projectedText(ID)).toBe(want);
		await h.pushTo(server);
		expect(server.getText(CONTENT_KEY).toJSON()).toBe(want);
		expect([...rootClients(server)]).toEqual([999]);
		expect(h.copies).toEqual([]);
		await h.reg.destroyAll();
	});

	test("arrival with no provable base keeps both", async () => {
		const h = harness();
		const S = "A\nB\n";
		h.disk.set(ID, "A\n");
		await h.reg.ingest(ID, { text: "A\n", base: null, source: "disk" });

		await h.arrive(serverDoc(S));

		expect(h.copies).toEqual(["A\n"]);
		expect(h.disk.get(ID)).toBe(S);
		expect(await h.reg.projectedText(ID)).toBe(S);
		const doc = await h.reg.getDoc(ID);
		expect(doc.store.clients.has(doc.clientID)).toBe(false);
		expect(h.pending.get(ID)).toBeUndefined();
		await h.reg.destroyAll();
	});

	test("refused disk write leaves entry pending and doc untouched", async () => {
		const h = harness();
		h.baselines.set(ID, fnv1a(C1));
		h.disk.set(ID, C2);
		await h.reg.ingest(ID, { text: C2, base: C1, source: "disk" });
		h.ctl.refuse = true;

		await h.arrive(serverDoc(C1));

		expect(h.pending.get(ID)).toBeDefined();
		expect(h.disk.get(ID)).toBe(C2);
		const doc = await h.reg.getDoc(ID);
		expect(doc.store.clients.has(doc.clientID)).toBe(false);
		expect(await h.reg.projectedText(ID)).toBe(C1);
		await h.reg.destroyAll();
	});

	test("flush listener does not write S over a pending edit", async () => {
		const h = harness();
		h.baselines.set(ID, fnv1a(C1));
		h.disk.set(ID, C2);
		const S = `REMOTE\n${C1}`;
		await h.reg.ingest(ID, { text: C2, base: C1, source: "disk" });

		await h.arrive(serverDoc(S));

		expect(h.flushes).not.toContain(S);
		expect(h.flushes).toEqual([`REMOTE\n${C2}`]);
		await h.reg.destroyAll();
	});

	test("local note seeds as before", async () => {
		const h = harness();
		const local = "local";
		expect(await h.reg.ingest(local, { text: C1, base: null, source: "disk" })).toEqual({
			consumed: C1,
		});
		expect(await h.reg.projectedText(local)).toBe(C1);
		expect(h.pending.get(local)).toBeUndefined();
		expect(h.lineage).toEqual([]);
		await h.reg.destroyAll();
	});

	test("live note diffs as before", async () => {
		const h = harness();
		const server = serverDoc(C1);
		await h.arrive(server);
		expect(await h.reg.ingest(ID, { text: C2, base: C1, source: "disk" })).toEqual({
			consumed: C2,
		});
		await h.pushTo(server);
		expect(server.getText(CONTENT_KEY).toJSON()).toBe(C2);
		expect([...rootClients(server)]).toEqual([999]);
		await h.reg.destroyAll();
	});

	test("bound note replays from the editor and paints it", async () => {
		const painted: string[] = [];
		const h = harness({
			editorText: () => C2,
			paintEditor: (_id, text) => painted.push(text),
		});
		h.baselines.set(ID, fnv1a(C1));
		await h.reg.ingest(ID, { text: C2, base: C1, source: "editor" });

		await h.arrive(serverDoc(`REMOTE\n${C1}`));

		expect(painted).toEqual([`REMOTE\n${C2}`]);
		expect(await h.reg.projectedText(ID)).toBe(`REMOTE\n${C2}`);
		expect(h.pending.get(ID)).toBeUndefined();
		await h.reg.destroyAll();
	});

	test("unchanged text is consumed without a pending entry", async () => {
		const h = harness();
		h.baselines.set(ID, fnv1a(C1));
		expect(await h.reg.ingest(ID, { text: C1, base: null, source: "disk" })).toEqual({
			consumed: C1,
		});
		const doc = await h.reg.getDoc(ID);
		expect(doc.store.clients.size).toBe(0);
		expect(h.pending.get(ID)).toBeUndefined();
		await h.reg.destroyAll();
	});

	test("fails closed: no isServerKnown means awaiting, and the shim declines", async () => {
		const h = harness({ isServerKnown: undefined });
		expect(await h.reg.applyLocalEdit("local", C1)).toBeNull();
		const doc = await h.reg.getDoc("local");
		expect(doc.store.clients.size).toBe(0);
		await h.reg.destroyAll();
	});
});

describe("other local-text paths respect the gate", () => {
	test("frontmatter into an awaiting note waits instead of seeding", async () => {
		const h = harness();
		h.disk.set(ID, "---\ntitle: T\n---\nbody\n");
		await h.reg.ingestFrontmatter(ID, "---\ntitle: T\n---\nbody\n");
		const doc = await h.reg.getDoc(ID);
		expect(doc.store.clients.size).toBe(0);
		expect(h.pending.get(ID)).toBeDefined();
		await h.reg.destroyAll();
	});

	test("a forced base merge never seeds a history-less server-known doc", async () => {
		const h = harness();
		expect(await h.reg.mergeLocalEditFromBase(ID, "", "", C1, true)).toBeNull();
		const doc = await h.reg.getDoc(ID);
		expect(doc.store.clients.size).toBe(0);
		await h.reg.destroyAll();
	});
});

describe("server-confirmed empty note", () => {
	test("an empty first STEP2 lets the pending edit replay onto the empty doc", async () => {
		const h = harness();
		h.disk.set(ID, C1);
		await h.reg.ingest(ID, { text: C1, base: null, source: "disk" });
		expect(h.pending.get(ID)).toBeDefined();

		const enc = encoding.createEncoder();
		encoding.writeVarUint(enc, MESSAGE_SYNC);
		syncProtocol.writeSyncStep2(enc, new Y.Doc());
		await h.reg.receive(ID, toB64(encoding.toUint8Array(enc)));
		await waitFor(() => h.pending.get(ID) === undefined);

		expect(await h.reg.projectedText(ID)).toBe(C1);
		await h.reg.destroyAll();
	});

	test("a disconnect expires the empty verdict", async () => {
		const h = harness();
		const enc = encoding.createEncoder();
		encoding.writeVarUint(enc, MESSAGE_SYNC);
		syncProtocol.writeSyncStep2(enc, new Y.Doc());
		await h.reg.receive(ID, toB64(encoding.toUint8Array(enc)));
		h.reg.setConnected(false);
		h.reg.clearSynced();

		h.disk.set(ID, C1);
		expect(await h.reg.ingest(ID, { text: C1, base: null, source: "disk" })).toEqual({
			pending: true,
		});
		await new Promise((r) => setTimeout(r, 50)); // let any replay run
		const doc = await h.reg.getDoc(ID);
		expect(doc.store.clients.size).toBe(0);
		expect(h.pending.get(ID)).toBeDefined();
		await h.reg.destroyAll();
	});
});

async function waitFor(cond: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
	expect(cond()).toBe(true);
}
