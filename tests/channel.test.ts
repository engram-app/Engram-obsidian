/**
 * Tests for channel.ts — Phoenix channel with vault-scoped topics.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthProvider } from "../src/auth";
import { NoteChannel } from "../src/channel";

// Capture WebSocket constructor calls
let lastWsUrl: string | null = null;
let lastWsInstance: any = null;

type CloseEventLike = { code: number; reason: string; wasClean: boolean };

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: ((evt: CloseEventLike) => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: any) => void) | null = null;
	sent: string[] = [];

	constructor(url: string) {
		lastWsUrl = url;
		lastWsInstance = this;
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.onclose = null;
	}
}

// Install mock
(globalThis as any).WebSocket = MockWebSocket;

// Bun shares one process across test files: restore the real navigator so a
// test setting globalThis.navigator (online/offline probe tests below) can't
// leak into downstream files.
const originalNavigator = (globalThis as any).navigator;
afterAll(() => {
	(globalThis as any).navigator = originalNavigator;
});

function simulateOpen(ws: any): void {
	ws.onopen?.();
}

/** Fires the mock WebSocket's close handler with a CloseEvent-like payload.
 *  Real browsers always pass one; this keeps tests aligned with that shape. */
function fireClose(ws: any, code = 1006): void {
	ws.onclose?.({ code, reason: "", wasClean: false });
}

/** The sync-topic `phx_join` is always the first frame sent on open. */
function getSyncJoinMessage(ws: any): unknown[] {
	return JSON.parse(ws.sent[0]) as unknown[];
}

function simulateMessage(ws: any, msg: unknown[]): void {
	ws.onmessage?.({ data: JSON.stringify(msg) });
}

beforeEach(() => {
	lastWsUrl = null;
	lastWsInstance = null;
});

describe("NoteChannel topic format", () => {
	test("joins sync:{userId}:{vaultId} when vaultId is provided", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const joinMsg = getSyncJoinMessage(lastWsInstance);
		// [joinRef, ref, topic, event, payload]
		expect(joinMsg[2]).toBe("sync:42:7");
		expect(joinMsg[3]).toBe("phx_join");

		channel.disconnect();
	});

	test("joins sync:{userId} when vaultId is null (backwards compat)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", null);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const joinMsg = getSyncJoinMessage(lastWsInstance);
		expect(joinMsg[2]).toBe("sync:42");
		expect(joinMsg[3]).toBe("phx_join");

		channel.disconnect();
	});
});

describe("NoteChannel user topic + plan state", () => {
	test("joins user:{userId} as a second phx_join on open", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		simulateOpen(lastWsInstance);

		// First join is the sync topic, second is the user topic.
		const join1 = JSON.parse(lastWsInstance.sent[0]);
		const join2 = JSON.parse(lastWsInstance.sent[1]);
		expect(join1[2]).toBe("sync:42:7");
		expect(join1[3]).toBe("phx_join");
		expect(join2[2]).toBe("user:42");
		expect(join2[3]).toBe("phx_join");
		// Distinct join refs so server replies are attributable.
		expect(join2[0]).not.toBe(join1[0]);

		channel.disconnect();
	});

	test("user-topic join reply surfaces plan state", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		const seen: unknown[] = [];
		channel.onPlanState = (p) => seen.push(p);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"2",
			"9",
			"user:u1",
			"phx_reply",
			{
				status: "ok",
				response: {
					plan: {
						tier: "free",
						attachments_text_only: true,
						max_file_bytes: 10,
						attachment_bytes_cap: 5,
					},
				},
			},
		]);

		expect(seen.length).toBe(1);
		expect((seen[0] as { tier: string }).tier).toBe("free");
		channel.disconnect();
	});

	test("subscription_activated on user topic surfaces plan state", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		const seen: unknown[] = [];
		channel.onPlanState = (p) => seen.push(p);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"user:u1",
			"subscription_activated",
			{
				tier: "pro",
				attachments_text_only: false,
				max_file_bytes: 100,
				attachment_bytes_cap: null,
			},
		]);

		expect(seen.length).toBe(1);
		expect((seen[0] as { tier: string }).tier).toBe("pro");
		channel.disconnect();
	});

	test("sync-topic join reply sets connected; user-topic reply alone does not", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		simulateOpen(lastWsInstance);

		// A user-topic reply alone must NOT flip connected.
		simulateMessage(lastWsInstance, [
			"2",
			"9",
			"user:42",
			"phx_reply",
			{ status: "ok", response: { plan: { tier: "free" } } },
		]);
		expect(channel.isConnected()).toBe(false);

		// Only the sync-topic reply marks the channel connected.
		const join1 = JSON.parse(lastWsInstance.sent[0]);
		simulateMessage(lastWsInstance, [
			join1[0],
			join1[1],
			"sync:42:7",
			"phx_reply",
			{ status: "ok", response: {} },
		]);
		expect(channel.isConnected()).toBe(true);

		channel.disconnect();
	});

	test("user-topic join error does not flip connected and does not throw", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		simulateOpen(lastWsInstance);

		expect(() =>
			simulateMessage(lastWsInstance, [
				"2",
				"9",
				"user:42",
				"phx_reply",
				{ status: "error", response: { reason: "unmatched topic" } },
			]),
		).not.toThrow();
		expect(channel.isConnected()).toBe(false);

		channel.disconnect();
	});

	test("user-topic reply without a plan does not call onPlanState", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		const seen: unknown[] = [];
		channel.onPlanState = (p) => seen.push(p);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"2",
			"9",
			"user:u1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);

		expect(seen.length).toBe(0);
		channel.disconnect();
	});
});

