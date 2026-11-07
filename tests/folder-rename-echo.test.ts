/**
 * Engram#2523 S4: the Relay echo rule (Relay `SharedFolder.ts`
 * notifyVaultRename). After a folder op re-keyed a folder's children, a
 * child rename event arriving on a LATER tick (design risk R4: the order is
 * not verified on mobile) must be a pure no-op: no file read, no id
 * un-confirm, nothing on the wire.
 *
 * The sim cannot see this one: without the rule the per-file path still ends
 * in an echo skip, so the cost is local (a read of every child's bytes, an
 * attachment's whole blob) plus an un-confirmed note id. This pins it.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function setup() {
	const note = new TFile("Done/a.md");
	const image = new TFile("Done/img.png");
	(note as any).stat = { mtime: 1, ctime: 1, size: 4 };
	(image as any).stat = { mtime: 1, ctime: 1, size: 3 };
	const folder = new TFolder("Done", [note, image]);
	const byPath = new Map<string, unknown>([
		["Done", folder],
		["Done/a.md", note],
		["Done/img.png", image],
	]);
	const cachedRead = mock().mockResolvedValue("body");
	const readBinary = mock().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead,
			read: cachedRead,
			readBinary,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = {
		renameAttachment: mock(),
		pushAttachment: mock(),
		deleteAttachment: mock(),
		deleteNote: mock(),
	};
	const e = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	const ids = new NoteIdMap();
	e.setNoteIdMap(ids);
	const crdtCreate = mock();
	e.setCrdtPorts({ create: crdtCreate, folderOp: async () => ({ kind: "ok", seq: 5 }) });
	ids.set("Proj/a.md", "id-a");
	(e as any).confirmNoteId("id-a");
	(e as any).syncState.set("Proj/a.md", { hash: 1, crdtHead: "h" });
	(e as any).syncState.set("Proj/img.png", { hash: 2, serverHash: "s" });
	e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
	return { e, ids, folder, note, image, api, crdtCreate, cachedRead, readBinary };
}

describe("Relay echo rule", () => {
	test("children arriving a tick after their folder's op send and read nothing", async () => {
		const s = setup();
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		// A later tick: the batch above has flushed.
		await new Promise((r) => setTimeout(r, 0));
		await s.e.handleRename(s.note, "Proj/a.md");
		await s.e.handleRename(s.image, "Proj/img.png");

		expect(s.ids.get("Done/a.md")).toBe("id-a");
		expect(s.cachedRead).not.toHaveBeenCalled();
		expect(s.readBinary).not.toHaveBeenCalled();
		expect(s.crdtCreate).not.toHaveBeenCalled();
		expect(s.api.renameAttachment).not.toHaveBeenCalled();
		expect(s.api.pushAttachment).not.toHaveBeenCalled();
		expect((s.e as any).isNoteConfirmed("id-a")).toBe(true);
	});

	test("folder ops off: the same child events take today's per-file path", async () => {
		const s = setup();
		await s.e.handleRename(s.note, "Proj/a.md");
		await new Promise((r) => setTimeout(r, 5));
		expect(s.ids.get("Done/a.md")).toBe("id-a");
		expect(s.cachedRead).toHaveBeenCalled();
	});
});
