/**
 * Tests: the recent-local-delete guard (Task C). A note THIS device deleted
 * must not be resurrected by either CRDT convergence path — the seq-ordered
 * op-log replay (`applyOp`, driven by `catchupViaSeqReplay`) nor
 * `applyPushedNoteUpdate` (the vault-channel fan-out) — for the delete-wins
 * window that mirrors backend #970's 60s same-user delete-then-recreate
 * refusal. The prior `hasPendingDelete` guard only covered a delete STILL
 * sitting in the offline queue; once the delete is SENT (dequeued) that guard
 * lapses and the note resurrects.
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
	e.setCrdtEnqueue(() => {}); // durable crdt_delete enqueued (never REST)
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
	test("op-replay does NOT resurrect a note this device already deleted (sent, not queued)", async () => {
		const applied: string[] = [];
		const engine = makeEngine(crdtDouble(applied), applied);
		mockApp.vault.create.mockClear();

		// Delete the note. The delete is enqueued on the durable CRDT op queue
		// (not the REST offline queue), so nothing lingers there; the
		// hasPendingDelete guard from Task B does NOT cover this case.
		await engine.handleDelete(new TFile("Notes/gone.md"));

		// A catch-up replay whose seq feed STILL carries an UPSERT for the
		// just-deleted note (the server delete has not committed / the tombstone
		// hasn't reached the feed). Without the recent-delete guard, applyOp would
		// re-learn the id and re-materialize it as a first-discovery note.
		engine.setCrdtCatchupSince(async () => ({
			changes: [
				{
					type: "note",
					id: "id-gone",
					seq: 9,
					path: "Notes/gone.md",
					title: "gone",
					content: "resurrected?",
					folder: "",
					tags: [],
					mtime: 9,
					updated_at: "2026-01-01T00:00:00Z",
					deleted: false,
				},
			],
			has_more: false,
			next_seq: null,
		}));

		await engine.catchupViaSeqReplay();

		expect(mockApp.vault.create).not.toHaveBeenCalled(); // NOT resurrected on disk
		expect((engine as any).noteIdMap.pathForId("id-gone")).toBeNull(); // id not re-learned
	});

	test("op-replay does NOT resurrect a note with a delete still QUEUED (unsent, TTL lapsed)", async () => {
		// The paired guard: a delete still sitting in the offline queue (never
		// sent, so recentlyDeleted is empty / its ~60s TTL has lapsed). A fromZero
		// replay can carry the stale upsert in this window — hasPendingDelete must
		// still refuse it so the note isn't resurrected while the delete is unsent.
		const applied: string[] = [];
		const engine = makeEngine(crdtDouble(applied), applied);
		mockApp.vault.create.mockClear();

		await (engine as any).queue.enqueue({
			path: "Notes/gone.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});

		engine.setCrdtCatchupSince(async () => ({
			changes: [
				{
					type: "note",
					id: "id-gone",
					seq: 9,
					path: "Notes/gone.md",
					title: "gone",
					content: "resurrected?",
					folder: "",
					tags: [],
					mtime: 9,
					updated_at: "2026-01-01T00:00:00Z",
					deleted: false,
				},
			],
			has_more: false,
			next_seq: null,
		}));

		await engine.catchupViaSeqReplay();

		expect(mockApp.vault.create).not.toHaveBeenCalled(); // NOT resurrected while delete is queued
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
});
