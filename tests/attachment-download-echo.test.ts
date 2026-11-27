/**
 * A downloaded attachment is never uploaded back (e2e test_108 rename chain).
 *
 * The download's own vault `create` event used to arm a debounced push. That
 * push is normally an echo skip (the row records the bytes). A server folder
 * move cancels a push still armed, but one already in flight reads the path
 * after `await readBinary`: if the move re-keys the row to the new path in
 * that await, there is no row at the old path and the downloaded bytes went
 * up there, a duplicate at the moved folder's old path about 500 ms (the e2e
 * debounce) after the download.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const OLD = "a/sub/img.png";
const NEW = "b/sub/img.png";
const BYTES = new Uint8Array([137, 80, 78, 71]).buffer;

function makeEngine() {
	const pushAttachment = mock().mockResolvedValue({
		attachment: { path: OLD, content_hash: "server-hash" },
	});
	const api = {
		pushAttachment,
		ping: mock().mockResolvedValue({ ok: true }),
	} as unknown as EngramApi;
	const files = new Map<string, TFile>();
	let engine: SyncEngine;
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			getFileByPath: (p: string) => files.get(p) ?? null,
			getFiles: () => [...files.values()],
			createFolder: mock().mockResolvedValue(undefined),
			// Obsidian dispatches `create` from inside createBinary.
			createBinary: mock(async (p: string) => {
				const f = new TFile(p, Date.now(), BYTES.byteLength);
				files.set(p, f);
				engine.handleModify(f);
				return f;
			}),
			// ...and `modify` from inside modifyBinary.
			modifyBinary: mock(async (f: TFile) => engine.handleModify(f)),
			// The server folder move is handled while the push reads the file:
			// the bookkeeping moves first, the disk rename has not landed yet.
			readBinary: mock(async () => {
				(engine as any).rekeyMoved([[OLD, NEW]], false);
				return BYTES;
			}),
			getName: () => "Test Vault",
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	engine = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setNoteIdMap(new NoteIdMap());
	return { engine, pushAttachment, files, app };
}

describe("attachment download echo", () => {
	test("bytes the engine just downloaded are not uploaded at the old path after a folder move", async () => {
		const { engine, pushAttachment } = makeEngine();

		await engine.applyAttachmentChange(
			{ path: OLD, content_hash: "server-hash", mtime: 1 } as any,
			undefined,
			BYTES,
		);
		await new Promise((r) => setTimeout(r, 30));

		expect(pushAttachment).not.toHaveBeenCalled();
	});

	test("an overwrite of an existing attachment is not uploaded back either", async () => {
		const { engine, pushAttachment, files } = makeEngine();
		// Different size from the download: no read, straight to modifyBinary.
		files.set(OLD, new TFile(OLD, 1, 1));

		await engine.applyAttachmentChange(
			{ path: OLD, content_hash: "server-hash", mtime: 1 } as any,
			undefined,
			BYTES,
		);
		await new Promise((r) => setTimeout(r, 30));

		expect(pushAttachment).not.toHaveBeenCalled();
	});

	test("a write landing on the file a pending folder op moved is not uploaded back", async () => {
		const { engine, pushAttachment, app } = makeEngine();
		const moved = new TFile(NEW, 1, 1);
		// The row is stamped at the server's path, the bytes land at the moved
		// file: only the marker stands between this write and an upload.
		app.vault.readBinary = mock(async () => BYTES);
		(engine as any).fileMovedByPendingOp = (p: string) => (p === OLD ? moved : null);

		await engine.applyAttachmentChange(
			{ path: OLD, content_hash: "server-hash", mtime: 1 } as any,
			undefined,
			BYTES,
		);
		await new Promise((r) => setTimeout(r, 30));

		expect(pushAttachment).not.toHaveBeenCalled();
	});

	test("a download during a pull is not queued for the post-pull push", async () => {
		const { engine, pushAttachment } = makeEngine();
		(engine as any).pulling = true;

		await engine.applyAttachmentChange(
			{ path: OLD, content_hash: "server-hash", mtime: 1 } as any,
			undefined,
			BYTES,
		);
		(engine as any).pulling = false;
		// The drain reads the file while a folder move re-keys its row away.
		await (engine as any).flushPostPullPushes();

		expect(pushAttachment).not.toHaveBeenCalled();
	});
});
