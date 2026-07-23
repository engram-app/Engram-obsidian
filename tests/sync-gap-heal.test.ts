/**
 * Task 2 (crdt-single-path Phase D2): SyncEngine.applyLiveOpWithSeq decision
 * function. seq NEVER gates application (Yjs updates are commutative +
 * idempotent) — apply() runs in every branch. Phase E3: the per-path seq
 * stamp happens ONLY when apply() resolves "applied" (op-level proof) — a
 * pended/deferred op stamping seq fence-masked the replay row carrying its
 * content (e2e test_85, CI run 29942250643). Live ops are a pure
 * behind-detector: they never advance or persist the catchupSeq cursor
 * (final-review fix). Only catchupViaSeqReplay's per-page advance does that.
 * An integer seq greater than the cursor fires the single-flight replay; a
 * non-integer (string/NaN/float) is not a valid signal at all.
 *
 * Task 3: the wiring layer (createCrdtWiring's onNoteYjsUpdate) that threads a
 * live fan-out's seq through applyLiveOpWithSeq.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { toB64 } from "../src/crdt/channel";
import type { CrdtManager } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { createCrdtWiring } from "../src/crdt/wiring";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Lean SyncEngine — applyLiveOpWithSeq only touches the catchupSeq cursor
 *  and catchupViaSeqReplay, so bare stubs are enough (mirrors
 *  crdt-create-ack-gate.test.ts's makeEngine). */
function makeEngine(): SyncEngine {
	return new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	);
}

describe("SyncEngine.applyLiveOpWithSeq", () => {
	test("a fresh seq (cursor+1) applies AND fires the single-flight heal, cursor untouched", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", 6, apply)).toBe("healing");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(catchup).toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(5); // ONLY the replay advances/persists the cursor
	});

	test("a gap STILL applies the op, triggers catch-up, does not advance", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", 8, apply)).toBe("healing");
		expect(apply).toHaveBeenCalledTimes(1); // ALWAYS applied — seq never gates a CRDT op
		expect(catchup).toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(5); // replay starts from the true cursor
	});

	test("a stale seq (live delta between checkpoints) applies without advancing", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", 5, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1); // NOT dropped — stale seq is normal for live deltas
		expect(engine.getCatchupSeq()).toBe(5);
	});

	test("a seq-less op (old backend) applies for back-compat without advancing", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", undefined, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(engine.getCatchupSeq()).toBe(5); // unchanged
	});

	test("a null seq (note deleted mid-flight) behaves exactly like undefined", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", null as any, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(engine.getCatchupSeq()).toBe(5); // unchanged, no heal triggered
	});

	// Non-integer seq values are not a valid gap-heal signal (aliasing across
	// write kinds proved unsound in review) — only Number.isInteger(seq) counts.
	test("a string seq applies without advancing or healing", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay");
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", "42" as any, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(catchup).not.toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(5);
	});

	test("a NaN seq applies without advancing or healing", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay");
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", Number.NaN, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(catchup).not.toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(5);
	});

	test("a float seq applies without advancing or healing", async () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay");
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", 8.5, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(catchup).not.toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(5);
	});

	test("fresh install (cursor unset at 0) treats the first live op as a gap and heals from 0", async () => {
		const engine = makeEngine();
		// getCatchupSeq() defaults to 0 on a fresh install (never called setCatchupSeq).
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", 42, apply)).toBe("healing");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(catchup).toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(0); // replay starts from true cursor 0 (full catch-up)
	});

	test("repeat heals inside the cooldown coalesce: one immediate replay, ops still apply", async () => {
		// Steady-state editing fans out FRESH seqs (CI run 29877041947 fired a
		// replay per op) — the trailing throttle must bound that to one
		// immediate run per window while every op still applies.
		const engine = makeEngine();
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);
		const apply = mock(async () => "applied" as const);
		expect(await engine.applyLiveOpWithSeq("n", 1, apply)).toBe("healing");
		expect(await engine.applyLiveOpWithSeq("n", 2, apply)).toBe("healing");
		expect(await engine.applyLiveOpWithSeq("n", 3, apply)).toBe("healing");
		expect(apply).toHaveBeenCalledTimes(3); // never gated
		expect(catchup).toHaveBeenCalledTimes(1); // rest coalesce into the trailing run
		engine.destroy(); // clears the armed trailing timer without firing
		expect(catchup).toHaveBeenCalledTimes(1);
	});
});

