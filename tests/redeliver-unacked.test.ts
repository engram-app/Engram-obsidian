/**
 * A live `crdt_msg` has no ack. One sent on a socket that was already dead (an
 * iOS resume runs the debounced push before the channel's probe finds the
 * socket dead) went nowhere, while the echo baseline said disk was synced: the
 * sweep skipped it, catch-up saw nothing newer on the server, and the edit
 * never left the device (fuzz seed 21). Delivery is proven by an ACK, so every
 * crdt join re-sends, room-free, what the server never acked.
 *
 * Real ProviderRegistry over fake-indexeddb; the engine's ports stand in for
 * the server.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { fromB64 } from "../src/crdt/wire";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

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

function updateOf(b64: string): Uint8Array {
	const dec = decoding.createDecoder(fromB64(b64));
	decoding.readVarUint(dec);
	decoding.readVarUint(dec);
	return decoding.readVarUint8Array(dec);
}

let prefixSeq = 0;

/** A device holding a server-synced note, with every send "succeeding" (the
 *  half-dead socket takes the frame and drops it). */
async function device(opts: { docUpdateFails?: boolean } = {}) {
	const server = new Y.Doc();
	server.getText(CONTENT_KEY).insert(0, "hello");
	const reg = new ProviderRegistry({
		ackScope: () => "https://api|vault-1",
		dbPrefix: `redeliver-${++prefixSeq}`,
		send: () => true,
		onFlushToDisk: async () => true,
	});
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	const engine = new SyncEngine(
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
	engine.importSyncState({ [PATH]: { hash: 1, crdtHead: "h1" } });
	const enroll = mock();
	const reset = mock();
	engine.setCrdtEnrollment({ enroll, reset } as any);
	const docUpdate = mock(async (_id: string, b64: string) => {
		if (opts.docUpdateFails) throw new Error("doc_update_failed");
		Y.applyUpdate(server, updateOf(b64));
		return { head: "h2" };
	});
	engine.setCrdtPorts({ docUpdate });
	reg.setConnected(true);
	return { engine, reg, server, docUpdate, enroll };
}

describe("a crdt join re-sends what the server never acked", () => {
	test("an edit sent on a dead socket reaches the server, once", async () => {
		const { engine, reg, server, docUpdate } = await device();
		await reg.applyLocalEdit(ID, "hello world"); // the push that went nowhere

		await engine.selfHealSweep();

		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(server.getText(CONTENT_KEY).toString()).toBe("hello world");
		// Acked now: the next join has nothing to re-send.
		await engine.selfHealSweep();
		expect(docUpdate).toHaveBeenCalledTimes(1);
		await reg.destroyAll();
	});

	test("a doc holding only server state is not re-sent", async () => {
		const { engine, reg, docUpdate } = await device();

		await engine.selfHealSweep();

		expect(docUpdate).not.toHaveBeenCalled();
		await reg.destroyAll();
	});

	test("a failed room-free write falls back to the pooled re-handshake", async () => {
		const { engine, reg, docUpdate, enroll } = await device({ docUpdateFails: true });
		await reg.applyLocalEdit(ID, "hello world");

		await engine.selfHealSweep();

		expect(docUpdate).toHaveBeenCalledTimes(1);
		expect(enroll).toHaveBeenCalledWith(ID);
		await reg.destroyAll();
	});

	test("a note whose create is unacked is left to its create", async () => {
		const { engine, reg, docUpdate } = await device();
		(engine as any).syncState.set(PATH, { hash: 1 }); // no crdtHead: not server-known
		await reg.applyLocalEdit(ID, "hello world");

		await engine.selfHealSweep();

		expect(docUpdate).not.toHaveBeenCalled();
		await reg.destroyAll();
	});

	test("an offline engine re-sends nothing (the periodic poll calls this too)", async () => {
		const { engine, reg, docUpdate, enroll } = await device();
		await reg.applyLocalEdit(ID, "hello world");
		(engine as any).offline = true;

		await engine.selfHealSweep();

		expect(docUpdate).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
		await reg.destroyAll();
	});

	test("a latched crdt_doc_update opens no heal room: it is not a failed write", async () => {
		const { engine, reg, docUpdate, enroll } = await device();
		await reg.applyLocalEdit(ID, "hello world");
		(engine as any).unsupportedFrames.set("crdt_doc_update", {
			until: Date.now() + 60_000,
			latches: 1,
		});

		await engine.selfHealSweep();

		expect(docUpdate).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
		await reg.destroyAll();
	});

	test("a sweep re-sends at most REDELIVER_PER_SWEEP docs; the next one drains the rest", async () => {
		const { engine, reg, docUpdate } = await device();
		const map = (engine as any).noteIdMap as NoteIdMap;
		const rows: Record<string, { hash: number; crdtHead: string }> = {};
		for (let i = 1; i <= 60; i++) {
			const id = `id-${i}`;
			const path = `Notes/n${i}.md`;
			const doc = new Y.Doc();
			doc.getText(CONTENT_KEY).insert(0, "hello");
			await reg.applyRemoteUpdate(id, Y.encodeStateAsUpdate(doc));
			await reg.applyLocalEdit(id, "hello world");
			map.set(path, id);
			rows[path] = { hash: 1, crdtHead: "h1" };
		}
		engine.importSyncState({ [PATH]: { hash: 1, crdtHead: "h1" }, ...rows });

		await engine.selfHealSweep();
		expect(docUpdate).toHaveBeenCalledTimes(50);

		await engine.selfHealSweep();
		expect(docUpdate).toHaveBeenCalledTimes(60);
		await reg.destroyAll();
	});
});
