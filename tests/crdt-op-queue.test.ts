/**
 * Tests for crdt-op-queue.ts: a durable outbound CRDT op queue.
 *
 * All deterministic: `send` is a scripted mock, `now` is a mutable fake clock,
 * retries are driven by an explicit `tick()`. No real sockets, no real timers.
 *
 * Covers:
 *  1. enqueue-while-not-joined holds (nothing sent until onJoined)
 *  2. onJoined flushes held ops FIFO
 *  3. "ok" ack removes the op
 *  4. "error"/"timeout" retries with exponential backoff; drop after maxAttempts
 *  5. terminal-op dedup/supersede by docId; msg coalesced to latest payload
 *  6. bounded size: overflow drops the oldest pending op (onDrop "overflow")
 *  7. strict TTL: op aged past opTtlMs is dropped, never sent (onDrop "ttl")
 */
import { describe, expect, mock, test } from "bun:test";
import {
	BASE_BACKOFF_MS,
	type CrdtOp,
	CrdtOpQueue,
	type CrdtOpQueueOptions,
	type DropReason,
	MAX_BACKOFF_MS,
	makeDropReporter,
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

/** A mutable fake clock. */
function fakeClock(start = 0) {
	let t = start;
	return {
		now: () => t,
		advance: (ms: number) => {
			t += ms;
		},
		set: (ms: number) => {
			t = ms;
		},
	};
}

/** A send mock that returns scripted results (defaults to "ok" when exhausted). */
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
}) {
	return new CrdtOpQueue(opts);
}

// ---------------------------------------------------------------------------
// 1. Enqueue while not joined holds
// ---------------------------------------------------------------------------

describe("enqueue while not joined", () => {
	test("does not send until onJoined", async () => {
		const clock = fakeClock();
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: clock.now });

		q.enqueue(makeOp("a", "create"));
		q.enqueue(makeOp("b", "create"));
		await q.tick(); // tick before join must not flush

		expect(calls.length).toBe(0);
		expect(q.size()).toBe(2);

		await q.onJoined();
		expect(calls.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 2. Flush FIFO
// ---------------------------------------------------------------------------

describe("onJoined flush", () => {
	test("sends held ops in FIFO order", async () => {
		const clock = fakeClock();
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: clock.now });

		q.enqueue(makeOp("a", "create"));
		q.enqueue(makeOp("b", "msg"));
		q.enqueue(makeOp("c", "delete"));
		await q.onJoined();

		expect(calls.map((o) => o.docId)).toEqual(["a", "b", "c"]);
	});
});

// ---------------------------------------------------------------------------
// 3. Ack removes
// ---------------------------------------------------------------------------

describe("ack", () => {
	test('"ok" removes the op and is not retried', async () => {
		const clock = fakeClock();
		const { fn, calls } = scriptedSend(["ok"]);
		const q = makeQueue({ send: fn, now: clock.now });

		q.enqueue(makeOp("a", "create"));
		await q.onJoined();
		expect(q.size()).toBe(0);

		clock.advance(MAX_BACKOFF_MS * 2);
		await q.tick();
		expect(calls.length).toBe(1); // no retry after ack
	});
});

// ---------------------------------------------------------------------------
// 4. Retry with exponential backoff, drop after maxAttempts
// ---------------------------------------------------------------------------

describe("retry with backoff", () => {
	test("keeps op on error/timeout and retries with exponential backoff", async () => {
		const clock = fakeClock(1000);
		// always fail
		const { fn, calls } = scriptedSend(["error", "timeout", "error", "timeout", "error"]);
		const drops: DropReason[] = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (_op, r) => drops.push(r),
			options: { maxAttempts: 4 },
		});

		q.enqueue(makeOp("a", "msg", { enqueuedAt: 1000 }));
		await q.onJoined(); // attempt 1 -> "error"
		expect(calls.length).toBe(1);
		expect(q.size()).toBe(1);

		// Not due yet: nextAttemptAt = 1000 + BASE (500)
		clock.advance(BASE_BACKOFF_MS - 1);
		await q.tick();
		expect(calls.length).toBe(1);

		// Now due: attempt 2 -> "timeout"; next backoff = BASE*2
		clock.advance(1);
		await q.tick();
		expect(calls.length).toBe(2);

		// Backoff doubled: BASE*2 window
		clock.advance(BASE_BACKOFF_MS * 2 - 1);
		await q.tick();
		expect(calls.length).toBe(2);
		clock.advance(1);
		await q.tick(); // attempt 3 -> "error"; next backoff = BASE*4
		expect(calls.length).toBe(3);

		clock.advance(BASE_BACKOFF_MS * 4);
		await q.tick(); // attempt 4 -> "timeout" => maxAttempts reached, drop
		expect(calls.length).toBe(4);
		expect(q.size()).toBe(0);
		expect(drops).toEqual(["max-attempts"]);
	});

	test("backoff is capped at maxBackoffMs", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend(new Array(20).fill("error"));
		const q = makeQueue({
			send: fn,
			now: clock.now,
			options: {
				maxAttempts: 20,
				baseBackoffMs: 1000,
				maxBackoffMs: 4000,
				opTtlMs: Number.MAX_SAFE_INTEGER,
			},
		});

		q.enqueue(makeOp("a", "msg"));
		await q.onJoined(); // attempt1, next = 1000*2^0 = 1000

		// drive several retries; once delay hits the 4000 cap it stays there
		const step = () => {
			clock.advance(MAX_BACKOFF_MS); // over-advance so it's always due
			return q.tick();
		};
		for (let i = 0; i < 6; i++) await step();
		// 1 (join) + 6 ticks all fired since we always over-advance past cap
		expect(calls.length).toBe(7);
	});

	test("op not due is skipped (delay respected before cap)", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend(["error"]);
		const q = makeQueue({
			send: fn,
			now: clock.now,
			options: { baseBackoffMs: 1000, opTtlMs: Number.MAX_SAFE_INTEGER },
		});
		q.enqueue(makeOp("a", "msg"));
		await q.onJoined(); // next = 1000
		clock.advance(999);
		await q.tick();
		expect(calls.length).toBe(1); // still not due
	});
});

