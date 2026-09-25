/**
 * Tests: NoteChannel recovery after a crdt: join rejected "onboarding_required".
 *
 * Issue #455 (recovery half). The backend refuses `crdt:` joins for an account
 * that has not finished onboarding. The user IS told — `onboarding_required`
 * is in PLAN_JOIN_REASONS, so main.ts toasts "Finish setting up your account at
 * app.engram.page to start syncing." They go and do it.
 *
 * Then nothing happens. A Phoenix join rejection leaves the socket healthy and
 * heartbeating, so `onclose` never runs, so the join-failure backoff never
 * arms, so nothing rejoins. `unauthorized` was the only reason that cycled the
 * socket. The user sits on the degraded legacy path until they restart Obsidian.
 *
 * Fix: treat `onboarding_required` as recoverable — cycle the socket so the
 * EXISTING bounded backoff (exponential, capped at maxReconnectMs) retries the
 * join. The first retry after they finish onboarding succeeds.
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
	closed = false;
	constructor(_url: string) {
		lastWsInstance = this;
	}
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.closed = true;
	}
}
const originalWebSocket = (globalThis as any).WebSocket;
(globalThis as any).WebSocket = MockWebSocket;

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
	Math.random = () => 0;
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

describe("NoteChannel onboarding_required join recovery (#455)", () => {
	test("an onboarding_required rejection cycles the socket so the backoff can retry", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "user-1", "v1");
		await channel.connect();
		lastWsInstance.onopen?.();
		const ws = lastWsInstance;

		rejectCrdtJoin(ws, crdtJoinRef(ws), "onboarding_required", "crdt:user-1:v1");

		// Without the cycle the socket stays open and heartbeating forever, so
		// onclose never fires and nothing ever rejoins.
		expect(ws.closed).toBe(true);
		channel.disconnect();
	});

	test("the retry rejoins crdt: once onboarding is finished", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "user-1", "v1");
		await channel.connect();
		lastWsInstance.onopen?.();
		rejectCrdtJoin(
			lastWsInstance,
			crdtJoinRef(lastWsInstance),
			"onboarding_required",
			"crdt:user-1:v1",
		);
		lastWsInstance.onclose?.({ code: 1000, reason: "", wasClean: true });

		// The onclose backoff armed a reconnect. Fire it.
		expect(capturedTimers.length).toBeGreaterThan(0);
		capturedTimers[capturedTimers.length - 1]!.cb();
		for (let i = 0; i < 4; i++) await Promise.resolve();
		lastWsInstance.onopen?.();

		const rejoined = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.filter((m: unknown[]) => (m[3] as string) === "phx_join")
			.map((m: unknown[]) => m[2] as string);
		expect(rejoined).toContain("crdt:user-1:v1");
		channel.disconnect();
	});

	test("a reason the user cannot clear does NOT cycle the socket", async () => {
		// account_suspended and account_deleted are terminal: retrying cannot fix
		// them, and cycling would burn a reconnect loop against a wall until the
		// backoff caps. Only reasons a user can resolve get the cycle.
		const channel = new NoteChannel("http://localhost:4000", "key", "user-1", "v1");
		await channel.connect();
		lastWsInstance.onopen?.();
		const ws = lastWsInstance;

		rejectCrdtJoin(ws, crdtJoinRef(ws), "account_suspended", "crdt:user-1:v1");

		expect(ws.closed).toBe(false);
		channel.disconnect();
	});
});
