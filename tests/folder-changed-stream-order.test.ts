// e2e test_107 (backend PR 2607, run 43791484191) on plugin 8ac3d17e: an
// attachment was lost on the server and every vault after a folder rename.
// The server's cascade sends delete(old) + upsert(new) for each attachment
// BEFORE folder_changed. On the receiving device `folder_changed` did not wait
// for the stream lane: it `vault.rename`d the folder while the attachment
// delete's `trashFile` was still in flight, so the trash landed at the NEW
// path, whose vault delete event is not engine-marked and went out as a real
// DELETE. Inbound folder changes must apply in arrival order with the note
// stream. Red before the fix: the folder change ran inside the delete.
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

test("folder_changed waits for the stream event that arrived before it", async () => {
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const e = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
	);
	try {
		e.setNoteIdMap(new NoteIdMap());
		e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
		await e.setFolderOpsEnabled(true);
		const order: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		(e as any).applyStreamEvent = async () => {
			order.push("delete:start");
			await gate; // Obsidian's trashFile, mid-flight
			order.push("delete:end");
		};
		(e as any).applyFolderChange = async () => {
			order.push("folder");
		};
		const del = e.handleStreamEvent({
			event_type: "delete",
			kind: "attachment",
			path: "Proj/img.png",
		} as any);
		const fc = e.onFolderChanged({ id: "f1", parent_id: null, name: "Done", seq: 9 });
		for (let i = 0; i < 5; i++) await Promise.resolve();
		release();
		await Promise.all([del, fc]);
		expect(order).toEqual(["delete:start", "delete:end", "folder"]);
	} finally {
		e.destroy();
	}
});

test("backstop: an engine trash that lands after a rename is never sent as a user delete", async () => {
	const file = new TFile("Proj/img.png");
	(file as any).stat = { mtime: 1, ctime: 1, size: 3 };
	const deleteAttachment = mock().mockResolvedValue(undefined);
	let e!: SyncEngine;
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
		fileManager: {
			// Obsidian's trash is async: a folder rename lands mid-flight, and the
			// delete event then names the file's NEW path.
			trashFile: async (f: any) => {
				f.path = "Done/img.png";
				await e.handleDelete(f);
			},
		},
	} as any;
	e = new SyncEngine(
		app,
		{ deleteAttachment, deleteNote: mock() } as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
	);
	try {
		e.setReady();
		e.setNoteIdMap(new NoteIdMap());
		(e as any).syncState.set("Done/img.png", { hash: 1, serverHash: "s" });
		await (e as any).trashRemotelyDeleted(file);
		await e.flushQueue();
		expect(deleteAttachment).not.toHaveBeenCalled();
		expect(e.queue.size).toBe(0);
	} finally {
		e.destroy();
	}
});
