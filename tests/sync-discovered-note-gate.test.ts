/**
 * The load gate: a note the server holds, with no local history on this
 * device, takes NO local input until the server's state has loaded.
 *
 * Staging 0.59.0, 8/8: a fresh device's catch-up discovery writes the row body
 * c1 to disk and marks the note server-known, but never touches the Y.Doc. The
 * user edits to c2; applyLocalEdit sees a history-less doc and seeds ALL of c2
 * under a new clientID. The server unions that with its own c1 and stores
 * c1 followed by c2.
 *
 * Real ProviderRegistry, wired the way `createCrdtWiring` wires it, so every
 * outcome is a genuine Yjs merge.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { seedContentInto } from "../src/crdt/note-seed";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { reconcileColdStart, SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "Notes/Fresh.md";
const ID = "id-fresh";
const C1 = "# fresh\n\nfirst body line.\n";
const C2 = "# fresh\n\nfirst body line.\nsecond line from a fresh device.\n";

/** Clients owning a ROOT insert in the body: more than one is a rival lineage,
 *  however the text reads. */
function rootClients(doc: Y.Doc): number[] {
	const ids = new Set<number>();
	for (let it: any = (doc.getText("content") as any)._start; it; it = it.right) {
		if (it.origin === null && it.rightOrigin === null) ids.add(it.id.client);
	}
	return [...ids];
}

