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
import { describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { fromB64, toB64 } from "../src/crdt/wire";
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
		ackScope: () => "https://api|vault-1",
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

/** The Yjs update inside a `crdt_doc_update` frame. */
function updateOf(b64: string): Uint8Array {
	const dec = decoding.createDecoder(fromB64(b64));
	decoding.readVarUint(dec); // messageSync
	decoding.readVarUint(dec); // messageYjsUpdate
	return decoding.readVarUint8Array(dec);
}

/** Relaunch: a fresh registry over the same IndexedDB, wired to an engine. */
async function relaunch(prefix: string, server: Y.Doc, ackScope = "https://api|vault-1") {
	let engine: SyncEngine;
	const reg = new ProviderRegistry({
		ackScope: () => ackScope,
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
	// The server really stores what it acks: the read after a write must see it.
	const docUpdate = mock(async (_id: string, b64: string) => {
		Y.applyUpdate(server, updateOf(b64));
		return { head: "h2" };
	});
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

describe("the acked mark is checked, scoped and cheap (Engram#2242 review)", () => {
	test("a server ROLLBACK that lost an acked edit makes the idle note re-send it", async () => {
		const prefix = `acked-${++prefixSeq}`;
		const scope = () => "https://api|vault-1";
		let server = new Y.Doc();
		server.getText(CONTENT_KEY).insert(0, "hello");
		const beforeEdit = Y.encodeStateAsUpdate(server);
		const first = new ProviderRegistry({
			ackScope: scope,
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: async () => true,
		});
		first.setConnected(true);
		await first.applyRemoteUpdate(ID, beforeEdit);
		(await first.getDoc(ID)).getText(CONTENT_KEY).insert(0, "mine ");
		const receipt = await first.encodeDeliveryReceipt(ID);
		Y.applyUpdate(server, await first.encodeStateAsUpdate(ID));
		first.markDelivered(ID, receipt); // the server acked "mine "
		await first.destroyAll();

		// Point-in-time restore: the server is back to before the edit, then
		// someone else writes.
		server = new Y.Doc();
		Y.applyUpdate(server, beforeEdit);
		server.getText(CONTENT_KEY).insert(5, " world");

		const { engine, reg, enroll, docUpdate } = await relaunch(prefix, server);
		await converge(engine);

		expect(enroll).not.toHaveBeenCalled();
		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(server.getText(CONTENT_KEY).toString()).toContain("mine ");
		await reg.destroyAll();
	});

	test("the mark is scoped to the server and vault: another server never inherits it", async () => {
		const { prefix, server } = await deviceThatSyncedThenQuit();
		const { engine, reg, docUpdate } = await relaunch(prefix, server, "https://other|vault-1");

		await converge(engine);

		// No mark for this server, so the hydrated doc is undelivered: it is sent.
		expect(docUpdate).toHaveBeenCalledTimes(1);
		await reg.destroyAll();
	});

	test("a server update between taking the receipt and the ack is not claimed as acked", async () => {
		const reg = new ProviderRegistry({
			dbPrefix: `acked-${++prefixSeq}`,
			send: () => true,
			onFlushToDisk: async () => true,
		});
		reg.setConnected(true);
		await reg.applyLocalEdit(ID, "hello");
		const receipt = await reg.encodeDeliveryReceipt(ID);
		const peer = new Y.Doc();
		peer.getText(CONTENT_KEY).insert(0, "from elsewhere ");
		await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(peer));
		reg.markDelivered(ID, receipt);

		// The ack covers exactly the receipt, never the merge that raced it.
		expect(reg.deliveredStateVector(ID)).toEqual(
			Y.encodeStateVector(Y.decodeSnapshot(receipt).sv),
		);
		expect(reg.hasCurrentDeliveryReceipt(ID)).toBe(false);
		await reg.destroyAll();
	});

	test("remote updates persist the mark on a debounce, not one IndexedDB write each", async () => {
		const reg = new ProviderRegistry({
			dbPrefix: `acked-${++prefixSeq}`,
			send: () => true,
			onFlushToDisk: async () => true,
		});
		const server = new Y.Doc();
		await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
		const persistence = reg.docs.get(ID)!.persistence;
		const set = spyOn(persistence, "set");
		for (let i = 0; i < 50; i++) {
			const before = Y.encodeStateVector(server);
			server.getText(CONTENT_KEY).insert(0, "x");
			await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server, before));
		}
		expect(set).not.toHaveBeenCalled();

		await reg.flushAcked();
		expect(set).toHaveBeenCalledTimes(1);
		expect(reg.hasCurrentDeliveryReceipt(ID)).toBe(true);
		await reg.destroyAll();
	});

	test("a server ROLLBACK that lost an acked DELETE makes the idle note re-send it", async () => {
		// A delete advances no clock, so a state-vector check alone cannot see it.
		const prefix = `acked-${++prefixSeq}`;
		const scope = () => "https://api|vault-1";
		let server = new Y.Doc();
		server.getText(CONTENT_KEY).insert(0, "hello world");
		const beforeDelete = Y.encodeStateAsUpdate(server);
		const first = new ProviderRegistry({
			ackScope: scope,
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: async () => true,
		});
		first.setConnected(true);
		await first.applyRemoteUpdate(ID, beforeDelete);
		(await first.getDoc(ID)).getText(CONTENT_KEY).delete(5, 6);
		const receipt = await first.encodeDeliveryReceipt(ID);
		Y.applyUpdate(server, await first.encodeStateAsUpdate(ID));
		first.markDelivered(ID, receipt); // the server acked the delete
		await first.destroyAll();

		server = new Y.Doc(); // restored to before the delete
		Y.applyUpdate(server, beforeDelete);
		const { engine, reg, enroll, docUpdate } = await relaunch(prefix, server);
		await converge(engine);

		expect(enroll).not.toHaveBeenCalled();
		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(server.getText(CONTENT_KEY).toString()).toBe("hello");
		await reg.destroyAll();
	});

	test("the mark is filed under the scope the note LOADED with, not the one live at save", async () => {
		const { prefix, server } = await deviceThatSyncedThenQuit();
		let scope = "https://api|vault-1";
		const reg = new ProviderRegistry({
			ackScope: () => scope,
			dbPrefix: prefix,
			send: () => true,
			onFlushToDisk: async () => true,
		});
		await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
		scope = "https://api|vault-2"; // a vault switch before the debounce fires
		await reg.destroyAll();

		const { engine, reg: again, docUpdate } = await relaunch(prefix, server);
		await converge(engine);
		// Still vault-1's mark: nothing to re-send.
		expect(docUpdate).not.toHaveBeenCalled();
		await again.destroyAll();
	});
});