describe("NoteChannel vault_deleted event", () => {
	test("fires onVaultDeleted callback when vault_deleted event received", async () => {
		const onVaultDeleted = mock();
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		channel.onVaultDeleted = onVaultDeleted;
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Simulate server sending vault_deleted
		simulateMessage(lastWsInstance, [null, null, "sync:42:7", "vault_deleted", {}]);

		expect(onVaultDeleted).toHaveBeenCalledTimes(1);
		channel.disconnect();
	});

	test("does not fire onEvent for vault_deleted (separate callback)", async () => {
		const onEvent = mock();
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		channel.onEvent = onEvent;
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [null, null, "sync:42:7", "vault_deleted", {}]);

		expect(onEvent).not.toHaveBeenCalled();
		channel.disconnect();
	});
});

describe("NoteChannel updateConfig with vaultId", () => {
	test("updateConfig accepts vaultId parameter", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		channel.updateConfig("http://localhost:4001", "key2", "42", "99");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const joinMsg = getSyncJoinMessage(lastWsInstance);
		expect(joinMsg[2]).toBe("sync:42:99");

		channel.disconnect();
	});
});

describe("NoteChannel.isConnected", () => {
	test("returns false before connect", () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		expect(channel.isConnected()).toBe(false);
	});

	test("returns true after successful join reply", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		simulateOpen(lastWsInstance);

		// The join message was sent; simulate a successful phx_reply
		const joinMsg = JSON.parse(lastWsInstance.sent[0]);
		const joinRef = joinMsg[0]; // join ref
		const ref = joinMsg[1]; // message ref
		simulateMessage(lastWsInstance, [
			joinRef,
			ref,
			"sync:42:7",
			"phx_reply",
			{ status: "ok", response: {} },
		]);

		expect(channel.isConnected()).toBe(true);
		channel.disconnect();
	});

	test("returns false after disconnect", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const joinMsg = JSON.parse(lastWsInstance.sent[0]);
		simulateMessage(lastWsInstance, [
			joinMsg[0],
			joinMsg[1],
			"sync:42:7",
			"phx_reply",
			{ status: "ok", response: {} },
		]);
		expect(channel.isConnected()).toBe(true);

		channel.disconnect();
		expect(channel.isConnected()).toBe(false);
	});
});

