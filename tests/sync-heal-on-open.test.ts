/**
 * Tests: SyncEngine.healNoteOnOpen — rework #6 (mid-session divergence heal
 * for file-open, restoring what `verifyConvergenceOnOpen` used to cover
 * WITHOUT reintroducing its per-open lag — see
 * .superpowers/sdd/rework-design.md "#6 — verifyConvergenceOnOpen removal
 * dropped the mid-session heal").
 *
 * Root cause restored here: a note that missed a live announce/STEP2 during
 * a fan-out storm stayed diverged until an unrelated reconnect, because
 * file-open (main.ts) is now a pure local bind with no convergence check.
 *
 * Single-path D3 (socket-native converge, fix wave 1): healNoteOnOpen no
 * longer pulls a REST delta. It fires `socketConverge`, which always
 * re-fires STEP1 (reset+enroll) on a diverged note — no text-verify skip
 * (text equality doesn't prove the doc holds the server's ops); the room
 * sv-exchange delivers whatever this doc is missing over the socket and
 * paints it through the binding. A per-note_id cooldown
 * (`crdtHealCooldown`/`healCooldownMs`) collapses repeated same-note
 * detections (open + catch-up + heal racing) to one handshake instead of
 * draining the handshake budget (#193 starvation class). No manifest fetch,
 * no REST round trip.
 *
 * Mirrors the mock-engine pattern from tests/sync-socket-catchup.test.ts.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManager } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApp = {
	vault: {
		configDir: ".obsidian",
		cachedRead: mock().mockResolvedValue("body"),
		getFileByPath: mock().mockReturnValue(null),
	},
} as any;

function confirm(engine: SyncEngine, noteId: string): void {
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
}

function makeEngine(
	crdt: Partial<CrdtManager>,
	api: Partial<EngramApi>,
	opts?: {
		liveBound?: boolean;
		enrollment?: { enroll: ReturnType<typeof mock>; reset: ReturnType<typeof mock> };
	},
): { engine: SyncEngine; enroll: ReturnType<typeof mock>; reset: ReturnType<typeof mock> } {
	const mockApi = {
		getUpdates: mock().mockResolvedValue({ update: new Uint8Array(), head: "head-1" }),
		...api,
	} as unknown as EngramApi;
	const e = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(crdt as unknown as CrdtManager);
	e.setReady();
	e.setLiveBoundCheck(() => opts?.liveBound ?? true);
	const enroll = opts?.enrollment?.enroll ?? mock();
	const reset = opts?.enrollment?.reset ?? mock();
	e.setCrdtEnrollment({ enroll, reset });
	const map = new NoteIdMap();
	map.set("Notes/a.md", "id-a");
	e.setNoteIdMap(map);
	confirm(e, "id-a");
	return { engine: e, enroll, reset };
}

describe("healNoteOnOpen", () => {
	test("live-bound note: fires the socket re-handshake (reset+enroll) — no REST, no disk write", async () => {
		const getUpdates = mock().mockResolvedValue({
			update: new Uint8Array([9, 9]),
			head: "head-2",
		});
		const applyRemoteUpdate = mock().mockResolvedValue(undefined);
		const crdt = {
			applyRemoteUpdate,
			projectedText: mock().mockResolvedValue("whatever"),
		};
		const { engine, enroll, reset } = makeEngine(crdt, { getUpdates });

		await engine.healNoteOnOpen("Notes/a.md");

		expect(reset).toHaveBeenCalledWith("id-a");
		expect(enroll).toHaveBeenCalledWith("id-a");
		expect(getUpdates).not.toHaveBeenCalled();
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
	});

	test("repeated opens within the cooldown window collapse to ONE handshake (fix wave 1)", async () => {
		const crdt = { projectedText: mock().mockResolvedValue("same") };
		const { engine, enroll, reset } = makeEngine(crdt, {});

		await engine.healNoteOnOpen("Notes/a.md");
		await engine.healNoteOnOpen("Notes/a.md");

		// Open + catch-up + heal can all independently detect the same
		// divergence in quick succession — the per-note cooldown collapses
		// them to one STEP1 instead of draining the handshake budget (#193
		// starvation class).
		expect(reset).toHaveBeenCalledTimes(1);
		expect(enroll).toHaveBeenCalledTimes(1);
	});

	test("cooldown of 0 allows every open to independently re-fire the handshake", async () => {
		const crdt = { projectedText: mock().mockResolvedValue("same") };
		const { engine, enroll, reset } = makeEngine(crdt, {});
		engine.healCooldownMs = 0;

		await engine.healNoteOnOpen("Notes/a.md");
		await engine.healNoteOnOpen("Notes/a.md");

		expect(reset).toHaveBeenCalledTimes(2);
		expect(enroll).toHaveBeenCalledTimes(2);
	});

	test("idle (not live-bound) confirmed note: no-op in the first cut — no catch-up replay", async () => {
		const crdt = { projectedText: mock().mockResolvedValue("x") };
		const { engine, enroll, reset } = makeEngine(crdt, {}, { liveBound: false });
		let replayed = false;
		engine.setCrdtCatchupSince(async () => {
			replayed = true;
			return { changes: [], has_more: false, next_seq: null };
		});

		await engine.healNoteOnOpen("Notes/a.md");

		expect(replayed).toBe(false); // confirmed + idle → left to reconnect catch-up (#5)
		expect(reset).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("unmapped path: no-op (nothing to heal against)", async () => {
		const { engine, reset, enroll } = makeEngine({}, {});

		await expect(engine.healNoteOnOpen("Notes/unknown.md")).resolves.toBeUndefined();
		expect(reset).not.toHaveBeenCalled();
		expect(enroll).not.toHaveBeenCalled();
	});

	test("unconfirmed note: no-op (no server row known yet)", async () => {
		const applyRemoteUpdate = mock().mockResolvedValue(undefined);
		const e = new SyncEngine(
			mockApp,
			{ getUpdates: mock() } as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1 },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager({ applyRemoteUpdate } as unknown as CrdtManager);
		e.setReady();
		e.setLiveBoundCheck(() => true);
		const map = new NoteIdMap();
		map.set("Notes/a.md", "id-a"); // mapped but never confirmed
		e.setNoteIdMap(map);

		await e.healNoteOnOpen("Notes/a.md");

		expect(applyRemoteUpdate).not.toHaveBeenCalled();
	});

	test("opened-but-unconfirmed note: converges over the seq-replay op-log, not REST", async () => {
		// A note opened after being discovered via catch-up/fan-out but never
		// handshaked (unconfirmed). It must not wait for the next reconnect — heal
		// converges it over the one catch-up path (crdt_catchup_since), NOT the
		// socket re-handshake primitive.
		const getUpdates = mock().mockResolvedValue({ update: new Uint8Array(), head: "h" });
		const crdt = { projectedText: mock().mockResolvedValue("x") };
		const { engine, reset } = makeEngine(crdt, { getUpdates });
		(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.delete("id-a");
		let replayed = false;
		engine.setCrdtCatchupSince(async () => {
			replayed = true;
			return { changes: [], has_more: false, next_seq: null };
		});

		await engine.healNoteOnOpen("Notes/a.md");

		expect(replayed).toBe(true); // seq-replay catch-up ran
		expect(getUpdates).not.toHaveBeenCalled(); // NOT the REST heal path
		expect(reset).not.toHaveBeenCalled(); // NOT the socket re-handshake path
	});

	test("never throws — a failure inside the socket re-handshake is caught and swallowed", async () => {
		const crdt = {};
		const failingReset = mock().mockImplementation(() => {
			throw new Error("boom");
		});
		const { engine } = makeEngine(
			crdt,
			{},
			{ enrollment: { enroll: mock(), reset: failingReset } },
		);

		await expect(engine.healNoteOnOpen("Notes/a.md")).resolves.toBeUndefined();
	});
});
