/**
 * Tests: the recent-local-delete guard (Task C). A note THIS device deleted
 * must not be resurrected by either CRDT convergence path — `catchupViaSocket`
 * (the head-map discovery loop) nor `applyPushedNoteUpdate` (the vault-channel
 * fan-out) — for the delete-wins window that mirrors backend #970's 60s
 * same-user delete-then-recreate refusal. The prior `hasPendingDelete` guard
 * only covered a delete STILL sitting in the offline queue; once the delete is
 * SENT (dequeued) that guard lapses and the note resurrects.
 *
 * Also pins the inverse invariant (requirement c): catch-up must NEVER trash a
 * known local note merely because it is ABSENT from the head map. The server
 * head map lists only surviving notes (is_nil(deleted_at)); it conveys no
 * tombstone, so absence is not proof of deletion (a first-discovery note is
 * also absent). Trashing on absence would delete legitimate notes.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getUpdates: mock().mockRejectedValue(new Error("getUpdates must not be called")),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		create: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function makeEngine(crdt: Partial<CrdtManager>, applied: string[]): SyncEngine {
	const e = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(crdt as unknown as CrdtManager);
	e.setReady();
	e.setCrdtDelete(() => true); // socket delete "sent"
	const map = new NoteIdMap();
	map.set("Notes/gone.md", "id-gone");
	map.set("Notes/a.md", "id-a");
	e.setNoteIdMap(map);
	// A previously-converged head, so the note is a KNOWN local note (not a
	// brand-new local-only file).
	(e as any).setCrdtHead("Notes/gone.md", "h1");
	(e as any).setCrdtHead("Notes/a.md", "h1");
	// Neutralize disk-drift capture — no on-disk file in these unit doubles.
	(e as any).captureDiskDriftBeforeRemote = async () => {};
	void applied;
	return e;
}

function crdtDouble(applied: string[]): Partial<CrdtManager> {
	return {
		applyRemoteUpdate: (id: string, _u: Uint8Array) => {
			applied.push(id);
			return Promise.resolve();
		},
		encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
		removeDoc: (_id: string) => Promise.resolve(),
		closeDoc: () => {},
	} as unknown as Partial<CrdtManager>;
}

describe("recent-local-delete guard", () => {
	test("catchupViaSocket does NOT resurrect a note this device already deleted (sent, not queued)", async () => {
		const applied: string[] = [];
		const engine = makeEngine(crdtDouble(applied), applied);

		// Delete the note. crdtDelete is wired to return true (delete sent over the
		// socket) so nothing lingers in the offline queue — the hasPendingDelete
		// guard from Task B does NOT cover this case.
		await engine.handleDelete(new TFile("Notes/gone.md"));

		// A reconnect catch-up whose head map STILL lists the just-deleted note
		// (the server delete has not yet dropped it, or the head map was fetched
		// before the delete committed). Without the tombstone the id is unknown
		// (handleDelete cleared its mapping) and gets re-materialized as a
		// first-discovery note.
		engine.setCrdtCatchup(
			async () => ({ heads: { "id-gone": { path: "Notes/gone.md", head: "h2" } } }),
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h2" }),
		);

		await engine.catchupViaSocket();

		expect(applied).toEqual([]); // NOT resurrected
		expect((engine as any).noteIdMap.pathForId("id-gone")).toBeNull();
	});

	test("applyPushedNoteUpdate does NOT resurrect a note this device already deleted", async () => {
		const applied: string[] = [];
		const engine = makeEngine(crdtDouble(applied), applied);

		await engine.handleDelete(new TFile("Notes/gone.md"));

		// Model the fan-out resurrection chain: some path (a racing catch-up) has
		// re-learned id-gone's mapping, and a vault-channel note_yjs_update for it
		// now arrives. The tombstone must win regardless of map state.
		(engine as any).noteIdMap.set("Notes/gone.md", "id-gone");

		await engine.applyPushedNoteUpdate("id-gone", new Uint8Array([1]), "h2");

		expect(applied).toEqual([]); // NOT resurrected by the fan-out
	});

	test("catchupViaSocket does NOT trash a known local note merely absent from the head map", async () => {
		// Requirement (c): absence is not a tombstone. The server head map lists
		// only surviving notes; a note absent from it may be a first-discovery
		// note or a stale/partial map — never proof of deletion. Catch-up must
		// leave the local note untouched (no trash, mapping intact).
		const applied: string[] = [];
		const engine = makeEngine(crdtDouble(applied), applied);
		mockApp.fileManager.trashFile.mockClear();

		engine.setCrdtCatchup(
			async () => ({ heads: {} }), // id-a is KNOWN locally but absent here
			async (docId: string) => ({ doc_id: docId, b64: "AAE=", head: "h2" }),
		);

		await engine.catchupViaSocket();

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
		expect((engine as any).noteIdMap.pathForId("id-a")).toBe("Notes/a.md");
	});
});
