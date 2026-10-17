import { errMsg } from "./error-util";
import { rlog } from "./remote-log";
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
 *  `floorMs` is never skipped, urgent or not: callers put their failure
 *  backoff there, so urgency skips only the success cooldown.
 *
 *  A run that resolves `false` did nothing (no work was pending): it stamps
 *  no cooldown, so the next poke is not throttled by a run that never happened.
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
		private readonly run: () => Promise<boolean | void>,
		private readonly floorMs: () => number = () => 0,
	) {}

	poke(urgent = false): void {
		if (this.running) {
			this.again = true;
			this.againUrgent ||= urgent;
			return;
		}
		const now = this.time.now();
		const due = Math.max(
			urgent && !this.lastWasUrgent ? now : this.lastDoneAt + this.gapMs(urgent),
			this.lastDoneAt + this.floorMs(),
		);
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
		const urgent = this.time.now() < this.lastDoneAt + this.gapMs(false);
		let didWork = true;
		void this.run()
			.then(
				(r) => {
					didWork = r !== false;
				},
				// `run` should handle its own errors; one that escapes is logged
				// (a throw counts as work done) and the bookkeeping still runs.
				(e) => rlog().warn("sync", `throttled run failed: ${errMsg(e)}`),
			)
			.finally(() => {
				this.running = false;
				// A reset mid-run: the old run's completion is not the new era's cooldown.
				if (gen === this.gen && didWork) {
					this.lastDoneAt = this.time.now();
					this.lastWasUrgent = urgent;
				}
				if (this.again) this.poke(this.againUrgent);
			});
	}
}