describe("NoteChannel.setAuthProvider", () => {
	test("stores the provider and uses its token for WebSocket URL", async () => {
		const provider: AuthProvider = {
			getToken: mock(() => Promise.resolve("oauth-ws-token-abc")),
			getVaultId: mock(() => "99"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
		};
		const channel = new NoteChannel("http://localhost:4000", "fallback-key", "42", "7");
		channel.setAuthProvider(provider);
		await channel.connect();

		// The WebSocket URL should contain the oauth token, not the fallback key
		expect(lastWsUrl).toContain("oauth-ws-token-abc");
		expect(lastWsUrl).not.toContain("fallback-key");

		channel.disconnect();
	});

	test("uses apiKey when no auth provider set", async () => {
		const channel = new NoteChannel("http://localhost:4000", "my-api-key", "42", "7");
		await channel.connect();

		expect(lastWsUrl).toContain("my-api-key");

		channel.disconnect();
	});

	test("fast pre-open close while online fires the auth probe, does NOT invalidate directly", async () => {
		(globalThis as any).navigator = { onLine: true };
		const probe = mock(() => Promise.resolve({ id: "u1", email: "e" }));
		const invalidate = mock(() => {});
		const provider: AuthProvider = {
			getToken: mock(() => Promise.resolve("maybe-stale-token")),
			getVaultId: mock(() => "7"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
			invalidateAccessToken: invalidate,
		};
		const channel = new NoteChannel("http://localhost:4000", "fallback", "42", "7");
		channel.setAuthProvider(provider);
		channel.setAuthProbe(probe);
		await channel.connect();

		// Simulate Phoenix UserSocket rejecting the upgrade (or a network blip,
		// both produce the same bare pre-open close). onclose fires without an
		// intervening onopen.
		fireClose(lastWsInstance);
		await Promise.resolve();

		expect(probe).toHaveBeenCalledTimes(1);
		// The channel no longer guesses and invalidates directly. The api
		// client (via the probe's real 401 handling) is the sole authority.
		expect(invalidate).not.toHaveBeenCalled();

		channel.disconnect();
	});

	test("fast pre-open close while OFFLINE does not probe and preserves the token", async () => {
		(globalThis as any).navigator = { onLine: false };
		const probe = mock(() => Promise.resolve({}));
		const channel = new NoteChannel("http://localhost:4000", "fallback", "42", "7");
		channel.setAuthProvider({
			getToken: mock(() => Promise.resolve("good-token")),
			getVaultId: mock(() => "7"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
			invalidateAccessToken: mock(() => {}),
		});
		channel.setAuthProbe(probe);
		await channel.connect();

		fireClose(lastWsInstance);
		await Promise.resolve();

		expect(probe).not.toHaveBeenCalled();

		channel.disconnect();
	});

	test("a rejecting probe does not throw out of onclose and still schedules reconnect", async () => {
		(globalThis as any).navigator = { onLine: true };
		const probe = mock(() => Promise.reject(new Error("401")));
		const channel = new NoteChannel("http://localhost:4000", "fallback", "42", "7");
		channel.setAuthProvider({
			getToken: mock(() => Promise.resolve("token")),
			getVaultId: mock(() => "7"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
		});
		channel.setAuthProbe(probe);
		await channel.connect();

		expect(() => fireClose(lastWsInstance)).not.toThrow();
		await Promise.resolve();

		expect(probe).toHaveBeenCalledTimes(1);

		channel.disconnect();
	});

	test("does NOT fire the auth probe when WS closes AFTER a successful open (normal disconnect)", async () => {
		(globalThis as any).navigator = { onLine: true };
		const probe = mock(() => Promise.resolve({}));
		const channel = new NoteChannel("http://localhost:4000", "fallback", "42", "7");
		channel.setAuthProvider({
			getToken: mock(() => Promise.resolve("good-token")),
			getVaultId: mock(() => "7"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
		});
		channel.setAuthProbe(probe);
		await channel.connect();

		simulateOpen(lastWsInstance);
		fireClose(lastWsInstance);
		await Promise.resolve();

		expect(probe).not.toHaveBeenCalled();

		channel.disconnect();
	});

	test("fast pre-open close with no authProbe set does not throw (no-op)", async () => {
		// Channel without setAuthProbe (and without setAuthProvider): only the
		// api-key fallback string drives the WS URL. The onclose handler must
		// NOT crash on the optional `this.authProbe` guard.
		(globalThis as any).navigator = { onLine: true };
		const channel = new NoteChannel("http://localhost:4000", "my-api-key", "42", "7");
		await channel.connect();

		expect(() => fireClose(lastWsInstance)).not.toThrow();

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// Task 8: Heartbeat reply timeout — half-dead socket detection
// Tests use (channel as any).heartbeatTick() to drive the interval body
// directly without relying on fake timers.
// ---------------------------------------------------------------------------

describe("NoteChannel heartbeat reply timeout", () => {
	/** MockWebSocket variant that tracks close() calls so we can assert the
	 *  channel forces a close when a heartbeat goes unanswered. */
	class TrackingWebSocket {
		static OPEN = 1;
		readyState = TrackingWebSocket.OPEN;
		onopen: (() => void) | null = null;
		onclose: (() => void) | null = null;
		onmessage: ((evt: { data: string }) => void) | null = null;
		onerror: ((e: any) => void) | null = null;
		sent: string[] = [];
		closeCalls = 0;

		constructor(_url: string) {
			lastWsInstance = this;
		}

		send(data: string): void {
			this.sent.push(data);
		}

		close(): void {
			this.closeCalls++;
			// Simulate Chromium behaviour: onclose fires locally regardless of
			// whether the remote peer is reachable.
			const cb = this.onclose;
			this.onclose = null;
			cb?.();
		}
	}

	test("heartbeat reply (phoenix phx_reply) clears pendingHeartbeatRef so subsequent ticks send a fresh heartbeat", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		const ws = lastWsInstance as TrackingWebSocket;
		ws.onopen?.();

		const countBefore = ws.sent.length;

		// First tick — should stamp a pending ref and send a heartbeat
		(channel as any).heartbeatTick();
		const afterFirstTick = ws.sent.length;
		expect(afterFirstTick).toBe(countBefore + 1);
		const hb1 = JSON.parse(ws.sent[afterFirstTick - 1]!);
		expect(hb1[2]).toBe("phoenix");
		expect(hb1[3]).toBe("heartbeat");
		const sentRef = hb1[1] as string;

		// Simulate the server replying to the heartbeat
		ws.onmessage?.({
			data: JSON.stringify([
				null,
				sentRef,
				"phoenix",
				"phx_reply",
				{ status: "ok", response: {} },
			]),
		});

		// Second tick — pendingHeartbeatRef should be null, so a new heartbeat is sent
		(channel as any).heartbeatTick();
		expect(ws.sent.length).toBe(countBefore + 2);
		expect(ws.closeCalls).toBe(0);

		channel.disconnect();
		(globalThis as any).WebSocket = MockWebSocket;
	});

	test("no reply between ticks — second tick detects unanswered heartbeat and calls ws.close()", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		const ws = lastWsInstance as TrackingWebSocket;
		ws.onopen?.();

		// First tick sends a heartbeat, leaves pendingHeartbeatRef set
		(channel as any).heartbeatTick();
		expect(ws.closeCalls).toBe(0);

		// Second tick fires with pendingHeartbeatRef still set — must close the socket
		(channel as any).heartbeatTick();
		expect(ws.closeCalls).toBe(1);

		channel.disconnect();
		(globalThis as any).WebSocket = MockWebSocket;
	});

	test("pendingHeartbeatRef is cleared on socket open (reset across reconnects)", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		const ws = lastWsInstance as TrackingWebSocket;
		ws.onopen?.();

		// Stamp a pending ref via first tick
		(channel as any).heartbeatTick();
		expect((channel as any).pendingHeartbeatRef).not.toBeNull();

		// Simulate reconnect: a new open fires startHeartbeat
		// The open handler must reset pendingHeartbeatRef
		ws.onopen?.();
		expect((channel as any).pendingHeartbeatRef).toBeNull();

		channel.disconnect();
		(globalThis as any).WebSocket = MockWebSocket;
	});
});