/** Polls until `cond` holds — applyPushedNoteUpdate's apply body runs as a
 *  fire-and-forget promise chain (several awaits deep), so a fixed sleep
 *  would be racy. Mirrors tests/crdt/wiring.test.ts's waitFor. */
async function waitFor(cond: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (cond()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`waitFor timed out: ${label}`);
}

/** A real SyncEngine + a real createCrdtWiring, wired around a fake CrdtManager
 *  (applyRemoteUpdate/closeDoc only — mirrors tests/crdt/note-yjs-update.test.ts's
 *  noteEngine). Drives the wiring's onNoteYjsUpdate callback end to end so the
 *  seq threading (channel frame -> wiring -> applyLiveOpWithSeq -> apply) is
 *  what's actually pinned, not just SyncEngine's decision function in isolation. */
function wiredNote(noteId: string, path: string) {
	const applied: Uint8Array[] = [];
	const crdt = {
		applyRemoteUpdate: async (_id: string, update: Uint8Array) => {
			applied.push(update);
		},
		closeDoc: () => {},
	};
	const engine = new SyncEngine(
		{
			vault: {
				configDir: ".obsidian",
				getFileByPath: mock().mockReturnValue(null),
				getAbstractFileByPath: mock().mockReturnValue(null),
				cachedRead: mock().mockResolvedValue(""),
			},
			fileManager: { trashFile: mock().mockResolvedValue(undefined) },
			workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
		} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager(crdt as unknown as CrdtManager);
	engine.setReady();
	const map = new NoteIdMap();
	map.set(path, noteId);
	engine.setNoteIdMap(map);
	engine.setLiveBoundCheck(() => false);
	(engine as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add(noteId);
	engine.setCrdtHead(path, "server-head");

	const wiring = createCrdtWiring({
		noteIdMap: map,
		syncEngine: engine,
		sendCrdt: () => {},
		isBound: () => false,
	});

	return { engine, wiring, applied };
}

describe("createCrdtWiring.onNoteYjsUpdate — seq gap-heal threading", () => {
	test("a gapped seq applies the update AND triggers catch-up", async () => {
		const { engine, wiring, applied } = wiredNote("id-a", "a.md");
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);

		wiring.onNoteYjsUpdate("id-a", toB64(new Uint8Array([1, 2, 3])), "SRV", 8);

		// The update applies first (the heal decision now waits for the apply
		// so the per-path seq can be stamped on op-level proof only).
		await waitFor(() => applied.length === 1, "gapped update applied");
		expect(applied).toEqual([new Uint8Array([1, 2, 3])]);
		await waitFor(() => catchup.mock.calls.length > 0, "catch-up fired");
		expect(engine.getCatchupSeq()).toBe(5); // unchanged — replay starts from the true cursor
	});

	test("a fresh seq applies the update, fires catch-up, and leaves the cursor untouched", async () => {
		const { engine, wiring, applied } = wiredNote("id-a", "a.md");
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);

		wiring.onNoteYjsUpdate("id-a", toB64(new Uint8Array([1, 2, 3])), "SRV", 6);

		await waitFor(() => applied.length === 1, "fresh-seq update applied");
		expect(applied).toEqual([new Uint8Array([1, 2, 3])]);
		await waitFor(() => catchup.mock.calls.length > 0, "catch-up fired");
		expect(engine.getCatchupSeq()).toBe(5); // ONLY the replay advances/persists the cursor
	});

	test("a seq-less frame (old backend) applies exactly as today — no cursor move, no heal", async () => {
		const { engine, wiring, applied } = wiredNote("id-a", "a.md");
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay");

		wiring.onNoteYjsUpdate("id-a", toB64(new Uint8Array([1, 2, 3])), "SRV", undefined);

		expect(engine.getCatchupSeq()).toBe(5);
		expect(catchup).not.toHaveBeenCalled();
		await waitFor(() => applied.length === 1, "seq-less update applied");
		expect(applied).toEqual([new Uint8Array([1, 2, 3])]);
	});
});
