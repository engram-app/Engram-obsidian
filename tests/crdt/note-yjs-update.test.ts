/**
 * Tests: applying a vault-channel-pushed `note_yjs_update` event to an IDLE
 * note (P1 of the vault-channel CRDT fan-out plan). Mirrors the coldReceive
 * mock-engine harness in tests/sync-cold-receive.test.ts, minus the REST
 * getUpdates fetch — the update bytes arrive directly in the event.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../../src/api";
import type { CrdtManager } from "../../src/crdt/manager";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import { SyncEngine } from "../../src/sync";
import { DEFAULT_SETTINGS } from "../../src/types";

/** Mark a note_id as server-confirmed — same pattern as tests/sync-cold-receive.test.ts. */
function markConfirmed(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
}

const mockApi = {} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		getFileByPath: mock().mockReturnValue(null),
	},
	fileManager: { trashFile: mock().mockResolvedValue(undefined) },
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

function engine(opts?: { crdt?: Partial<CrdtManager> }): SyncEngine {
	const e = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	if (opts?.crdt) e.setCrdtManager(opts.crdt as unknown as CrdtManager);
	e.setReady();
	return e;
}

function noteEngine(opts: {
	live?: (path: string) => boolean;
	applyThrows?: boolean;
}) {
	const applied: Array<{ id: string; update: Uint8Array }> = [];
	const crdt = {
		applyRemoteUpdate: async (id: string, update: Uint8Array) => {
			if (opts.applyThrows) throw new Error("apply failed");
			applied.push({ id, update });
		},
	};
	const e = engine({ crdt });
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(opts.live ?? (() => false));
	return { e, applied };
}

describe("applyPushedNoteUpdate (note_yjs_update)", () => {
	test("a confirmed, not-live-bound note applies the update and persists the head", async () => {
		const { e, applied } = noteEngine({});
		markConfirmed(e, "id-a");
		const update = new Uint8Array([1, 2, 3]);

		await (e as any).applyPushedNoteUpdate("id-a", update, "SRV");

		expect(applied).toEqual([{ id: "id-a", update }]);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
	});

	test("a live-bound note is skipped (the editor's own room owns it)", async () => {
		const { e, applied } = noteEngine({ live: () => true });
		markConfirmed(e, "id-a");

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([]);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
	});

	test("an unconfirmed note is skipped", async () => {
		const { e, applied } = noteEngine({});
		// Note deliberately NOT marked confirmed.

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([]);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
	});

	test("a note_id with no locally known path is skipped", async () => {
		const { e, applied } = noteEngine({});
		markConfirmed(e, "id-unknown");

		await (e as any).applyPushedNoteUpdate("id-unknown", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([]);
	});

	test("applyRemoteUpdate failure leaves the head unadvanced (isolated, no throw)", async () => {
		const { e, applied } = noteEngine({ applyThrows: true });
		markConfirmed(e, "id-a");

		await expect(
			(e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV"),
		).resolves.toBeUndefined();

		expect(applied).toEqual([]);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
	});
});
