import { expBackoff } from "./backoff";
/**
 * CRDT outbound op queue: a durable, bounded, in-memory hold-and-retry buffer
 * for CRDT socket ops (create / delete / msg).
 *
 * Ops enqueued while the channel is not joined are HELD; nothing is sent until
 * `onJoined()` fires. Sends are retried with exponential backoff on failure,
 * coalesced per docId (one pending op per docId, newest supersedes older),
 * bounded in count, and dropped once they age past a TTL.
 *
 * Pure logic: all side-effecting deps (send, clock, drop-notify) are injected,
 * and retries are driven off the injected clock via `tick()`. No real timers,
 * no real sockets, fully deterministic under test.
 *
 * Persistence (mirrors `offline-queue.ts`): register `setPersist(fn)` and every
 * mutation (enqueue / ack-delete / drop) schedules a debounced write of the flat
 * pending `CrdtOp[]`. `load(ops)` restores them on startup — pruning any op past
 * `opTtlMs` (never resurrect stale ops after a long downtime) and honoring
 * `maxQueue`. `dispose()` cancels the pending timer on unload.
 */

/** One outbound CRDT op. `attempts` counts failed send attempts so far. */
export type CrdtOp = {
	id: string;
	kind: "create" | "delete" | "msg";
	docId: string;
	payload: unknown;
	enqueuedAt: number;
	attempts: number;
};

/** Why an op was dropped without being acked. */
export type DropReason = "ttl" | "overflow" | "max-attempts";

/** Result of an outbound send attempt. */
export type SendResult = "ok" | "error" | "timeout";

/** Max distinct pending docId ops. Bounds memory across long offline spells;
 *  overflow drops the oldest pending op rather than growing unbounded. */
export const MAX_QUEUE = 500;

/** Ops older than this (by `enqueuedAt`) are stale and dropped, never sent.
 *  A CRDT op held 5 min past creation is better dropped than delivered late,
 *  the peer reconverges via full sync, so a late op only causes churn. */
export const OP_TTL_MS = 5 * 60 * 1000;

/** Give up (drop + notify) after this many failed send attempts. */
export const MAX_ATTEMPTS = 8;

/** First retry delay; each subsequent retry doubles it up to MAX_BACKOFF_MS. */
export const BASE_BACKOFF_MS = 500;

/** Ceiling on retry backoff so a persistently-failing op still gets retried
 *  roughly twice a minute rather than backing off into hours. */
export const MAX_BACKOFF_MS = 30_000;

export type CrdtOpQueueOptions = {
	maxQueue: number;
	opTtlMs: number;
	maxAttempts: number;
	baseBackoffMs: number;
	maxBackoffMs: number;
};

export type CrdtOpQueueDeps = {
	send: (op: CrdtOp) => Promise<SendResult>;
	now: () => number;
	onDrop?: (op: CrdtOp, reason: DropReason) => void;
	options?: Partial<CrdtOpQueueOptions>;
	/** Debounce window for persist writes, coalescing rapid mutations. */
	persistDelayMs?: number;
};

/** Default persist debounce (matches OfflineQueue). */
export const PERSIST_DELAY_MS = 1000;

const DEFAULT_OPTIONS: CrdtOpQueueOptions = {
	maxQueue: MAX_QUEUE,
	opTtlMs: OP_TTL_MS,
	maxAttempts: MAX_ATTEMPTS,
	baseBackoffMs: BASE_BACKOFF_MS,
	maxBackoffMs: MAX_BACKOFF_MS,
};

/** Internal record: the op plus the clock time at which it may next be sent. */
type Entry = { op: CrdtOp; nextAttemptAt: number };

export class CrdtOpQueue {
	/** Keyed by docId → at most one pending op per doc (newest supersedes). */
	private entries: Map<string, Entry> = new Map();
	private joined = false;
	/** Re-entrancy guard so overlapping flush/tick calls don't double-send. */
	private flushing = false;

	private readonly send: (op: CrdtOp) => Promise<SendResult>;
	private readonly now: () => number;
	private readonly onDrop?: (op: CrdtOp, reason: DropReason) => void;
	private readonly opts: CrdtOpQueueOptions;

	private persistFn: ((ops: CrdtOp[]) => Promise<void> | void) | null = null;
	private persistTimer: number | null = null;
	private readonly persistDelayMs: number;

	constructor(deps: CrdtOpQueueDeps) {
		this.send = deps.send;
		this.now = deps.now;
		this.onDrop = deps.onDrop;
		this.opts = { ...DEFAULT_OPTIONS, ...deps.options };
		this.persistDelayMs = deps.persistDelayMs ?? PERSIST_DELAY_MS;
	}

	/** Number of distinct pending ops (docIds). */
	size(): number {
		return this.entries.size;
	}

	/** Flat snapshot of pending ops (mirrors OfflineQueue.all()), for the
	 *  wholesale savePluginData blob. Every save must re-list it or the next
	 *  write wipes it. */
	all(): CrdtOp[] {
		return this.pending();
	}

	/** Register a callback to persist the flat pending op list. */
	setPersist(fn: (ops: CrdtOp[]) => Promise<void> | void): void {
		this.persistFn = fn;
	}

