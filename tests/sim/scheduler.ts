// tests/sim/scheduler.ts
import type { SimClock } from "./clock";
import { mulberry32 } from "./prng";

/** Owns ALL sim nondeterminism. An action is either delivering one queued
 * lane item (a network message, an fs event, an op application) or firing one
 * virtual timer. step() picks randomly among enabled actions using the seeded
 * PRNG; drain() empties everything deterministically (round-robin) — the
 * quiescence barrier uses drain, never randomness. Await each action fully
 * (microtasks settle between steps) so interleavings are step-atomic. */
export class Scheduler {
	private lanes = new Map<string, Array<() => Promise<void> | void>>();
	readonly rand: () => number;
	constructor(
		seed: number,
		private clock: SimClock,
	) {
		this.rand = mulberry32(seed);
	}
	pick<T>(arr: T[]): T {
		return arr[Math.floor(this.rand() * arr.length)];
	}
	chance(p: number): boolean {
		return this.rand() < p;
	}
	enqueue(lane: string, fn: () => Promise<void> | void): void {
		if (!this.lanes.has(lane)) this.lanes.set(lane, []);
		this.lanes.get(lane)!.push(fn);
	}
	laneSizes(): Record<string, number> {
		return Object.fromEntries([...this.lanes.entries()].map(([k, v]) => [k, v.length]));
	}
	async step(): Promise<boolean> {
		const nonEmpty = [...this.lanes.entries()].filter(([, q]) => q.length > 0);
		const nActions = nonEmpty.length + (this.clock.pendingCount() > 0 ? 1 : 0);
		if (nActions === 0) return false;
		const i = Math.floor(this.rand() * nActions);
		if (i < nonEmpty.length) await nonEmpty[i][1].shift()!();
		else this.clock.fireNext();
		await Promise.resolve(); // settle one microtask tick
		return true;
	}
	async drain(maxSteps = 100_000): Promise<void> {
		let steps = 0;
		while (steps++ < maxSteps) {
			const q = [...this.lanes.values()].find((v) => v.length > 0);
			if (q) {
				await q.shift()!();
				await Promise.resolve();
				continue;
			}
			if (this.clock.pendingCount() > 0) {
				this.clock.fireNext();
				await Promise.resolve();
				continue;
			}
			return;
		}
		throw new Error(
			`drain: not quiescent after ${maxSteps} steps — livelock? lanes=${JSON.stringify(this.laneSizes())} timers=${this.clock.pendingCount()}`,
		);
	}
}
