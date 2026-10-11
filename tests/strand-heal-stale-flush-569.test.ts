/**
 * #569: a local edit is erased by a strand-heal flush of a STALE snapshot.
 *
 * Reproduced locally against the real e2e (`test_concurrent_edits_both_survive`)
 * with a vault.modify stack probe. Device A's sequence for the new note:
 *
 *   1. pushFile's genesis `applyRemoteUpdate` fires the registry's flush
 *      listener while `pathForId(mint)` still answers null, so `onFlushToDisk`
 *      hands the projection ("shared base\n") to `healUnknownNoteId`, which
 *      stores that STRING and arms a 750 ms timer.
 *   2. The create acks, the id resolves, the baseline is recorded.
 *   3. The user writes FROM_A to disk. pushFile is still debounced, so the
 *      edit lives only on disk.
 *   4. The timer fires: `drainStrandedFlushes` calls
 *      `flushFromCrdt(path, "shared base\n")` with the snapshot from step 1,
 *      writing it over FROM_A. The debounced push then reads the reverted file,
 *      hash-matches the baseline, and echo-skips. FROM_A never leaves the device.
 *
 * Not #567: plugin 09a8201 (before #567) fails the same e2e with the same
 * vault.modify sequence.
 */
import { afterEach, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { type CrdtWiring, createCrdtWiring } from "../src/crdt/wiring";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "E2E/Crdt/Merge.md";
const ID = "01a128a3-49a7-7368-bd0d-e2badc621e30";
const BASE = "shared base\n";
const FROM_A = "shared base\nFROM_A\n";
const HEAL_MS = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let wiring: CrdtWiring | null = null;
afterEach(async () => {
	wiring?.dispose();
	await wiring?.manager.destroyAll();
	wiring = null;
});

const REMOTE_PLUS_BASE = "REMOTE\nshared base\n";

/** Device whose genesis flush strands (id unmapped), then the create acks. */
async function strandedDevice() {
	const disk = new Map<string, string>([[PATH, BASE]]);
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
			}),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const engine = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setLiveBoundCheck(() => false);
	// The id is known by the time the drain reconciles (adoptCreateAck set it).
	engine.reconcileNoteIdMapFromManifest = async () => 0;

	// Step 1: the id does not resolve yet when the genesis apply flushes.
	const map = new NoteIdMap();
	engine.setNoteIdMap(map);
	const w = createCrdtWiring({
		noteIdMap: map,
		syncEngine: engine,
		sendCrdt: () => true,
		isBound: () => false,
		strandHealDebounceMs: HEAL_MS,
		dbPrefix: `strand-569-${Math.random()}`,
		// The last-synced body is the 3-way merge base, as in production.
		lcaFor: () => BASE,
	});
	wiring = w;
	engine.setCrdtManager(w.manager); // as main.ts does
	await w.manager.applyRemoteUpdate(ID, w.manager.encodeGenesisUpdate(BASE));

	// Step 2: create acked. The id resolves and the baseline is the genesis body.
	map.set(PATH, ID);
	engine.importSyncState({ [PATH]: { hash: fnv1a(BASE) } });
	return { disk, engine, manager: w.manager };
}

test("strand-heal drain does not write its stale snapshot over a newer local edit (#569)", async () => {
	const { disk } = await strandedDevice();

	// Step 3: the user's edit lands on disk; its debounced push has not run.
	disk.set(PATH, FROM_A);

	// Step 4: the strand-heal timer fires.
	await sleep(HEAL_MS * 10);

	expect(disk.get(PATH)).toBe(FROM_A);
});

test("strand-heal drain does not revert an edit whose push already landed (#569)", async () => {
	const { disk, engine, manager } = await strandedDevice();

	// The push beat the drain: doc, disk and baseline all hold FROM_A.
	await manager.applyLocalEdit(ID, FROM_A, false);
	disk.set(PATH, FROM_A);
	engine.importSyncState({ [PATH]: { hash: fnv1a(FROM_A) } });

	await sleep(HEAL_MS * 10);

	expect(disk.get(PATH)).toBe(FROM_A);
});

test("strand-heal drain keeps both the doc's newer content and an unpushed disk edit (#569)", async () => {
	const { disk, manager } = await strandedDevice();

	// The doc moved past the stranded snapshot while disk took a local edit.
	await manager.applyLocalEdit(ID, REMOTE_PLUS_BASE, false);
	disk.set(PATH, FROM_A);

	await sleep(HEAL_MS * 10);

	expect(disk.get(PATH)).toContain("REMOTE");
	expect(disk.get(PATH)).toContain("FROM_A");
});
