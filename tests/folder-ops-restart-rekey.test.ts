// e2e test_107 restart case (backend PR 2607, run 43903317486): after a
// plugin reload with a folder op still pending, A's id map said the note
// lived at the OLD path (`rename-trace 2/3 SKIPPED (map already at target)
// ... from=<old>`) while its file was at the new one: only the op itself was
// persisted with its from/to, and the restored bookkeeping predated the op's
// re-key. Every inbound row then targeted the old path and re-created the
// note there. On ready, a pending op's re-key must be re-derived.
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function restartedWithStaleBookkeeping() {
	const note = new TFile("Done/a.md");
	(note as any).stat = { mtime: 1, ctime: 1, size: 4 };
	const folder = new TFolder("Done", [note]);
	const byPath = new Map<string, unknown>([
		["Done", folder],
		["Done/a.md", note],
	]);
	const read = mock().mockResolvedValue("body");
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead: read,
			read,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const e = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	const ids = new NoteIdMap();
	e.setNoteIdMap(ids);
	// What the reload restored: bookkeeping from BEFORE the op's re-key.
	ids.set("Proj/a.md", "id-a");
	(e as any).syncState.set("Proj/a.md", { hash: 1, crdtHead: "h", seq: 3 });
	// The op itself was persisted (data.json folderOps) and is restored.
	e.folderOps.load([
		{
			op: "move",
			op_id: "o1",
			folder_id: "f1",
			parent_id: null,
			name: "Done",
			from: "Proj",
			to: "Done",
			vaultId: "v1",
		},
	]);
	return { e, ids };
}

test("on ready, a pending op's re-key is re-derived: the map and rows follow the disk", () => {
	const { e, ids } = restartedWithStaleBookkeeping();
	try {
		e.setReady();
		expect(ids.get("Done/a.md")).toBe("id-a");
		expect(ids.get("Proj/a.md")).toBeNull();
		expect(ids.pathForId("id-a")).toBe("Done/a.md");
		expect((e as any).syncState.has("Done/a.md")).toBe(true);
		expect((e as any).syncState.has("Proj/a.md")).toBe(false);
		// A server row for the old path is the server's pre-op state: stale.
		expect((e as any).isStalePathClaim("id-a", "Proj/a.md", 9)).toBe(true);
	} finally {
		e.destroy();
	}
});

test("control: with no pending op nothing is re-keyed", () => {
	const { e, ids } = restartedWithStaleBookkeeping();
	try {
		e.folderOps.reset();
		e.setReady();
		expect(ids.get("Proj/a.md")).toBe("id-a");
	} finally {
		e.destroy();
	}
});
