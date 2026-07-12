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
		// captureDiskDriftBeforeRemote (BUG 2) probes disk for un-pushed drift.
		// These tests carry no on-disk file, so there is no drift to merge.
		getAbstractFileByPath: mock().mockReturnValue(null),
		cachedRead: mock().mockResolvedValue(""),
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
	const closed: string[] = [];
	const crdt = {
		applyRemoteUpdate: async (id: string, update: Uint8Array) => {
			if (opts.applyThrows) throw new Error("apply failed");
			applied.push({ id, update });
		},
		closeDoc: (id: string) => closed.push(id),
	};
	const e = engine({ crdt });
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(opts.live ?? (() => false));
	return { e, applied, closed };
}

describe("applyPushedNoteUpdate (note_yjs_update)", () => {
	test("a confirmed, not-live-bound note applies the update, persists the head, and hibernates the doc (P3)", async () => {
		const { e, applied, closed } = noteEngine({});
		markConfirmed(e, "id-a");
		const update = new Uint8Array([1, 2, 3]);

		await (e as any).applyPushedNoteUpdate("id-a", update, "SRV");

		expect(applied).toEqual([{ id: "id-a", update }]);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
		expect(closed).toEqual(["id-a"]); // idle doc freed after the head is durably set
	});

	test("a live-bound note is skipped (the editor's own room owns it) — no apply, no free", async () => {
		const { e, applied, closed } = noteEngine({ live: () => true });
		markConfirmed(e, "id-a");

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([]);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
		expect(closed).toEqual([]);
	});

	test("a note that becomes live-bound DURING the apply is NOT hibernated (re-checked after the await)", async () => {
		// isLiveBound is checked once at entry (false — not yet open) and again
		// after the apply resolves (true — the user opened it mid-apply). The
		// second check must win: the editor now owns this doc's lifecycle.
		let liveCalls = 0;
		const live = () => {
			liveCalls++;
			return liveCalls > 1;
		};
		const { e, applied, closed } = noteEngine({ live });
		markConfirmed(e, "id-a");

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([{ id: "id-a", update: new Uint8Array([1]) }]);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV"); // head still recorded
		expect(closed).toEqual([]); // but the doc stays resident for the editor
	});

	test("an unconfirmed-but-mapped note is confirmed and applied (the fan-out IS proof of a server row)", async () => {
		// A fan-out arriving for a note this device has mapped but not confirmed
		// is the server authoritatively pushing that note's bytes — proof it has a
		// row. Dropping it opens the reconnect window where clearConfirmedNoteIds()
		// un-confirms every note and fanned-out appends are silently skipped until
		// a slow re-confirmation (>30s missed-open convergence,
		// test_web_edit_reaches_obsidian_that_missed_room_open). Confirm and apply.
		const { e, applied } = noteEngine({});
		// Note deliberately NOT marked confirmed.

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([{ id: "id-a", update: new Uint8Array([1]) }]);
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
		expect((e as any).isNoteConfirmed("id-a")).toBe(true);
	});

	test("a note_id with no locally known path is skipped", async () => {
		const { e, applied } = noteEngine({});
		markConfirmed(e, "id-unknown");

		await (e as any).applyPushedNoteUpdate("id-unknown", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([]);
	});

	test("applyRemoteUpdate failure leaves the head unadvanced and the doc NOT hibernated (isolated, no throw, retry-safe)", async () => {
		const { e, applied, closed } = noteEngine({ applyThrows: true });
		markConfirmed(e, "id-a");

		await expect(
			(e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV"),
		).resolves.toBeUndefined();

		expect(applied).toEqual([]);
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
		expect(closed).toEqual([]); // a failed apply is left for retry, not freed
	});
});

describe("applyPushedNoteUpdate — gap heal (missed-open reconnect)", () => {
	// A device that was offline while another device edited a note misses that
	// edit's fan-out. A LATER fan-out delta then references the missed update:
	// Yjs PENDS it (doc stays behind, hasPendingGap true). Advancing crdtHead to
	// the broadcast head over that unconverged doc would make coldReceive's cost
	// gate skip the note forever — the gap never heals (>30s convergence,
	// e2e test_web_edit_reaches_obsidian_that_missed_room_open). Instead the apply
	// must pull the FULL delta since our real state vector and advance only to the
	// head we actually reached.
	function gapEngine(opts: {
		hasPendingGap: () => Promise<boolean>;
		getUpdates: (id: string, since?: string) => Promise<{ update: Uint8Array; head: string }>;
	}) {
		const applied: Array<{ id: string; update: Uint8Array }> = [];
		const crdt = {
			applyRemoteUpdate: async (id: string, update: Uint8Array) => {
				applied.push({ id, update });
			},
			closeDoc: () => {},
			encodeStateVector: async () => new Uint8Array([9, 9]),
			hasPendingGap: opts.hasPendingGap,
		};
		const api = { getUpdates: mock(opts.getUpdates) } as unknown as EngramApi;
		const e = new SyncEngine(
			mockApp,
			api,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager(crdt as unknown as CrdtManager);
		e.setReady();
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		e.setNoteIdMap(map);
		e.setLiveBoundCheck(() => false);
		markConfirmed(e, "id-a");
		return { e, applied, api };
	}

	test("a gapped delta pulls the full delta and advances to the reached head, not the broadcast head", async () => {
		let gapCalls = 0;
		const { e, applied, api } = gapEngine({
			// gap after the pushed delta, converged after the full pull
			hasPendingGap: async () => {
				gapCalls++;
				return gapCalls === 1;
			},
			getUpdates: async () => ({ update: new Uint8Array([7, 7, 7]), head: "FULL" }),
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		// Applied the gapped delta, then the full delta from getUpdates.
		expect(applied).toEqual([
			{ id: "id-a", update: new Uint8Array([1]) },
			{ id: "id-a", update: new Uint8Array([7, 7, 7]) },
		]);
		expect(api.getUpdates as ReturnType<typeof mock>).toHaveBeenCalledTimes(1);
		// Advanced to the head the doc actually reached, NOT the broadcast "SRV".
		expect((e as any).getCrdtHead("a.md")).toBe("FULL");
	});

	test("still gapped after the full pull → leaves crdtHead unadvanced for coldReceive to retry", async () => {
		const { e } = gapEngine({
			hasPendingGap: async () => true, // never converges (deeper gap)
			getUpdates: async () => ({ update: new Uint8Array([7]), head: "FULL" }),
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		// Unadvanced so coldReceive's cost gate re-pulls next poll — never stamped
		// converged over a doc that has not reached the head.
		expect((e as any).getCrdtHead("a.md")).toBeUndefined();
	});

	test("no gap → advances to the broadcast head without a getUpdates round-trip", async () => {
		const { e, applied, api } = gapEngine({
			hasPendingGap: async () => false,
			getUpdates: async () => {
				throw new Error("must not fetch when the delta applied cleanly");
			},
		});

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(applied).toEqual([{ id: "id-a", update: new Uint8Array([1]) }]);
		expect(api.getUpdates as ReturnType<typeof mock>).not.toHaveBeenCalled();
		expect((e as any).getCrdtHead("a.md")).toBe("SRV");
	});
});

describe("applyPushedNoteUpdate ordering (b#3)", () => {
	test("the idle doc is freed only AFTER setCrdtHead durably records the head", async () => {
		// Mirrors the coldReceive ordering test: hibernateIfIdle -> closeDoc must
		// run AFTER the head is persisted, so a half-recorded note is never freed.
		const order: string[] = [];
		const crdt = {
			applyRemoteUpdate: async () => {},
			closeDoc: (id: string) => order.push(`close:${id}`),
		};
		const e = engine({ crdt });
		const map = new NoteIdMap();
		map.set("a.md", "id-a");
		e.setNoteIdMap(map);
		e.setLiveBoundCheck(() => false);
		markConfirmed(e, "id-a");
		const originalSetCrdtHead = (e as any).setCrdtHead.bind(e);
		(e as any).setCrdtHead = (path: string, head: string) => {
			order.push(`head:${path}`);
			return originalSetCrdtHead(path, head);
		};

		await (e as any).applyPushedNoteUpdate("id-a", new Uint8Array([1]), "SRV");

		expect(order).toEqual(["head:a.md", "close:id-a"]);
	});
});
