/**
 * Tests for channel.ts socket single-flight discipline.
 *
 * Root cause of the e2e-clerk zombie-channel flake family (backend #875/#879):
 * openSocket() could run re-entrantly — a connect() call racing the async
 * auth-token fetch, or a stale reconnect timer firing after an external
 * connect() — creating two live WebSockets whose handlers fight over
 * this.ws/connected. The orphan's onclose clobbers the current socket's
 * state, leaving the client believing it is connected while the server
 * holds no subscription.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { AuthProvider } from "../src/auth";
import { NoteChannel } from "../src/channel";

let instances: MockWebSocket[] = [];

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: any) => void) | null = null;
	sent: string[] = [];
	constructor(_url: string) {
		instances.push(this);
	}
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.onclose = null;
	}
}
(globalThis as any).WebSocket = MockWebSocket;

/** Captured window.setTimeout callbacks so tests can fire timers manually. */
let capturedTimeouts: Array<() => void> = [];

// Bun runs test files in a shared process: the fake window MUST be restored
// or downstream files' real timers (SyncEngine debounce tests) never fire.
const originalWindow = (globalThis as any).window;

function installFakeWindow(): void {
	(globalThis as any).window = {
		setTimeout: (cb: () => void, _ms: number): number => {
			capturedTimeouts.push(cb);
			return capturedTimeouts.length;
		},
		clearTimeout: (_id: number): void => {},
		setInterval: (_cb: () => void, _ms: number): number => 0,
		clearInterval: (_id: number): void => {},
	};
}

afterAll(() => {
	(globalThis as any).window = originalWindow;
});

function simulateSyncJoinAck(ws: MockWebSocket, topic: string): void {
	ws.onmessage?.({
		data: JSON.stringify(["1", "1", topic, "phx_reply", { status: "ok", response: {} }]),
	});
}

beforeEach(() => {
	instances = [];
	capturedTimeouts = [];
	installFakeWindow();
});

describe("NoteChannel socket single-flight", () => {
	test("concurrent connect() calls create only one WebSocket", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		// Async token fetch opens the race window: the first connect() is
		// suspended on getToken while the second connect() runs.
		channel.setAuthProvider({
			getToken: () => new Promise<string>((r) => queueMicrotask(() => r("tok"))),
		} as unknown as AuthProvider);

		const first = channel.connect();
		const second = channel.connect();
		await Promise.all([first, second]);

		expect(instances.length).toBe(1);
		channel.disconnect();
	});

	test("stale reconnect timer no-ops after an external connect()", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		const ws1 = instances[0];
		ws1.onopen?.();
		simulateSyncJoinAck(ws1, "sync:42:7");
		expect(channel.isConnected()).toBe(true);

		// Live connection drops: onclose schedules a jittered reconnect
		// (captured, not yet fired).
		ws1.onclose?.();
		expect(channel.isConnected()).toBe(false);
		const staleTimerCount = capturedTimeouts.length;
		expect(staleTimerCount).toBeGreaterThan(0);

		// External reconnect (e.g. settings change) beats the timer.
		await channel.connect();
		const ws2 = instances[1];
		ws2.onopen?.();
		simulateSyncJoinAck(ws2, "sync:42:7");
		expect(channel.isConnected()).toBe(true);

		// The stale timer fires afterwards: it must NOT open a third socket
		// or disturb the live connection.
		for (const cb of capturedTimeouts.slice(0, staleTimerCount)) cb();
		await Promise.resolve(); // let any (buggy) async openSocket settle
		await Promise.resolve();

		expect(instances.length).toBe(2);
		expect(channel.isConnected()).toBe(true);
		channel.disconnect();
	});
});
