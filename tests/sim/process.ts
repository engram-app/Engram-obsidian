// tests/sim/process.ts
//
// One "process" (incarnation) of a sim device. Every replica's code runs inside
// an AsyncLocalStorage context naming its incarnation, so the sim can kill or
// freeze ONE device while the others share the same clock and scheduler:
//
//   - `dead`: the app process is gone (hard restart, crash). Its timers never
//     fire again, its socket and HTTP replies are dropped, its vault refuses
//     writes. Nothing it scheduled can touch the next incarnation.
//   - `frozen`: iOS-style suspend. Its timers stay pending but do not fire
//     until resume, exactly like a JS context the OS has paused.
//
// The context propagates through every `await` (AsyncLocalStorage), and the
// SimClock re-enters the captured context when it fires a timer, so a chain
// keeps its owner across virtual time. Code outside any context (the oracle,
// existing scenarios) has no owner and is never gated.
import { AsyncLocalStorage } from "node:async_hooks";

export interface Incarnation {
	readonly replicaId: string;
	readonly n: number;
	dead: boolean;
	frozen: boolean;
}

const als = new AsyncLocalStorage<Incarnation>();

export function currentIncarnation(): Incarnation | undefined {
	return als.getStore();
}

export function runAs<T>(inc: Incarnation | undefined, fn: () => T): T {
	return inc ? als.run(inc, fn) : als.exit(fn);
}

export function newIncarnation(replicaId: string, n: number): Incarnation {
	return { replicaId, n, dead: false, frozen: false };
}
