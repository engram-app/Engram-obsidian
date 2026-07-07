/**
 * REPLICATION of the 2026-07-07 prod data-loss incident: an inbound change for
 * one note destroyed/overwrote a DIFFERENT, unrelated note.
 *
 * Precondition: the client noteIdMap is cross-wired — id X is locally mapped to
 * path B.md, while the server authoritatively holds X at A.md and B.md is its
 * OWN separate note (id Y). This is the stale-map state the incident's data.json
 * showed (existing files carrying freshly-minted / wrong ids).
 *
 * Two real code seams consume pathForId(id) and can then hit the wrong file:
 *   1. moveIfIdRelocated (applySyncChange, sync.ts) — trashes pathForId(id) as
 *      the "old path" of a rename. Under a cross-wire that's an unrelated note.
 *   2. flushFromCrdt via pathForId (live CRDT delivery) — writes X's body onto
 *      pathForId(X).
 *
 * These tests assert the SAFE behavior (the unrelated note B.md is never
 * trashed by an inbound change whose authoritative path is A.md).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const getManifest = mock().mockResolvedValue(null);
const mockApi = {
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
	getManifest,
} as unknown as EngramApi;

function manifest(notes: Array<{ id: string; path: string }>) {
	return {
		notes: notes.map((n) => ({ ...n, content_hash: "h" })),
		attachments: [],
		total_notes: notes.length,
		total_attachments: 0,
		change_seq: 1,
	};
}

const mockApp = {
	vault: {
		configDir: ".obsidian",
		cachedRead: mock().mockResolvedValue("B body — do not lose"),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function createEngine(): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	return engine;
}

beforeEach(() => {
	(mockApp.fileManager.trashFile as ReturnType<typeof mock>).mockClear();
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset();
	getManifest.mockReset().mockResolvedValue(null);
});

function upsert(id: string, path: string) {
	return {
		type: "note",
		id,
		seq: 2,
		path,
		title: path,
		content: `${path} body`,
		folder: "",
		tags: [],
		mtime: 2,
		updated_at: "2026-01-01T00:00:00Z",
		deleted: false,
	} as any;
}

describe("cross-wired map must not destroy an unrelated note", () => {
	test("manifest says priorPath belongs to a DIFFERENT id -> refuse trash, rebind id to its real path", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		// Cross-wire: X is locally mapped to B.md, but X authoritatively lives at
		// A.md. B.md is a real, separate note (id Y) the user cares about.
		map.set("B.md", "X");
		engine.setNoteIdMap(map);
		getManifest.mockResolvedValue(
			manifest([
				{ id: "X", path: "A.md" },
				{ id: "Y", path: "B.md" },
			]),
		);

		const bFile = new TFile("B.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "B.md" ? bFile : null,
		);

		// Server sends the authoritative upsert for X at its real path A.md.
		await engine.applySyncChange(upsert("X", "A.md"));

		// B.md is an unrelated live note — never trash it on X's account.
		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalledWith(bFile);
		// And the map heals: X rebinds to A.md, B.md no longer claims X.
		expect(map.pathForId("X")).toBe("A.md");
		expect(map.get("B.md")).not.toBe("X");
	});

	test("manifest UNAVAILABLE -> refuse trash (duplicate is recoverable, a wrong trash is not)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		map.set("B.md", "X");
		engine.setNoteIdMap(map);
		getManifest.mockResolvedValue(null); // pre-manifest backend / fetch failed

		const bFile = new TFile("B.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "B.md" ? bFile : null,
		);

		await engine.applySyncChange(upsert("X", "A.md"));

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalledWith(bFile);
	});

	test("legit server rename (priorPath absent from manifest) -> old file IS trashed (test_10 preserved)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		map.set("Old.md", "id-move");
		engine.setNoteIdMap(map);
		// Fresh manifest reflects the rename: only New.md exists, Old.md is gone.
		getManifest.mockResolvedValue(manifest([{ id: "id-move", path: "New.md" }]));

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);

		await engine.applySyncChange(upsert("id-move", "New.md"));

		// The id-keyed move must still clean up the genuinely-renamed old file.
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
		expect(map.pathForId("id-move")).toBe("New.md");
	});

	test("stale manifest still lists priorPath under the SAME id -> rename is real, trash proceeds", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		map.set("Old.md", "id-move");
		engine.setNoteIdMap(map);
		// Manifest snapshot predates the rename: Old.md still listed, but under
		// the SAME id being moved — that's the id's own old copy, not a stranger.
		getManifest.mockResolvedValue(manifest([{ id: "id-move", path: "Old.md" }]));

		const oldFile = new TFile("Old.md");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation((p: string) =>
			p === "Old.md" ? oldFile : null,
		);

		await engine.applySyncChange(upsert("id-move", "New.md"));

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(oldFile);
	});
});
