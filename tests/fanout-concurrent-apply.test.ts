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
import { describe, expect, mock, test } from "bun:test";
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
let deviceSeq = 0;
let ID = "id-a";
const BASE = "# a\nbase\n";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A device holding a synced idle note: the real registry wired to the engine
 *  as wiring.ts wires it, a disk whose writes take time and fire Obsidian's
 *  modify event. `writesTake(ms)` slows every later write. `bind(true)`
 *  makes the note editor-bound, so a remote merge nudges instead of writing. */
async function device() {
	ID = `id-a-${++deviceSeq}`;
	const server = new Y.Doc();
	server.getText(CONTENT_KEY).insert(0, BASE);

	const disk = new Map<string, string>([[PATH, BASE]]);
	const file = new TFile(PATH);
	let engine!: SyncEngine;
	// A write takes a few ms and then fires the vault modify event, as
	// Obsidian does for every write, the plugin's own included.
	let writeMs = 2;
	let bound = false;
	const modify = mock(async (f: TFile, content: string) => {
		await tick(writeMs);
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
		isBound: () => bound,
		onBoundUpdate: () => {},
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

	const push = (line: string) => {
		const before = Y.encodeStateVector(server);
		const t = server.getText(CONTENT_KEY);
		t.insert(t.length, line);
		wiring.onNoteYjsUpdate(ID, toB64(Y.encodeStateAsUpdate(server, before)), "h", null);
	};
	return {
		engine,
		map,
		server,
		reg,
		disk,
		file,
		push,
		writesTake: (ms: number) => {
			writeMs = ms;
		},
		bind: (v: boolean) => {
			bound = v;
		},
	};
}

test("three back-to-back fan-outs and a pending local append keep every line", async () => {
	const { engine, reg, disk, file, push } = await device();
	// A appends a line on disk; its debounced push has not fired yet.
	disk.set(PATH, `${BASE}A line\n`);
	engine.handleModify(file);

	// B appends three times; each update reaches A as a fan-out, back to back.
	for (const line of ["B one\n", "B two\n", "B three\n"]) push(line);
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

test("a burst of fan-outs for an unknown note id shares one manifest fetch", async () => {
	const getManifest = mock(async () => {
		await tick(10);
		return { notes: [], change_seq: 1 };
	});
	const engine = new SyncEngine(
		{
			vault: {
				configDir: ".obsidian",
				getAbstractFileByPath: mock(() => null),
				getFileByPath: mock(() => null),
				getMarkdownFiles: mock(() => []),
				getFiles: mock(() => []),
				getName: mock().mockReturnValue("Test Vault"),
			},
			workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
		} as any,
		{ getManifest } as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager({ applyRemoteUpdate: async () => true } as never);
	engine.setNoteIdMap(new NoteIdMap());
	engine.setReady();

	const results = await Promise.all(
		[1, 2, 3, 4, 5].map(() => engine.applyPushedNoteUpdate("ghost", new Uint8Array([1]), "h")),
	);

	expect(results.every((r) => r === "deferred")).toBe(true);
	expect(getManifest.mock.calls.length).toBeLessThanOrEqual(2);
});

describe("a disk that lags the doc is folded against what disk held, not the doc", () => {
	test("a modify for the older disk fires while the next flush is still writing: nothing deleted", async () => {
		const { engine, reg, disk, file, push, writesTake } = await device();
		push("B one\n");
		await tick(50); // flushed and settled: disk = base + B one
		writesTake(60);
		push("B two\n"); // its write lands 60 ms from now...
		await tick(20);
		engine.handleModify(file); // ...a modify for the older disk fires mid-write
		await tick(200);

		expect(await reg.projectedText(ID)).toContain("B two\n");
		expect(disk.get(PATH)).toContain("B two\n");
	});

	test("a user adds a line then deletes it: the delete reaches the doc", async () => {
		// Review probe: disk returns to a text it held, which is NOT no-edit.
		const B1 = `${BASE}B one\n`;
		const { engine, reg, disk, file, push } = await device();
		push("B one\n");
		await tick(80);
		disk.set(PATH, `${B1}user line\n`);
		engine.handleModify(file);
		await tick(80);
		disk.set(PATH, B1);
		engine.handleModify(file);
		await tick(120);

		expect(await reg.projectedText(ID)).not.toContain("user line");
		expect(disk.get(PATH)).toBe(B1);
	});

	test("a user deletes a remote line that just arrived: the delete reaches the doc", async () => {
		const B1 = `${BASE}B one\n`;
		const { engine, reg, disk, file, push } = await device();
		push("B one\n");
		await tick(80);
		push("B two\n");
		await tick(80);
		disk.set(PATH, B1);
		engine.handleModify(file);
		await tick(120);

		expect(await reg.projectedText(ID)).not.toContain("B two");
		expect(disk.get(PATH)).toBe(B1);
	});

	test("an editor-bound note's remote merge writes nothing, so it is not the fold's base", async () => {
		// The nudge leaves disk to the editor. Had the merge been recorded as on
		// disk, a fold of the pre-save disk with a user line would read the
		// remote line as deleted.
		const { reg, disk, push, bind } = await device();
		push("B one\n");
		await tick(50); // written: the base is base + B one
		bind(true);
		const before = disk.get(PATH) ?? "";
		push("R remote\n");
		await tick(50);
		expect(disk.get(PATH)).toBe(before); // nudged, not written

		await reg.applyLocalEdit(
			ID,
			`user line\n${before}`,
			undefined,
			async () => `user line\n${before}`,
		);

		const doc = await reg.projectedText(ID);
		expect(doc).toContain("R remote\n");
		expect(doc).toContain("user line\n");
	});

	test("a flush for an id not yet mapped writes nothing, so it is not the fold's base", async () => {
		const { reg, map, disk, server, push } = await device();
		push("B one\n");
		await tick(50); // written: the base is base + B one
		const before = disk.get(PATH) ?? "";
		map.delete(PATH);
		const sv = Y.encodeStateVector(server);
		server.getText(CONTENT_KEY).insert(server.getText(CONTENT_KEY).length, "R remote\n");
		await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server, sv)); // heal: no write
		await tick(20);
		map.set(PATH, ID);
		expect(disk.get(PATH)).toBe(before);

		await reg.applyLocalEdit(
			ID,
			`user line\n${before}`,
			undefined,
			async () => `user line\n${before}`,
		);

		const doc = await reg.projectedText(ID);
		expect(doc).toContain("R remote\n");
		expect(doc).toContain("user line\n");
	});

	test("a local append, a remote append whose flush is slow, the push reads pre-flush disk: both kept", async () => {
		// Real-Obsidian pairing 40253955588, note-052 on B: B appended (107 B),
		// A's append merged and B began writing the merged text (131 B), and B's
		// debounced push folded the pre-flush disk: A's line was deleted.
		const { engine, reg, disk, file, push, writesTake } = await device();
		writesTake(40);
		disk.set(PATH, `${BASE}B local\n`);
		engine.handleModify(file); // debounced 5 ms
		push("A remote\n"); // its merged flush takes 40 ms
		await tick(300);

		const doc = await reg.projectedText(ID);
		expect(doc).toContain("B local\n");
		expect(doc).toContain("A remote\n");
		expect(disk.get(PATH)).toBe(doc);
	});

	test("a refused empty write is not recorded as on disk", async () => {
		// flushFromCrdt refuses an empty write while the doc still has content
		// (a transient projection) and reports true without writing.
		const { engine, reg, disk } = await device();
		const before = disk.get(PATH);
		const recorded: string[] = [];
		const orig = reg.noteDiskText.bind(reg);
		reg.noteDiskText = (id, text, written) => {
			recorded.push(text);
			orig(id, text, written);
		};

		await engine.flushFromCrdt(PATH, "");

		expect(disk.get(PATH)).toBe(before);
		expect(recorded).not.toContain("");
	});
});
