/**
 * Create race doubles a note on the racing device (e2e test_84, CI run
 * 45977422865, plugin 46b569d0).
 *
 * An API writer and this device create the same path at the same moment. The
 * API create lands first, so the server row holds API_BODY under the server's
 * own lineage S. On this device, in order:
 *
 *   1. the discovery pull (`applyChange`) maps path -> server id and starts
 *      materializing API_BODY ("rename-trace 3/3 CREATING", targetOnDisk=false);
 *   2. the user's own `vault.create` lands first (PLUGIN_BODY, "vault create
 *      bytes=37"), so the pull's create throws "already exists" and its race
 *      fallback modifies the file to API_BODY ("modify bytes=34");
 *   3. before the pull reaches `markServerKnown`, `pushFile` routes: the id is
 *      the SERVER's (not minted here) but `hasServerNote` is still false, so it
 *      takes the genesis branch and sends `crdt_create` under the server's id
 *      with a THROWAWAY-doc frame of disk (= API_BODY, a fresh lineage G);
 *   4. the backend's `seed_detached` finds the row's text equal to the frame's
 *      text and answers `:stored` (seeded: true) WITHOUT writing: it still holds
 *      S, not G;
 *   5. `seedBodyAfterCreate` reads seeded + sameId + empty doc as "the server
 *      took OUR bytes under OUR id" and applies G locally;
 *   6. the REST write's fan-out delivers S; G and S union ("modify bytes=68").
 *
 * The server and the bystander hold the body once; this device holds it twice.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as decoding from "lib0/decoding";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { seedContentInto } from "../src/crdt/note-seed";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "E2E/Race/Raced.md";
const SERVER_ID = "01a21c7b-2d17-74cb-8ef6-2d22b95e2bd9";
const MARKER = "api-content-f10a417a442a";
const API_BODY = `# Raced\n\n${MARKER}\n`;
const PLUGIN_BODY = "# Raced\n\nplugin-content-f10a417a442a\n";

const textOf = (doc: Y.Doc) => doc.getText("content").toString();
const count = (s: string) => s.split(MARKER).length - 1;

/** A `messageSync` update frame -> its raw Yjs update (inverse of encodeUpdateFrame). */
function frameUpdate(b64: string): Uint8Array {
	const d = decoding.createDecoder(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
	decoding.readVarUint(d); // messageSync
	decoding.readVarUint(d); // messageYjsUpdate
	return decoding.readVarUint8Array(d);
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
}

test("create race: a create racing a discovery write routes as server-known and holds the body once", async () => {
	// The server row, created by the API writer: lineage S.
	const server = new Y.Doc();
	seedContentInto(server, server.getText("content"), API_BODY, false);

	const disk = new Map<string, string>();
	const folders = new Set<string>();
	const map = new NoteIdMap();
	// Holds the pull just before its create, so the user's create wins the path.
	const folderGate = deferred();
	// Holds the pull just after its race-fallback write, before markServerKnown.
	const afterFallback = deferred();
	let pullFallbackWritten = false;

	let e!: SyncEngine;
	const mgr = new ProviderRegistry({
		dbPrefix: `create-race-stored-${Math.random()}`,
		send: () => true,
		onFlushToDisk: async (id, content, _fm, firstLoad) => {
			const p = map.pathForId(id);
			if (!p) return undefined;
			return (await e.flushFromCrdt(p, content, firstLoad ? id : undefined)) === false
				? false
				: undefined;
		},
		isUnchangedSynced: (id, content) => {
			const p = map.pathForId(id);
			return p ? e.isUnchangedSynced(p, content) : false;
		},
		serverHolds: (id) => e.hasServerNote(id),
		onAwaitingServer: (id) => void e.loadServerState(id),
	});
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) =>
				disk.has(p) ? new TFile(p) : folders.has(p) ? ({ path: p } as never) : null,
			),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
				if (!pullFallbackWritten && c === API_BODY) {
					pullFallbackWritten = true;
					await afterFallback.promise;
				}
			}),
			create: mock(async (p: string, c: string) => {
				if (disk.has(p)) throw new Error("File already exists.");
				disk.set(p, c);
				return new TFile(p);
			}),
			createFolder: mock(async (p: string) => {
				await folderGate.promise;
				folders.add(p);
			}),
			rename: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: {
			trashFile: mock().mockResolvedValue(undefined),
			renameFile: mock().mockResolvedValue(undefined),
		},
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
	e.setLiveBoundCheck(() => false);
	e.setCrdtEnrollment({ enroll: mock(), reset: mock() } as never);

	const creates: string[] = [];
	e.setCrdtPorts({
		live: () => true,
		docState: async () => ({ b64: toB64(Y.encodeStateAsUpdate(server)), head: "h1" }),
		// The backend's `seed_detached` (crdt_channel.ex): a frame whose text equals
		// the row's is the idempotent no-write clause and answers `:stored`. The row
		// keeps lineage S; the frame's lineage G is discarded.
		create: async (docId: string, _path: string, b64?: string) => {
			creates.push(docId);
			// The pull resumes while the create is on the wire (step 3 -> 4).
			afterFallback.resolve();
			const frame = new Y.Doc();
			if (b64) Y.applyUpdate(frame, frameUpdate(b64));
			// Only the text-equal clause is modelled; anything else is a test bug.
			expect(textOf(frame)).toBe(textOf(server));
			return { docId: SERVER_ID, seeded: true, genesisOutcome: "stored" };
		},
	} as never);

	// 1. The discovery pull for the API writer's row.
	map.set(PATH, SERVER_ID);
	const pull = e.applyChange({
		id: SERVER_ID,
		path: PATH,
		title: "Raced",
		content: API_BODY,
		folder: "E2E/Race",
		tags: [],
		mtime: Date.now() / 1000,
		updated_at: new Date().toISOString(),
		deleted: false,
		version: 1,
		content_hash: "hash-api",
	} as never);
	await new Promise((r) => setTimeout(r, 0));

	// 2. The user's own create lands first, then the pull's create loses the race.
	disk.set(PATH, PLUGIN_BODY);
	folderGate.resolve();
	while (!pullFallbackWritten) await new Promise((r) => setTimeout(r, 1));
	expect(disk.get(PATH)).toBe(API_BODY);

	// 3. The user's push (push_file_now: pushFile(file, true)), routed while the
	// pull is still inside its write. Before the fix it saw no head here and sent
	// a genesis crdt_create under the server's id (the create port above then
	// resumes the pull); now it must route as a server-known note.
	const push = (e as any).pushFile(new TFile(PATH), true);
	await new Promise((r) => setTimeout(r, 10));
	afterFallback.resolve();
	await push;
	await pull;

	// 6. The API write's fan-out delivers the server's own lineage.
	await e.applyPushedNoteUpdate(SERVER_ID, Y.encodeStateAsUpdate(server), "h2");
	await new Promise((r) => setTimeout(r, 20));

	// The server never doubled: the race is local to this device.
	expect(count(textOf(server))).toBe(1);
	const local = textOf(await mgr.getDoc(SERVER_ID));
	expect({ doc: count(local), disk: count(disk.get(PATH) ?? "") }).toEqual({ doc: 1, disk: 1 });
	// No conflict copy, no rename, nothing trashed.
	expect([...disk.keys()]).toEqual([PATH]);
	expect(app.vault.rename).not.toHaveBeenCalled();
	expect(app.fileManager.renameFile).not.toHaveBeenCalled();
	expect(app.fileManager.trashFile).not.toHaveBeenCalled();
	// A server-known note: no genesis create at all.
	expect(creates).toEqual([]);
});
