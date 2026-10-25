/**
 * Engram#2242 root cause: "has undelivered ops" was the in-memory handshake
 * `synced` flag, false at every launch and wiped on every disconnect, and the
 * #1493 delivery receipt lived in memory only. So after a restart or a resume
 * every resident idle doc read as undelivered, the room-free read was refused,
 * and every diverged one took a room (805 in 3 minutes from one iPhone).
 *
 * The fix records the last SERVER-ACKNOWLEDGED snapshot per doc in the doc's
 * own y-indexeddb store (the custom store Relay uses for `serverSync`). These
 * tests run the real ProviderRegistry over fake-indexeddb, restart it for
 * real, and count rooms and room-free writes through the engine's ports.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type SyncNoteChange } from "../src/types";

const ID = "id-0";
const PATH = "Notes/n0.md";

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		getName: mock().mockReturnValue("Test Vault"),
	},
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

let prefixSeq = 0;

/** A server doc plus a device that synced it once, then quit. */
async function deviceThatSyncedThenQuit() {
	const prefix = `acked-${++prefixSeq}`;
	const server = new Y.Doc();
	server.getText(CONTENT_KEY).insert(0, "hello");
	const first = new ProviderRegistry({
		dbPrefix: prefix,
		send: () => true,
		onFlushToDisk: async () => true,
	});
	await first.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	await first.destroyAll(); // the app is killed
	// Someone else edits while this device is away: the note is diverged.
	server.getText(CONTENT_KEY).insert(5, " world");
	return { prefix, server };
}

/** Relaunch: a fresh registry over the same IndexedDB, wired to an engine. */
async function relaunch(prefix: string, server: Y.Doc) {
	let engine: SyncEngine;
	const reg = new ProviderRegistry({
		dbPrefix: prefix,
		send: () => true,
		onFlushToDisk: async () => true,
		onSynced: (id) => void engine.commitCrdtConvergence(id),
	});
	engine = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager(reg);
	engine.setReady();
	const map = new NoteIdMap();
	map.set(PATH, ID);
	engine.setNoteIdMap(map);
	engine.importSyncState({ [PATH]: { hash: 1, serverHash: "H1" } });
	const enroll = mock();
	engine.setCrdtEnrollment({ enroll, reset: () => {} } as any);
	const docState = mock(async () => ({ b64: toB64(Y.encodeStateAsUpdate(server)), head: "h" }));
	const docUpdate = mock(async (_id: string, _b64: string) => ({ head: "h2" }));
	engine.setCrdtPorts({ docState, docUpdate });
	// The doc is resident, as every first-synced doc was on the phone, and the
	// socket is up.
	reg.setConnected(true);
	await reg.getText(ID);
	return { engine, reg, enroll, docState, docUpdate };
}

const change = { id: ID, path: PATH, content_hash: "H2", version: 2, seq: 2 } as SyncNoteChange;

function converge(engine: SyncEngine): Promise<void> {
	return (engine as any).convergeColdNoteRoomFree(ID, PATH, change, "hello world", "H2");
}

describe("the server-acked state survives a restart (Engram#2242)", () => {
	test("restart, reconnect, no local edits: 0 rooms and 0 room-free writes", async () => {
		const { prefix, server } = await deviceThatSyncedThenQuit();
		const { engine, reg, enroll, docState, docUpdate } = await relaunch(prefix, server);

		await converge(engine);

		expect(enroll).not.toHaveBeenCalled();
		expect(docUpdate).not.toHaveBeenCalled();
		expect(docState).toHaveBeenCalledTimes(1);
		expect(await reg.getText(ID)).toBe("hello world");
		await reg.destroyAll();
	});

	test("a disconnect (clearSynced) without a restart: still 0 rooms", async () => {
		const { prefix, server } = await deviceThatSyncedThenQuit();
		const { engine, reg, enroll, docUpdate } = await relaunch(prefix, server);
		reg.setConnected(true);
		reg.setConnected(false);
		reg.clearSynced();

		await converge(engine);

		expect(enroll).not.toHaveBeenCalled();
		expect(docUpdate).not.toHaveBeenCalled();
		await reg.destroyAll();
	});

	test("a real local edit goes room-free write, then room-free read: 0 rooms", async () => {
		const { prefix, server } = await deviceThatSyncedThenQuit();
		const { engine, reg, enroll, docState, docUpdate } = await relaunch(prefix, server);
		(await reg.getDoc(ID)).getText(CONTENT_KEY).insert(0, "local ");

		await converge(engine);

		expect(enroll).not.toHaveBeenCalled();
		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(docState).toHaveBeenCalledTimes(1);
		// Both sides' work is in the doc.
		const text = await reg.getText(ID);
		expect(text).toContain("local ");
		expect(text).toContain("world");
		await reg.destroyAll();
	});

	test("a local edit made while the app was away is never read as delivered", async () => {
		// The persisted snapshot is compared with the doc as hydrated, so an edit
		// that reached IndexedDB but not the server reads as undelivered.
		const { prefix, server } = await deviceThatSyncedThenQuit();
		const offline = new ProviderRegistry({
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: async () => true,
		});
		(await offline.getDoc(ID)).getText(CONTENT_KEY).insert(0, "offline ");
		await offline.destroyAll();
		const { engine, reg, enroll, docUpdate } = await relaunch(prefix, server);

		await converge(engine);

		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(enroll).not.toHaveBeenCalled();
		await reg.destroyAll();
	});
});
