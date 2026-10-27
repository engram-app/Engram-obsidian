// tests/sim/fuzz.test.ts
//
// The seeded sync fuzz gate. The world, ops and invariants live in
// fuzz-world.ts (its header lists every invariant).
//
// Seeds: SIM_SEEDS (default 200) seeds from SIM_SEED_BASE (default 1); SIM_SEED
// replays one. SIM_OPS sets ops per seed, SIM_TRACE=1 prints every run's
// trace, SIM_KEEP_GOING=1 reports every failing seed instead of the first.
// A failure prints the seed, the invariant and a shrunk op trace. The nightly
// soak (.github/workflows/sim-soak.yml) runs SIM_SEEDS=5000.
import { afterAll, expect, test } from "bun:test";
import { genOps, type Op, runOps, shrink } from "./fuzz-world";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

const SEEDS = Number(process.env.SIM_SEEDS ?? 200);
const SEED_BASE = Number(process.env.SIM_SEED_BASE ?? 1);

function seedList(): number[] {
	if (process.env.SIM_SEED) return [Number(process.env.SIM_SEED) >>> 0];
	return Array.from({ length: SEEDS }, (_, k) => SEED_BASE + k);
}

test(`sync fuzz: ${process.env.SIM_SEED ? `seed ${process.env.SIM_SEED}` : `${SEEDS} seeds`}, devices x real sync stack, all invariants`, async () => {
	// biome-ignore lint/suspicious/noConsole: the seed and trace ARE the failure report
	const log = console.log;
	const failures: string[] = [];
	const started = performance.now();
	for (const seed of seedList()) {
		const gen = genOps(seed);
		const nDev = gen.nDev;
		// SIM_REPLAY: run exactly this op list (the JSON a failure prints).
		const ops = process.env.SIM_REPLAY ? (JSON.parse(process.env.SIM_REPLAY) as Op[]) : gen.ops;
		const res = await runOps(seed, nDev, ops);
		if (process.env.SIM_TRACE) log(`[sim/fuzz] seed=${seed}\n  ${res.trace.join("\n  ")}`);
		if (!res.violation) continue;
		const v = res.violation;
		const small = process.env.SIM_REPLAY ? ops : await shrink(seed, nDev, ops, v.invariant);
		const replay = await runOps(seed, nDev, small);
		const report = [
			`[sim/fuzz] seed=${seed} devices=${nDev} FAILED ${v.invariant}`,
			`  ${v.detail}`,
			`  shrunk ${ops.length} -> ${small.length} ops (replay of the shrunk trace: ${replay.violation?.invariant ?? "passes; full trace needed"}):`,
			...(replay.violation ? replay.trace : res.trace).map((l) => `    ${l}`),
			`  replay: SIM_SEED=${seed} bun test tests/sim/fuzz.test.ts`,
			`  shrunk: SIM_SEED=${seed} SIM_REPLAY='${JSON.stringify(replay.violation ? small : ops)}'`,
		].join("\n");
		log(report);
		failures.push(report);
		if (!process.env.SIM_KEEP_GOING) break;
	}
	log(`[sim/fuzz] ${seedList().length} seed(s) in ${Math.round(performance.now() - started)} ms`);
	expect(failures).toEqual([]);
}, 3_600_000);
