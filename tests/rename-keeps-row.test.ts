/**
 * A rename re-keys the note's sync-state row; it never resets it.
 *
 * It used to write a presence-only `{ hash: 0 }` at the new path on the
 * receiver as well as the renamer, and the identity mover dropped the row
 * outright. With the baseline gone, a note edited while closed on the receiver
 * read as diverged from "unknown" and resolved into a conflict copy or a stale
 * disk (real-Obsidian probe 40249390517: an offline edit to a note another
 * device renamed). Relay's model: a path change moves the doc's metadata to the
 * new key and leaves its sync state alone (SharedFolder.applyRemoteMove,
 * Document.move).
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { fnv1a } from "../src/content-hash";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const ROW = { hash: 1234, crdtHead: "head-1", seq: 7, version: 3, serverHash: "H" };

function engineWith(files: Record<string, string> = {}) {
	const tfile = (path: string) => ({ path, extension: "md", stat: { size: 10 } });
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead: mock(async (f: { path: string }) => {
				if (!(f.path in files)) throw new Error(`ENOENT: ${f.path}`);
				return files[f.path];
			}),
			getFileByPath: mock((p: string) => (p in files ? tfile(p) : null)),
			getAbstractFileByPath: mock((p: string) => (p in files ? tfile(p) : null)),
			getMarkdownFiles: mock().mockReturnValue([]),
			getFiles: mock().mockReturnValue([]),
			rename: mock(async (f: { path: string }, to: string) => {
				files[to] = files[f.path];
				delete files[f.path];
			}),
			getName: mock().mockReturnValue("Test Vault"),
		},
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const engine = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	) as any;
	engine.setReady();
	const map = new NoteIdMap();
	map.set("a.md", "id-1");
	engine.setNoteIdMap(map);
	engine.importSyncState({ "a.md": { ...ROW } });
	return { engine, map };
}

describe("a rename re-keys the sync-state row", () => {
	test("a receiver keeps every field at the new path", () => {
		const { engine } = engineWith();

		engine.renamePath("a.md", "b.md", "remote");

		expect(engine.exportSyncState()).toEqual({ "b.md": ROW });
	});

	test("the renamer keeps the baseline and flags the relocation", () => {
		const { engine, map } = engineWith();
		map.rename("a.md", "b.md");

		engine.renamePath("a.md", "b.md", "local");

		expect(engine.exportSyncState()).toEqual({ "b.md": { ...ROW, relocating: true } });
		// Its push must be the relocating create, not a crdt_msg (e2e test_93).
		expect(engine.hasServerNote("id-1")).toBe(false);
	});

	test("the relocation's create-ack clears the flag and keeps the row", async () => {
		const { engine, map } = engineWith();
		map.rename("a.md", "b.md");
		engine.renamePath("a.md", "b.md", "local");

		await engine.adoptCreateAck("id-1", "b.md", null, { flushHeld: false });

		expect(engine.exportSyncState()["b.md"].relocating).toBeUndefined();
		expect(engine.exportSyncState()["b.md"].hash).toBe(ROW.hash);
		expect(engine.hasServerNote("id-1")).toBe(true);
	});

	test("the identity mover carries the row instead of dropping it", async () => {
		const { engine } = engineWith({ "a.md": "body" });

		await engine.renameFollowingIdentity("a.md", "b.md");

		expect(engine.exportSyncState()).toEqual({ "b.md": ROW });
	});

	test("a queued create carries the note's current path, not the failed send's", () => {
		const { engine, map } = engineWith();
		const enqueue = mock();
		engine.setCrdtPorts({ enqueue });
		map.rename("a.md", "b.md");

		engine.crdtEnqueue({ kind: "create", docId: "id-1", path: "a.md" });
		engine.crdtEnqueue({ kind: "delete", docId: "id-1", path: "a.md" });

		expect(enqueue.mock.calls[0][0]).toEqual({ kind: "create", docId: "id-1", path: "b.md" });
		expect(enqueue.mock.calls[1][0]).toEqual({ kind: "delete", docId: "id-1", path: "a.md" });
	});

	test("a debounced push for a file gone from its path is a skip, not a throw", async () => {
		const { engine } = engineWith();

		await expect(engine.pushFile({ path: "gone.md", extension: "md" })).resolves.toBe(false);
	});

	test("a read error on a file that still exists propagates, not a silent skip", async () => {
		const { engine } = engineWith({ "a.md": "body" });
		engine.app.vault.cachedRead.mockRejectedValueOnce(new Error("EIO"));

		await expect(engine.pushFile({ path: "a.md", extension: "md" })).rejects.toThrow("EIO");
	});

	test("a renamed note's unchanged body is not echo-skipped: the push is the relocation", async () => {
		const { engine, map } = engineWith({ "b.md": "body" });
		// Baseline hash equals the file's own: a rename changes no content.
		engine.importSyncState({ "a.md": { ...ROW, hash: fnv1a("body") } });
		map.rename("a.md", "b.md");
		engine.renamePath("a.md", "b.md", "local");
		// The push gets past the echo filter into the push slot.
		const slot = mock(async () => {
			throw new Error("reached push slot");
		});
		engine.acquirePushSlot = slot;

		await expect(engine.pushFile({ path: "b.md", extension: "md" })).rejects.toThrow(
			"reached push slot",
		);
		expect(slot).toHaveBeenCalledTimes(1);
	});

	test("a relocation lost in a crash is re-found by the sweep despite an old mtime", () => {
		const file = new TFile("b.md", 1);
		const { engine, map } = engineWith({ "b.md": "body" });
		engine.app.vault.getFiles.mockReturnValue([file]);
		map.rename("a.md", "b.md");
		engine.renamePath("a.md", "b.md", "local");
		// Restart: the row (with its flag) comes back from disk.
		engine.importSyncState(engine.exportSyncState());

		expect(engine.pushCandidates(Date.now())).toEqual([file]);

		engine.patchSyncedRow("b.md", { relocating: undefined });
		expect(engine.pushCandidates(Date.now())).toEqual([]);
	});

	test("a relocation whose create is still queued is left to the queue", () => {
		const file = new TFile("b.md", 1);
		const { engine, map } = engineWith({ "b.md": "body" });
		engine.app.vault.getFiles.mockReturnValue([file]);
		map.rename("a.md", "b.md");
		engine.renamePath("a.md", "b.md", "local");
		engine.setCrdtHasPendingOp(() => true);

		expect(engine.pushCandidates(Date.now())).toEqual([]);
	});

	test("a debounced push that hits a real read error is logged, not an unhandled rejection", async () => {
		const file = new TFile("a.md", 1);
		const { engine } = engineWith({ "a.md": "body" });
		engine.app.vault.getAbstractFileByPath.mockReturnValue(file);
		engine.app.vault.cachedRead.mockRejectedValue(new Error("EIO"));
		const unhandled: unknown[] = [];
		const onUnhandled = (e: unknown) => unhandled.push(e);
		process.on("unhandledRejection", onUnhandled);

		engine.handleModify(file);
		await new Promise((r) => setTimeout(r, 50));
		process.off("unhandledRejection", onUnhandled);

		expect(unhandled).toEqual([]);
	});
});
