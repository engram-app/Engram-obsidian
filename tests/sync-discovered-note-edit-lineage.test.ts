/**
 * A fresh device's first edit to a DISCOVERED note must land on the server
 * exactly once, on the server's lineage.
 *
 * Staging 0.59.0, 8/8 (plugin e3747eb6): device D joins with an empty
 * IndexedDB, catch-up's discovery leg writes the row body c1 to disk and marks
 * the note server-known, but never touches the Y.Doc (cold note: no STEP1, no
 * crdt_doc_state). The user edits to c2. pushFile's server-known arm routes to
 * applyLocalEdit, which sees a history-less doc and seeds ALL of c2 under a new
 * clientID. The server unions that with its own c1 and stores c1+c2.
 *
 * Real ProviderRegistry so the outcome is a genuine Yjs merge, not mocked.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { reconcileColdStart, SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "Notes/Fresh.md";
const ID = "id-fresh";
const C1 = "# fresh\n\nfirst body line.\n";
const C2 = "# fresh\n\nfirst body line.\nsecond line from a fresh device.\n";

/** Clients owning a ROOT insert (no origin, no right origin) in the body: more
 *  than one is a rival lineage, however the text reads. */
function rootClients(doc: Y.Doc): number[] {
	const ids = new Set<number>();
	// biome-ignore lint/suspicious/noExplicitAny: Yjs item internals.
	for (let it: any = (doc.getText("content") as any)._start; it; it = it.right) {
		if (it.origin === null && it.rightOrigin === null) ids.add(it.id.client);
	}
	return [...ids];
}

async function scenario(dbPrefix: string) {
	// The server's lineage: another device created c1.
	const server = new Y.Doc();
	server.getText("content").insert(0, C1);
	const ctl = {
		docStateFails: false,
		bound: false,
		refuseFlush: false,
		onRead: () => {},
	};

	const disk = new Map<string, string>();
	const map = new NoteIdMap();
	const time = new ManualTimeProvider();
	let e!: SyncEngine;
	const mgr = new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: async (id, content) => {
			if (ctl.refuseFlush) return false;
			const p = map.pathForId(id);
			if (p) await e.flushFromCrdt(p, content);
		},
		isUnchangedSynced: (id, content) => {
			const p = map.pathForId(id);
			return p ? e.isUnchangedSynced(p, content) : false;
		},
		// Production wiring (src/crdt/wiring.ts).
		serverLineage: (id, d) => e.serverLineageFor(id, d),
	});
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => void disk.set(f.path, c)),
			create: mock(async (p: string, c: string) => {
				if (disk.has(p)) throw new Error("File already exists.");
				disk.set(p, c);
				return new TFile(p);
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	e = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		time,
	);
	e.setCrdtManager(mgr as never);
	e.setReady();
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => ctl.bound);
	const enroll = mock();
	e.setCrdtEnrollment({ enroll, reset: mock() } as never);
	const docStateCalls: string[] = [];
	e.setCrdtPorts({
		live: () => true,
		docState: async (id: string) => {
			docStateCalls.push(id);
			ctl.onRead();
			if (ctl.docStateFails) throw new Error("rate_limited");
			return { b64: toB64(Y.encodeStateAsUpdate(server)), head: "h1" };
		},
	} as never);
	map.set(PATH, ID);

	// Catch-up discovery: the file is absent locally, the row carries c1.
	await e.applyChange({
		id: ID,
		path: PATH,
		title: "Fresh",
		content: C1,
		folder: "Notes",
		tags: [],
		mtime: Date.now() / 1000,
		updated_at: new Date().toISOString(),
		deleted: false,
		version: 1,
		content_hash: "hash-c1",
	} as never);

	/** The server after merging everything this device holds (what any
	 *  delivery path, live or queued, ends with). */
	const serverText = async () => {
		if (mgr.hasDoc(ID)) Y.applyUpdate(server, Y.encodeStateAsUpdate(await mgr.getDoc(ID)));
		return server.getText("content").toJSON();
	};
	/** Another device edits the note after discovery. */
	const remoteEdit = (at: number, s: string) => {
		const other = new Y.Doc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(server));
		other.getText("content").insert(at, s);
		Y.applyUpdate(server, Y.encodeStateAsUpdate(other));
	};
	const settle = () => new Promise((r) => setTimeout(r, 10));
	const edit = async (text: string) => {
		disk.set(PATH, text);
		await (e as any).pushFile(new TFile(PATH));
		await settle();
	};
	return { e, mgr, server, disk, ctl, time, enroll, serverText, remoteEdit, edit, settle, docStateCalls };
}