// ---------------------------------------------------------------------------
// 5. Terminal-op dedup / supersede by docId; msg coalescing
// ---------------------------------------------------------------------------

describe("dedup / supersede by docId", () => {
	test("delete supersedes a pending create; only delete is sent", async () => {
		const clock = fakeClock();
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: clock.now });

		q.enqueue(makeOp("a", "create"));
		q.enqueue(makeOp("a", "delete"));
		expect(q.size()).toBe(1);

		await q.onJoined();
		expect(calls.length).toBe(1);
		expect(calls[0].kind).toBe("delete");
	});

	test("msg ops coalesce to the latest payload", async () => {
		const clock = fakeClock();
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: clock.now });

		q.enqueue(makeOp("a", "msg", { payload: "v1" }));
		q.enqueue(makeOp("a", "msg", { payload: "v2" }));
		q.enqueue(makeOp("a", "msg", { payload: "v3" }));
		expect(q.size()).toBe(1);

		await q.onJoined();
		expect(calls.length).toBe(1);
		expect(calls[0].payload).toBe("v3");
	});

	test("supersede keeps the original FIFO slot", async () => {
		const clock = fakeClock();
		const { fn, calls } = scriptedSend();
		const q = makeQueue({ send: fn, now: clock.now });

		q.enqueue(makeOp("a", "create"));
		q.enqueue(makeOp("b", "create"));
		q.enqueue(makeOp("a", "delete")); // supersede a; must stay first
		await q.onJoined();

		expect(calls.map((o) => o.docId)).toEqual(["a", "b"]);
	});
});

// ---------------------------------------------------------------------------
// 6. Bounded size (overflow drops oldest)
// ---------------------------------------------------------------------------

describe("bounded size", () => {
	test("new docId beyond maxQueue drops the oldest pending op", async () => {
		const clock = fakeClock();
		const { fn } = scriptedSend();
		const drops: Array<{ docId: string; reason: DropReason }> = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (op, reason) => drops.push({ docId: op.docId, reason }),
			options: { maxQueue: 2 },
		});

		q.enqueue(makeOp("a", "msg"));
		q.enqueue(makeOp("b", "msg"));
		q.enqueue(makeOp("c", "msg")); // evicts "a"

		expect(q.size()).toBe(2);
		expect(drops).toEqual([{ docId: "a", reason: "overflow" }]);
	});

	test("superseding an existing docId does not trigger overflow", async () => {
		const clock = fakeClock();
		const { fn } = scriptedSend();
		const drops: DropReason[] = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (_op, r) => drops.push(r),
			options: { maxQueue: 2 },
		});

		q.enqueue(makeOp("a", "msg"));
		q.enqueue(makeOp("b", "msg"));
		q.enqueue(makeOp("a", "delete")); // supersede, not a new docId
		expect(q.size()).toBe(2);
		expect(drops).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 7. Strict TTL (dropped, never sent)
// ---------------------------------------------------------------------------

