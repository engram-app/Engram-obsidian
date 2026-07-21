/**
 * Task 2 (crdt-single-path Phase D2): SyncEngine.applyLiveOpWithSeq decision
 * function. seq NEVER gates application (Yjs updates are commutative +
 * idempotent) — apply() runs in every branch. seq only decides whether the
 * catchupSeq cursor advances or a gap-heal replay fires.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Lean SyncEngine — applyLiveOpWithSeq only touches the catchupSeq cursor
 *  and catchupViaSeqReplay, so bare stubs are enough (mirrors
 *  crdt-create-ack-gate.test.ts's makeEngine). */
function makeEngine(): SyncEngine {
	return new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS, enableCrdt: false },
		mock().mockResolvedValue(undefined),
	);
}

describe("SyncEngine.applyLiveOpWithSeq", () => {
	test("an in-order op applies and advances the cursor", () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(() => {});
		expect(engine.applyLiveOpWithSeq("n", 6, apply)).toBe("advanced");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(engine.getCatchupSeq()).toBe(6);
	});

	test("a gap STILL applies the op, triggers catch-up, does not advance", () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);
		const apply = mock(() => {});
		expect(engine.applyLiveOpWithSeq("n", 8, apply)).toBe("healing");
		expect(apply).toHaveBeenCalledTimes(1); // ALWAYS applied — seq never gates a CRDT op
		expect(catchup).toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(5); // replay starts from the true cursor
	});

	test("a stale seq (live delta between checkpoints) applies without advancing", () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(() => {});
		expect(engine.applyLiveOpWithSeq("n", 5, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1); // NOT dropped — stale seq is normal for live deltas
		expect(engine.getCatchupSeq()).toBe(5);
	});

	test("a seq-less op (old backend) applies for back-compat without advancing", () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(() => {});
		expect(engine.applyLiveOpWithSeq("n", undefined, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(engine.getCatchupSeq()).toBe(5); // unchanged
	});

	test("a null seq (note deleted mid-flight) behaves exactly like undefined", () => {
		const engine = makeEngine();
		engine.setCatchupSeq(5);
		const apply = mock(() => {});
		expect(engine.applyLiveOpWithSeq("n", null as any, apply)).toBe("applied");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(engine.getCatchupSeq()).toBe(5); // unchanged, no heal triggered
	});

	test("fresh install (cursor unset at 0) treats the first live op as a gap and heals from 0", () => {
		const engine = makeEngine();
		// getCatchupSeq() defaults to 0 on a fresh install (never called setCatchupSeq).
		const catchup = spyOn(engine, "catchupViaSeqReplay").mockResolvedValue({
			applied: 0,
		} as any);
		const apply = mock(() => {});
		expect(engine.applyLiveOpWithSeq("n", 42, apply)).toBe("healing");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(catchup).toHaveBeenCalled();
		expect(engine.getCatchupSeq()).toBe(0); // replay starts from true cursor 0 (full catch-up)
	});
});
