import type { TimeProvider } from "./time-provider";

/** One FIFO queue per key: `run(key, fn)` starts `fn` only after every earlier
 *  `run` for the same key has settled. Different keys never wait on each
 *  other. A rejection is the caller's; it does not stall the queue.
 *
 *  The QUEUE is bounded, the task is not: a task still running after
 *  `stallMs` keeps running (it cannot be cancelled), but the next one for its
 *  key stops waiting on it, so one hung apply cannot stop that key for the
 *  rest of the session. */
export class KeyedSerial {
	private readonly tails = new Map<string, Promise<void>>();

	constructor(
		private readonly time: Pick<TimeProvider, "setTimeout" | "clearTimeout">,
		private readonly stallMs: number,
		private readonly onStall: (key: string) => void = () => {},
	) {}

	run<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.tails.get(key) ?? Promise.resolve();
		const result = prev.then(fn);
		// The stall clock starts when the task does, not while it waits its turn.
		const tail = prev.then(
			() =>
				new Promise<void>((resolve) => {
					let settled = false;
					const timer = this.time.setTimeout(() => {
						if (settled) return;
						settled = true;
						this.onStall(key);
						resolve();
					}, this.stallMs);
					const release = () => {
						if (settled) return;
						settled = true;
						this.time.clearTimeout(timer);
						resolve();
					};
					result.then(release, release);
				}),
		);
		this.tails.set(key, tail);
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return result;
	}

	/** Forget every queue (vault switch): a task from the old vault must not
	 *  delay the new one's. Running tasks finish on their own. */
	clear(): void {
		this.tails.clear();
	}
}
