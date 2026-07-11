/**
 * BUG 2: a fanned-out remote update must NOT clobber an un-pushed local disk
 * edit. A NOT-live-bound note edited on disk (external tool / reading view /
 * another device) lives only on disk until its debounce fires pushFile. If a
 * fanned-out remote update (applyPushedNoteUpdate) or a cold-receive poll
 * (coldReceive) lands in that window, applyRemoteUpdate flushes the REMOTE
 * projection to disk with no merge — the local edit was never in the Y.Doc, so
 * it is destroyed. The fix captures the disk drift into the Y.Doc (applyLocalEdit)
 * BEFORE applying the remote update, so CRDT MERGES both.
 *
 * Uses the REAL CrdtManager so the merge is genuine, not mocked.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
}
function markProbed(engine: SyncEngine): void {
	(engine as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
}

/** Build a shared-base local doc + a remote delta that adds " REMOTE" on that
 *  same base, plus the disk drift "BASE local" and its recorded baseline. */
async function scenario(dbPrefix: string) {
	let lastFlushed: string | null = null;
	const mgr = new CrdtManager({
		dbPrefix,
		onUpdate: () => {},
		onFlushToDisk: async (_id, content) => {
			lastFlushed = content;
		},
	});

	// Shared base lineage: both local and remote descend from "BASE".
	const base = new Y.Doc();
	base.getText("content").insert(0, "BASE");
	const uBase = Y.encodeStateAsUpdate(base);

	// Local doc adopts the base lineage (as a prior sync would have).
	await mgr.applyRemoteUpdate("id-a", uBase);
	lastFlushed = null; // reset — that flush was the base, not the merge under test

	// Remote update: " REMOTE" appended on the shared base.
	const remote = new Y.Doc();
	Y.applyUpdate(remote, uBase);
	remote.getText("content").insert(4, " REMOTE");
	const remoteDelta = Y.encodeStateAsUpdate(remote, Y.encodeStateVector(base));

	const file = new TFile("a.md");
	const mockApp = {
		vault: {
			configDir: ".obsidian",
			// Disk holds an un-pushed external edit relative to the "BASE" baseline.
			getAbstractFileByPath: mock().mockReturnValue(file),
			getFileByPath: mock().mockReturnValue(file),
			cachedRead: mock().mockResolvedValue("BASE local"),
			modify: mock().mockResolvedValue(undefined),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	const e = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(mgr as unknown as CrdtManager);
	e.setReady();
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	markConfirmed(e, "id-a");
	e.setLiveBoundCheck(() => false);
	// Recorded baseline = the last-synced content "BASE" (disk now differs).
	e.importSyncState({ "a.md": { hash: fnv1a("BASE") } });

	return { e, mgr, remoteDelta, flushed: () => lastFlushed };
}

describe("BUG 2: un-pushed disk drift is merged, not clobbered", () => {
	test("applyPushedNoteUpdate merges the un-pushed local disk edit with the remote update", async () => {
		const { e, remoteDelta, flushed } = await scenario("bug2-pushed");

		await (e as any).applyPushedNoteUpdate("id-a", remoteDelta, "HEAD");

		const out = flushed();
		expect(out).not.toBeNull();
		expect(out).toContain("local"); // the un-pushed disk edit survived
		expect(out).toContain("REMOTE"); // the remote change applied too
	});

	test("coldReceive merges the un-pushed local disk edit with the pulled update", async () => {
		const { e, remoteDelta, flushed } = await scenario("bug2-cold");
		markProbed(e);
		(e as any).api = {
			getVaultHeads: async () => ({ heads: { "id-a": "HEAD" } }),
			getUpdates: async () => ({ update: remoteDelta, head: "HEAD" }),
		};

		expect(await e.coldReceive()).toBe(1);

		const out = flushed();
		expect(out).not.toBeNull();
		expect(out).toContain("local");
		expect(out).toContain("REMOTE");
	});
});
