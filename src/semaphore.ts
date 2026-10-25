/** A counting semaphore: at most `max` holders at once, waiters woken FIFO.
 *  Shared by the push slots and the bulk revive's room-free doc reads, which
 *  had (or would have had) their own hand-rolled counter + waiter list. */
export class Semaphore {
	active = 0;
	private readonly waiters: (() => void)[] = [];

	constructor(public max: number) {}

	/** Take a slot now if one is free; never waits. */
	tryAcquire(): boolean {
		if (this.active >= this.max) return false;
		this.active++;
		return true;
	}

	async acquire(): Promise<void> {
		if (this.active < this.max) {
			this.active++;
			return;
		}
		// The releaser hands its slot straight over (see `release`), so there is
		// no gap in which a `tryAcquire` or a fresh `acquire` could take it too.
		await new Promise<void>((resolve) => this.waiters.push(resolve));
	}

	release(): void {
		const next = this.waiters.shift();
		if (next) next();
		else this.active--;
	}

	/** Run `fn` holding a slot; the slot is released however `fn` settles. */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}
}