test("discovery leaves the doc empty but the note server-known (the precondition)", async () => {
	const { e, mgr, disk } = await scenario("disc-lineage-pre");
	expect(disk.get(PATH)).toBe(C1);
	expect(e.hasServerNote(ID)).toBe(true);
	expect(await mgr.hasHistory(ID)).toBe(false);
});

test("first edit after discovery reaches the server exactly once", async () => {
	const { server, disk, serverText, edit } = await scenario("disc-lineage-edit");
	await edit(C2);
	expect(await serverText()).toBe(C2);
	expect(rootClients(server)).toHaveLength(1);
	expect(disk.get(PATH)).toBe(C2);
});

test("cold-start reconcile of a discovered note reaches the server exactly once", async () => {
	const { mgr, disk, serverText, settle } = await scenario("disc-lineage-cold");
	disk.set(PATH, C2);
	await reconcileColdStart({ path: PATH, noteId: ID, diskContent: C2 }, mgr as never, () => {});
	await settle();
	expect(await serverText()).toBe(C2);
});

test("server moved since discovery: the edit merges, the remote work survives", async () => {
	const { disk, serverText, remoteEdit, edit } = await scenario("disc-lineage-moved");
	remoteEdit(0, "REMOTE\n");
	await edit(C2);
	expect(await serverText()).toBe(`REMOTE\n${C2}`);
	expect(disk.get(PATH)).toBe(`REMOTE\n${C2}`);
});

test("server moved and no provable base: keep both, delete nothing", async () => {
	const { e, mgr, server, disk, serverText, remoteEdit, edit } = await scenario("disc-lineage-nobase");
	(e as any).forgetDiscoveryBase(PATH);
	remoteEdit(0, "REMOTE\n");
	await edit(C2);
	expect(await serverText()).toBe(`REMOTE\n${C1}`);
	expect(disk.get(PATH)).toBe(`REMOTE\n${C1}`);
	const copies = [...disk.entries()].filter(([p]) => p !== PATH);
	expect(copies.map(([, c]) => c)).toEqual([C2]);
	expect(await mgr.hasHistory(ID)).toBe(true);
	expect(rootClients(server)).toHaveLength(1);
});

test("no provable base, disk only adds: the edit applies, server text kept", async () => {
	const { e, server, serverText, remoteEdit, edit } = await scenario("disc-lineage-inserts");
	(e as any).forgetDiscoveryBase(PATH);
	remoteEdit(C1.length, "tail\n");
	await edit(`${C1}tail\nmine\n`);
	expect(await serverText()).toBe(`${C1}tail\nmine\n`);
	expect(rootClients(server)).toHaveLength(1);
});

test("edits while a retry is pending ride it instead of spending attempts", async () => {
	const { ctl, edit, docStateCalls } = await scenario("disc-lineage-pending");
	ctl.docStateFails = true;
	await edit(C2);
	await edit(`${C2}more\n`);
	await edit(`${C2}more more\n`);
	expect(docStateCalls).toHaveLength(1);
});

test("retries spent: the edit still ships (old seed), never stranded", async () => {
	const { ctl, time, serverText, edit, settle } = await scenario("disc-lineage-spent");
	ctl.docStateFails = true;
	await edit(C2);
	for (const ms of [2_000, 10_000, 30_000]) {
		time.advance(ms);
		await settle();
		time.advance(10);
		await settle();
	}
	expect(await serverText()).toContain("second line from a fresh device.");
});

