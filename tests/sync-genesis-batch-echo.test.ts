/**
 * Regression (#188 class, single-push-path): `pushGenesisBatch` must not mint a
 * THROWAWAY second lineage for a note that already carries a local CRDT lineage.
 *
 * Genesis means brand-new — no history ANYWHERE. The batch path seeds the server
 * from a throwaway doc (encodeGenesisUpdate) via `crdt_create_batch`. If a note
 * already has a local CRDT lineage (e.g. offline-captured then channel-synced to
 * the server before this sync, or a lingering doc from a prior lineage), that
 * lineage may already be server-side, so minting a SECOND one makes the server
 * merge both → the note body DOUBLES on disk (test_86 push-all-delete-remote, a
 * second live client echoes the merged state back). The fix routes any
 * history-carrying note to `pushFile`, which diffs disk into its REAL doc
 * (idempotent on an unchanged body) and pushes THAT single lineage.
 *
 * Uses the REAL CrdtManager so `hasHistory` reflects genuine Yjs state, not a mock.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const CONTENT = "# LocalOnly\n\nadvanced-sync seed LocalOnly abc123def456\n";

function makeGenesisEngine(dbPrefix: string) {
	const disk = new Map<string, string>();
	disk.set("a.md", CONTENT);

	const mgr = new CrdtManager({ dbPrefix, onUpdate: () => {}, onFlushToDisk: async () => {} });

	const tfile = (p: string) => new TFile(p);
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? tfile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? tfile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
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

	const api = {} as unknown as EngramApi;

	const e = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(mgr as unknown as CrdtManager);
	e.setReady();
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => false); // batch only handles NOT-live-bound notes

	const batchCalls: { doc_id: string; path: string }[] = [];
	e.setCrdtCreateBatch(async (creates) => {
		for (const c of creates) batchCalls.push({ doc_id: c.doc_id, path: c.path });
		return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
	});
	const pushFile = mock().mockResolvedValue(true);
	(e as any).pushFile = pushFile;

	return { e, mgr, tfile, batchCalls, pushFile };
}

describe("pushGenesisBatch — a note with a local CRDT lineage is not genesis", () => {
	test("history-carrying note → routed to pushFile, NEVER minted as a throwaway genesis frame", async () => {
		const { e, mgr, tfile, batchCalls, pushFile } = makeGenesisEngine("genesis-hist");

		// The note already carries a local CRDT lineage (offline-captured / lingering).
		await mgr.applyLocalEdit("id-a", CONTENT);
		expect(await mgr.hasHistory("id-a")).toBe(true);

		const file = tfile("a.md");
		const out = await (e as any).pushGenesisBatch([file]);

		expect(out).toEqual({ pushed: 1, failed: 0 });
		// The fix: it must NOT mint a second lineage for this note.
		expect(batchCalls).toHaveLength(0);
		// It routes to pushFile (which pushes the note's real, single lineage).
		expect(pushFile).toHaveBeenCalledWith(file, true);
		await mgr.destroy();
	});

	test("control: a genuinely history-less note IS minted via crdt_create_batch", async () => {
		const { e, mgr, tfile, batchCalls, pushFile } = makeGenesisEngine("genesis-fresh");
		expect(await mgr.hasHistory("id-a")).toBe(false);

		const file = tfile("a.md");
		const out = await (e as any).pushGenesisBatch([file]);

		expect(out).toEqual({ pushed: 1, failed: 0 });
		expect(batchCalls).toEqual([{ doc_id: "id-a", path: "a.md" }]);
		expect(pushFile).not.toHaveBeenCalled();
		await mgr.destroy();
	});
});
