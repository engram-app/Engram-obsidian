// tests/sim/scheduler.ts
import type { SimClock } from "./clock";
import { mulberry32 } from "./prng";

/** Number of microtask ticks to yield between scheduler actions. A bare
 *  `await Promise.resolve()` yields only ONE tick, so a multi-`await` DETACHED
 *  chain the engine fire-and-forgets (`void pushFile(...)`,
 *  `void discoverAnnouncedNote(...)`) whose tail is pure-microtask escapes
 *  drain() and completes on the real loop AFTER quiescence is declared — the
 *  exact failure that let a note's CRDT seed land after the convergence
 *  assertions. Looping the yield flushes those chains to their next REAL async
 *  boundary — which in the sim is ALWAYS a scheduler lane or a virtual timer
 *  this scheduler owns (REST rides a lane; IndexedDB rides globalThis.setImmediate
 *  which Replica.boot patches onto the virtual clock) — so no engine async ever
 *  needs the real event loop. Crucially this stays in the MICROTASK phase: a real
 *  macrotask boundary (setImmediate/setTimeout) would pump the real timer queue
 *  and fire recurring timers LEAKED by earlier un-disposed test objects
 *  (EditorController drift checks, channel health probes) straight onto this
 *  clock — an unkillable livelock. Generous bound; realistic engine chains nest
 *  only a handful of awaits between virtual boundaries. */
const MICROTASK_FLUSH_ROUNDS = 200;

/** Drain the microtask queue (bounded) WITHOUT yielding a real macrotask. */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < MICROTASK_FLUSH_ROUNDS; i++) await Promise.resolve();
}

/** Owns ALL sim nondeterminism. An action is either delivering one queued
 * lane item (a network message, an fs event, an op application) or firing one
 * virtual timer. step() picks randomly among enabled actions using the seeded
 * PRNG; drain() empties everything deterministically (round-robin) — the
 * quiescence barrier uses drain, never randomness. Await each action fully
 * (microtasks settle between steps) so interleavings are step-atomic. */
export class Scheduler {
	private lanes = new Map<string, Array<() => Promise<void> | void>>();
	/** Lanes the scheduler must NOT deliver while held. Items still ENQUEUE
	 *  (they pile up in order) but neither step() nor drain() pops them until
	 *  release(). This is the sim's only fault-injection primitive for FORCED
	 *  ORDERING: e.g. #288 needs B's genesis-enroll to complete while A's create
	 *  reply (which releases A's held content push) is stuck in flight. A held
	 *  lane does not count toward quiescence — drain() returns with it non-empty.
	 *  (Timers are not lanes, so holding never freezes virtual time.) */
	private held = new Set<string>();
	readonly rand: () => number;
	constructor(
		readonly seed: number,
		private clock: SimClock,
	) {
		this.rand = mulberry32(seed);
	}
	/** Freeze delivery of a lane (see `held`). Idempotent. */
	hold(lane: string): void {
		this.held.add(lane);
	}
	/** Resume delivery of a previously held lane. Idempotent. Caller drains. */
	release(lane: string): void {
		this.held.delete(lane);
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
		const nonEmpty = [...this.lanes.entries()].filter(
			([k, q]) => q.length > 0 && !this.held.has(k),
		);
		const nActions = nonEmpty.length + (this.clock.pendingCount() > 0 ? 1 : 0);
		if (nActions === 0) return false;
		const i = Math.floor(this.rand() * nActions);
		if (i < nonEmpty.length) await nonEmpty[i][1].shift()!();
		else this.clock.fireNext();
		await flushMicrotasks(); // settle ALL microtasks (incl. detached chains)
		return true;
	}
	async drain(maxSteps = 100_000): Promise<void> {
		let steps = 0;
		const deliverable = () =>
			[...this.lanes.entries()].find(([k, v]) => v.length > 0 && !this.held.has(k))?.[1];
		while (steps++ < maxSteps) {
			const q = deliverable();
			if (q) {
				await q.shift()!();
				await flushMicrotasks();
				continue;
			}
			if (this.clock.pendingCount() > 0) {
				this.clock.fireNext();
				await flushMicrotasks();
				continue;
			}
			// Deliverable lanes AND virtual timers are empty. Detached async chains
			// may have re-armed either while their pure-microtask segments ran; a
			// final microtask flush surfaces that work before declaring quiescence.
			// Held lanes are intentionally excluded — drain() returns with them
			// still pending (that IS the forced-ordering fault).
			await flushMicrotasks();
			if (deliverable() || this.clock.pendingCount() > 0) continue;
			return;
		}
		throw new Error(
			`drain: not quiescent after ${maxSteps} steps — livelock? lanes=${JSON.stringify(this.laneSizes())} timers=${this.clock.pendingCount()}`,
		);
	}
}
