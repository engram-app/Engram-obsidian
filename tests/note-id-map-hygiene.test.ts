/**
 * NoteIdMap hygiene (plugin #200 + #197 retro-review finding):
 *
 * 1. Vault change must wipe the noteIdMap + confirmed ids. main.ts loads
 *    `noteIds` UNSCOPED while syncState is guarded by syncStateVaultId —
 *    switching vaults carried note-id mappings across vaults (cross-vault
 *    identity hazard, same family as the 2026-07-07 incidents).
 * 2. (Removed by Task 7, CRDT single-push-path) recordBatchPushOk's
 *    server-rename branch had to evict the OLD path's map entry like
 *    pushFile's sibling branch does — a create-race combined with path
 *    sanitization left a dangling mint keyed to a nonexistent path.
 *    recordBatchPushOk/pushNotesViaBatch are deleted; pushFile's own branch
 *    still covers this invariant (see the comment further down).
 * 3. ensureNoteIdMapped must be intrinsically gate-safe: its reconcile can
 *    reach sweepPendingOrphans (trashFile), so relying on every CALLER to
 *    check isSyncBlocked is fragile — the check belongs inside.
 * 4. Same reason, second trigger (#491): a note THIS device just deleted must
 *    not start a reconcile. The server answering note_not_found for a
 *    tombstoned id is CORRECT, not map drift, and reconciling on it runs a
 *    whole-vault manifest sweep that moves files (onRelocate →
 *    renameFollowingIdentity) and trashes them (sweepPendingOrphans) — the
 *    "note flashes into existence then deletes itself" report.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function createEngine(vaultId?: string): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, ...(vaultId ? { vaultId } : {}) },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	return engine;
}

beforeEach(() => {
	(mockApi.getManifest as ReturnType<typeof mock>).mockReset().mockResolvedValue(null);
	(mockApi.pushNotesBatch as ReturnType<typeof mock>)
		.mockReset()
		.mockRejectedValue({ status: 404 });
	(mockApp.vault.getFiles as ReturnType<typeof mock>).mockReset().mockReturnValue([]);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockReset().mockResolvedValue("body");
});

describe("vault change wipes note identity (plugin #200)", () => {
	test("invalidateIfVaultChanged clears the noteIdMap and confirmed ids", async () => {
		const engine = createEngine("vault-B");
		const map = new NoteIdMap();
		map.set("a.md", "id-from-vault-A");
		engine.setNoteIdMap(map);
		(engine as any).confirmNoteId("id-from-vault-A");
		engine.setSyncStateVaultId("vault-A");

		await (engine as any).invalidateIfVaultChanged();

		// The map belongs to vault A; carrying it into vault B is a cross-vault
		// identity hazard (CRDT frames keyed by another vault's note ids).
		expect(map.get("a.md")).toBeNull();
		expect((engine as any).isNoteConfirmed("id-from-vault-A")).toBe(false);
		expect(engine.getSyncStateVaultId()).toBe("vault-B");
	});

	test("resetForVaultChange (explicit picker path) wipes the map and confirmed ids", async () => {
		// The picker path sets syncStateVaultId itself, so the backstop
		// short-circuits and never runs — the wipe must happen here too or
		// #200 stays open on the most common user-facing vault switch.
		const engine = createEngine("vault-B");
		const map = new NoteIdMap();
		map.set("a.md", "id-from-vault-A");
		engine.setNoteIdMap(map);
		(engine as any).confirmNoteId("id-from-vault-A");

		await engine.resetForVaultChange();

		expect(map.get("a.md")).toBeNull();
		expect((engine as any).isNoteConfirmed("id-from-vault-A")).toBe(false);
	});

	test("both vault-change routes also drop the outbound CRDT work", async () => {
		// The note-id map was never the only carrier: unsentDocIds holds the same
		// per-vault note ids, and reEnrollUnsent would STEP1 them against the NEW
		// vault's topic. Asserted on BOTH routes because wipePerVaultState exists
		// precisely to keep them in lockstep -- a drop wired to only one re-opens
		// the hazard on the other.
		//
		// The op QUEUE is NOT dropped here. Ops carry their own vaultId and
		// self-drop at send time, which is both earlier (the topic rejoin flushes
		// before this hook runs) and narrower (a queued delete for the CURRENT
		// vault has no REST fallback and must survive).
		for (const route of ["backstop", "picker"] as const) {
			const engine = createEngine("vault-B");
			const resetOutbox = mock();
			engine.setCrdtPorts({ resetOutbox });

			if (route === "backstop") {
				engine.setSyncStateVaultId("vault-A");
				await (engine as any).invalidateIfVaultChanged();
			} else {
				await engine.resetForVaultChange();
			}

			expect(resetOutbox).toHaveBeenCalledTimes(1);
		}
	});

	test("same vault: outbox survives (it is still this vault's work)", async () => {
		const engine = createEngine("vault-A");
		const resetOutbox = mock();
		engine.setCrdtPorts({ resetOutbox });
		engine.setSyncStateVaultId("vault-A");

		await (engine as any).invalidateIfVaultChanged();

		expect(resetOutbox).not.toHaveBeenCalled();
	});

	test("same vault: map untouched", async () => {
		const engine = createEngine("vault-A");
		const map = new NoteIdMap();
		map.set("a.md", "id-1");
		engine.setNoteIdMap(map);
		engine.setSyncStateVaultId("vault-A");

		await (engine as any).invalidateIfVaultChanged();

		expect(map.get("a.md")).toBe("id-1");
	});
});

// Task 7 (CRDT single-push-path): "batch server-rename evicts the old path
// mapping (#197 retro-review)" exercised recordBatchPushOk's server-rename
// branch via pushNotesViaBatch directly — both deleted along with the REST
// batch machinery (dead since Task 3). pushFile's own sibling branch
// (src/sync.ts, the sanitized-rename case in the single-note push path) still
// evicts the old path's mint the same way; the genesis-batch create-race path
// (crdt_create_batch id_conflict) hands off to pushFile for the full adopt,
// so this old-path-eviction invariant stays covered through pushFile there
// too — see tests/sync.test.ts ("Path sanitization on push") for the general
// sanitize-rename pin.

describe("ensureNoteIdMapped is intrinsically gate-safe", () => {
	test("does nothing while the sync gate is closed (reconcile can trashFile)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		engine.setSyncBlocked(true);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValue({
			notes: [{ id: "x-1", path: "x.md", content_hash: "h" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
			change_seq: 1,
		});

		engine.ensureNoteIdMapped("x-1");
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.getManifest).not.toHaveBeenCalled();
		expect(map.pathForId("x-1")).toBeNull();
	});

	// #491. The delete unmaps the id, so the `pathForId !== null` early return
	// stops covering it, and the id is exactly the one a still-bound editor's
	// in-flight crdt_msg gets note_not_found for. Without a tombstone check the
	// reconcile fires on every fast delete. Guarded here rather than at the
	// wiring.ts caller for the same reason as the gate check above: the
	// destructive work is inside, so the guard must be too.
	test("does nothing for an id this device just deleted (tombstoned)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValue({
			notes: [{ id: "dead-1", path: "Untitled.md", content_hash: "h" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
			change_seq: 1,
		});
		(mockApi.getManifest as ReturnType<typeof mock>).mockClear();

		// The local delete: tombstone the id and drop its mapping, exactly as
		// handleDelete does before the server round trip.
		(engine as any).markRecentlyDeleted("dead-1", "Untitled.md");

		// The server's note_not_found for the still-in-flight op lands here.
		engine.ensureNoteIdMapped("dead-1");
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.getManifest).not.toHaveBeenCalled();
		expect(map.pathForId("dead-1")).toBeNull();
	});

	test("still reconciles an id with no tombstone (the drift case it exists for)", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);
		(mockApi.getManifest as ReturnType<typeof mock>).mockResolvedValue({
			notes: [{ id: "live-1", path: "Live.md", content_hash: "h" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
			change_seq: 1,
		});
		(mockApi.getManifest as ReturnType<typeof mock>).mockClear();

		engine.ensureNoteIdMapped("live-1");
		await new Promise((r) => setTimeout(r, 50));

		expect(mockApi.getManifest).toHaveBeenCalled();
		expect(map.pathForId("live-1")).toBe("Live.md");
	});
});
