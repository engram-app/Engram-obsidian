/**
 * Three `note_yjs_update` fan-outs for one idle note reached A within 33 ms
 * while A's own append was still only on disk (real-Obsidian gauntlet
 * 40247603066). A logged `modify bytes=84` (both lines) then `modify bytes=60`
 * in the same ms, and A's line ended up DELETED in the shared history.
 *
 * Real ProviderRegistry wired to the engine the way wiring.ts wires it
 * (onFlushToDisk -> flushFromCrdt), a disk whose writes take real time and
 * fire Obsidian's modify event, and the fan-outs delivered the way the
 * channel delivers them: fire-and-forget, back to back.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry } from "../src/crdt/provider-registry";
import { toB64 } from "../src/crdt/wire";
import { createCrdtWiring } from "../src/crdt/wiring";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "a.md";
const ID = "id-a";
const BASE = "# a\nbase\n";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("three back-to-back fan-outs and a pending local append keep every line", async () => {
	const server = new Y.Doc();
	server.getText(CONTENT_KEY).insert(0, BASE);

	const disk = new Map<string, string>([[PATH, BASE]]);
	const file = new TFile(PATH);
	let engine!: SyncEngine;
	// A write takes a few ms and then fires the vault modify event, as
	// Obsidian does for every write, the plugin's own included.
	const modify = mock(async (f: TFile, content: string) => {
		await tick(2);
		disk.set(f.path, content);
		engine.handleModify(f);
	});
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
			cachedRead: mock(async (f: TFile) => {
				await tick(1);
				return disk.get(f.path) ?? "";
			}),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify,
			getMarkdownFiles: mock(() => [file]),
			getFiles: mock(() => [file]),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const sent: Uint8Array[] = [];
	const map = new NoteIdMap();
	map.set(PATH, ID);
	engine = new SyncEngine(
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
		sendCrdt: (_id: string, frame: string) => {
			sent.push(new TextEncoder().encode(frame));
			return true;
		},
	} as any);
	const reg = wiring.manager as ProviderRegistry;
	engine.setCrdtManager(reg);
	engine.setNoteIdMap(map);
	engine.setLiveBoundCheck(() => false);
	engine.setCrdtLiveCheck(() => true);
	engine.setReady();
	// A synced note: the doc holds the server lineage, the baseline is BASE.
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	await tick(10);
	engine.importSyncState({ [PATH]: { hash: fnv1a(BASE), crdtHead: "h0" } });

	// A appends a line on disk; its debounced push has not fired yet.
	disk.set(PATH, `${BASE}A line\n`);
	engine.handleModify(file);

	// B appends three times; each update reaches A as a fan-out, back to back.
	for (const line of ["B one\n", "B two\n", "B three\n"]) {
		const before = Y.encodeStateVector(server);
		const t = server.getText(CONTENT_KEY);
		t.insert(t.length, line);
		wiring.onNoteYjsUpdate(ID, toB64(Y.encodeStateAsUpdate(server, before)), "h", null);
	}
	await tick(200);

	const doc = await reg.projectedText(ID);
	expect(doc).toContain("A line\n");
	expect(doc).toContain("B three\n");
	expect(disk.get(PATH)).toBe(doc);
	await reg.destroyAll();
});

test("a modify event for the plugin's own in-flight write is not pushed as a local edit", async () => {
	const file = new TFile(PATH);
	const applyLocalEdit = mock(async (_id: string, c: string) => c);
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead: mock(async () => "flushed by us"),
			getAbstractFileByPath: mock(() => file),
			getFileByPath: mock(() => file),
			getName: mock().mockReturnValue("Test Vault"),
		},
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const engine = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	) as any;
	engine.setCrdtManager({ applyLocalEdit, isCrdtEligible: () => true } as never);
	engine.setReady();
	const map = new NoteIdMap();
	map.set(PATH, ID);
	engine.setNoteIdMap(map);
	engine.importSyncState({ [PATH]: { hash: fnv1a("older baseline"), crdtHead: "h" } });
	// flushFromCrdt registers the bytes it is writing before the write starts.
	engine.flushingHash.set(PATH, new Map([[fnv1a("flushed by us"), 1]]));

	expect(await engine.pushFile(file)).toBe(false);
	expect(applyLocalEdit).not.toHaveBeenCalled();
});
