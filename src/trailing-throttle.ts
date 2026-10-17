import type { TimeProvider } from "./time-provider";

/** Single-flight runner with a minimum gap between runs and ONE trailing run.
 *
 *  `poke()` runs `run` now when idle and the gap since the previous run
 *  FINISHED has elapsed; otherwise it arms a single trailing run (pokes during
 *  a run or a wait coalesce into it, never dropped). The gap is measured from
 *  completion, not start, so a run slower than the gap cannot make runs
 *  back-to-back. `gapMs` is read per poke so callers can back off.
 *
 *  `reset()` cancels the armed run and forgets the previous one; a run still in
 *  flight finishes but no longer touches this throttle's state.
 *
 *  ponytail: `scheduleSeqHeal` in sync.ts is the same shape on Date.now; move it
 *  here when it is next touched. */
export class TrailingThrottle {
	private timer: number | null = null;
	private running = false;
	private again = false;
	private lastDoneAt = Number.NEGATIVE_INFINITY;
	private gen = 0;

	constructor(
		private readonly time: TimeProvider,
		private readonly gapMs: () => number,
		private readonly run: () => Promise<void>,
	) {}

	poke(): void {
		if (this.running) {
			this.again = true;
			return;
		}
		if (this.timer !== null) return;
		const wait = this.lastDoneAt + this.gapMs() - this.time.now();
		if (wait <= 0) {
			this.fire();
			return;
		}
		this.timer = this.time.setTimeout(() => {
			this.timer = null;
			this.fire();
		}, wait);
	}

	reset(): void {
		if (this.timer !== null) this.time.clearTimeout(this.timer);
		this.timer = null;
		this.running = false;
		this.again = false;
		this.lastDoneAt = Number.NEGATIVE_INFINITY;
		this.gen++;
	}

	private fire(): void {
		const gen = this.gen;
		this.running = true;
		this.again = false;
		// `run` must handle its own errors; a rejection here is a bug and is left
		// unhandled so it surfaces. `finally` still keeps the throttle unwedged.
		void this.run().finally(() => {
			if (gen !== this.gen) return;
			this.running = false;
			this.lastDoneAt = this.time.now();
			if (this.again) this.poke();
		});
	}
}
