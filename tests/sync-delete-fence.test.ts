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

	test("the record is CONSUMED by the trash's own delete event, so a later REAL user delete pushes", async () => {
		// Consumption-based, not clear-on-recreate (post-merge review finding 1:
		// clearing on recreate let the late trash echo through as a push against
		// the FRESH note). Sequence: trash → recreate → late trash echo (consumes)
		// → genuine user delete (pushes).
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("a/pic.png");
		recordSyncEvidence(e, file.path);

		await (e as any).trashRemotelyDeleted(file);
		(e as any).files.clearMarker(file.path, "remotelyDeleted");

		// Recreate at the path (pull) — must NOT clear the pending record.
		recordSyncEvidence(e, file.path);

		// Late delete event for the OLD trashed file: consumed as an echo, no push.
		await e.handleDelete(file);
		expect(deleteAttachment).not.toHaveBeenCalled();

		// Genuine user delete of the recreated file: pushes.
		recordSyncEvidence(e, file.path);
		await e.handleDelete(file);
		expect(deleteAttachment).toHaveBeenCalledTimes(1);
	});

	test("a wipe-pass delete event landing DURING suppressDeletes still consumes the record", async () => {
		// Review finding 4: the suppressDeletes early-return ran before the echo
		// consume, stranding a permanent record that would swallow a future
		// genuine delete at the path.
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("wipe/extra.png");
		recordSyncEvidence(e, file.path);

		await (e as any).trashRemotelyDeleted(file);
		(e as any).suppressDeletes = true;
		await e.handleDelete(file); // in-window echo: consumed, no push
		(e as any).suppressDeletes = false;
		expect(deleteAttachment).not.toHaveBeenCalled();

		// Path is later reused and genuinely deleted — must push.
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

describe("refusal side effects (review findings 5+7)", () => {
	test("refusal with a PENDING crdt create enqueues the superseding delete", async () => {
		const { e, crdtDeletes } = makeEngine();
		const file = makeNoteFile("fresh/unacked.md");
		(e as any).noteIdMap.set(file.path, "id-pending");
		e.setCrdtHasPendingOp((id: string) => id === "id-pending");

		await e.handleDelete(file);

		// Queue coalesces by docId: the delete supersedes the pending create,
		// restoring the pre-fence create/delete coalesce semantics.
		expect(crdtDeletes).toEqual([file.path]);
	});

	test("pure refusal (no pending op) does not tombstone the id for delete-wins", async () => {
		const { e, crdtDeletes } = makeEngine();
		const file = makeNoteFile("never/synced.md");
		(e as any).noteIdMap.set(file.path, "id-x");
		e.setCrdtHasPendingOp(() => false);

		await e.handleDelete(file);

		expect(crdtDeletes).toHaveLength(0);
		// The promised remedy for a wrong refusal is next-pull resurrection —
		// a recentlyDeleted tombstone would block it for the delete-wins window.
		expect((e as any).recentlyDeleted.has("id-x")).toBe(false);
	});
});

describe("offline-queue delete drain (review finding 0)", () => {
	test("a persisted delete entry WITHOUT an evidence stamp is dropped, not pushed", async () => {
		const { e, deleteAttachment } = makeEngine();
		e.queue.load([
			{ path: "poison/old.png", action: "delete", kind: "attachment", timestamp: 1 },
		]);

		await e.flushQueue();

		expect(deleteAttachment).not.toHaveBeenCalled();
		expect(e.queue.size).toBe(0);
	});

	test("an evidenced delete entry still pushes", async () => {
		const { e, deleteAttachment } = makeEngine();
		e.queue.load([
			{
				path: "known/gone.png",
				action: "delete",
				kind: "attachment",
				timestamp: 1,
				evidenced: true,
			},
		]);

		await e.flushQueue();

		expect(deleteAttachment).toHaveBeenCalledTimes(1);
		expect(e.queue.size).toBe(0);
	});
});

describe("queue-replayed attachment gains evidence (review finding 6)", () => {
	test("an attachment uploaded only via the queue drain can later be deleted", async () => {
		const { e, deleteAttachment } = makeEngine();
		(e as any).api.pushAttachment = mock().mockResolvedValue({ attachment: {} });
		e.queue.load([
			{
				path: "flaky/photo.png",
				action: "upsert",
				contentBase64: "AQID",
				mimeType: "image/png",
				mtime: 100,
				kind: "attachment",
				timestamp: 1,
			},
		]);

		await e.flushQueue();

		// The replay must stamp sync evidence, or this delete is refused forever.
		await e.handleDelete(makeAttachmentFile("flaky/photo.png"));
		expect(deleteAttachment).toHaveBeenCalledWith("flaky/photo.png");
	});
});

describe("rename old-leg delete (review finding 2)", () => {
	test("rename of a never-synced attachment does not push the old-path delete", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("img/pic2.png");

		await e.handleRename(file, "img/pic.png");

		expect(deleteAttachment).not.toHaveBeenCalled();
	});

	test("rename of a synced attachment still deletes the old path", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("img/pic2.png");
		recordSyncEvidence(e, "img/pic.png");

		await e.handleRename(file, "img/pic.png");

		expect(deleteAttachment).toHaveBeenCalledWith("img/pic.png");
	});
});
