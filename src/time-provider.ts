/**
 * Injectable clock + timers.
 *
 * Ported from Relay (`src/TimeProvider.ts`). Our correctness depends on
 * wall-clock windows — the ~60s recentlyDeleted cooldown, the echo-suppression
 * window, heal cooldowns — and every one of them is driven by a raw
 * `window.setTimeout`. That makes them untestable except by waiting, which is
 * how timing-shaped flake gets into the e2e suite: the only way to assert "the
 * window expired" is to sleep through it.
 *
 * With the clock injected, a test advances time instead of spending it.
 */

export interface TimeProvider {
	now(): number;
	setTimeout(callback: () => void, ms: number): number;
	clearTimeout(id: number): void;
	setInterval(callback: () => void, ms: number): number;
	clearInterval(id: number): void;
	/** Cancel every timer this provider handed out (plugin unload). */
	destroy(): void;
}

export class DefaultTimeProvider implements TimeProvider {
	private readonly timeouts = new Set<number>();
	private readonly intervals = new Set<number>();

	now(): number {
		return Date.now();
	}

	setTimeout(callback: () => void, ms: number): number {
		const id = window.setTimeout(() => {
			this.timeouts.delete(id);
			callback();
		}, ms);
		this.timeouts.add(id);
		return id;
	}

	clearTimeout(id: number): void {
		this.timeouts.delete(id);
		window.clearTimeout(id);
	}

	setInterval(callback: () => void, ms: number): number {
		const id = window.setInterval(callback, ms);
		this.intervals.add(id);
		return id;
	}

	clearInterval(id: number): void {
		this.intervals.delete(id);
		window.clearInterval(id);
	}

	destroy(): void {
		for (const id of this.timeouts) window.clearTimeout(id);
		for (const id of this.intervals) window.clearInterval(id);
		this.timeouts.clear();
		this.intervals.clear();
	}
}

/** Test double: time only moves when you move it. Exported from src (not tests)
 *  so the e2e harness can drive plugin-side windows deterministically too. */
export class ManualTimeProvider implements TimeProvider {
	private current: number;
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ due: number; callback: () => void; every: number | null }
	>();

	constructor(start = 0) {
		this.current = start;
	}

	now(): number {
		return this.current;
	}

	setTimeout(callback: () => void, ms: number): number {
		const id = this.nextId++;
		this.pending.set(id, { due: this.current + ms, callback, every: null });
		return id;
	}

	clearTimeout(id: number): void {
		this.pending.delete(id);
	}

	setInterval(callback: () => void, ms: number): number {
		const id = this.nextId++;
		this.pending.set(id, { due: this.current + ms, callback, every: ms });
		return id;
	}

	clearInterval(id: number): void {
		this.pending.delete(id);
	}

	/** Advance the clock, firing everything that comes due in timestamp order.
	 *  Callbacks scheduling further work inside the advanced window still fire. */
	advance(ms: number): void {
		const target = this.current + ms;
		for (;;) {
			let nextId: number | null = null;
			let nextDue = Number.POSITIVE_INFINITY;
			for (const [id, t] of this.pending) {
				if (t.due <= target && t.due < nextDue) {
					nextDue = t.due;
					nextId = id;
				}
			}
			if (nextId === null) break;
			const timer = this.pending.get(nextId);
			if (!timer) break;
			this.current = timer.due;
			if (timer.every === null) this.pending.delete(nextId);
			else timer.due = this.current + timer.every;
			timer.callback();
		}
		this.current = target;
	}

	get pendingCount(): number {
		return this.pending.size;
	}

	destroy(): void {
		this.pending.clear();
	}
}
