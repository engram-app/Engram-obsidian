import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { NoteChannel } from "../src/channel";
import { rlog } from "../src/remote-log";

// Bun shares one process across test files: restore the real navigator so the
// online/offline probe test below can't leak into downstream files.
const originalNavigator = (globalThis as any).navigator;
afterAll(() => {
	(globalThis as any).navigator = originalNavigator;
});

// Mirrors the MockWebSocket pattern used in tests/channel-jitter.test.ts:
// readyState is OPEN from construction (unlike a real WebSocket, which starts
// CONNECTING) so `send()` can be exercised without waiting on a real handshake.
let lastWsInstance: any = null;

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: ((evt: CloseEvent) => void) | null = null;
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
(globalThis as any).WebSocket = MockWebSocket;

beforeEach(() => {
	lastWsInstance = null;
});

describe("outbound oversize frame warning", () => {
	test("a frame over the threshold triggers a channel warn naming the event and size", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "vault-1", true);
		await channel.connect();

		const logger = rlog();
		const warnSpy = spyOn(logger, "warn");

		// b64 field alone pushes the serialized JSON well past 1MB.
		channel.sendCrdt("doc-1", "A".repeat(1_500_000));

		expect(warnSpy).toHaveBeenCalledTimes(1);
		const [category, message] = warnSpy.mock.calls[0] as [string, string];
		expect(category).toBe("channel");
		expect(message).toContain("crdt_msg");
		expect(message).toMatch(/bytes=\d+/);
		expect(message.toLowerCase()).toContain("oversized");

		// Observability only - the frame must still be sent.
		expect(lastWsInstance.sent).toHaveLength(1);

		warnSpy.mockRestore();
		channel.disconnect();
	});

	test("a small frame does NOT trigger a warn", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "vault-1", true);
		await channel.connect();

		const logger = rlog();
		const warnSpy = spyOn(logger, "warn");

		channel.sendCrdt("doc-1", "small-delta");

		expect(warnSpy).not.toHaveBeenCalled();
		expect(lastWsInstance.sent).toHaveLength(1);

		warnSpy.mockRestore();
		channel.disconnect();
	});
});

describe("onclose surfaces close code/reason/wasClean", () => {
	test("a synthetic 1009 close is logged with code=1009 on the live-connection-dropped path", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "vault-1");
		await channel.connect();
		// Simulate a successful open first so the onclose handler takes the
		// "dropped after live connection" branch instead of the reconnect-backoff one.
		lastWsInstance.onopen?.();

		const logger = rlog();
		const infoSpy = spyOn(logger, "info");

		lastWsInstance.onclose?.(
			new CloseEvent("close", { code: 1009, reason: "message too big", wasClean: false }),
		);

		const match = infoSpy.mock.calls.find(
			(call) => typeof call[1] === "string" && call[1].includes("code=1009"),
		);
		expect(match).toBeDefined();
		const message = match?.[1] as string;
		expect(message).toContain('reason="message too big"');
		expect(message).toContain("wasClean=false");

		infoSpy.mockRestore();
		channel.disconnect();
	});

	test("a close before open is logged with the close code on the auth-fail-check warn path", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "vault-1");
		await channel.connect();
		// No onopen call: onclose sees `opened = false`, taking the
		// close-before-open / reconnect-backoff branch.

		const logger = rlog();
		const infoSpy = spyOn(logger, "info");

		lastWsInstance.onclose?.(
			new CloseEvent("close", { code: 1006, reason: "", wasClean: false }),
		);

		const match = infoSpy.mock.calls.find(
			(call) => typeof call[1] === "string" && call[1].includes("code=1006"),
		);
		expect(match).toBeDefined();

		infoSpy.mockRestore();
		channel.disconnect();
	});

	test("a close before open within the auth-fail window while online fires the auth probe and logs the close code", async () => {
		// The channel no longer guesses a stale token on a bare pre-open close
		// (that heuristic misfired on plain network blips). Within the fail
		// window and while online it fires the injected probe instead; the api
		// client is the sole invalidation authority.
		(globalThis as any).navigator = { onLine: true };
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "vault-1");
		let probed = false;
		channel.setAuthProvider({
			getToken: async () => "tok",
			getVaultId: () => "vault-1",
			isAuthenticated: () => true,
			signOut: () => {},
		});
		channel.setAuthProbe(async () => {
			probed = true;
			return {};
		});
		await channel.connect();
		// No onopen call: onclose sees `opened = false`, well within
		// AUTH_FAIL_WINDOW_MS, taking the probe branch.

		const logger = rlog();
		const infoSpy = spyOn(logger, "info");

		lastWsInstance.onclose?.(
			new CloseEvent("close", { code: 1006, reason: "", wasClean: false }),
		);
		await Promise.resolve();

		expect(probed).toBe(true);
		const match = infoSpy.mock.calls.find(
			(call) => typeof call[1] === "string" && call[1].includes("code=1006"),
		);
		expect(match).toBeDefined();
		const message = match?.[1] as string;
		expect(message).toContain("wasClean=false");

		infoSpy.mockRestore();
		channel.disconnect();
	});
});