describe("strict TTL", () => {
	// The TTL counts only time the channel was JOINED (see "join state"
	// below): these used to age the op while never joined, which is exactly the
	// window that silently dropped a first sync's creates (2026-10-09). The op
	// now ages while joined but undeliverable (backing off), which is the case
	// the TTL exists for.
	test("op aged past TTL while joined-but-failing is dropped at flush, never resent", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend(["error"]);
		const drops: Array<{ docId: string; reason: DropReason }> = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (op, reason) => drops.push({ docId: op.docId, reason }),
			options: { opTtlMs: 1000, baseBackoffMs: 10 },
		});

		q.enqueue(makeOp("a", "msg", { enqueuedAt: 0 }));
		await q.onJoined(); // attempt 1 fails at t=0
		clock.set(1001); // age past TTL while joined
		await q.tick();

		expect(calls.length).toBe(1); // never resent
		expect(q.size()).toBe(0);
		expect(drops).toEqual([{ docId: "a", reason: "ttl" }]);
	});

	test("op within TTL is sent; a sibling past TTL is dropped", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend();
		const drops: Array<{ docId: string; reason: DropReason }> = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (op, reason) => drops.push({ docId: op.docId, reason }),
			options: { opTtlMs: 1000 },
		});

		await q.onJoined(); // joined at t=0, nothing held yet
		q.enqueue(makeOp("old", "msg", { enqueuedAt: 0 }));
		q.enqueue(makeOp("fresh", "msg", { enqueuedAt: 900 }));
		clock.set(1001); // old is 1001ms (expired), fresh is 101ms (alive)
		await q.tick();

		expect(calls.map((o) => o.docId)).toEqual(["fresh"]);
		expect(drops).toEqual([{ docId: "old", reason: "ttl" }]);
	});

	test("op expiring between retries is dropped, not sent late", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend(["error"]);
		const drops: DropReason[] = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (_op, r) => drops.push(r),
			options: { opTtlMs: 2000, baseBackoffMs: 500 },
		});

		q.enqueue(makeOp("a", "msg", { enqueuedAt: 0 }));
		await q.onJoined(); // attempt 1 -> error at t=0
		expect(calls.length).toBe(1);

		clock.set(2001); // now past TTL before the retry fires
		await q.tick();
		expect(calls.length).toBe(1); // NOT sent again
		expect(q.size()).toBe(0);
		expect(drops).toEqual(["ttl"]);
	});
});

// ---------------------------------------------------------------------------
// 8. vault-stamped ops: a foreign vault's op is dropped at send time
// ---------------------------------------------------------------------------

describe("vault-stamped ops", () => {
	test("an op for another vault is dropped before send, with an onDrop trail", async () => {
		// A CrdtOp used to carry no vault, so anything still queued at switch time
		// was delivered blind on the NEW vault's topic under the OLD vault's ids.
		// Checked at SEND rather than at switch time on purpose: the topic rejoin
		// flushes the queue before any switch-time hook runs.
		const clock = fakeClock();
		const { fn: send, calls } = scriptedSend();
		const drops: [CrdtOp, DropReason][] = [];
		const q = new CrdtOpQueue({
			send,
			now: clock.now,
			onDrop: (op, reason) => drops.push([op, reason]),
			currentVaultId: () => "vault-B",
		});

		q.enqueue(makeOp("doc-a", "create", { vaultId: "vault-A" }));
		await q.onJoined();

		expect(calls).toHaveLength(0);
		expect(drops.map(([op, reason]) => [op.docId, reason])).toEqual([
			["doc-a", "vault-changed"],
		]);
	});

	test("an op for the CURRENT vault still sends (deletes must survive a same-vault reset)", async () => {
		// A delete has no REST fallback: the tombstone lives only here. Dropping
		// the whole outbox on any vault-state reset resurrected deleted notes.
		const clock = fakeClock();
		const { fn: send, calls } = scriptedSend();
		const q = new CrdtOpQueue({
			send,
			now: clock.now,
			currentVaultId: () => "vault-B",
		});

		q.enqueue(makeOp("doc-b", "delete", { vaultId: "vault-B" }));
		await q.onJoined();

		expect(calls.map((o) => o.docId)).toEqual(["doc-b"]);
	});

	test("an op persisted before vault stamping (no vaultId) still sends", async () => {
		const clock = fakeClock();
		const { fn: send, calls } = scriptedSend();
		const q = new CrdtOpQueue({
			send,
			now: clock.now,
			currentVaultId: () => "vault-B",
		});

		q.enqueue(makeOp("doc-legacy", "create"));
		await q.onJoined();

		expect(calls.map((o) => o.docId)).toEqual(["doc-legacy"]);
	});
});

// ---------------------------------------------------------------------------
// 9. Join state is tracked for real (2026-10-09 first-sync incident)
//
// `joined` used to be set once and never reset, so during a disconnect every
// tick failed instantly and burned an attempt, and the TTL kept running while
// nothing could possibly be delivered: about a minute of outage could drop the
// whole outbox. Neither budget may be spent while the channel is down.
// ---------------------------------------------------------------------------

