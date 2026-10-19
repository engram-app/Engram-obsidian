/**
 * Catch-up drift check vs the engine's own in-flight flush (backend e2e
 * test_101, ~1 in 13 runs).
 *
 * The genesis apply flushes the plugin's frontmatter projection to disk and
 * only stamps the new baseline after `vault.modify` resolves. A catch-up for
 * the same note that read its sync row BEFORE that stamp and the file AFTER
 * the write compared the new disk bytes against the old baseline, called the
 * plugin's own rewrite a local edit, and wrote a "(conflict)" copy.
 */
import { expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { fnv1a } from "../src/content-hash";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

const PATH = "Fm/colon-and-comment.md";
const ID = "id-fm";
const RAW = '---\ntitle: "Meeting: kickoff" # comment\n---\nbody\n';
const PROJECTED = "---\ntitle: 'Meeting: kickoff'\n---\nbody\n";
const ROW = "---\ntitle: 'Meeting: kickoff'\n---\nbody\n\n";
const USER_EDIT = '---\ntitle: "Meeting: kickoff" # comment\n---\nbody\nmy edit\n';

/** Runs one catch-up of ROW over a note whose baseline is RAW. `duringRead`
 *  fires inside catch-up's awaited file read, after its row snapshot: the
 *  window the race lives in. Returns how many drift copies were written. */
async function catchUp(duringRead: (e: AnyEngine, disk: Map<string, string>) => void) {
	const disk = new Map<string, string>([[PATH, RAW]]);
	let engine: AnyEngine | null = null;
	let fired = false;
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => {
				if (!fired && engine) {
					fired = true;
					duringRead(engine, disk);
				}
				return disk.get(f.path) ?? "";
			}),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
			}),
			create: mock(async (p: string, c: string) => {
				disk.set(p, c);
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const map = new NoteIdMap();
	const mgr = new ProviderRegistry({
		dbPrefix: `catchup-stale-${Math.random()}`,
		send: () => true,
		onFlushToDisk: async () => undefined,
	} as any);
	const e = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine = e as unknown as AnyEngine;
	e.setCrdtManager(mgr as never);
	e.setReady();
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => false);
	e.setCrdtEnrollment({ enroll: mock(), reset: mock() } as never);
	map.set(PATH, ID);
	// The create-ack era baseline: still the raw bytes when catch-up starts.
	engine.recordCrdtBaseline(PATH, RAW);

	const copy = spyOn(engine as any, "writeDriftConflictCopy");
	spyOn(engine as any, "stageAndConverge").mockImplementation(() => {});

	await e.applyChange({
		id: ID,
		path: PATH,
		title: "colon-and-comment",
		content: ROW,
		folder: "Fm",
		tags: [],
		mtime: Date.now() / 1000,
		updated_at: new Date().toISOString(),
		deleted: false,
		content_hash: "hash-row",
	} as never);
	return copy.mock.calls.length;
}

/** The genesis flush of PROJECTED is in flight (registered, not yet stamped). */
function flushInFlight(e: AnyEngine) {
	e.flushingHash.set(PATH, new Map([[fnv1a(PROJECTED), 1]]));
}

test("own flush finished and stamped mid-read: not drift-copied", async () => {
	const copies = await catchUp((e, disk) => {
		disk.set(PATH, PROJECTED);
		e.recordCrdtBaseline(PATH, PROJECTED);
	});
	expect(copies).toBe(0);
});

test("own flush on disk but not yet stamped: not drift-copied", async () => {
	const copies = await catchUp((e, disk) => {
		disk.set(PATH, PROJECTED);
		flushInFlight(e);
	});
	expect(copies).toBe(0);
});

test("a REAL local edit racing a flush is still drift-copied", async () => {
	const copies = await catchUp((e, disk) => {
		disk.set(PATH, USER_EDIT);
		flushInFlight(e);
	});
	expect(copies).toBe(1);
});

/** The note's own create round trip is still running: disk holds the raw
 *  pre-create bytes, and the row is the `hash: 0` placeholder a seq or head
 *  patch leaves before the create-ack stamps a baseline (backend e2e test_101,
 *  CI run 39188780962: the copy was written ~90ms before the genesis flush). */
function placeholderRow(e: AnyEngine) {
	e.syncState.set(PATH, { hash: 0, seq: 7 });
}

test("own create still in flight: not drift-copied", async () => {
	const copies = await catchUp((e) => {
		placeholderRow(e);
		e.creatingPaths.add(PATH);
	});
	expect(copies).toBe(0);
});

test("same placeholder row with no create in flight is still drift-copied", async () => {
	const copies = await catchUp((e) => {
		placeholderRow(e);
	});
	expect(copies).toBe(1);
});

test("a change deferred during the create is replayed when the create ends", async () => {
	let engine: AnyEngine | null = null;
	const copies = await catchUp((e) => {
		engine = e;
		placeholderRow(e);
		e.beginCreate(PATH);
	});
	expect(copies).toBe(0);
	const replay = spyOn(engine! as any, "applyChange").mockResolvedValue(true);
	await engine!.endCreate(PATH);
	expect(replay).toHaveBeenCalledTimes(1);
	expect(replay.mock.calls[0][0].path).toBe(PATH);
	expect(engine!.creatingPaths.has(PATH)).toBe(false);
	// Replayed once, then forgotten.
	await engine!.endCreate(PATH);
	expect(replay).toHaveBeenCalledTimes(1);
});
