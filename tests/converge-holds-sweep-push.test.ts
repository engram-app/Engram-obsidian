/**
 * Engram-obsidian#666: device B's catch-up found local AND remote diverged,
 * copied the local drift to a "(conflict)" file and staged the main file's
 * convergence (`pendingConvergence`). A concurrent sweep push of the same note
 * then diffed the stale on-disk text into a doc that already held the
 * server's edit, and deleted it. While a convergence is staged the disk is
 * known-stale, so the push must wait for the commit and then re-read disk.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry } from "../src/crdt/provider-registry";
import { createCrdtWiring } from "../src/crdt/wiring";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "a.md";
const ID = "id-converge";
const BASE = "# a\nbase\n";
const SERVER_EDIT = "server edit\n";
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function device() {
	const server = new Y.Doc();
	server.getText(CONTENT_KEY).insert(0, BASE);
	const disk = new Map<string, string>([[PATH, BASE]]);
	const file = new TFile(PATH);
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			// The converge's own write never lands in this test: the sweep wins the race.
			modify: mock(async () => {
				await tick(10_000);
			}),
			getMarkdownFiles: mock(() => [file]),
			getFiles: mock(() => [file]),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const map = new NoteIdMap();
	map.set(PATH, ID);
	const engine = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 5 },
		mock().mockResolvedValue(undefined),
	);
	const wiring = createCrdtWiring({
		ackScope: () => "s",
		noteIdMap: map,
		syncEngine: engine,
		canSendLive: () => true,
		isBound: () => false,
		onBoundUpdate: () => {},
		sendCrdt: () => true,
	} as any);
	const reg = wiring.manager as ProviderRegistry;
	engine.setCrdtManager(reg);
	engine.setNoteIdMap(map);
	engine.setLiveBoundCheck(() => false);
	engine.setCrdtLiveCheck(() => true);
	engine.setReady();
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	await tick(10);
	engine.importSyncState({ [PATH]: { hash: fnv1a(BASE), crdtHead: "h0" } });
	return { engine: engine as any, server, reg, disk, file };
}

test("a sweep push waits for a staged convergence and never deletes the server edit", async () => {
	const { engine, server, reg, disk, file } = await device();
	// Disk holds a local edit (copied to the conflict file); the doc is about to
	// hold the server's edit, which has not reached disk.
	disk.set(PATH, `${BASE}local edit\n`);
	engine.stageConvergence(ID, PATH, "srv-hash", `${BASE}${SERVER_EDIT}`);
	const before = Y.encodeStateVector(server);
	server.getText(CONTENT_KEY).insert(BASE.length, SERVER_EDIT);
	// Not awaited: the merge lands in the doc at once, its flush (slow write) later.
	void reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server, before));
	await tick(20);

	await engine.pushFile(file);

	expect(await reg.projectedText(ID)).toContain(SERVER_EDIT);

	// Convergence commits: the held push is not lost, it runs against re-read disk.
	disk.set(PATH, `${BASE}${SERVER_EDIT}kept local\n`);
	await engine.commitCrdtConvergence(ID);
	await tick(80);
	const doc = await reg.projectedText(ID);
	expect(doc).toContain(SERVER_EDIT);
	expect(doc).toContain("kept local\n");
	await reg.destroyAll();
});
