/**
 * Tests for the device-flow authorization listener — the socket that replaced
 * the 5s polling loop.
 *
 * The plugin holds no token until the flow completes, so this rides the
 * unauthenticated `/socket/device` and is keyed by the device_code. It carries
 * a NOTIFICATION only: on "authorized" the caller performs exactly one token
 * exchange through the existing single-use REST endpoint.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { waitForDeviceAuthorization } from "../src/device-flow-socket";

type CloseEventLike = { code: number; reason: string; wasClean: boolean };

let lastWsUrl = "";
let lastWs: MockWebSocket | null = null;

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: ((evt: CloseEventLike) => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	sent: string[] = [];
	closed = false;

	constructor(url: string) {
		lastWsUrl = url;
		lastWs = this;
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
		this.onclose = null;
	}
}

const origWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

beforeEach(() => {
	lastWsUrl = "";
	lastWs = null;
	(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
});

afterEach(() => {
	(globalThis as unknown as { WebSocket: unknown }).WebSocket = origWebSocket;
});

const frames = (ws: MockWebSocket) => ws.sent.map((s) => JSON.parse(s) as unknown[]);

describe("waitForDeviceAuthorization", () => {
	test("connects to the unauthenticated device socket, not the user socket", () => {
		waitForDeviceAuthorization("https://api.example.test/api", "dev-code-1", () => {});
		expect(lastWsUrl).toContain("wss://api.example.test/socket/device/websocket");
		// The Phoenix v2 wire protocol is what channel.ts already speaks.
		expect(lastWsUrl).toContain("vsn=2.0.0");
		// No token: the whole point is that we don't have one yet.
		expect(lastWsUrl).not.toContain("token=");
	});

	test("strips the /api suffix — the socket is at the origin, not under /api", () => {
		waitForDeviceAuthorization("https://api.example.test/api", "dev-code-1", () => {});
		expect(lastWsUrl).not.toContain("/api/socket");
	});

	test("joins the topic for this device code once open", () => {
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-2", () => {});
		lastWs?.onopen?.();

		const join = frames(lastWs as MockWebSocket).find((f) => f[3] === "phx_join");
		expect(join).toBeDefined();
		expect(join?.[2]).toBe("device:dev-code-2");
	});

	test("fires the callback when the server pushes authorized", () => {
		let fired = 0;
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-3", () => {
			fired += 1;
		});
		lastWs?.onopen?.();
		lastWs?.onmessage?.({
			data: JSON.stringify(["1", "2", "device:dev-code-3", "authorized", {}]),
		});

		expect(fired).toBe(1);
	});

	test("ignores events for a different device code", () => {
		let fired = 0;
		waitForDeviceAuthorization("http://localhost:4000/api", "mine", () => {
			fired += 1;
		});
		lastWs?.onopen?.();
		lastWs?.onmessage?.({
			data: JSON.stringify(["1", "2", "device:theirs", "authorized", {}]),
		});

		expect(fired).toBe(0);
	});

	// The flow can run for the code's full 300s lifetime. Phoenix drops idle
	// sockets around 60s, so without a heartbeat the listener would silently
	// die partway through and the user would be back to waiting on the
	// fallback poll.
	test("heartbeats so the socket survives the code's full lifetime", async () => {
		const dispose = waitForDeviceAuthorization(
			"http://localhost:4000/api",
			"dev-code-4",
			() => {},
			{ heartbeatMs: 1 },
		);
		lastWs?.onopen?.();
		await new Promise((r) => setTimeout(r, 20));
		dispose();

		const beats = frames(lastWs as MockWebSocket).filter((f) => f[3] === "heartbeat");
		expect(beats.length).toBeGreaterThan(0);
		// Phoenix heartbeats go to the "phoenix" topic with a null join_ref.
		expect(beats[0]?.[2]).toBe("phoenix");
	});

	test("dispose closes the socket and stops the heartbeat", () => {
		const dispose = waitForDeviceAuthorization(
			"http://localhost:4000/api",
			"dev-code-5",
			() => {},
		);
		lastWs?.onopen?.();
		dispose();

		expect(lastWs?.closed).toBe(true);
	});

	test("a callback never fires after dispose", () => {
		let fired = 0;
		const dispose = waitForDeviceAuthorization(
			"http://localhost:4000/api",
			"dev-code-6",
			() => {
				fired += 1;
			},
		);
		lastWs?.onopen?.();
		const ws = lastWs as MockWebSocket;
		dispose();
		ws.onmessage?.({ data: JSON.stringify(["1", "2", "device:dev-code-6", "authorized", {}]) });

		expect(fired).toBe(0);
	});

	// A blocked WebSocket must not take the whole flow down with it — the REST
	// fallback poll is still running underneath.
	test("survives a socket that fails to construct", () => {
		(globalThis as unknown as { WebSocket: unknown }).WebSocket = function Boom() {
			throw new Error("blocked");
		};
		expect(() =>
			waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-7", () => {}),
		).not.toThrow();
	});
});
