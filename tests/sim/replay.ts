// tests/sim/replay.ts
//
// Pin a fuzz finding (tests/sim/fuzz-world.ts) as a deterministic test: the
// seed and the shrunk op trace a failure printed. A regression reports the
// broken invariant with the run's trace.
import { expect } from "bun:test";
import { genOps, type Op, runOps } from "./fuzz-world";

/** One op as the fuzz report prints it: kind, devices, note, entropy, steps. */
export const op = (kind: string, d: number, d2: number, n: number, x: number, steps: number): Op =>
	({ kind, d, d2, n, x, steps }) as Op;

export async function expectReplayClean(seed: number, ops: Op[]): Promise<void> {
	const res = await runOps(seed, genOps(seed).nDev, ops);
	const v = res.violation;
	expect(v ? `${v.invariant}: ${v.detail}\n  ${res.trace.join("\n  ")}` : null).toBeNull();
}