describe("join state (flapping channel)", () => {
	test("ticks while left send nothing, burn no attempts, and drop nothing", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend(["error"]);
		const drops: DropReason[] = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (_op, r) => drops.push(r),
			options: { maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 10 },
		});

		q.enqueue(makeOp("a", "create"));
		await q.onJoined(); // attempt 1 fails
		q.onLeft();
		for (let i = 0; i < 20; i++) {
			clock.advance(1000);
			await q.tick();
		}
		expect(calls.length).toBe(1);
		expect(drops).toEqual([]);
		expect(q.size()).toBe(1);

		await q.onJoined();
		expect(calls.length).toBe(2);
		expect(q.size()).toBe(0);
	});

	test("TTL does not run while the channel is down", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend(["error"]);
		const drops: DropReason[] = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (_op, r) => drops.push(r),
			options: { opTtlMs: 1000, baseBackoffMs: 10 },
		});

		q.enqueue(makeOp("a", "create", { enqueuedAt: 0 }));
		await q.onJoined(); // fails at t=0
		clock.set(100);
		q.onLeft();
		clock.set(10 * 60_000); // ten minutes offline, far past the TTL
		await q.onJoined();

		expect(drops).toEqual([]);
		expect(calls.length).toBe(2);
		expect(q.size()).toBe(0);
	});

	test("time held before the FIRST join does not count against the TTL", async () => {
		const clock = fakeClock(0);
		const { fn, calls } = scriptedSend();
		const drops: DropReason[] = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (_op, r) => drops.push(r),
			options: { opTtlMs: 1000 },
		});

		q.enqueue(makeOp("a", "create", { enqueuedAt: 0 }));
		clock.set(5000);
		await q.onJoined();

		expect(drops).toEqual([]);
		expect(calls.map((o) => o.docId)).toEqual(["a"]);
	});

	test("a leave mid-flush stops the pass; the failed in-flight send costs no attempt", async () => {
		const clock = fakeClock(0);
		let q!: CrdtOpQueue;
		const sent: string[] = [];
		const send = async (op: CrdtOp): Promise<SendResult> => {
			sent.push(op.docId);
			if (op.docId === "b" && sent.length === 2) {
				q.onLeft(); // the socket drops while b's first send is in flight
				return "error";
			}
			return "ok";
		};
		q = makeQueue({ send, now: clock.now, options: { maxAttempts: 1 } });
		for (const id of ["a", "b", "c"]) q.enqueue(makeOp(id, "create"));

		await q.onJoined();
		expect(sent).toEqual(["a", "b"]); // c was not attempted against a dead socket
		expect(q.size()).toBe(2);
		expect(q.all().find((o) => o.docId === "b")?.attempts).toBe(0);

		await q.onJoined();
		expect(sent).toEqual(["a", "b", "b", "c"]);
		expect(q.size()).toBe(0);
	});

	test("overflow evicts a create (the sweep re-pushes it) before a delete (no fallback)", async () => {
		const clock = fakeClock();
		const { fn } = scriptedSend();
		const drops: Array<{ docId: string; reason: DropReason }> = [];
		const q = makeQueue({
			send: fn,
			now: clock.now,
			onDrop: (op, reason) => drops.push({ docId: op.docId, reason }),
			options: { maxQueue: 2 },
		});

		q.enqueue(makeOp("del", "delete"));
		q.enqueue(makeOp("new", "create"));
		q.enqueue(makeOp("del2", "delete"));

		expect(drops).toEqual([{ docId: "new", reason: "overflow" }]);
		expect(
			q
				.all()
				.map((o) => o.docId)
				.sort(),
		).toEqual(["del", "del2"]);
	});
});

// ---------------------------------------------------------------------------
// 10. Drops are reported server-side (counts and reasons, never a path)
// ---------------------------------------------------------------------------

describe("drop reporter", () => {
	test("aggregates drops per reason into one report each, then resets", () => {
		const lines: Array<{ reason: DropReason; counts: { count: number; creates: number } }> = [];
		const r = makeDropReporter((reason, counts) => lines.push({ reason, counts }));

		for (let i = 0; i < 150; i++) r.onDrop(makeOp(`n${i}`, "create"), "overflow");
		r.onDrop(makeOp("d", "delete"), "max-attempts");
		r.onDrop(makeOp("c", "create"), "max-attempts");
		r.flush();

		expect(lines).toEqual([
			{ reason: "overflow", counts: { count: 150, creates: 150 } },
			{ reason: "max-attempts", counts: { count: 2, creates: 1 } },
		]);
		r.flush();
		expect(lines.length).toBe(2); // nothing new, nothing re-sent
	});
});
