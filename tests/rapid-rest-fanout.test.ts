/**
 * Engram#2271 (e2e test_49 `test_rapid_api_edits_final_content_arrives`):
 * five REST saves to one NEW note ~16 ms apart. The receiving device gets,
 * on the vault topic, five `note_changed` frames and five full-state
 * `note_yjs_update` fan-outs, the FIRST of which (v1, cold in the server's
 * FanoutPacer) arrives last. B ended on "Version 4 of 5", and in other runs
 * the SERVER ended on "Version 4 of 5" or "Version 51 of 5": a receiver
 * wrote a stale body over a newer one, read its own write back as a user
 * edit, and pushed it.
 *
 * Real ProviderRegistry wired the way wiring.ts wires it, a vault whose
 * create rejects an existing path (as Obsidian's does) and whose writes fire
 * the modify event, frames delivered the way the channel delivers them:
 * fire-and-forget, in server order. Disk latency is a seeded number of
 * microtask turns, so every interleaving is reproducible without a clock.
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

const PATH = "E2E/Rapid.md";
const body = (i: number) => `# Rapid Edit\nVersion ${i} of 5`;
const SEEDS = 30;
const MAX_TURNS = 32;

let runs = 0;
const settle = () => new Promise((r) => setTimeout(r, 150));
const turns = async (n: number) => {
	for (let i = 0; i < n; i++) await Promise.resolve();
};

async function setup(seed: number) {
	// Unique per run: fake-indexeddb persists docs across runs in one file.
	const ID = `id-rapid-${++runs}`;
	let s = seed;
	const jitter = () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s % MAX_TURNS;
	};
	const disk = new Map<string, string>();
	const files = new Map<string, TFile>();
	const fileFor = (p: string) => {
		let f = files.get(p);
		if (!f) {
			f = new TFile(p);
			files.set(p, f);
		}
		return f;
	};
	let engine!: SyncEngine;
	const write = async (p: string, content: string) => {
		await turns(jitter());
		disk.set(p, content);
		engine.handleModify(fileFor(p));
	};
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? fileFor(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? fileFor(p) : null)),
			getFolderByPath: mock(() => ({})),
			createFolder: mock(async () => undefined),
			cachedRead: mock(async (f: TFile) => {
				await turns(jitter());
				return disk.get(f.path) ?? "";
			}),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => write(f.path, c)),
			process: mock(async (f: TFile, fn: (s: string) => string) =>
				write(f.path, fn(disk.get(f.path) ?? "")),
			),
			// Obsidian's create rejects a path that exists by the time it runs.
			create: mock(async (p: string, c: string) => {
				await turns(jitter());
				if (disk.has(p)) throw new Error("File already exists.");
				disk.set(p, c);
				engine.handleModify(fileFor(p));
				return fileFor(p);
			}),
			getMarkdownFiles: mock(() => [...disk.keys()].map(fileFor)),
			getFiles: mock(() => [...disk.keys()].map(fileFor)),
			getName: mock().mockReturnValue("Test Vault"),
			adapter: { exists: mock(async (p: string) => disk.has(p)) },
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const map = new NoteIdMap();
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
		sendCrdt: () => true,
	} as any);
	const reg = wiring.manager as ProviderRegistry;
	engine.setCrdtManager(reg);
	engine.setNoteIdMap(map);
	engine.setLiveBoundCheck(() => false);
	engine.setCrdtLiveCheck(() => true);
	engine.setReady();

	// The server: five REST saves merged into the note's one Y.Doc lineage by
	// a minimal diff (the digit changes). Full state after each, as
	// CrdtDeliver.fanout_idle sends it.
	const server = new Y.Doc();
	const t = server.getText(CONTENT_KEY);
	const states: Uint8Array[] = [];
	for (let i = 1; i <= 5; i++) {
		if (i === 1) t.insert(0, body(1));
		else {
			const at = body(i).indexOf(String(i));
			t.delete(at, 1);
			t.insert(at, String(i));
		}
		states.push(Y.encodeStateAsUpdate(server));
	}
	return { ID, engine, wiring, reg, disk, states, map, app };
}

async function run(
	seed: number,
	after?: (engine: SyncEngine) => Promise<unknown>,
): Promise<{ disk: string | undefined; doc: string }> {
	const { ID, engine, wiring, reg, disk, states } = await setup(seed);
	const changed = (i: number) =>
		engine.handleStreamEvent({
			event_type: "upsert",
			path: PATH,
			id: ID,
			content: body(i),
			content_hash: `h${i}`,
			version: i,
			timestamp: Date.now(),
		} as any);
	const fan = (i: number) => wiring.onNoteYjsUpdate(ID, toB64(states[i - 1]), `head${i}`, i);
	void changed(1);
	for (let i = 2; i <= 5; i++) {
		void changed(i);
		fan(i);
	}
	await turns(64);
	fan(1); // the paced cold frame, drained last
	await settle();
	if (after) {
		await after(engine);
		await settle();
	}

	const doc = await reg.projectedText(ID);
	await reg.destroyAll();
	return { disk: disk.get(PATH), doc };
}

async function badSeeds(after?: (engine: SyncEngine) => Promise<unknown>) {
	const bad: unknown[] = [];
	for (let seed = 1; seed <= SEEDS; seed++) {
		const r = await run(seed, after);
		if (r.disk !== body(5) || r.doc !== body(5)) bad.push({ seed, ...r });
	}
	return bad;
}

test("rapid REST saves: the receiver converges on the LAST version and reverts nothing", async () => {
	expect(await badSeeds()).toEqual([]);
}, 120_000);

test("a caller's stale snapshot written after the doc moved on still leaves disk at the doc", async () => {
	// The row-body writers (first-delivery apply, catch-up replay) capture
	// their text before awaiting. Arriving after the doc reached v5, a v1
	// snapshot must not land on disk, or disk sits at v1 with a v1 baseline
	// and nothing ever brings it forward.
	expect(await badSeeds((engine) => engine.flushFromCrdt(PATH, body(1)))).toEqual([]);
}, 120_000);

test("a row-body write that loses the create race never lands its stale text", async () => {
	// The stream event's first-delivery apply writes the row body (v1) while
	// the doc is still empty. Before its create runs, the doc's first server
	// state (v5) arrives and its flush creates the file. The v1 create then
	// rejects "already exists", and its fallback overwrote v5 with v1 after
	// the v5 write had recorded the baseline: the stale disk then read as a
	// user edit and reverted the note.
	const { ID, reg, disk, states, map, engine, app } = await setup(1);
	map.set(PATH, ID);
	engine.importSyncState({ [PATH]: { hash: 0 } });
	const create = app.vault.create;
	let first = true;
	app.vault.create = async (p: string, c: string) => {
		if (first) {
			first = false;
			await reg.applyRemoteUpdate(ID, states[4]);
		}
		return create(p, c);
	};
	await engine.flushFromCrdt(PATH, body(1));
	await settle();
	const doc = await reg.projectedText(ID);
	await reg.destroyAll();
	expect({ disk: disk.get(PATH), doc }).toEqual({ disk: body(5), doc: body(5) });
});

test("a write whose doc moves on while it awaits writes the doc's newer text", async () => {
	// A flush checks disk before writing. If the doc takes a newer server
	// state (and that state's flush lands) during the check, the older write
	// must not land after it.
	const { ID, reg, disk, states, map, engine, app } = await setup(1);
	map.set(PATH, ID);
	disk.set(PATH, body(3));
	engine.importSyncState({ [PATH]: { hash: fnv1a(body(3)) } });
	await reg.applyRemoteUpdate(ID, states[2]);
	await settle();
	const cachedRead = app.vault.cachedRead;
	let moved = false;
	app.vault.cachedRead = async (f: TFile) => {
		if (!moved) {
			moved = true;
			await reg.applyRemoteUpdate(ID, states[4]);
		}
		return cachedRead(f);
	};
	await engine.flushFromCrdt(PATH, body(3));
	await settle();
	const doc = await reg.projectedText(ID);
	await reg.destroyAll();
	expect({ disk: disk.get(PATH), doc }).toEqual({ disk: body(5), doc: body(5) });
});

test("the create-race fallback records the text it wrote as the baseline", async () => {
	// Review probe (#653). The doc's v2 flush starts first and is held inside
	// its create. A row-body write (v1) then starts; its doc asks miss (the
	// doc not yet answering, forced here) and it reaches its own create while
	// v2's completes. v1's create rejects, and its fallback writes the doc's
	// v2. v1 is the newer write, so its baseline is the one kept: it must be
	// the v2 it wrote, not the v1 it was given, or disk != baseline and the
	// next fan-out reads the plugin's own write as a user edit.
	const { ID, reg, disk, states, map, engine, app } = await setup(1);
	map.set(PATH, ID);
	const create = app.vault.create;
	let releaseV2: () => void = () => {};
	const v2Held = new Promise<void>((r) => {
		releaseV2 = r;
	});
	let v2Created: Promise<unknown> = Promise.resolve();
	let calls = 0;
	app.vault.create = (p: string, c: string) => {
		calls++;
		if (calls === 1) {
			v2Created = v2Held.then(() => create(p, c));
			return v2Created;
		}
		// v1's create: let the held v2 create land first.
		releaseV2();
		return v2Created.then(() => create(p, c));
	};
	const v2 = reg.applyRemoteUpdate(ID, states[1]);
	while (calls === 0) await new Promise((r) => setTimeout(r, 1));
	const ask = (engine as any).currentDocText.bind(engine);
	let missing = true;
	(engine as any).currentDocText = async (p: string) => (missing && calls === 1 ? null : ask(p));
	const v1 = engine.flushFromCrdt(PATH, body(1));
	await v1;
	missing = false;
	await v2;
	expect(disk.get(PATH)).toBe(body(2));
	expect(engine.needsColdReconcile(PATH, body(2))).toBe(false);
	await reg.destroyAll();
});

test("a first load's interlock re-asks the doc when it held no local input", async () => {
	// With nothing held on disk the interlock answers the load projection.
	// The doc can take a newer state (and that state's flush land) while the
	// interlock reads disk; the older projection must not land after it.
	const { ID, reg, disk, states, map, engine, app } = await setup(1);
	map.set(PATH, ID);
	await reg.applyRemoteUpdate(ID, states[1]);
	await settle();
	disk.set(PATH, body(1));
	engine.importSyncState({ [PATH]: { hash: fnv1a(body(1)) } });
	const cachedRead = app.vault.cachedRead;
	let reads = 0;
	app.vault.cachedRead = async (f: TFile) => {
		// Read 1 is the idempotency check, read 2 the interlock's.
		if (++reads === 2) await reg.applyRemoteUpdate(ID, states[3]);
		return cachedRead(f);
	};
	await engine.flushFromCrdt(PATH, body(2), ID);
	await settle();
	const doc = await reg.projectedText(ID);
	await reg.destroyAll();
	expect({ disk: disk.get(PATH), doc }).toEqual({ disk: body(4), doc: body(4) });
	expect(engine.needsColdReconcile(PATH, body(4))).toBe(false);
});

test("a write that follows a rename lands the doc's text, not the caller's snapshot", async () => {
	// createFileWithFolders moves the note's old file to the new path, then
	// writes. The move awaits; a doc that moved meanwhile must win.
	const { ID, reg, disk, states, map, engine, app } = await setup(1);
	const OLD = "E2E/Old.md";
	map.set(PATH, ID);
	await reg.applyRemoteUpdate(ID, states[1]);
	await settle();
	// The note's file is still at its old path; the new one is empty.
	disk.delete(PATH);
	disk.set(OLD, body(2));
	engine.importSyncState({ [PATH]: { hash: fnv1a(body(2)) } });
	(engine as any).relocatedFrom.set(PATH, { from: OLD, timer: 0 });
	app.vault.rename = async (f: TFile, to: string) => {
		disk.set(to, disk.get(f.path) ?? "");
		disk.delete(f.path);
		// The doc moves on while the move is still settling.
		await reg.applyRemoteUpdate(ID, states[4]);
	};
	await engine.flushFromCrdt(PATH, body(2));
	await settle();
	const doc = await reg.projectedText(ID);
	await reg.destroyAll();
	expect({ disk: disk.get(PATH), doc }).toEqual({ disk: body(5), doc: body(5) });
});

test("a blank doc never replaces a caller's text past the empty-write guard", async () => {
	// The doc ask runs after the guard; a blank answer there would blank the
	// file unchecked. A blank doc is not an answer: the caller's text stands
	// and a real clear goes through the guard on its own flush.
	const { ID, reg, disk, map, engine } = await setup(1);
	map.set(PATH, ID);
	const cleared = new Y.Doc();
	const t = cleared.getText(CONTENT_KEY);
	t.insert(0, body(1));
	t.delete(0, t.length);
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(cleared));
	await settle();
	disk.set(PATH, body(1));
	engine.importSyncState({ [PATH]: { hash: fnv1a(body(1)) } });
	await engine.flushFromCrdt(PATH, body(2));
	await reg.destroyAll();
	expect(disk.get(PATH)).toBe(body(2));
});

test("a write landing after an already-matching check still records its baseline", async () => {
	// e2e 40632775792 (B's engine trace): flush v3 found disk already at v3
	// and returned, but its read resolved while flush v4's write was in
	// flight. It marked every started write as superseded, so v4 landed
	// without recording. Baseline v3 with disk v4: the next fan-out read the
	// plugin's own v4 as a user edit, reverted the doc from v5 and pushed it.
	const { ID, reg, disk, states, map, engine, app } = await setup(1);
	map.set(PATH, ID);
	await reg.applyRemoteUpdate(ID, states[2]);
	await settle();
	expect(disk.get(PATH)).toBe(body(3));
	const modify = app.vault.modify;
	let releaseWrite: () => void = () => {};
	const writeHeld = new Promise<void>((r) => {
		releaseWrite = r;
	});
	let writing: () => void = () => {};
	const writeStarted = new Promise<void>((r) => {
		writing = r;
	});
	app.vault.modify = async (f: TFile, c: string) => {
		writing();
		await writeHeld;
		return modify(f, c);
	};
	const cachedRead = app.vault.cachedRead;
	let armed = true;
	app.vault.cachedRead = async (f: TFile) => {
		const text = disk.get(f.path) ?? "";
		if (armed) {
			// The v3 check has read disk; v4's flush starts and is writing
			// before this read resolves.
			armed = false;
			void reg.applyRemoteUpdate(ID, states[3]);
			await writeStarted;
			return text;
		}
		return cachedRead(f);
	};
	const v3 = engine.flushFromCrdt(PATH, body(3));
	await v3;
	releaseWrite();
	await settle();
	await reg.destroyAll();
	expect(disk.get(PATH)).toBe(body(4));
	expect(engine.needsColdReconcile(PATH, body(4))).toBe(false);
});
