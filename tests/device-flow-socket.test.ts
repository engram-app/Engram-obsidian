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

	// Verified against the real server: a Phoenix broadcast arrives with BOTH
	// join_ref and ref null, not the string refs a reply carries. Matching on
	// those positions instead of the topic would have silently ignored it.
	test("accepts the real broadcast frame shape (null join_ref and ref)", () => {
		let fired = 0;
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-8", () => {
			fired += 1;
		});
		lastWs?.onopen?.();
		lastWs?.onmessage?.({
			data: JSON.stringify([null, null, "device:dev-code-8", "authorized", {}]),
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

	// The socket OPENING proves nothing — a channel whose join crashes
	// server-side still leaves you with a happily open socket. Only the join
	// reply distinguishes "live" from "silently on the fallback poll".
	test("reports live only after the join is acked, not on open", () => {
		const seen: boolean[] = [];
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-9", () => {}, {
			onStatus: (live) => seen.push(live),
		});
		lastWs?.onopen?.();
		expect(seen).toEqual([]);

		lastWs?.onmessage?.({
			data: JSON.stringify(["1", "1", "device:dev-code-9", "phx_reply", { status: "ok" }]),
		});
		expect(seen).toEqual([true]);
	});

	test("reports not-live when the join is rejected", () => {
		const seen: boolean[] = [];
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-10", () => {}, {
			onStatus: (live) => seen.push(live),
		});
		lastWs?.onopen?.();
		lastWs?.onmessage?.({
			data: JSON.stringify([
				"1",
				"1",
				"device:dev-code-10",
				"phx_reply",
				{ status: "error", response: { reason: "unknown_or_expired" } },
			]),
		});
		expect(seen).toEqual([false]);
	});

	// This is the exact shape of the bug that shipped: the server killed the
	// transport right after join, and nothing told the user.
	test("reports not-live when the server closes the socket", () => {
		const seen: boolean[] = [];
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-11", () => {}, {
			onStatus: (live) => seen.push(live),
		});
		lastWs?.onopen?.();
		lastWs?.onclose?.({ code: 1011, reason: "", wasClean: false });
		expect(seen).toEqual([false]);
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

	// The channel can die AFTER a successful join (server crash, code expiry
	// sweep) while the transport stays open. Nothing else would notice, and the
	// modal would keep promising "connected, this will complete instantly"
	// while the user is silently back on the 30s poll.
	test("reports not-live when the channel errors after joining", () => {
		const seen: boolean[] = [];
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-12", () => {}, {
			onStatus: (live) => seen.push(live),
		});
		lastWs?.onopen?.();
		lastWs?.onmessage?.({
			data: JSON.stringify(["1", "1", "device:dev-code-12", "phx_reply", { status: "ok" }]),
		});
		lastWs?.onmessage?.({
			data: JSON.stringify([null, null, "device:dev-code-12", "phx_error", {}]),
		});
		expect(seen).toEqual([true, false]);
	});

	// There is no reconnect, so a closed socket means this listener is finished.
	// Leaving the heartbeat armed just fires every 30s at a dead socket for the
	// rest of the session.
	test("a closed socket stops the heartbeat", async () => {
		waitForDeviceAuthorization("http://localhost:4000/api", "dev-code-13", () => {}, {
			heartbeatMs: 1,
		});
		const ws = lastWs as MockWebSocket;
		ws.onopen?.();
		await new Promise((r) => setTimeout(r, 10));
		const before = frames(ws).filter((f) => f[3] === "heartbeat").length;
		expect(before).toBeGreaterThan(0);

		ws.onclose?.({ code: 1006, reason: "", wasClean: false });
		await new Promise((r) => setTimeout(r, 15));

		expect(frames(ws).filter((f) => f[3] === "heartbeat").length).toBe(before);
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
