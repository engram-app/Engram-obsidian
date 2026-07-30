/**
 * Tests: NoteChannel reconnect backoff after a crdt: topic JOIN rejection.
 *
 * Root cause (alert-noise investigation, docs/context/... loki-error-rate):
 * a crdt: join rejected mid-session (e.g. "rate_limited" from the backend's
 * crdt_msg/join limiter) does not by itself force a reconnect, but when the
 * WHOLE socket then drops (server-side abuse defense, or any other graceful
 * drop), the existing "opened=true" reconnect path used a FLAT full-jitter
 * window that never grows across repeated failures — unlike the "opened=false"
 * path, which already exponentially backs off 1s->60s. A server that keeps
 * closing the socket right after rejecting the crdt join produces a tight
 * open/reject/close loop, which is exactly the burst pattern seen in prod.
 *
 * Fix: track whether the crdt: join was rejected in the session that just
 * ended; if so, the next reconnect uses a growing backoff (capped at 60s)
 * instead of the flat jitter, with a higher floor for an explicit
 * "rate_limited" reason. A graceful drop with no join failure is unaffected.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { NoteChannel } from "../src/channel";

let lastWsInstance: any = null;

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: ((evt?: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: any) => void) | null = null;
	sent: string[] = [];
	constructor(_url: string) {
		lastWsInstance = this;
	}
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.onclose = null;
	}
}
const originalWebSocket = (globalThis as any).WebSocket;
(globalThis as any).WebSocket = MockWebSocket;

/** Captured window.setTimeout calls: {cb, ms} so tests can assert the delay
 *  the reconnect scheduler chose, not just that a timer was scheduled. */
let capturedTimers: Array<{ cb: () => void; ms: number }> = [];
const originalWindow = (globalThis as any).window;
function installFakeWindow(): void {
	(globalThis as any).window = {
		setTimeout: (cb: () => void, ms: number): number => {
			capturedTimers.push({ cb, ms });
			return capturedTimers.length;
		},
		clearTimeout: (_id: number): void => {},
		setInterval: (_cb: () => void, _ms: number): number => 0,
		clearInterval: (_id: number): void => {},
	};
}

const originalRandom = Math.random;

afterAll(() => {
	(globalThis as any).window = originalWindow;
	(globalThis as any).WebSocket = originalWebSocket;
	Math.random = originalRandom;
});

beforeEach(() => {
	lastWsInstance = null;
	capturedTimers = [];
	installFakeWindow();
	Math.random = () => 0; // deterministic: full-jitter terms become 0
});

function crdtJoinRef(ws: any): string {
	const crdtJoin = ws.sent
		.map((s: string) => JSON.parse(s) as unknown[])
		.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));
	return crdtJoin![1] as string;
}

function rejectCrdtJoin(ws: any, ref: string, reason: string, topic: string): void {
	ws.onmessage?.({
		data: JSON.stringify([
			"3",
			ref,
			topic,
			"phx_reply",
			{ status: "error", response: { reason } },
		]),
	});
}

function acceptCrdtJoin(ws: any, ref: string, topic: string): void {
	ws.onmessage?.({
		data: JSON.stringify(["3", ref, topic, "phx_reply", { status: "ok", response: {} }]),
	});
}

/** Open a fresh socket, reject its crdt join, then close it "live" (opened=true).
 *  Returns the ms of the reconnect timer scheduled by that close. */
function failCycle(_channel: NoteChannel, reason: string, topic = "crdt:u1:v1"): number {
	lastWsInstance.onopen?.();
	const ref = crdtJoinRef(lastWsInstance);
	rejectCrdtJoin(lastWsInstance, ref, reason, topic);
	const before = capturedTimers.length;
	lastWsInstance.onclose?.({ code: 1000, reason: "", wasClean: true });
	const scheduled = capturedTimers.slice(before);
	expect(scheduled.length).toBe(1);
	return scheduled[0]!.ms;
}

describe("NoteChannel join-failure reconnect backoff", () => {
	test("a graceful drop with NO join failure keeps the flat full-jitter delay", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		lastWsInstance.onopen?.();
		const ref = crdtJoinRef(lastWsInstance);
		acceptCrdtJoin(lastWsInstance, ref, "crdt:u1:v1");

		lastWsInstance.onclose?.({ code: 1000, reason: "", wasClean: true });
		expect(capturedTimers.length).toBe(1);
		// rng stubbed to 0 -> fullJitterDelay(window, rng) === 0 for the
		// unmodified graceful path (proves the join-failure branch was NOT taken).
		expect(capturedTimers[0]!.ms).toBe(0);
		channel.disconnect();
	});

	test("a rejected crdt join backs off (non-zero delay) instead of the flat jitter", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		const delay = failCycle(channel, "some_error");
		expect(delay).toBeGreaterThan(0);
		channel.disconnect();
	});

	test("consecutive join rejections grow the backoff, capped at 60s", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();

		const delays: number[] = [];
		for (let i = 0; i < 8; i++) {
			delays.push(failCycle(channel, "some_error"));
			// Each cycle's reconnect timer fires immediately (deterministic rng),
			// opening the next socket for the next cycle. openSocket() awaits the
			// (synchronous-but-Promise-wrapped) token fetch before constructing the
			// new WebSocket, so let that microtask settle before the next cycle.
			capturedTimers[capturedTimers.length - 1]!.cb();
			await Promise.resolve();
			await Promise.resolve();
		}

		for (let i = 1; i < delays.length; i++) {
			expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
		}
		expect(Math.max(...delays)).toBeLessThanOrEqual(60_000);
		expect(delays[delays.length - 1]).toBe(60_000);
		channel.disconnect();
	});

	test("an explicit rate_limited reason gets a higher floor than a generic join error", async () => {
		const channelA = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channelA.connect();
		const genericDelay = failCycle(channelA, "some_error");
		channelA.disconnect();

		const channelB = new NoteChannel("http://localhost:4000", "key", "u2", "v1");
		await channelB.connect();
		const rateLimitedDelay = failCycle(channelB, "rate_limited", "crdt:u2:v1");
		channelB.disconnect();

		expect(rateLimitedDelay).toBeGreaterThan(genericDelay);
	});

	test("a successful crdt join resets the backoff back to the floor", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();

		// First failure grows the backoff.
		const firstDelay = failCycle(channel, "some_error");
		capturedTimers[capturedTimers.length - 1]!.cb();
		await Promise.resolve();
		await Promise.resolve();

		// This session's crdt join succeeds — health restored.
		lastWsInstance.onopen?.();
		const ref = crdtJoinRef(lastWsInstance);
		acceptCrdtJoin(lastWsInstance, ref, "crdt:u1:v1");
		lastWsInstance.onclose?.({ code: 1000, reason: "", wasClean: true });
		// Graceful drop (no failure this session) uses the flat jitter — 0 with
		// stubbed rng — proving crdtJoinFailedReason was cleared by the accept.
		expect(capturedTimers[capturedTimers.length - 1]!.ms).toBe(0);
		capturedTimers[capturedTimers.length - 1]!.cb();
		await Promise.resolve();
		await Promise.resolve();

		// Next failure starts from the floor again, not from where it left off.
		const nextDelay = failCycle(channel, "some_error");
		expect(nextDelay).toBe(firstDelay);
		channel.disconnect();
	});
});
