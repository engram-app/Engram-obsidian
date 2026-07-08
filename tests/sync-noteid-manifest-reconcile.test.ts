/**
 * Regression: live CRDT pull strands inbound content with "no known path"
 * because the plugin never learns the server's note_id -> path mapping for
 * notes it already holds locally.
 *
 * The `/sync/manifest` response ALREADY carries `{ id, path }` for every note
 * (backend render_manifest), but the plugin discarded `id` and only rebuilt
 * `noteIdMap` during a no-cursor bootstrap. After the id-keying cutover a
 * device with an existing cursor never re-runs bootstrap, so its map stays
 * stale, `pathForId` returns null, and `onFlushToDisk` drops every inbound
 * CRDT update ("no known path ... awaiting a sync pull"). Only a manual full
 * sync repopulated the map.
 *
 * Fix under test: `SyncEngine.reconcileNoteIdMapFromManifest()` populates the
 * map authoritatively from the manifest so inbound CRDT always resolves a path.
 */
import { describe, expect, mock, test } from "bun:test";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApp = {
	vault: {
		getFiles: () => [],
		getAbstractFileByPath: () => null,
	},
} as any;

function makeEngine(notes: Array<{ id: string; path: string; content_hash: string }>) {
	const getManifest = mock(async () => ({
		notes,
		attachments: [],
		total_notes: notes.length,
		total_attachments: 0,
		change_seq: 1,
	}));
	const saveData = mock(async () => {});
	const engine = new SyncEngine(
		mockApp,
		{ getManifest } as any,
		{ ...DEFAULT_SETTINGS },
		saveData,
	);
	engine.setReady();
	const map = new NoteIdMap();
	engine.setNoteIdMap(map);
	return { engine, map, getManifest, saveData };
}

describe("SyncEngine.reconcileNoteIdMapFromManifest", () => {
	test("populates id->path from the manifest so inbound CRDT resolves a path", async () => {
		const { engine, map } = makeEngine([
			{ id: "srv-1", path: "A.md", content_hash: "h1" },
			{ id: "srv-2", path: "B/C.md", content_hash: "h2" },
		]);

		// Before: empty map — this is the "no known path" strand condition.
		expect(map.pathForId("srv-1")).toBeNull();

		await engine.reconcileNoteIdMapFromManifest();

		// After: the map resolves the server ids to their paths.
		expect(map.pathForId("srv-1")).toBe("A.md");
		expect(map.pathForId("srv-2")).toBe("B/C.md");
	});

	test("overwrites a stale/wrong id for a path (manifest is authoritative)", async () => {
		const { engine, map } = makeEngine([{ id: "srv-real", path: "A.md", content_hash: "h" }]);
		// Simulate a locally-minted (wrong) id from getOrMint before the server id was learned.
		map.set("A.md", "local-mint-wrong");
		expect(map.pathForId("local-mint-wrong")).toBe("A.md");

		await engine.reconcileNoteIdMapFromManifest();

		expect(map.pathForId("srv-real")).toBe("A.md");
		// The stale reverse entry is gone — pathForId(wrong) no longer resolves.
		expect(map.pathForId("local-mint-wrong")).toBeNull();
	});

	test("does NOT clobber a known id with a stale manifest path (in-flight rename)", async () => {
		// Manifest snapshot is stale: it still lists the note at its OLD path while
		// the device has already renamed it locally (a reconnect landing mid-rename).
		const { engine, map } = makeEngine([{ id: "X", path: "Old.md", content_hash: "h" }]);
		// Local already renamed Old.md -> New.md for the same id (handleRename).
		map.set("New.md", "X");
		expect(map.pathForId("X")).toBe("New.md");

		await engine.reconcileNoteIdMapFromManifest();

		// The reconcile must NOT resurrect the old path from the stale manifest —
		// doing so clobbers the reverse index and re-creates Old.md on disk/server
		// (the test_10 rename-propagation regression).
		expect(map.pathForId("X")).toBe("New.md");
		expect(map.get("Old.md")).toBeNull();
	});

	test("corrects a cross-wired id: id mapped to a path the manifest assigns to a DIFFERENT id", async () => {
		// The data-loss incident (2026-07-07): a stale map + getOrMint left an id
		// X pointing at path B.md, while the manifest authoritatively assigns
		// X -> A.md and B.md -> Y. The old fill-unknown guard skipped X (pathForId
		// was non-null) so the cross-wire persisted, and onFlushToDisk(X) wrote
		// A.md's CRDT content onto B.md — overwriting an unrelated note.
		const { engine, map } = makeEngine([
			{ id: "X", path: "A.md", content_hash: "h1" },
			{ id: "Y", path: "B.md", content_hash: "h2" },
		]);
		// Corrupted local state: X cross-wired onto B.md (B.md's real id is Y).
		map.set("B.md", "X");
		expect(map.pathForId("X")).toBe("B.md");

		await engine.reconcileNoteIdMapFromManifest();

		// The manifest is authoritative: X belongs to A.md, Y to B.md.
		expect(map.pathForId("X")).toBe("A.md");
		expect(map.pathForId("Y")).toBe("B.md");
		expect(map.get("A.md")).toBe("X");
		expect(map.get("B.md")).toBe("Y");
	});

	test("persists the map so it survives a reload", async () => {
		const { engine, saveData } = makeEngine([{ id: "srv-1", path: "A.md", content_hash: "h" }]);

		await engine.reconcileNoteIdMapFromManifest();

		expect(saveData).toHaveBeenCalled();
		const savedWithIds = saveData.mock.calls.some(
			(c: unknown[]) => c[0] && typeof c[0] === "object" && "noteIds" in (c[0] as object),
		);
		expect(savedWithIds).toBe(true);
	});
});
