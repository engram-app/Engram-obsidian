/**
 * Engram#2523 S4 step 1: an attachment rename moves the server row with
 * `POST /attachments/rename` instead of deleting the old path and uploading
 * the bytes again at the new one (audit item 3: O(1) on the server, 0 bytes).
 *
 * Fallbacks:
 *  - 404: the server has nothing at the old path, so upload at the new path
 *    (no old-path delete: there is nothing to delete).
 *  - any other refusal (402 attachments disabled, 409, network): today's
 *    delete-plus-upload path, so the plan gate and the durable queue behave
 *    exactly as before.
 *  - no sync evidence for the old path: no move and no delete (#416 evidence
 *    rule), just the new-path upload, as today.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function httpError(status: number): Error {
	return Object.assign(new Error(`HTTP ${status}`), { status });
}

function makeEngine(rename: (oldPath: string, newPath: string) => Promise<unknown>) {
	const deleteAttachment = mock().mockResolvedValue({ deleted: true, path: "" });
	const pushAttachment = mock().mockResolvedValue({ attachment: { content_hash: "srv" } });
	const renameAttachment = mock(rename);
	const api = {
		deleteAttachment,
		pushAttachment,
		renameAttachment,
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	} as unknown as EngramApi;
	const app = {
		vault: {
			configDir: ".obsidian",
			read: mock().mockResolvedValue("body"),
			cachedRead: mock().mockResolvedValue("body"),
			readBinary: mock().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
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
	e.setCrdtEnqueue(() => {});
	e.setNoteIdMap(new NoteIdMap());
	return { e, deleteAttachment, pushAttachment, renameAttachment };
}

function attachment(path: string): TFile {
	const f = new TFile(path);
	(f as any).stat = { mtime: 1000, ctime: 1000, size: 3 };
	return f;
}

const state = (e: SyncEngine) => (e as any).syncState as Map<string, any>;

describe("attachment rename moves the server row (Engram#2523 S4)", () => {
	test("a synced attachment is moved, not deleted and re-uploaded", async () => {
		const { e, deleteAttachment, pushAttachment, renameAttachment } = makeEngine(async () => ({
			renamed: true,
		}));
		state(e).set("img/pic.png", { hash: 7, serverHash: "srv-hash" });

		await e.handleRename(attachment("img/moved/pic.png"), "img/pic.png");

		expect(renameAttachment).toHaveBeenCalledWith("img/pic.png", "img/moved/pic.png");
		expect(deleteAttachment).not.toHaveBeenCalled();
		expect(pushAttachment).not.toHaveBeenCalled();
		// The row moved with the file: the server's own upsert broadcast for the
		// new path then hash-skips instead of downloading the bytes back.
		expect(state(e).get("img/pic.png")).toBeUndefined();
		expect(state(e).get("img/moved/pic.png")?.serverHash).toBe("srv-hash");
	});

	test("404 (server never had the old path) uploads at the new path, no delete", async () => {
		const { e, deleteAttachment, pushAttachment, renameAttachment } = makeEngine(async () => {
			throw httpError(404);
		});
		state(e).set("img/pic.png", { hash: 7, serverHash: "srv-hash" });

		await e.handleRename(attachment("img/moved/pic.png"), "img/pic.png");

		expect(renameAttachment).toHaveBeenCalledTimes(1);
		expect(deleteAttachment).not.toHaveBeenCalled();
		expect(pushAttachment.mock.calls.map((c: unknown[]) => c[0])).toEqual([
			"img/moved/pic.png",
		]);
	});

	test("402 (attachments not on the plan) falls back to today's delete plus upload", async () => {
		const { e, deleteAttachment, pushAttachment } = makeEngine(async () => {
			throw httpError(402);
		});
		state(e).set("img/pic.png", { hash: 7 });

		await e.handleRename(attachment("img/moved/pic.png"), "img/pic.png");

		expect(deleteAttachment.mock.calls.map((c: unknown[]) => c[0])).toEqual(["img/pic.png"]);
		expect(pushAttachment.mock.calls.map((c: unknown[]) => c[0])).toEqual([
			"img/moved/pic.png",
		]);
	});

	test("a network failure falls back to today's path (the delete leg queues durably)", async () => {
		const { e, deleteAttachment, pushAttachment } = makeEngine(async () => {
			throw new Error("net::ERR_CONNECTION_RESET");
		});
		state(e).set("img/pic.png", { hash: 7 });

		await e.handleRename(attachment("img/moved/pic.png"), "img/pic.png");

		expect(deleteAttachment.mock.calls.map((c: unknown[]) => c[0])).toEqual(["img/pic.png"]);
		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("a failed move restores the old row, so the fallback still has its evidence", async () => {
		const { e } = makeEngine(async () => {
			throw httpError(409);
		});
		state(e).set("img/pic.png", { hash: 7 });

		await e.handleRename(attachment("img/moved/pic.png"), "img/pic.png");

		// Not moved: the new path's row is the upload's, not a carried copy.
		expect(state(e).get("img/moved/pic.png")?.serverHash).toBe("srv");
	});

	test("no sync evidence: no move, no delete, just the upload (evidence rule #416)", async () => {
		const { e, deleteAttachment, pushAttachment, renameAttachment } = makeEngine(async () => ({
			renamed: true,
		}));

		await e.handleRename(attachment("img/moved/pic.png"), "img/pic.png");

		expect(renameAttachment).not.toHaveBeenCalled();
		expect(deleteAttachment).not.toHaveBeenCalled();
		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("rename INTO an ignored folder does not move the server row there", async () => {
		const { e, renameAttachment } = makeEngine(async () => ({ renamed: true }));
		(e as any).settings.ignorePatterns = "private/";
		(e as any).parseIgnorePatterns();
		expect(e.shouldIgnore("private/pic.png")).toBe(true);
		state(e).set("img/pic.png", { hash: 7 });

		await e.handleRename(attachment("private/pic.png"), "img/pic.png");

		expect(renameAttachment).not.toHaveBeenCalled();
	});

	test("a rename journaled while gated replays as a move, with no upload", async () => {
		const { e, pushAttachment, renameAttachment } = makeEngine(async () => ({ renamed: true }));
		const moved = attachment("img/moved/pic.png");
		(e as any).app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === moved.path ? moved : null,
		);
		state(e).set("img/pic.png", { hash: 7 });
		e.setSyncBlocked(true);

		await e.handleRename(moved, "img/pic.png");
		expect(renameAttachment).not.toHaveBeenCalled();

		e.setSyncBlocked(false);
		await e.replayGateJournal();

		expect(renameAttachment).toHaveBeenCalledWith("img/pic.png", "img/moved/pic.png");
		expect(pushAttachment).not.toHaveBeenCalled();
	});
});
