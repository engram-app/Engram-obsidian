/**
 * Tests: Task 3 — SyncEngine.recordParseStatus records/clears frontmatter
 * parse issues from a backend parse_status/parse_reason. Mirrors the
 * mock-api harness in tests/sync-cold-receive.test.ts.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getNote: mock().mockResolvedValue({
		path: "n.md",
		title: "n",
		content: "body",
		folder: "",
		tags: [],
		mtime: 1,
	}),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getAttachment: mock().mockResolvedValue({
		path: "",
		content_base64: "",
		mime_type: "",
		size_bytes: 0,
		mtime: 0,
	}),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	getRateLimit: mock().mockResolvedValue(0),
	getManifest: mock().mockResolvedValue(null),
	registerVault: mock().mockResolvedValue({
		id: "v1",
		name: "Test",
		slug: "test",
		is_default: true,
	}),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		modify: mock().mockResolvedValue(undefined),
		process: mock().mockImplementation((_f: any, fn: (d: string) => string) =>
			Promise.resolve(fn("")),
		),
		modifyBinary: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createBinary: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockResolvedValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function makeEngine(): SyncEngine {
	const e = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: false },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	return e;
}

describe("SyncEngine.recordParseStatus", () => {
	test("degraded result records a frontmatter issue", () => {
		const engine = makeEngine();
		engine.recordParseStatus("notes/a.md", "note", "degraded", {
			code: "frontmatter_invalid_yaml",
			message: "Frontmatter isn't valid YAML",
			detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
		});
		const issue = engine.issues.get("notes/a.md");
		expect(issue?.category).toBe("frontmatter");
		expect(issue?.parseReason?.detail?.snippet).toBe("date:YYYY-MM-DD");
	});

	test("ok parse_status clears a prior frontmatter issue for that path", () => {
		const engine = makeEngine();
		engine.recordParseStatus("notes/a.md", "note", "degraded", {
			code: "frontmatter_invalid_yaml",
			message: "bad",
			detail: null,
		});
		engine.recordParseStatus("notes/a.md", "note", "ok", null);
		expect(engine.issues.get("notes/a.md")).toBeUndefined();
	});

	test("ok parse_status leaves a non-frontmatter issue intact", () => {
		const engine = makeEngine();
		engine.issues.record({
			path: "notes/a.md",
			kind: "note",
			category: "server",
			message: "500",
			firstFailedAt: 1,
			lastFailedAt: 1,
			attempts: 1,
		});
		engine.recordParseStatus("notes/a.md", "note", "ok", null);
		expect(engine.issues.get("notes/a.md")?.category).toBe("server");
	});
});

const DEGRADED = {
	parse_status: "degraded" as const,
	parse_reason: {
		code: "frontmatter_invalid_yaml" as const,
		message: "Frontmatter isn't valid YAML",
		detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
	},
};

/** Drive pushFile's push-side 409 conflict resolution: first pushNote returns
 *  a version conflict, the resolver picks `choice`, the retry push returns a
 *  degraded :ok note. baseStore stays null so the 3-way auto-merge is skipped
 *  and the interactive resolution branch runs. */
async function pushWithConflictResolution(choice: "keep-local" | "merge"): Promise<SyncEngine> {
	const engine = makeEngine();
	(engine as unknown as { baseStore: null }).baseStore = null;
	const file = new TFile("notes/c.md", 1000);
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReturnValue(file);
	(mockApp.vault.cachedRead as ReturnType<typeof mock>).mockResolvedValue("# local");
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValueOnce({
			conflict: true,
			server_note: {
				id: "id-1",
				path: "notes/c.md",
				title: "c",
				content: "# remote",
				folder: "notes",
				tags: [],
				mtime: 1,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
				version: 5,
			},
		})
		.mockResolvedValueOnce({
			note: { id: "id-1", path: "notes/c.md", version: 6, content_hash: "h", ...DEGRADED },
			chunks_indexed: 1,
		});
	engine.onConflict = async () =>
		choice === "merge" ? { choice, mergedContent: "# merged" } : { choice };
	await (engine as unknown as { pushFile(f: TFile): Promise<boolean> }).pushFile(file);
	return engine;
}

describe("recordParseStatus wired into conflict re-push resolution", () => {
	test("keep-local re-push (forceResp) records a frontmatter issue", async () => {
		const engine = await pushWithConflictResolution("keep-local");
		expect(engine.issues.get("notes/c.md")?.category).toBe("frontmatter");
	});

	test("merge re-push (mergeResp) records a frontmatter issue", async () => {
		const engine = await pushWithConflictResolution("merge");
		expect(engine.issues.get("notes/c.md")?.category).toBe("frontmatter");
	});
});

describe("applySyncChange consumes parse_status from the /sync/changes feed", () => {
	test("applySyncChange records a frontmatter issue from a degraded feed entry", async () => {
		const engine = makeEngine();
		await engine.applySyncChange({
			type: "note",
			id: "id-1",
			seq: 5,
			path: "notes/remote.md",
			title: "remote",
			content: "---\ndate:YYYY-MM-DD\n---\nbody",
			folder: "notes",
			tags: [],
			mtime: 1,
			updated_at: "2026-07-12T00:00:00Z",
			deleted: false,
			parse_status: "degraded",
			parse_reason: {
				code: "frontmatter_invalid_yaml",
				message: "Frontmatter isn't valid YAML",
				detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
			},
		});
		expect(engine.issues.get("notes/remote.md")?.category).toBe("frontmatter");
	});

	test("deleted feed entry does not record a parse issue", async () => {
		const engine = makeEngine();
		await engine.applySyncChange({
			type: "note",
			id: "id-2",
			seq: 6,
			path: "notes/gone.md",
			title: "gone",
			folder: "notes",
			tags: [],
			mtime: 1,
			updated_at: "2026-07-12T00:00:00Z",
			deleted: true,
			parse_status: "degraded",
			parse_reason: {
				code: "frontmatter_invalid_yaml",
				message: "Frontmatter isn't valid YAML",
				detail: null,
			},
		});
		expect(engine.issues.get("notes/gone.md")).toBeUndefined();
	});

	test("folder-marker feed entry (no path) does not throw or record an issue", async () => {
		const engine = makeEngine();
		await engine.applySyncChange({
			type: "note",
			id: "id-3",
			seq: 7,
			path: "",
			title: "",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: "2026-07-12T00:00:00Z",
			deleted: false,
			parse_status: "degraded",
			parse_reason: {
				code: "frontmatter_invalid_yaml",
				message: "Frontmatter isn't valid YAML",
				detail: null,
			},
		});
		expect(engine.issues.get("")).toBeUndefined();
	});
});
