/**
 * Persistence tests for crdt-op-queue.ts.
 *
 * Mirrors the offline-queue persistence pattern: a debounced persist coalesces
 * rapid mutations into one write, `load()` restores pending ops on startup
 * (pruning TTL-expired ops and honoring `maxQueue`), and `dispose()` cancels the
 * pending persist timer on unload.
 *
 * Uses `jest.useFakeTimers()` for the debounce (window.setTimeout), matching
 * how offline-queue.test.ts exercises its debounced persist.
 */
import { describe, expect, jest, mock, test } from "bun:test";
import {
	type CrdtOp,
	CrdtOpQueue,
	type CrdtOpQueueOptions,
	type DropReason,
	type SendResult,
} from "../src/crdt-op-queue";

function makeOp(docId: string, kind: CrdtOp["kind"], overrides: Partial<CrdtOp> = {}): CrdtOp {
	return {
		id: `${docId}:${kind}:${overrides.enqueuedAt ?? 0}`,
		kind,
		docId,
		payload: overrides.payload ?? `payload-${docId}`,
		enqueuedAt: overrides.enqueuedAt ?? 0,
		attempts: 0,
		...overrides,
	};
}

function scriptedSend(results: SendResult[] = []) {
	const calls: CrdtOp[] = [];
	let i = 0;
	const fn = mock(async (op: CrdtOp): Promise<SendResult> => {
		calls.push(op);
		return results[i++] ?? "ok";
	});
	return { fn, calls };
}

function makeQueue(opts: {
	send: (op: CrdtOp) => Promise<SendResult>;
	now: () => number;
	onDrop?: (op: CrdtOp, reason: DropReason) => void;
	options?: Partial<CrdtOpQueueOptions>;
	persistDelayMs?: number;
}) {
	return new CrdtOpQueue(opts);
}

// ---------------------------------------------------------------------------
// (a) Mutations schedule a single debounced persist
// ---------------------------------------------------------------------------

describe("debounced persist", () => {
	test("rapid enqueues coalesce into one persist with all pending ops", async () => {
		jest.useFakeTimers();
		try {
			const { fn } = scriptedSend();
			const persist = mock(async (_ops: CrdtOp[]) => {});
			const q = makeQueue({ send: fn, now: () => 0, persistDelayMs: 500 });
			q.setPersist(persist);

			q.enqueue(makeOp("a", "create"));
			q.enqueue(makeOp("b", "create"));
			q.enqueue(makeOp("c", "delete"));
			expect(persist).not.toHaveBeenCalled();

			jest.advanceTimersByTime(500);
			await Promise.resolve();

			expect(persist).toHaveBeenCalledTimes(1);
			const ops = persist.mock.calls[0][0];
			expect(ops.map((o) => o.docId).sort()).toEqual(["a", "b", "c"]);
		} finally {
			jest.useRealTimers();
		}
	});

	test("no persist callback is safe", () => {
		jest.useFakeTimers();
		try {
			const { fn } = scriptedSend();
			const q = makeQueue({ send: fn, now: () => 0, persistDelayMs: 500 });
			q.enqueue(makeOp("a", "create"));
			jest.advanceTimersByTime(500); // must not throw
		} finally {
			jest.useRealTimers();
		}
	});
});

// ---------------------------------------------------------------------------
// (b) load restores pending ops; they flush on onJoined
// ---------------------------------------------------------------------------

describe("load restores pending ops", () => {
	test("loaded ops flush on onJoined", async () => {
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: () => 0 });

		q.load([
			makeOp("a", "create", { enqueuedAt: 0 }),
			makeOp("b", "delete", { enqueuedAt: 0 }),
		]);
		expect(q.size()).toBe(2);
		expect(calls.length).toBe(0); // held until join

		await q.onJoined();
		expect(calls.map((o) => o.docId).sort()).toEqual(["a", "b"]);
		expect(q.size()).toBe(0);
	});

	test("loaded op is retried immediately (attempts/nextAttemptAt reset)", async () => {
		// Persisted op carried a large attempts count; load must reset it so the
		// op is not instantly dropped and is due immediately.
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: () => 5000, options: { maxAttempts: 4 } });

		q.load([makeOp("a", "msg", { enqueuedAt: 4900, attempts: 99 })]);
		await q.onJoined();

		expect(calls.length).toBe(1); // sent, not dropped as max-attempts
		expect(calls[0].attempts).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// (c) TTL prune on load
// ---------------------------------------------------------------------------

describe("TTL prune on load", () => {
	test("op older than opTtlMs is dropped, not restored (onDrop ttl)", async () => {
		const drops: Array<{ docId: string; reason: DropReason }> = [];
		const { fn, calls } = scriptedSend();
		const q = makeQueue({
			send: fn,
			now: () => 2000,
			onDrop: (op, reason) => drops.push({ docId: op.docId, reason }),
			options: { opTtlMs: 1000 },
		});

		q.load([
			makeOp("stale", "msg", { enqueuedAt: 500 }), // age 1500 > 1000 -> drop
			makeOp("fresh", "msg", { enqueuedAt: 1500 }), // age 500 -> keep
		]);

		expect(q.size()).toBe(1);
		expect(drops).toEqual([{ docId: "stale", reason: "ttl" }]);

		await q.onJoined();
		expect(calls.map((o) => o.docId)).toEqual(["fresh"]);
	});
});

// ---------------------------------------------------------------------------
// (d) load respects maxQueue
// ---------------------------------------------------------------------------

describe("load respects maxQueue", () => {
	test("never restores more than maxQueue ops", () => {
		const { fn } = scriptedSend();
		const q = makeQueue({ send: fn, now: () => 0, options: { maxQueue: 2 } });

		q.load([
			makeOp("a", "msg", { enqueuedAt: 0 }),
			makeOp("b", "msg", { enqueuedAt: 0 }),
			makeOp("c", "msg", { enqueuedAt: 0 }),
		]);

		expect(q.size()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// dispose cancels the pending persist timer
// ---------------------------------------------------------------------------

describe("dispose", () => {
	test("cancels pending debounced persist", async () => {
		jest.useFakeTimers();
		try {
			const { fn } = scriptedSend();
			const persist = mock(async (_ops: CrdtOp[]) => {});
			const q = makeQueue({ send: fn, now: () => 0, persistDelayMs: 500 });
			q.setPersist(persist);

			q.enqueue(makeOp("a", "create"));
			q.dispose();

			jest.advanceTimersByTime(1000);
			await Promise.resolve();
			expect(persist).not.toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
	});
});