test("server state unreadable: declined, retried, then delivered once", async () => {
	const { mgr, ctl, time, serverText, edit, settle } = await scenario("disc-lineage-retry");
	ctl.docStateFails = true;
	await edit(C2);
	expect(await mgr.hasHistory(ID)).toBe(false);
	expect(await serverText()).toBe(C1);
	ctl.docStateFails = false;
	time.advance(2_000); // retry -> handleModify -> debounced push
	await settle();
	time.advance(10);
	await settle();
	expect(await serverText()).toBe(C2);
});

test("backend without crdt_doc_state: the edit still ships (old seed path)", async () => {
	const { e, disk, serverText, edit } = await scenario("disc-lineage-oldbackend");
	e.setCrdtPorts({ docState: null } as never);
	await edit(C2);
	// Doubling is the pre-fix behaviour on such a backend; losing the edit is not.
	expect(await serverText()).toContain("second line from a fresh device.");
	expect(disk.get(PATH)).toBe(C2);
});

test("an unchanged discovered note costs no doc-state read", async () => {
	const { mgr, docStateCalls } = await scenario("disc-lineage-unchanged");
	expect(await mgr.applyLocalEdit(ID, C1)).toBe(C1);
	expect(docStateCalls).toEqual([]);
});

test("a note the server does not know yet still seeds (genesis is unaffected)", async () => {
	const { mgr, docStateCalls } = await scenario("disc-lineage-genesis");
	const fresh = "id-brand-new";
	expect(await mgr.applyLocalEdit(fresh, "new note")).toBe("new note");
	expect(await mgr.getText(fresh)).toBe("new note");
	expect(docStateCalls).toEqual([]);
});

test("editor open and the note would change: left to the live binding", async () => {
	const { e, mgr, disk, ctl, enroll, remoteEdit, edit } = await scenario("disc-lineage-bound");
	(e as any).forgetDiscoveryBase(PATH);
	remoteEdit(0, "REMOTE\n");
	ctl.bound = true;
	await edit(C2);
	expect(await mgr.hasHistory(ID)).toBe(false);
	expect(disk.get(PATH)).toBe(C2);
	expect([...disk.keys()]).toEqual([PATH]); // no conflict copy
	expect(enroll).toHaveBeenCalledWith(ID);
});

test("a save during the read: one conflict copy, of the newer text", async () => {
	const { e, disk, ctl, remoteEdit, edit } = await scenario("disc-lineage-midread");
	(e as any).forgetDiscoveryBase(PATH);
	remoteEdit(0, "REMOTE\n");
	const C3 = `${C2}third\n`;
	ctl.onRead = () => {
		ctl.onRead = () => {};
		disk.set(PATH, C3);
	};
	await edit(C2);
	await (e as any).pushFile(new TFile(PATH));
	const copies = [...disk.entries()].filter(([p]) => p !== PATH).map(([, c]) => c);
	expect(copies).toEqual([C3]);
});

test("disk write refused: the doc is left untouched for the next attempt", async () => {
	const { mgr, disk, ctl, remoteEdit, edit } = await scenario("disc-lineage-refused");
	remoteEdit(0, "REMOTE\n");
	ctl.refuseFlush = true;
	await edit(C2);
	expect(await mgr.hasHistory(ID)).toBe(false);
	expect(disk.get(PATH)).toBe(C2);
});

test("the latest edit made during a pending retry is what ships", async () => {
	const { ctl, time, serverText, edit, settle } = await scenario("disc-lineage-latest");
	ctl.docStateFails = true;
	await edit(C2);
	await edit(`${C2}later\n`);
	ctl.docStateFails = false;
	time.advance(2_000);
	await settle();
	time.advance(10);
	await settle();
	expect(await serverText()).toBe(`${C2}later\n`);
});
