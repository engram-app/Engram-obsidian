/** One FIFO queue per key: `run(key, fn)` starts `fn` only after every earlier
 *  `run` for the same key has settled. Different keys never wait on each
 *  other. A rejection is the caller's; it does not stall the queue. */
export class KeyedSerial {
	private readonly tails = new Map<string, Promise<void>>();

	run<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.tails.get(key) ?? Promise.resolve();
		const result = prev.then(fn);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(key, tail);
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return result;
	}
}
