/**
 * A downloaded attachment is never uploaded back (e2e test_108 rename chain).
 *
 * The download's own vault `create` event used to arm a debounced push. That
 * push is normally an echo skip (the row records the bytes), but a server
 * folder move re-keys the row to the new path before the disk rename lands.
 * A push reading the file in that window found no row at the old path and
 * uploaded the downloaded bytes there: a duplicate at the moved folder's old
 * path, about 500 ms (the e2e debounce) after the download.
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
	return { engine, pushAttachment };
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
});
