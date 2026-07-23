/**
 * Issue #244 — edits made while a sync is running are deferred into
 * pendingPostPullPushes, which used to drain ONLY when the sync ended. A
 * wedged sync (half-open connection, long post-swap chain) kept `pulling`
 * true for 60s+ (indefinitely before the API timeout), so deferred edits
 * never pushed and sync looked dead both ways. (Driven here via pullAll —
 * the surviving carrier of the `pulling` flag + post-sync drain.)
 *
 * The deferral is an echo-traffic optimization, not a correctness gate —
 * pushFile's echo-hash gate filters sync-write echoes either way — so the
 * drain is now ALSO scheduled a bounded time after the first deferral.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const hang = () => new Promise<never>(() => {});

const mockApi = {
	pushNote: mock().mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	getChanges: mock().mockImplementation(hang),
	getManifest: mock().mockImplementation(hang),
	health: mock().mockResolvedValue(true),
	ping: mock().mockResolvedValue({ ok: true }),
	getAttachmentChanges: mock().mockImplementation(hang),
	getRateLimit: mock().mockResolvedValue(0),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("user content"),
		cachedRead: mock().mockResolvedValue("user content"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
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

function flush(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
	(mockApi.pushNote as ReturnType<typeof mock>)
		.mockReset()
		.mockResolvedValue({ note: { id: "sid" }, chunks_indexed: 1 });
	(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReset().mockReturnValue(null);
});

describe("bounded post-pull push deferral (#244)", () => {
	test("an edit deferred behind a wedged pull still pushes within the defer bound", async () => {
		const engine = createEngine();
		engine.postPullMaxDeferMs = 30;

		// Wedge the sync: the replay itself hangs forever (mirrors a half-open
		// socket never delivering `has_more:false`), keeping `pulling` true.
		(engine as any).catchupViaSeqReplay = hang;
		void engine.pullAll();
		await flush(5);

		// .canvas so the drained push takes the kept LWW REST path (md is
		// CRDT-sole and never REST-pushes) — the deferral mechanism under test
		// is transport-agnostic.
		const file = new TFile("user-edit.canvas");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReturnValue(file);
		engine.handleModify(file);

		// Still inside the defer window: nothing pushed (and the debounce path
		// was bypassed by the pulling branch).
		await flush(10);
		expect(mockApi.pushNote).not.toHaveBeenCalled();

		// Past the bound: the drain fires even though the pull never ended.
		await flush(50);
		expect(mockApi.pushNote).toHaveBeenCalledTimes(1);
		expect((mockApi.pushNote as ReturnType<typeof mock>).mock.calls[0][0]).toBe(
			"user-edit.canvas",
		);

		engine.destroy();
	});

	test("destroy cancels a pending deferred drain", async () => {
		const engine = createEngine();
		engine.postPullMaxDeferMs = 20;

		(engine as any).catchupViaSeqReplay = hang;
		void engine.pullAll();
		await flush(5);

		const file = new TFile("user-edit.canvas");
		(mockApp.vault.getFileByPath as ReturnType<typeof mock>).mockReturnValue(file);
		engine.handleModify(file);
		engine.destroy();

		await flush(40);
		expect(mockApi.pushNote).not.toHaveBeenCalled();
	});
});
