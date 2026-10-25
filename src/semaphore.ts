/** A counting semaphore: at most `max` holders at once, waiters woken FIFO.
 *  Shared by the push slots and the bulk revive's room-free doc reads, which
 *  had (or would have had) their own hand-rolled counter + waiter list. */
export class Semaphore {
	active = 0;
	private readonly waiters: (() => void)[] = [];

	constructor(public max: number) {}

	async acquire(): Promise<void> {
		if (this.active < this.max) {
			this.active++;
			return;
		}
		await new Promise<void>((resolve) => this.waiters.push(resolve));
		this.active++;
	}

	release(): void {
		this.active--;
		this.waiters.shift()?.();
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
