/**
 * C1 WS-event branch must record the CAS base (issue #203, e2e test_83).
 *
 * A note received while CRDT-managed takes handleStreamEvent's C1 branch:
 * body apply is delegated to the CRDT room (flushFromCrdt) and the legacy
 * apply is skipped — but the branch never recorded syncState.serverHash.
 * A device whose ONLY knowledge of a note came via C1 therefore had no CAS
 * base: its later REST-fallback push (channel down — exactly the
 * missed-delivery scenario) declared no base_hash, sailed past the v0.5.642
 * CAS gate, and silently erased server content it never saw. Proven live by
 * e2e test_83_missed_delivery_no_deletion.
 *
 * The WS event carries the REST-level content_hash + version: record them.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
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

function createEngine(): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	// Truly-lazy enrollment: only a LIVE-BOUND note takes handleStreamEvent's C1
	// room branch (the one that seeds the CAS base). A cold note materializes via
	// applyChange instead. These tests are specifically about the C1 branch seed,
	// so bind the note. (Cold-note serverHash seeding is covered in sync-catchup.)
	engine.setLiveBoundCheck(() => true);
	return engine;
}

beforeEach(() => {
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
});

describe("C1 branch records the CAS base from the WS event", () => {
	test("upsert event for a CRDT-managed note stores serverHash + version", async () => {
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock().mockReturnValue(true) } as any);
		const map = new NoteIdMap();
		engine.setNoteIdMap(map);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "received.md",
			id: "note-id-1",
			content_hash: "srv-h-1",
			version: 5,
		} as any);

		// The C1 branch delegated the body to CRDT delivery — but the CAS base
		// must be recorded NOW, from the event, or this device pushes blind
		// after a disconnect (e2e test_83's silent server-edit deletion).
		const stored = engine.exportSyncState()["received.md"];
		expect(stored?.serverHash).toBe("srv-h-1");
		expect(stored?.version).toBe(5);
	});

	test("an existing CONVERGED base is never clobbered by an announcement", async () => {
		// serverHash means "server content this device actually converged to".
		// Stamping the ANNOUNCED hash over a real converged base would mark a
		// note converged before the CRDT body lands — if that delivery is then
		// missed, every recovery path (hash-skip, resolveChangeBody,
		// verifyConvergenceOnOpen) reads "converged" and the stale body sticks
		// silently. Seed a base only when none exists.
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock().mockReturnValue(true) } as any);
		const map = new NoteIdMap();
		map.set("received.md", "note-id-1");
		engine.setNoteIdMap(map);
		engine.importSyncState({
			"received.md": { hash: 777, version: 5, serverHash: "srv-h-1" },
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "received.md",
			id: "note-id-1",
			content_hash: "srv-h-2",
			version: 6,
		} as any);

		const stored = engine.exportSyncState()["received.md"];
		expect(stored?.serverHash).toBe("srv-h-1");
		expect(stored?.version).toBe(5);
		expect(stored?.hash).toBe(777);
	});

	test("baseless entry (file raced onto disk first) still gets the seed", async () => {
		// The CRDT room delivery and the WS event race: flushFromCrdt may write
		// the file (recording only a local hash, never serverHash) before the
		// event processes. The gate must key on "no CAS base yet", not on file
		// existence — otherwise the raced ordering re-opens the blind-push hole.
		const engine = createEngine();
		engine.setCrdtManager({ applyLocalEdit: mock().mockReturnValue(true) } as any);
		const map = new NoteIdMap();
		map.set("received.md", "note-id-1");
		engine.setNoteIdMap(map);
		engine.importSyncState({
			"received.md": { hash: 777 },
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "received.md",
			id: "note-id-1",
			content_hash: "srv-h-1",
			version: 3,
		} as any);

		const stored = engine.exportSyncState()["received.md"];
		expect(stored?.serverHash).toBe("srv-h-1");
		expect(stored?.version).toBe(3);
		expect(stored?.hash).toBe(777);
	});
});
