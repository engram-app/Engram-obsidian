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
	getNote: mock().mockResolvedValue({ path: "", content: "" }),
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
	(mockApi.getNote as ReturnType<typeof mock>).mockClear().mockResolvedValue({
		path: "",
		content: "",
	});
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
		expect(mockApi.getNote).not.toHaveBeenCalled();
		expect(mockApp.vault.create).not.toHaveBeenCalled();
		expect(replay).toHaveBeenCalled();
	});

	test("legacy (non-CRDT) upsert: content:'' + content_hash fetches, never applies ''", async () => {
		const engine = createEngine();
		(mockApi.getNote as ReturnType<typeof mock>).mockResolvedValue({
			path: "plain.md",
			title: "plain",
			content: "# real body",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-01-01T00:00:00Z",
		});

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "plain.md",
			content: "",
			content_hash: "real-hash",
			version: 2,
		} as any);

		expect(mockApi.getNote).toHaveBeenCalledWith("plain.md");
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
		expect(mockApi.getNote).not.toHaveBeenCalled();
		const created = (mockApp.vault.create as ReturnType<typeof mock>).mock.calls;
		expect(created.map((c: unknown[]) => c[0])).toContain("b.md");
	});

	test("a genuinely empty inline body WITHOUT a content_hash is left alone", async () => {
		// No hash means no poisoning is possible and no fetch is warranted; the
		// legacy inline-apply keeps its one-roundtrip behavior.
		const engine = createEngine();

		await engine.handleStreamEvent({
			event_type: "upsert",
			path: "empty.md",
			content: "",
			version: 1,
		} as any);

		expect(mockApi.getNote).not.toHaveBeenCalled();
	});
});
