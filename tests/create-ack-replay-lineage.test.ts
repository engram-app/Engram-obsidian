/**
 * A queued create replayed after a lost ack (the second shape of e2e test_84).
 *
 * The first `crdt_create` landed and the server stored that frame's lineage
 * G1, but the ack never arrived, so the durable queue replays the create.
 * `buildGenesisFrame` rebuilds the body in a throwaway doc at send time: a
 * fresh lineage G2 carrying the same text. What the client must end with
 * depends on what the backend answers:
 *
 *  - backend >= the create-race fix: G2 is not contained in the row, so it
 *    answers `occupied`; the client adopts G1 and holds the body once;
 *  - any backend, a GENUINE retry of the exact stored bytes: `stored`; the
 *    client applies its own frame (the cheap route, no round trip), which is
 *    the row's own lineage, so nothing doubles.
 *
 * Real ProviderRegistry, wired as `createCrdtWiring` wires it.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "Notes/Queued.md";
const MARKER = "queued body line";
const BODY = `# Queued\n\n${MARKER}\n`;
const REMOTE = "edit from another device\n";

const textOf = (doc: Y.Doc) => doc.getText("content").toString();
const count = (s: string) => s.split(MARKER).length - 1;

async function scenario(dbPrefix: string) {
	const disk = new Map<string, string>([[PATH, BODY]]);
	const map = new NoteIdMap();
	const docStateCalls: string[] = [];
	let e!: SyncEngine;
	const mgr = new ProviderRegistry({
		dbPrefix,
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

	// This device minted the id; the first create's ack was lost.
	const id = map.mint(PATH);
	const server = new Y.Doc();
	e.setCrdtPorts({
		live: () => true,
		docState: async (docId: string) => {
			docStateCalls.push(docId);
			return { b64: toB64(Y.encodeStateAsUpdate(server)), head: "h1" };
		},
	} as never);
	/** The first attempt's frame, stored by the server. */
	const landFirstAttempt = async () => {
		const first = await e.buildGenesisFrame(PATH, id);
		if (!first) throw new Error("no genesis frame");
		Y.applyUpdate(server, first.update);
		return first;
	};
	/** Another device edits the stored note; its update fans out here. */
	const remoteEditFansOut = async () => {
		const other = new Y.Doc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(server));
		other.getText("content").insert(other.getText("content").length, REMOTE);
		Y.applyUpdate(server, Y.encodeStateAsUpdate(other));
		await e.applyPushedNoteUpdate(id, Y.encodeStateAsUpdate(server), "h2");
		await new Promise((r) => setTimeout(r, 20));
	};
	const outcome = async () => ({
		doc: count(textOf(await mgr.getDoc(id))),
		disk: count(disk.get(PATH) ?? ""),
		remote: (disk.get(PATH) ?? "").includes(REMOTE),
		files: [...disk.keys()],
		renamed: app.vault.rename.mock.calls.length + app.fileManager.renameFile.mock.calls.length,
		trashed: app.fileManager.trashFile.mock.calls.length,
	});
	return { e, id, server, landFirstAttempt, remoteEditFansOut, outcome, docStateCalls };
}

const SINGLE = { doc: 1, disk: 1, remote: true, files: [PATH], renamed: 0, trashed: 0 };

test("lost-ack replay with a rebuilt frame: occupied adopts the stored lineage, body once", async () => {
	const s = await scenario(`replay-occupied-${Math.random()}`);
	await s.landFirstAttempt();
	const replay = await s.e.buildGenesisFrame(PATH, s.id);
	expect(replay).toBeDefined();
	// The rebuilt frame is a rival: its union with the row doubles the text,
	// which is why the backend answers `occupied` rather than `stored`.
	const union = new Y.Doc();
	Y.applyUpdate(union, Y.encodeStateAsUpdate(s.server));
	Y.applyUpdate(union, replay?.update as Uint8Array);
	expect(count(textOf(union))).toBe(2);

	await s.e.applyCrdtCreateAck(s.id, s.id, PATH, false, replay, "occupied");
	await s.remoteEditFansOut();

	expect(s.docStateCalls).toEqual([s.id]); // adopted over crdt_doc_state
	expect(await s.outcome()).toEqual(SINGLE);
});

test("genuine retry of the stored bytes (old or new backend): stored applies the frame, body once", async () => {
	// Backward compatibility: `stored` with no extra field keeps the cheap
	// route. The frame IS the row's lineage here, so applying it is a no-op
	// merge against every later server update.
	const s = await scenario(`replay-stored-${Math.random()}`);
	const first = await s.landFirstAttempt();

	await s.e.applyCrdtCreateAck(s.id, s.id, PATH, true, first, "stored");
	await s.remoteEditFansOut();

	expect(s.docStateCalls).toEqual([]); // no adopt round trip
	expect(await s.outcome()).toEqual(SINGLE);
});
