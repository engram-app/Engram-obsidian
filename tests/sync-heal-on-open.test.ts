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
 * Why this doesn't reintroduce the old lag: healNoteOnOpen does no
 * synchronous manifest-hash comparison and no reset/enroll re-handshake — it
 * just asks for the delta since our real state vector for the ONE opened
 * note via the existing guarded `restConvergeLiveBound`, which is a no-op
 * when already converged. Live-bound-only first cut (design decision iii):
 * an idle (non-live-bound) note is left to reconnect catch-up (#5), so this
 * heal never does a vault-wide heads fetch.
 *
 * Mirrors the mock-engine pattern from tests/sync-socket-catchup.test.ts.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import type { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
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
	opts?: { liveBound?: boolean },
): SyncEngine {
	const mockApi = {
		getUpdates: mock().mockResolvedValue({ update: new Uint8Array(), head: "head-1" }),
		...api,
	} as unknown as EngramApi;
	const e = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	(e as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
	e.setCrdtManager(crdt as unknown as CrdtManager);
	e.setReady();
	e.setLiveBoundCheck(() => opts?.liveBound ?? true);
	const map = new NoteIdMap();
	map.set("Notes/a.md", "id-a");
	e.setNoteIdMap(map);
	confirm(e, "id-a");
	return e;
}

describe("healNoteOnOpen", () => {
	test("live-bound note: applies the delta since our real state vector via restConvergeLiveBound", async () => {
		const applied: Array<[string, Uint8Array]> = [];
		const crdt = {
			applyRemoteUpdate: (id: string, update: Uint8Array) => {
				applied.push([id, update]);
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
		};
		const engine = makeEngine(crdt, {
			getUpdates: mock().mockResolvedValue({
				update: new Uint8Array([9, 9]),
				head: "head-2",
			}),
		});

		await engine.healNoteOnOpen("Notes/a.md");

		expect(applied).toEqual([["id-a", new Uint8Array([9, 9])]]);
		expect((engine as any).getCrdtHead("Notes/a.md")).toBe("head-2");
	});

	test("already-converged note: the delta is empty and the head still advances to the returned head — no reset, no re-handshake", async () => {
		const applied: Array<[string, Uint8Array]> = [];
		const getUpdates = mock().mockResolvedValue({ update: new Uint8Array(), head: "same" });
		const crdt = {
			applyRemoteUpdate: (id: string, update: Uint8Array) => {
				applied.push([id, update]);
				return Promise.resolve();
			},
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
		};
		const engine = makeEngine(crdt, { getUpdates });

		await engine.healNoteOnOpen("Notes/a.md");

		expect(applied).toEqual([["id-a", new Uint8Array()]]); // empty delta — near-no-op
		// Exactly one REST call (getUpdates) — no manifest fetch, no separate
		// reset/enroll round trip: the #203 false-fire lag source is absent.
		expect(getUpdates).toHaveBeenCalledTimes(1);
	});

	test("idle (not live-bound) note: no-op in the first cut — no vault-wide heads fetch", async () => {
		const crdtCatchupHeads = mock().mockResolvedValue({ heads: {} });
		const applyRemoteUpdate = mock().mockResolvedValue(undefined);
		const crdt = {
			applyRemoteUpdate,
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
		};
		const engine = makeEngine(crdt, {}, { liveBound: false });
		engine.setCrdtCatchup(crdtCatchupHeads, mock());

		await engine.healNoteOnOpen("Notes/a.md");

		expect(crdtCatchupHeads).not.toHaveBeenCalled();
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
	});

	test("unmapped path: no-op (nothing to heal against)", async () => {
		const applyRemoteUpdate = mock().mockResolvedValue(undefined);
		const engine = makeEngine({ applyRemoteUpdate }, {});

		await expect(engine.healNoteOnOpen("Notes/unknown.md")).resolves.toBeUndefined();
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
	});

	test("unconfirmed note: no-op (no server row known yet)", async () => {
		const applyRemoteUpdate = mock().mockResolvedValue(undefined);
		const e = new SyncEngine(
			mockApp,
			{ getUpdates: mock() } as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
			mock().mockResolvedValue(undefined),
		);
		(e as unknown as { crdtOpsProbed: boolean }).crdtOpsProbed = true;
		e.setCrdtManager({ applyRemoteUpdate } as unknown as CrdtManager);
		e.setReady();
		e.setLiveBoundCheck(() => true);
		const map = new NoteIdMap();
		map.set("Notes/a.md", "id-a"); // mapped but never confirmed
		e.setNoteIdMap(map);

		await e.healNoteOnOpen("Notes/a.md");

		expect(applyRemoteUpdate).not.toHaveBeenCalled();
	});

	test("opened-but-unconfirmed note: converges over the SOCKET (catchupViaSocket), not REST", async () => {
		// A note opened after being discovered via catch-up/fan-out but never
		// handshaked (unconfirmed). It must not wait for the next reconnect — heal
		// converges it over the socket, NOT via REST restConvergeLiveBound.
		const heads = mock().mockResolvedValue({ heads: {} });
		const getUpdates = mock().mockResolvedValue({ update: new Uint8Array(), head: "h" });
		const crdt = {
			applyRemoteUpdate: mock().mockResolvedValue(undefined),
			encodeStateVector: (_id: string) => Promise.resolve(new Uint8Array([1])),
		};
		const engine = makeEngine(crdt, { getUpdates });
		(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.delete("id-a");
		engine.setCrdtCatchup(heads, mock());

		await engine.healNoteOnOpen("Notes/a.md");

		expect(heads).toHaveBeenCalledTimes(1); // socket catch-up ran
		expect(getUpdates).not.toHaveBeenCalled(); // NOT the REST heal path
	});

	test("crdt disabled: no-op", async () => {
		const applyRemoteUpdate = mock().mockResolvedValue(undefined);
		const e = new SyncEngine(
			mockApp,
			{ getUpdates: mock() } as unknown as EngramApi,
			{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: false },
			mock().mockResolvedValue(undefined),
		);
		e.setCrdtManager({ applyRemoteUpdate } as unknown as CrdtManager);
		e.setReady();
		await e.healNoteOnOpen("Notes/a.md");
		expect(applyRemoteUpdate).not.toHaveBeenCalled();
	});

	test("never throws — a failure in the delta fetch is caught and swallowed", async () => {
		const crdt = {
			applyRemoteUpdate: mock().mockResolvedValue(undefined),
			encodeStateVector: (_id: string) => Promise.reject(new Error("boom")),
		};
		const engine = makeEngine(crdt, {});

		await expect(engine.healNoteOnOpen("Notes/a.md")).resolves.toBeUndefined();
	});
});
