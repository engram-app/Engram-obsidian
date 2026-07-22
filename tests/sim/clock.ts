// tests/sim/clock.ts
/** Deterministic virtual clock for the convergence sim. Owns every timer the
 * engine schedules via window.setTimeout — the sim decides firing order, so a
 * run is a pure function of its seed. No wall time anywhere.
 *
 * Step 5 grep findings (`grep -n "Date.now()\|performance.now()" src/sync.ts
 * src/crdt/*.ts src/channel.ts | grep -v log`):
 *   - src/crdt/uuid7.ts:15 — Date.now() seeds the UUIDv7 timestamp bits.
 *     LOGGING-adjacent (id generation, not a timer decision); not patched.
 *   - src/sync.ts:515-538 (manifestOwnerOf) — `age = Date.now() -
 *     manifestOwnersFetchedAt` gates a TTL freshness check that decides
 *     whether to refetch. SCHEDULING-relevant.
 *   - src/sync.ts:1663-1673 (scheduleSeqHeal) — `since = now -
 *     seqHealLastAt` decides immediate-fire vs throttled trailing
 *     window.setTimeout. SCHEDULING-relevant.
 *   - src/sync.ts:2078/2174/2347/2889/2932/5777/5925-5926/6046/6708/6847 and
 *     src/channel.ts:598/651/989/1017 — all `timestamp`/`firstFailedAt`/
 *     `lastFailedAt`/`openedAt`/`sinceOpen` stamps recorded onto issue
 *     records or log lines for display. LOGGING only — read back for
 *     display, never branched on to decide what fires next.
 *   - src/channel.ts reconnect backoff (`reconnectMs`, doubled per attempt)
 *     does NOT read Date.now() at all — it's driven purely by
 *     window.setTimeout delays, so install() patching setTimeout already
 *     covers it.
 *
 * Verdict: install() also patches Date.now so the two scheduling-relevant
 * sites above see virtual time.
 */
type Entry = { id: number; deadline: number; seq: number; fn: () => void; every?: number };

export class SimClock {
	private t = 0;
	private nextId = 1;
	private seq = 0;
	private entries = new Map<number, Entry>();

	now(): number {
		return this.t;
	}
	pendingCount(): number {
		return this.entries.size;
	}

	setTimeout(fn: () => void, ms: number): number {
		const id = this.nextId++;
		this.entries.set(id, { id, deadline: this.t + Math.max(0, ms), seq: this.seq++, fn });
		return id;
	}
	clearTimeout(id: number): void {
		this.entries.delete(id);
	}
	setInterval(fn: () => void, ms: number): number {
		const id = this.nextId++;
		this.entries.set(id, {
			id,
			deadline: this.t + Math.max(1, ms),
			seq: this.seq++,
			fn,
			every: Math.max(1, ms),
		});
		return id;
	}
	clearInterval(id: number): void {
		this.entries.delete(id);
	}

	/** Fire the earliest-deadline timer (ties: registration order). */
	fireNext(): boolean {
		let best: Entry | undefined;
		for (const e of this.entries.values())
			if (
				!best ||
				e.deadline < best.deadline ||
				(e.deadline === best.deadline && e.seq < best.seq)
			)
				best = e;
		if (!best) return false;
		this.t = Math.max(this.t, best.deadline);
		if (best.every) {
			best.deadline = this.t + best.every;
			best.seq = this.seq++;
		} else this.entries.delete(best.id);
		best.fn();
		return true;
	}
	advanceTo(t: number): void {
		while (true) {
			let e: Entry | undefined;
			for (const x of this.entries.values())
				if (
					x.deadline <= t &&
					(!e || x.deadline < e.deadline || (x.deadline === e.deadline && x.seq < e.seq))
				)
					e = x;
			if (!e) break;
			this.fireNext();
		}
		this.t = Math.max(this.t, t);
	}

	install(target: any = globalThis.window ?? globalThis): () => void {
		const saved = {
			st: target.setTimeout,
			ct: target.clearTimeout,
			si: target.setInterval,
			ci: target.clearInterval,
		};
		const savedDateNow = Date.now;
		target.setTimeout = (fn: () => void, ms = 0) => this.setTimeout(fn, ms);
		target.clearTimeout = (id: number) => this.clearTimeout(id);
		target.setInterval = (fn: () => void, ms = 0) => this.setInterval(fn, ms);
		target.clearInterval = (id: number) => this.clearInterval(id);
		Date.now = () => this.now();
		return () => {
			target.setTimeout = saved.st;
			target.clearTimeout = saved.ct;
			target.setInterval = saved.si;
			target.clearInterval = saved.ci;
			Date.now = savedDateNow;
		};
	}
}
