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

describe("pre-merge review hardening (#419 round 2)", () => {
	test("a failed trashFile rolls the counter back — the next genuine delete pushes", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("locked/file.png");
		recordSyncEvidence(e, file.path);
		(e as any).app.fileManager.trashFile = mock().mockRejectedValue(new Error("EBUSY"));

		await expect((e as any).trashRemotelyDeleted(file)).rejects.toThrow("EBUSY");

		// The file never left the vault; the user deletes it for real WITHIN the
		// 5s marker window — the rollback must have cleared BOTH the counter and
		// the remotelyDeleted marker (round-3 review: the marker half was missed
		// and the old version of this test masked it with a manual clearMarker).
		await e.handleDelete(file);
		expect(deleteAttachment).toHaveBeenCalledTimes(1);
	});

	test("a vault switch clears stranded trash counters", async () => {
		const { e, deleteAttachment } = makeEngine();
		const file = makeAttachmentFile("Inbox.png");
		recordSyncEvidence(e, file.path);
		await (e as any).trashRemotelyDeleted(file);
		(e as any).files.clearMarker(file.path, "remotelyDeleted");

		await e.resetForVaultChange();

		// New vault, same path: the old counter must not consume this delete.
		recordSyncEvidence(e, file.path);
		await e.handleDelete(file);
		expect(deleteAttachment).toHaveBeenCalledTimes(1);
	});

	test("a late delete event for a REPLACED path leaves the fresh note's state intact", async () => {
		const { e, crdtDeletes } = makeEngine();
		const file = makeNoteFile("replaced/note.md");
		await (e as any).trashRemotelyDeleted(file);
		(e as any).files.clearMarker(file.path, "remotelyDeleted");

		// A fresh file now lives at the path (pull recreated it) with new state.
		(e as any).app.vault.getFileByPath = mock().mockReturnValue(makeNoteFile(file.path));
		(e as any).noteIdMap.set(file.path, "id-fresh");
		recordSyncEvidence(e, file.path);

		await e.handleDelete(file);

		// The stale echo must not unmap/tombstone/push against the fresh note.
		expect(crdtDeletes).toHaveLength(0);
		expect((e as any).noteIdMap.get(file.path)).toBe("id-fresh");
		expect((e as any).syncState.has(file.path)).toBe(true);
		expect((e as any).recentlyDeleted.has("id-fresh")).toBe(false);
		// ...and the counter was consumed, so a real later delete pushes.
		(e as any).app.vault.getFileByPath = mock().mockReturnValue(null);
		await e.handleDelete(file);
		expect(crdtDeletes).toEqual([file.path]);
	});

	test("an unevidenced queued delete does not suppress catch-up recreation", () => {
		const { e } = makeEngine();
		e.queue.load([
			{ path: "doomed/a.md", action: "delete", timestamp: 1 },
			{ path: "real/b.md", action: "delete", evidenced: true, timestamp: 2 },
		]);
		expect(e.queue.hasPendingEvidencedDelete("doomed/a.md", undefined)).toBe(false);
		expect(e.queue.hasPendingEvidencedDelete("real/b.md", undefined)).toBe(true);
	});
});

describe("round-3 hardening", () => {
	test("a stale echo for a reoccupied path still cancels the pending push timer", async () => {
		const { e } = makeEngine();
		const file = makeAttachmentFile("reoccupied/x.png");
		await (e as any).trashRemotelyDeleted(file);
		// A push timer armed for the old file...
		const timer = setTimeout(() => {}, 60_000);
		(e as any).debounceTimers.set(file.path, timer);
		// ...and a fresh file already at the path when the late echo lands.
		(e as any).app.vault.getFileByPath = mock().mockReturnValue(makeAttachmentFile(file.path));

		await e.handleDelete(file);

		expect((e as any).debounceTimers.has(file.path)).toBe(false);
		clearTimeout(timer);
	});

	test("probe semantics: an unstamped queued create still counts as pending", async () => {
		const { e, crdtDeletes } = makeEngine();
		const file = makeNoteFile("fresh/unstamped.md");
		(e as any).noteIdMap.set(file.path, "id-unstamped");
		// Simulate main.ts's owner semantics: unstamped op (vaultId undefined)
		// is delivered to the current vault, so the probe reports it pending.
		e.setCrdtHasPendingOp((id: string) => id === "id-unstamped");

		await e.handleDelete(file);

		expect(crdtDeletes).toEqual([file.path]);
	});
});

/**
 * Retention: deleting a note must not leave its body on disk.
 *
 * The merge base is the FULL TEXT of the note, stored in sync-bases.json under
 * `.obsidian/` — a directory people commit to git, sync through iCloud, and zip
 * into bug reports. handleDelete used to pass `dropBase: false`, so a user who
 * deleted a note and emptied the trash still had its body sitting there until
 * LRU eviction happened to reach it at 50MB, which for most vaults is never.
 */
describe("a deleted note takes its merge base with it", () => {
	test("handleDelete drops the stored body, not just the sync row", async () => {
		const { e } = makeEngine();
		const file = makeNoteFile("Personal/Therapy.md");
		recordSyncEvidence(e, file.path);

		const droppedBases: string[] = [];
		(e as any).baseStore = { delete: (p: string) => droppedBases.push(p) };

		await e.handleDelete(file);

		expect(droppedBases).toEqual(["Personal/Therapy.md"]);
	});
});

describe("a delete the SERVER already applied must not tombstone the note id", () => {
	// The id-keyed tombstone (`recentlyDeleted`, 60s) makes both CRDT
	// convergence paths refuse a note by id. It exists for delete-wins
	// (backend #970): a delete THIS device originated, whose round trip an
	// in-flight peer frame could undo.
	//
	// It was ALSO being set when mirroring a delete the server had already
	// applied, and that is where it did damage. A rename is broadcast as two
	// frames — an upsert for the new path and a delete for the old — so the
	// delete leg tombstoned the very note the rename had just moved: 60s of
	// `fan-out skip (recent local delete)` and `op-replay skip`, with the doc
	// destroyed underneath the open editor. Reported live 2026-08-18 as "the
	// rename lands, then typing stops syncing", self-healing on reload.
	//
	// Nothing covered this branch, which is why four rounds of tests on the
	// surrounding code never caught it.
	function tombstoned(e: SyncEngine, id: string): boolean {
		return (e as any).recentlyDeleted.has(id);
	}

	test("mirroring a remote delete leaves the id un-tombstoned", async () => {
		const { e } = makeEngine();
		const file = makeNoteFile("Old.md");
		(e as any).noteIdMap.set(file.path, "id-moved");
		recordSyncEvidence(e, file.path);

		// trashRemotelyDeleted marks the path, so the vault delete event this
		// fires is recognised as our own mirror of a server decision.
		await (e as any).trashRemotelyDeleted(file);
		await e.handleDelete(file);

		expect(tombstoned(e, "id-moved")).toBe(false);
	});

	test("a LOCAL user delete still tombstones — delete-wins is untouched", async () => {
		// The case #970 is actually about: our delete is in flight, and a peer
		// frame that predates it must not resurrect the note.
		const { e } = makeEngine();
		const file = makeNoteFile("Gone.md");
		(e as any).noteIdMap.set(file.path, "id-gone");
		recordSyncEvidence(e, file.path);

		await e.handleDelete(file);

		expect(tombstoned(e, "id-gone")).toBe(true);
	});
});
