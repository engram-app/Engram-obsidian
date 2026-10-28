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
