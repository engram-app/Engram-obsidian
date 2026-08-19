/**
 * WS upsert events must never trust inline-EMPTY content (e2e test_34,
 * "received=yes materialized=no", 2026-07-14 triage).
 *
 * The backend's folder-rename cascade broadcasts upserts built from
 * meta-projected rows: note.content is nil (never decrypted) and
 * broadcast_change fabricates it as "" while content_hash carries the REAL
 * body hash. Taking "" as authoritative materializes a 0-byte file, and the
 * CAS seed then stamps hash("") + the real serverHash, so every backstop
 * (hash-skip, echo gate, exists-checks) reads "converged" and the empty file
 * sticks forever. The backend sibling fix stops fabricating ""; this guard is
 * defense-in-depth: empty inline content with a content_hash present falls
 * through to the fetch branch, so the body is verified via GET before any
 * write. A genuinely empty note costs one GET and still converges.
 */
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { TFile } from "obsidian";
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
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
	(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>)
		.mockReset()
		.mockReturnValue(null);
	(mockApp.vault.create as ReturnType<typeof mock>).mockClear();
	(mockApp.vault.modify as ReturnType<typeof mock>).mockClear();
});

describe("inline-empty content with a content_hash is fetched, not written", () => {
	test("CRDT first-delivery: content:'' + content_hash routes to the op-log catch-up — never fetches, never writes '' (Phase E3)", async () => {
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockImplementation(async (_id: string, c: string) => c),
			isSynced: mock().mockReturnValue(false),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		engine.setLiveBoundCheck(() => false);
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
			serverIds: new Set(),
			serverAttachmentPaths: new Set(),
			ran: true,
			complete: true,
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "renamed/note.md",
			id: "note-id-34",
			content: "",
			content_hash: "real-hash",
			version: 2,
		} as any);

		// Distrusted inline-"" is stripped, and the content-absent leg NEVER
		// fetches (getNote-for-sync deleted): the replay row carries the real
		// bytes. No 0-byte file can materialize from the fabricated "".
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(replay).toHaveBeenCalled();
	});

	test("legacy (non-CRDT) upsert: content:'' + content_hash heals via op-log seq-replay, never applies ''", async () => {
		const engine = createEngine();
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "plain.md",
			content: "",
			content_hash: "real-hash",
			version: 2,
		} as any);

		expect(replay).toHaveBeenCalled();
		for (const call of (mockApp.vault.create as ReturnType<typeof mock>).mock.calls) {
			expect(call[1]).not.toBe("");
		}
	});

	test("an op-log row teaches the empty-content hash; later inline-'' events with that hash apply without a roundtrip", async () => {
		// content_hash is a per-user HMAC the client cannot derive, and the
		// learn-by-fetch is deleted (Phase E3). But the hash IS deterministic:
		// an authoritative op-log ROW proving a hash maps to "" teaches it, so
		// later inline-empty EVENTS carrying that exact hash are trustworthy.
		const engine = createEngine();
		engine.setCrdtManager({
			applyLocalEdit: mock().mockReturnValue("x"),
			isSynced: mock().mockReturnValue(false),
		} as any);
		engine.setNoteIdMap(new NoteIdMap());
		engine.setLiveBoundCheck(() => false);

		// An op-log row (catch-up replay) carrying a genuinely empty body
		// teaches its hash.
		await engine.applyChange({
			path: "a.md",
			action: "upsert",
			content: "",
			content_hash: "H-empty",
			version: 1,
			mtime: 1,
		} as any);

		// A later broadcast with the SAME hash: trusted inline, no fetch.
		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "b.md",
			id: "note-id-b",
			content: "",
			content_hash: "H-empty",
			version: 1,
		} as any);
		const created = (mockApp.vault.create as ReturnType<typeof mock>).mock.calls;
		expect(created.map((c: unknown[]) => c[0])).toContain("b.md");
	});

	/** Register a file so BOTH vault accessors agree it exists.
	 *
	 *  `getFileByPath` is `getAbstractFileByPath` narrowed to TFile, so real
	 *  Obsidian can never answer "a file here" to one and "nothing here" to the
	 *  other. Mocking only the first fakes an impossible vault — and the CRDT
	 *  branch keys its inline-apply gate on `getAbstractFileByPath`, so that
	 *  inconsistency alone flips behavior and makes a guard look load-bearing
	 *  when it is inert.
	 */
	function registerFile(path: string, size: number): void {
		// A REAL TFile. Every write in sync.ts is gated on `instanceof TFile`
		// (`vault.modify` at the flush site, the cachedRead idempotency skip,
		// the content-loss guard), so a plain object silently routes around all
		// of them and any "no empty write landed" assertion passes vacuously.
		const file = new TFile(path, 1, size);
		const at = (p: string) => (p === path ? file : null);
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockImplementation(at);
		(mockApp.vault.getAbstractFileByPath as ReturnType<typeof mock>).mockImplementation(at);
	}

	test("#1377: the rename cascade is probed by id, where the bytes actually are", async () => {
		// The shape that produces these broadcasts. The upsert names the NEW
		// path while the file is still at the OLD one, so probing event.path
		// finds nothing, scores 0 bytes and trusts the "". Probing the id's
		// current local path sees the bytes and refuses.
		const engine = createEngine();
		const replay = spyOn(engine as any, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		});
		const idMap = new NoteIdMap();
		idMap.set("Old/moved.md", "note-id-moved");
		engine.setNoteIdMap(idMap);

		await engine.applyChange({
			path: "genuinely-empty.md",
			action: "upsert",
			content: "",
			content_hash: "H-empty",
			version: 1,
			mtime: 1,
		} as any);

		// Bytes live at the OLD path; nothing exists at the new one yet.
		registerFile("Old/moved.md", 2048);

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "New/moved.md",
			id: "note-id-moved",
			content: "",
			content_hash: "H-empty",
			version: 2,
		} as any);

		expect(replay).toHaveBeenCalled();
		for (const call of (mockApp.vault.create as ReturnType<typeof mock>).mock.calls) {
			if (call[0] === "New/moved.md") expect(call[1]).not.toBe("");
		}
	});

	test("a genuinely empty inline body WITHOUT a content_hash is applied inline", async () => {
		// No hash means no poisoning is possible: the legacy inline-apply keeps its
		// behavior and writes the empty body straight through, no distrust/catch-up.
		const engine = createEngine();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "empty.md",
			content: "",
			version: 1,
		} as any);

		expect(mockApp.vault.create).toHaveBeenCalledWith("empty.md", "");
	});
});
