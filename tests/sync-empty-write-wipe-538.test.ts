/**
 * #538: opening a note wiped it to 0 bytes on every device.
 *
 * CI trace (backend run 36095746392, device B): the note's map entry went
 * missing, `getOrMint` minted a second id at file-open, and a 0-byte write
 * landed on disk while the path was keyed to that fresh, EMPTY, never-acked
 * doc. `flushFromCrdt`'s empty-write guard only refused when the doc still
 * projected content, so an empty doc waved the blank through. Once the map
 * healed back to the server id, the empty disk body was diffed into the real
 * doc and fanned out to every device.
 *
 * Two halves are pinned here:
 *  - flushFromCrdt refuses "" over a non-empty file when the doc cannot vouch
 *    for the empty (no id, unseeded doc, or an id the server never acked);
 *  - a locally-minted, unacked id is never "server-known", even when its PATH
 *    has a crdtHead (the path-keyed oracle trap), so ops never route under it.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	getManifest: mock().mockResolvedValue(null),
} as unknown as EngramApi;

let mockApp: any;

beforeEach(() => {
	mockApp = {
		vault: {
			configDir: ".obsidian",
			cachedRead: mock().mockResolvedValue("---\nstatus: draft\n---\n\nbase line.\n"),
			getAbstractFileByPath: mock().mockReturnValue(new TFile("n.md")),
			getFileByPath: mock().mockReturnValue(null),
			getMarkdownFiles: mock().mockReturnValue([]),
			getFiles: mock().mockReturnValue([]),
			modify: mock().mockResolvedValue(undefined),
			create: mock().mockResolvedValue(undefined),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	};
});

function createEngine(map: NoteIdMap): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setNoteIdMap(map);
	return engine;
}

/** A registry double backed by real Y.Docs, so "seeded" means what it means in
 *  production: the doc has integrated at least one struct. */
function registry(docs: Record<string, Y.Doc>) {
	const doc = (id: string) => {
		docs[id] ??= new Y.Doc();
		return docs[id];
	};
	return {
		getDoc: mock(async (id: string) => doc(id)),
		projectedText: mock(async (id: string) => doc(id).getText("content").toJSON()),
	};
}

/** A doc that held content and was then cleared by a peer: empty, but seeded. */
function clearedDoc(): Y.Doc {
	const d = new Y.Doc();
	d.getText("content").insert(0, "base line.\n");
	d.getText("content").delete(0, d.getText("content").length);
	return d;
}

function confirm(engine: SyncEngine, id: string): void {
	(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId(id);
}

describe("#538 flushFromCrdt refuses an empty write the doc cannot vouch for", () => {
	test("fresh local mint (unacked id, empty doc) must NOT blank a non-empty file", async () => {
		const map = new NoteIdMap();
		// The wrong-mint: the path's server id is gone from the map, so the
		// file-open resolve mints a fresh id with an empty doc.
		map.getOrMint("n.md");
		const engine = createEngine(map);
		engine.setCrdtManager(registry({}) as any);

		await engine.flushFromCrdt("n.md", "");

		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("server-known id whose doc was never seeded must NOT blank a non-empty file", async () => {
		const map = new NoteIdMap();
		map.set("n.md", "id-server");
		const engine = createEngine(map);
		confirm(engine, "id-server");
		// Doc exists but has integrated nothing: an empty projection means
		// "not loaded yet", not "cleared".
		engine.setCrdtManager(registry({ "id-server": new Y.Doc() }) as any);

		await engine.flushFromCrdt("n.md", "");

		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("no id at all must NOT blank a non-empty file", async () => {
		const engine = createEngine(new NoteIdMap());
		engine.setCrdtManager(registry({}) as any);

		await engine.flushFromCrdt("n.md", "");

		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	test("a genuine remote clear (confirmed id, seeded doc now empty) still writes through", async () => {
		const map = new NoteIdMap();
		map.set("n.md", "id-server");
		const engine = createEngine(map);
		confirm(engine, "id-server");
		engine.setCrdtManager(registry({ "id-server": clearedDoc() }) as any);

		await engine.flushFromCrdt("n.md", "");

		expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);
		expect(mockApp.vault.modify.mock.calls[0][1]).toBe("");
	});

	test("a locally-created note, once acked, still receives a remote clear", async () => {
		const map = new NoteIdMap();
		const id = map.getOrMint("n.md");
		const engine = createEngine(map);
		confirm(engine, id); // create-ack
		engine.setCrdtManager(registry({ [id]: clearedDoc() }) as any);

		await engine.flushFromCrdt("n.md", "");

		expect(mockApp.vault.modify).toHaveBeenCalledTimes(1);
	});

	test("a note empty on both sides still syncs (nothing to protect)", async () => {
		mockApp.vault.cachedRead.mockResolvedValue("");
		const engine = createEngine(new NoteIdMap());
		engine.setCrdtManager(registry({}) as any);

		// Disk already "" → idempotent skip, reported as success.
		expect(await engine.flushFromCrdt("n.md", "")).toBe(true);
	});
});

describe("#538 a fresh local mint is never server-known", () => {
	test("an unacked mint on a path with a crdtHead does not inherit the path's verdict", () => {
		const map = new NoteIdMap();
		const engine = createEngine(map);
		// The path is server-known (a real id delivered it)...
		map.set("n.md", "id-server");
		engine.setCrdtHead("n.md", "head-1");
		expect(engine.hasServerNote("id-server")).toBe(true);
		// ...then the entry is lost and file-open mints a duplicate.
		map.delete("n.md");
		const minted = map.getOrMint("n.md");
		expect(minted).not.toBe("id-server");

		// hasServerNote is path-keyed; the server has never seen `minted`, so
		// ops under it are dropped note_not_found. It must not route live.
		expect(engine.hasServerNote(minted)).toBe(false);
	});

	test("the mint becomes server-known once the server acks it", () => {
		const map = new NoteIdMap();
		const engine = createEngine(map);
		const minted = map.getOrMint("n.md");
		engine.setCrdtHead("n.md", "head-1");
		confirm(engine, minted);

		expect(engine.hasServerNote(minted)).toBe(true);
	});
});