async function scenario(dbPrefix: string, body = C1) {
	// The server's lineage: another device created the note.
	const server = new Y.Doc();
	seedContentInto(server, server.getText("content"), body, false);
	const ctl = {
		/** An editor is bound to the note. */
		bound: false,
		/** Throw from crdt_doc_state (offline, timeout). */
		docStateFails: false,
		/** When set, crdt_doc_state waits on this before answering. */
		hold: null as Promise<void> | null,
		/** Answer crdt_doc_state with no structs (a row with no CRDT state). */
		emptyState: false,
	};

	const disk = new Map<string, string>();
	const map = new NoteIdMap();
	let e!: SyncEngine;
	const mgr = new ProviderRegistry({
		dbPrefix,
		send: () => true,
		// Production wiring (src/crdt/wiring.ts): a closed note's first server
		// state goes through the disk-drift interlock.
		onFlushToDisk: async (id, content, _fm, firstLoad) => {
			const p = map.pathForId(id);
			if (!p) return undefined;
			const loaded = firstLoad && !ctl.bound ? id : undefined;
			return (await e.flushFromCrdt(p, content, loaded)) === false ? false : undefined;
		},
		isUnchangedSynced: (id, content) => {
			const p = map.pathForId(id);
			return p ? e.isUnchangedSynced(p, content) : false;
		},
		// Production wiring (src/crdt/wiring.ts).
		serverHolds: (id) => e.hasServerNote(id),
		onAwaitingServer: (id) => void e.loadServerState(id),
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
		new ManualTimeProvider(),
	);
	e.setCrdtManager(mgr as never);
	e.setReady();
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => ctl.bound);
	e.setCrdtEnrollment({ enroll: mock(), reset: mock() } as never);
	const docStateCalls: string[] = [];
	e.setCrdtPorts({
		live: () => true,
		docState: async (id: string) => {
			docStateCalls.push(id);
			if (ctl.hold) await ctl.hold;
			if (ctl.docStateFails) throw new Error("timeout");
			const state = ctl.emptyState ? new Y.Doc() : server;
			return { b64: toB64(Y.encodeStateAsUpdate(state)), head: "h1" };
		},
	} as never);
	map.set(PATH, ID);

	// Catch-up discovery: the file is absent locally, the row carries c1.
	await e.applyChange({
		id: ID,
		path: PATH,
		title: "Fresh",
		content: body,
		folder: "Notes",
		tags: [],
		mtime: Date.now() / 1000,
		updated_at: new Date().toISOString(),
		deleted: false,
		version: 1,
		content_hash: "hash-c1",
	} as never);

	/** Let in-flight loads and their flushes finish. */
	const settle = async () => {
		for (let i = 0; i < 3; i++) {
			await Promise.all([
				...(((e as any).serverLoads as Map<string, Promise<void>>)?.values() ?? []),
			]);
			await new Promise((r) => setTimeout(r, 10));
		}
	};
	/** The server after merging everything this device holds (what any
	 *  delivery path, live or queued, ends with). */
	const serverText = async () => {
		await settle();
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
	const edit = async (text: string) => {
		disk.set(PATH, text);
		await (e as any).pushFile(new TFile(PATH));
	};
	const copies = () => [...disk.entries()].filter(([p]) => p !== PATH).map(([, c]) => c);
	return {
		e,
		mgr,
		server,
		disk,
		ctl,
		serverText,
		remoteEdit,
		edit,
		settle,
		copies,
		docStateCalls,
	};
}

test("discovery leaves the doc empty and the note server-known (the precondition)", async () => {
	const { e, mgr, disk } = await scenario("gate-pre");
	expect(disk.get(PATH)).toBe(C1);
	expect(e.hasServerNote(ID)).toBe(true);
	expect(await mgr.hasHistory(ID)).toBe(false);
	expect(mgr.awaitsServerState(ID)).toBe(true);
});

test("first edit after discovery reaches the server exactly once", async () => {
	const { server, disk, serverText, edit } = await scenario("gate-edit");
	await edit(C2);
	expect(await serverText()).toBe(C2);
	expect(rootClients(server)).toHaveLength(1);
	expect(disk.get(PATH)).toBe(C2);
});

test("the gate consumes nothing until the server state is in", async () => {
	const { mgr, ctl, edit } = await scenario("gate-holds");
	let release!: () => void;
	ctl.hold = new Promise((r) => (release = r));
	await edit(C2);
	expect(await mgr.hasHistory(ID)).toBe(false);
	release();
});

test("edits made while the load is in flight queue on disk and land once", async () => {
	const { server, disk, ctl, serverText, edit, docStateCalls } = await scenario("gate-queue");
	let release!: () => void;
	ctl.hold = new Promise((r) => (release = r));
	const C3 = `${C2}third line.\n`;
	await edit(C2);
	await edit(C3);
	expect(docStateCalls).toHaveLength(1); // one load serves the burst
	release();
	expect(await serverText()).toBe(C3);
	expect(rootClients(server)).toHaveLength(1);
	expect(disk.get(PATH)).toBe(C3);
});

test("server changed after discovery: 3-way merge from the discovery text keeps both", async () => {
	const { server, disk, serverText, remoteEdit, edit, copies } = await scenario("gate-moved");
	remoteEdit(0, "REMOTE\n");
	await edit(C2);
	expect(await serverText()).toBe(`REMOTE\n${C2}`);
	expect(disk.get(PATH)).toBe(`REMOTE\n${C2}`);
	expect(copies()).toEqual([]);
	expect(rootClients(server)).toHaveLength(1);
});

test("server changed the same line: exactly one conflict, the note takes the server's", async () => {
	const { server, disk, serverText, edit, copies } = await scenario("gate-conflict");
	const other = new Y.Doc();
	Y.applyUpdate(other, Y.encodeStateAsUpdate(server));
	const t = other.getText("content");
	const at = C1.indexOf("first");
	t.delete(at, "first".length);
	t.insert(at, "THEIR");
	Y.applyUpdate(server, Y.encodeStateAsUpdate(other));
	const mine = C1.replace("first", "MINE");
	await edit(mine);
	const theirs = C1.replace("first", "THEIR");
	expect(await serverText()).toBe(theirs);
	expect(disk.get(PATH)).toBe(theirs);
	expect(copies()).toEqual([mine]);
	expect(rootClients(server)).toHaveLength(1);
});

test("load never arrives: the edit stays on disk, nothing seeds, rejoin lands it once", async () => {
	const { e, mgr, server, disk, ctl, serverText, edit, settle } = await scenario("gate-offline");
	ctl.docStateFails = true;
	await edit(C2);
	await settle();
	expect(await mgr.hasHistory(ID)).toBe(false);
	expect(disk.get(PATH)).toBe(C2);
	expect(server.getText("content").toJSON()).toBe(C1);
	// Back online: the crdt rejoin retries the held load.
	ctl.docStateFails = false;
	e.retryHeldLocalEdits();
	expect(await serverText()).toBe(C2);
	expect(rootClients(server)).toHaveLength(1);
	// Landed: nothing is held any more.
	expect((e as any).heldForServer.size).toBe(0);
});

test("a latched crdt_doc_state frame does not strand a held edit", async () => {
	const { e, server, serverText, edit } = await scenario("gate-latched");
	(e as any).unsupportedFrames.add("crdt_doc_state");
	await edit(C2);
	expect(await serverText()).toBe(C2);
	expect(rootClients(server)).toHaveLength(1);
});

test("cold-start reconcile of a discovered note reaches the server exactly once", async () => {
	const { mgr, server, disk, serverText } = await scenario("gate-cold");
	disk.set(PATH, C2);
	await reconcileColdStart({ path: PATH, noteId: ID, diskContent: C2 }, mgr as never, () => {});
	expect(await serverText()).toBe(C2);
	expect(rootClients(server)).toHaveLength(1);
});

test("an unchanged discovered note costs no doc-state read", async () => {
	const { mgr, docStateCalls } = await scenario("gate-unchanged");
	expect(await mgr.applyLocalEdit(ID, C1)).toBe(C1);
	expect(docStateCalls).toEqual([]);
});

test("a note the server does not know yet still seeds (genesis is unaffected)", async () => {
	const { mgr, docStateCalls } = await scenario("gate-genesis");
	const fresh = "id-brand-new";
	expect(await mgr.applyLocalEdit(fresh, "new note")).toBe("new note");
	expect(await mgr.getText(fresh)).toBe("new note");
	expect(docStateCalls).toEqual([]);
});

test("frontmatter saved from an open editor before the load lands is not doubled", async () => {
	// The editor-side duplication: an open note's autosave ingests frontmatter
	// straight into the doc (the binding skips frontmatter keystrokes). Into a
	// held doc that minted rival keys, and the server's state doubled them.
	const FM = `---\ntags:\n  - a\ntitle: x\n---\n${C1}`;
	const { e, mgr, server, ctl, settle } = await scenario("gate-fm", FM);
	ctl.bound = true;
	e.handleModify(new TFile(PATH));
	await settle();
	// The room handshake (or crdt_doc_state) brings the server's state.
	await mgr.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	expect(await mgr.projectedText(ID)).toBe(FM);
});

test("server state with no data, editor open: the gate opens and tells the binding", async () => {
	const { e, mgr, ctl, settle } = await scenario("gate-empty-bound");
	ctl.emptyState = true;
	ctl.bound = true;
	await mgr.getDoc(ID); // resident, as under an open editor
	let opened = 0;
	mgr.onLoadGateOpen(ID, () => opened++);
	await e.loadServerState(ID);
	await settle();
	expect(opened).toBe(1);
	expect(mgr.awaitsServerState(ID)).toBe(false);
	expect((e as any).heldForServer.size).toBe(0);
});

test("server state with no data, note closed: the held edit seeds once", async () => {
	const { e, mgr, ctl, disk, edit, settle } = await scenario("gate-empty-closed");
	ctl.emptyState = true;
	await edit(C2);
	await settle();
	(e as any).time.advance(10); // the re-routed debounced push
	await settle();
	expect(mgr.awaitsServerState(ID)).toBe(false);
	expect(await mgr.projectedText(ID)).toBe(C2);
	expect(disk.get(PATH)).toBe(C2);
});
