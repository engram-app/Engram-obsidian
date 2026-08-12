/**
 * Tests: the delete-push fence (#416 — 2026-08-12 prod data-loss incident).
 *
 * A first sync into a switched vault trashed freshly-pulled files (replay
 * bookkeeping lost rows → orphan sweep) and the late vault delete events —
 * past the 5s remotelyDeleted echo TTL — were pushed to the server as REAL
 * deletions (20 notes + 19 attachments tombstoned in prod).
 *
 * Two independent layers close it:
 *  1. Engine-trashed paths are recorded DURABLY (consumed on the delete
 *     event, cleared on recreate) — never by a timer. Anything the engine
 *     itself trashed can never be pushed back as a user delete.
 *  2. Evidence rule: a delete push requires a recorded syncState entry for
 *     the path. No sync evidence = the server was never told about this
 *     path by us = nothing legitimate to delete.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function makeAttachmentFile(path: string): TFile {
	return new TFile(path);
}

function makeNoteFile(path: string): TFile {
	return new TFile(path);
}

function makeEngine() {
	const deleteAttachment = mock().mockResolvedValue({ deleted: true, path: "" });
	const api = {
		deleteAttachment,
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	} as unknown as EngramApi;
	const app = {
		vault: {
			configDir: ".obsidian",
			read: mock().mockResolvedValue("body"),
			cachedRead: mock().mockResolvedValue("body"),
			getAbstractFileByPath: mock().mockReturnValue(null),
			getFileByPath: mock().mockReturnValue(null),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const e = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	const crdtDeletes: string[] = [];
	e.setCrdtEnqueue((op: any) => {
		if (op.kind === "delete") crdtDeletes.push(op.path);
	});
	e.setNoteIdMap(new NoteIdMap());
	return { e, deleteAttachment, crdtDeletes };
}

function recordSyncEvidence(e: SyncEngine, path: string): void {
	(e as any).syncState.set(path, { hash: 1 });
}

describe("engine-trashed paths never push their delete", () => {
	test("delete event AFTER the echo TTL would have expired still skips the push", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("a/pic.png");
		recordSyncEvidence(e, file.path);

		await (e as any).trashRemotelyDeleted(file);
		// Simulate the 5s remotelyDeleted TTL expiring before Obsidian's async
		// delete event lands (the incident's exact window).
		(e as any).files.clearMarker(file.path, "remotelyDeleted");

		await e.handleDelete(file);

		expect(deleteAttachment).not.toHaveBeenCalled();
	});

	test("a recreate clears the record, so a later REAL user delete pushes", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("a/pic.png");
		recordSyncEvidence(e, file.path);

		await (e as any).trashRemotelyDeleted(file);
		(e as any).files.clearMarker(file.path, "remotelyDeleted");

		// File comes back (pull or user recreate) — the trash record must not
		// outlive it and swallow the next genuine delete.
		e.noteRecreatedPath(file.path);
		recordSyncEvidence(e, file.path);

		await e.handleDelete(file);

		expect(deleteAttachment).toHaveBeenCalledTimes(1);
	});
});

describe("evidence rule: no syncState entry → no delete push", () => {
	test("attachment delete without sync evidence is refused", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("never/synced.png");

		await e.handleDelete(file);

		expect(deleteAttachment).not.toHaveBeenCalled();
	});

	test("attachment delete WITH sync evidence pushes as before", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("known/synced.png");
		recordSyncEvidence(e, file.path);

		await e.handleDelete(file);

		expect(deleteAttachment).toHaveBeenCalledTimes(1);
	});

	test("note delete without sync evidence enqueues no crdt_delete", async () => {
		const { e, crdtDeletes } = makeEngine();
		const file = makeNoteFile("never/synced.md");
		// The note has an id BINDING but no crdtHead and no syncState row —
		// the server never confirmed it. The id alone must not be enough to
		// delete. (A crdtHead WOULD be evidence — it is only ever set from
		// server-delivered state; that shape is covered by the durable
		// engine-trash record instead.)
		(e as any).noteIdMap.set(file.path, "id-x");

		await e.handleDelete(file);

		expect(crdtDeletes).toHaveLength(0);
	});

	test("note delete WITH sync evidence still enqueues crdt_delete", async () => {
		const { e, crdtDeletes } = makeEngine();
		const file = makeNoteFile("known/synced.md");
		(e as any).noteIdMap.set(file.path, "id-y");
		(e as any).setCrdtHead(file.path, "h1");
		recordSyncEvidence(e, file.path);

		await e.handleDelete(file);

		expect(crdtDeletes).toEqual([file.path]);
	});
});