	/**
	 * Restore persisted ops on startup. Prunes any op already past `opTtlMs`
	 * (fires onDrop "ttl") so a long downtime never resurrects stale ops, and
	 * never restores more than `maxQueue` (oldest-first, dropping the excess).
	 * `attempts`/`nextAttemptAt` are transient scheduling state and are reset:
	 * a reloaded op gets a fresh retry budget and is due immediately.
	 */
	load(ops: CrdtOp[]): void {
		this.entries.clear();
		const now = this.now();
		for (const op of ops) {
			if (now - op.enqueuedAt > this.opts.opTtlMs) {
				this.onDrop?.(op, "ttl");
				continue;
			}
			if (this.entries.size >= this.opts.maxQueue) this.evictOldest();
			this.entries.set(op.docId, { op: { ...op, attempts: 0 }, nextAttemptAt: 0 });
		}
	}

	/** Drop every pending op and persist the empty queue.
	 *
	 *  A queued op carries a bare `docId` and NO vault (see CrdtOp), so it is
	 *  delivered blind on whatever crdt: topic is joined when it finally flushes.
	 *  Across a vault change that means the PREVIOUS vault's note ids arriving on
	 *  the NEW vault's channel, where the server cannot place them -- the client
	 *  half of the cross-vault id-collision class (engram #1318). The ops are per-
	 *  vault state, exactly like the note-id map and the relocation timestamps
	 *  that SyncEngine.wipePerVaultState already drops, so they are dropped in
	 *  lockstep with those.
	 *
	 *  Dropping is safe, not lossy: switching vaults clears `lastSync`, so the
	 *  next full sync against the old vault re-derives and re-pushes anything
	 *  these ops carried. */
	clear(): void {
		if (this.entries.size === 0) return;
		this.entries.clear();
		this.schedulePersist();
	}

	/** Cancel any pending persist timer. Call on plugin unload. */
	dispose(): void {
		if (this.persistTimer !== null) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
	}

	/**
	 * Add an op. Coalesced by docId: a newer op replaces any pending op for the
	 * same doc (delete supersedes create, latest msg wins). A brand-new docId
	 * beyond `maxQueue` evicts the oldest pending op (onDrop "overflow").
	 * Does not send until the channel is joined.
	 */
	enqueue(op: CrdtOp): void {
		const existing = this.entries.get(op.docId);
		if (existing) {
			// Supersede in place; Map keeps the original FIFO slot for this docId.
			this.entries.set(op.docId, { op, nextAttemptAt: 0 });
			this.schedulePersist();
			return;
		}
		if (this.entries.size >= this.opts.maxQueue) {
			this.evictOldest();
		}
		this.entries.set(op.docId, { op, nextAttemptAt: 0 });
		this.schedulePersist();
	}

	/** Channel joined: flush all held ops FIFO, retrying failures via backoff. */
	async onJoined(): Promise<void> {
		this.joined = true;
		await this.flush();
	}

	/**
	 * Drive retries: send every op that is due (nextAttemptAt <= now) and not
	 * TTL-expired. Call after advancing the clock. No-op until joined.
	 */
	async tick(): Promise<void> {
		await this.flush();
	}

	private evictOldest(): void {
		const first = this.entries.keys().next();
		if (first.done) return;
		const entry = this.entries.get(first.value);
		this.entries.delete(first.value);
		if (entry) this.onDrop?.(entry.op, "overflow");
		this.schedulePersist();
	}

	/** Drop and notify if the op has aged past its TTL. Returns true if dropped. */
	private dropIfExpired(docId: string, entry: Entry): boolean {
		if (this.now() - entry.op.enqueuedAt <= this.opts.opTtlMs) return false;
		this.entries.delete(docId);
		this.onDrop?.(entry.op, "ttl");
		this.schedulePersist();
		return true;
	}

	/** Flat snapshot of pending ops, for persistence. */
	private pending(): CrdtOp[] {
		return [...this.entries.values()].map((e) => e.op);
	}

	/** Debounced persist: coalesces rapid mutations into one write. */
	private schedulePersist(): void {
		if (!this.persistFn || this.persistTimer !== null) return;
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			void this.persistFn?.(this.pending());
		}, this.persistDelayMs);
	}

	private backoffFor(attempts: number): number {
		// attempts = number of failures so far (>=1): base, base*2, base*4, ...
		return expBackoff(this.opts.baseBackoffMs, attempts - 1, this.opts.maxBackoffMs);
	}

	private async flush(): Promise<void> {
		if (!this.joined || this.flushing) return;
		this.flushing = true;
		try {
			// Snapshot keys so eviction/supersede during iteration is safe.
			for (const docId of [...this.entries.keys()]) {
				const entry = this.entries.get(docId);
				if (!entry) continue;
				if (this.dropIfExpired(docId, entry)) continue;
				if (entry.nextAttemptAt > this.now()) continue;
				await this.attempt(docId, entry);
			}
		} finally {
			this.flushing = false;
		}
	}

	private async attempt(docId: string, entry: Entry): Promise<void> {
		const result = await this.send(entry.op);
		// The op may have been superseded/evicted while send was in flight;
		// only act on it if this exact entry is still the pending one.
		if (this.entries.get(docId) !== entry) return;

		if (result === "ok") {
			this.entries.delete(docId);
			this.schedulePersist();
			return;
		}
		entry.op.attempts += 1;
		if (entry.op.attempts >= this.opts.maxAttempts) {
			this.entries.delete(docId);
			this.onDrop?.(entry.op, "max-attempts");
			this.schedulePersist();
			return;
		}
		entry.nextAttemptAt = this.now() + this.backoffFor(entry.op.attempts);
	}
}
