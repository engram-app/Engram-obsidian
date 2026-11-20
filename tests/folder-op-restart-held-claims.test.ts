// e2e test_107 test_restart_with_folder_op_pending (backend run 44655471041,
// plugin e6aec9dd): A renamed a folder with its op still pending and
// reloaded. The op's moves had been staged in the id map and held local; a
// reload keeps only data.json's cache, which the server's committed claims
// (still the OLD paths until the op lands) outrank. So after the reload every
// note under the folder resolved to its OLD path, and once the op was acked,
// before the server's re-key reached this device, a CRDT flush of a peer's
// edit recreated the note at the old path ("A moved files back to the old
// folder after the reload"). Restoring a pending op must restore its held
// claims too.
import { afterEach, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const engines: SyncEngine[] = [];
afterEach(() => {
	for (const e of engines) e.destroy();
	engines.length = 0;
});

const OLD = "E2E/Rst107";
const NEW = "E2E/Rst107-done";

test("a pending folder op restored after a reload keeps its notes at the new path", async () => {
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const engine = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	// The reload: data.json's cache has the moved paths (the held overlay was
	// saved), the room is empty until it syncs.
	const ids = new NoteIdMap();
	ids.seed({ [`${NEW}/a.md`]: "na", [`${NEW}/sub/b.md`]: "nb" });
	engine.setCrdtPorts({ noteIdMap: ids });
	engine.restoreFolderOps([
		{
			op: "move",
			op_id: "op1",
			folder_id: "fD",
			parent_id: "fE",
			name: "Rst107-done",
			from: OLD,
			to: NEW,
			vaultId: "v1",
		},
	]);
	ids.flushNow();
	// The room syncs: the server still names the OLD paths (op not applied).
	const server = new Y.Doc();
	const sm = server.getMap<any>("filemeta_v0");
	sm.set(`${OLD}/a.md`, { note_id: "na" });
	sm.set(`${OLD}/sub/b.md`, { note_id: "nb" });
	Y.applyUpdate(ids.store.doc!, Y.encodeStateAsUpdate(server), "remote");
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
	expect(ids.pathForId("nb")).toBe(`${NEW}/sub/b.md`);
	// Held local while the op is pending: nothing published ahead of it.
	expect(ids.store.doc!.getMap<any>("filemeta_v0").has(`${NEW}/a.md`)).toBe(false);
	// The op is answered: the claims go out, matching what the server now holds.
	(engine.folderOps as any).queue.clear();
	ids.flushNow();
	expect(ids.store.doc!.getMap<any>("filemeta_v0").get(`${NEW}/a.md`)).toEqual({ note_id: "na" });
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
});

// Without a reload there is no window: the op's staged claims are still in
// the overlay when it is answered, so reads keep the new paths until the
// server's re-key lands (they are published at the next commit).
test("no reload: the claims staged by a pending op survive its ack", async () => {
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const engine = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	const ids = new NoteIdMap();
	engine.setCrdtPorts({ noteIdMap: ids });
	const server = new Y.Doc();
	server.getMap<any>("filemeta_v0").set(`${OLD}/a.md`, { note_id: "na" });
	Y.applyUpdate(ids.store.doc!, Y.encodeStateAsUpdate(server), "remote");
	engine.folderOps.load([
		{
			op: "move",
			op_id: "op1",
			folder_id: "fD",
			parent_id: "fE",
			name: "Rst107-done",
			from: OLD,
			to: NEW,
			vaultId: "v1",
		},
	]);
	ids.set(`${NEW}/a.md`, "na"); // the op's own re-key, held
	ids.flushNow();
	expect(ids.store.doc!.getMap<any>("filemeta_v0").has(`${NEW}/a.md`)).toBe(false);
	(engine.folderOps as any).queue.clear(); // answered; the server re-key not here yet
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
});

// Question 2 (no reload): between the op's ack and the server's re-key reaching
// this device, does any lookup a CRDT flush makes still answer the OLD path?
// The ack runs onFolderOpLeft, which commits the held claims (NEW set, OLD
// removed) into the local index doc before anything else runs, so the window
// closes at the ack itself. A server frame still naming OLD that crosses the
// re-key (sent before the server saw our commit) must not reopen it either.
test("no reload: after the ack, a stale server frame naming OLD does not move the note back", async () => {
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const engine = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
	);
	engines.push(engine);
	const ids = new NoteIdMap();
	engine.setCrdtPorts({ noteIdMap: ids });
	const server = new Y.Doc();
	server.getMap<any>("filemeta_v0").set(`${OLD}/a.md`, { note_id: "na" });
	Y.applyUpdate(ids.store.doc!, Y.encodeStateAsUpdate(server), "remote");
	engine.folderOps.load([
		{
			op: "move",
			op_id: "op1",
			folder_id: "fD",
			parent_id: "fE",
			name: "Rst107-done",
			from: OLD,
			to: NEW,
			vaultId: "v1",
		},
	]);
	ids.rename(`${OLD}/a.md`, `${NEW}/a.md`); // the op's own re-key, held
	ids.flushNow();
	expect(ids.store.doc!.getMap<any>("filemeta_v0").has(`${OLD}/a.md`)).toBe(true);
	// The ack: the op leaves the queue and onFolderOpLeft runs.
	(engine.folderOps as any).queue.clear();
	(engine as any).onFolderOpLeft(NEW, true);
	const local = ids.store.doc!.getMap<any>("filemeta_v0");
	expect(local.has(`${OLD}/a.md`)).toBe(false);
	expect(local.get(`${NEW}/a.md`)).toEqual({ note_id: "na" });
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
	// A server frame concurrent with our commit, re-asserting OLD.
	server.getMap<any>("filemeta_v0").set(`${OLD}/a.md`, { note_id: "na", hash: "h2" });
	Y.applyUpdate(ids.store.doc!, Y.encodeStateAsUpdate(server), "remote");
	expect(ids.pathForId("na")).toBe(`${NEW}/a.md`);
});
