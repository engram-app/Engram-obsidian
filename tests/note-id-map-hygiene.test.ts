/**
 * NoteIdMap hygiene (plugin #200 + #197 retro-review finding):
 *
 * 1. Vault change must wipe the noteIdMap + confirmed ids. main.ts loads
 *    `noteIds` UNSCOPED while syncState is guarded by syncStateVaultId —
 *    switching vaults carried note-id mappings across vaults (cross-vault
 *    identity hazard, same family as the 2026-07-07 incidents).
 * 2. recordBatchPushOk's server-rename branch must evict the OLD path's map
 *    entry like pushFile's sibling branch does — a create-race combined with
 *    path sanitization left a dangling mint keyed to a nonexistent path.
 * 3. ensureNoteIdMapped must be intrinsically gate-safe: its reconcile can
 *    reach sweepPendingOrphans (trashFile), so relying on every CALLER to
 *    check isSyncBlocked is fragile — the check belongs inside.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	getRateLimit: mock().mockResolvedValue(0),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
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

describe("batch server-rename evicts the old path mapping (#197 retro-review)", () => {
	test("create-race + sanitize rename: no dangling mint on the old path", async () => {
		const engine = createEngine();
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);

		const files = [new TFile("bad:name.md")];
		mockApp.vault.getFiles.mockReturnValue(files);
		(mockApi.pushNotesBatch as ReturnType<typeof mock>).mockReset().mockResolvedValue({
			results: [
				{
					path: "bad:name.md",
					status: "ok",
					id: "server-won-the-race", // differs from the local mint
					version: 1,
					content_hash: "srv-h",
					server_path: "bad-name.md", // server sanitized the path
				},
			],
		});

		// Task 3: pushAll routes genesis via crdtCreateBatch now; exercise the kept
		// REST pushNotesViaBatch directly (deleted in Task 7).
		await (engine as any).pushNotesViaBatch(files, true);

		// New path owns the winning id; the OLD path must not keep the dead mint
		// (pushFile's sibling branch deletes it explicitly — mirror it).
		expect(map.get("bad-name.md")).toBe("server-won-the-race");
		expect(map.get("bad:name.md")).toBeNull();
	});
});

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
});
