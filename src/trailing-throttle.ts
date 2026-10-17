import type { TimeProvider } from "./time-provider";

/** Single-flight runner with a minimum gap between runs and ONE trailing run.
 *
 *  `poke()` runs `run` now when idle and the gap since the previous run
 *  FINISHED has elapsed; otherwise it arms a single trailing run (pokes during
 *  a run or a wait coalesce into it, never dropped). The gap is measured from
 *  completion, not start, so a run slower than the gap cannot make runs
 *  back-to-back. `gapMs` is read per poke so callers can back off.
 *
 *  `poke(true)` is urgent: it skips the gap, except right after another early
 *  (urgent) run, when it waits `gapMs(true)` instead. Callers pass a short
 *  urgent gap, so a stream of urgent pokes costs one run per urgent gap.
 *
 *  `cancel()` drops the armed run and any queued trailing one. `reset()` also
 *  forgets the previous run's cooldown. Neither breaks single-flight: a run
 *  still in flight finishes first, and a poke made meanwhile runs after it.
 *
 *  `scheduleSeqHeal` in sync.ts is NOT on this: its gap is measured from the
 *  replay's START and the replay is fire-and-forget, so moving it here would
 *  change when heals fire. */
export class TrailingThrottle {
	private timer: number | null = null;
	private timerDue = 0;
	private running = false;
	private again = false;
	private againUrgent = false;
	private lastWasUrgent = false;
	private lastDoneAt = Number.NEGATIVE_INFINITY;
	private gen = 0;

	constructor(
		private readonly time: TimeProvider,
		private readonly gapMs: (urgent: boolean) => number,
		private readonly run: () => Promise<void>,
	) {}

	poke(urgent = false): void {
		if (this.running) {
			this.again = true;
			this.againUrgent ||= urgent;
			return;
		}
		const now = this.time.now();
		const due =
			urgent && !this.lastWasUrgent ? now : this.lastDoneAt + this.gapMs(urgent);
		if (this.timer !== null) {
			if (due >= this.timerDue) return;
			this.time.clearTimeout(this.timer);
			this.timer = null;
		}
		if (due <= now) {
			this.fire();
			return;
		}
		this.timerDue = due;
		this.timer = this.time.setTimeout(() => {
			this.timer = null;
			this.fire();
		}, due - now);
	}

	cancel(): void {
		if (this.timer !== null) this.time.clearTimeout(this.timer);
		this.timer = null;
		this.again = false;
		this.againUrgent = false;
	}

	reset(): void {
		this.cancel();
		this.lastDoneAt = Number.NEGATIVE_INFINITY;
		this.lastWasUrgent = false;
		this.gen++;
	}

	private fire(): void {
		const gen = this.gen;
		this.running = true;
		this.again = false;
		this.againUrgent = false;
		// Urgent = earlier than the regular gap allows.
		this.lastWasUrgent = this.time.now() < this.lastDoneAt + this.gapMs(false);
		// `run` must handle its own errors; a rejection here is a bug and is left
		// unhandled so it surfaces. `finally` still keeps the throttle unwedged.
		void this.run().finally(() => {
			this.running = false;
			// A reset mid-run: the old run's completion is not the new era's cooldown.
			if (gen === this.gen) this.lastDoneAt = this.time.now();
			if (this.again) this.poke(this.againUrgent);
		});
	}
}
