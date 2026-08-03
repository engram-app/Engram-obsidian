/**
 * Tests for channel.ts — Phoenix channel with vault-scoped topics.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthProvider } from "../src/auth";
import { connectRetryDelayMs, makeCrdtCatchupSender, NoteChannel } from "../src/channel";

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

describe("connectRetryDelayMs", () => {
	test("exponential from 2s for early attempts", () => {
		expect(connectRetryDelayMs(0)).toBe(2000);
		expect(connectRetryDelayMs(1)).toBe(4000);
		expect(connectRetryDelayMs(4)).toBe(32_000);
	});

	test("caps at 60s and never stops growing attempts from overflowing", () => {
		expect(connectRetryDelayMs(5)).toBe(60_000);
		expect(connectRetryDelayMs(100)).toBe(60_000);
		expect(connectRetryDelayMs(10_000)).toBe(60_000);
	});
});

describe("NoteChannel folders.batch event", () => {
	test("fires onFoldersChanged for folders.batch create", async () => {
		const onFoldersChanged = mock();
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		channel.onFoldersChanged = onFoldersChanged;
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:42:7",
			"folders.batch",
			{ op: "create", folder: "Projects/New" },
		]);

		expect(onFoldersChanged).toHaveBeenCalledTimes(1);
		channel.disconnect();
	});

	test("fires onFoldersChanged for folders.batch delete/move too", async () => {
		const onFoldersChanged = mock();
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		channel.onFoldersChanged = onFoldersChanged;
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:42:7",
			"folders.batch",
			{ op: "delete", ids: ["a"] },
		]);
		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:42:7",
			"folders.batch",
			{ op: "move", ids: ["a"], target_parent_id: "root" },
		]);

		expect(onFoldersChanged).toHaveBeenCalledTimes(2);
		channel.disconnect();
	});

	test("does not fire onEvent for folders.batch (separate callback)", async () => {
		const onEvent = mock();
		const channel = new NoteChannel("http://localhost:4000", "key", "42", "7");
		channel.onEvent = onEvent;
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:42:7",
			"folders.batch",
			{ op: "create", folder: "X" },
		]);

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

	test("a rejecting probe never blocks reconnect (onclose stays synchronous)", async () => {
		// Pins the fix: onclose must schedule reconnect in the SAME synchronous
		// tick, before the fire-and-forget probe promise has settled. If onclose
		// ever went back to `await`ing the probe, reconnectTimer would still be
		// null right after fireClose() returns.
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

		fireClose(lastWsInstance);

		// Reconnect must already be armed, synchronously, before the rejecting
		// probe promise gets a chance to settle.
		expect((channel as any).reconnectTimer).not.toBeNull();

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

// ---------------------------------------------------------------------------
// onResume() — mobile foreground recovery. Mobile OSes suspend the socket while
// backgrounded; readyState can report OPEN on a connection that is actually dead.
// onResume brings the liveness check (and any pending reconnect) forward so the
// first interaction after unlock is snappy instead of waiting ~30s for the next
// heartbeat tick. Tests drive it synchronously (no fake timers).
// ---------------------------------------------------------------------------

describe("NoteChannel onResume (mobile foreground recovery)", () => {
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
			const cb = this.onclose;
			this.onclose = null;
			cb?.();
		}
	}

	test("on an OPEN socket, fires an immediate heartbeat probe", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		const ws = lastWsInstance as TrackingWebSocket;
		ws.onopen?.();
		const before = ws.sent.length;

		channel.onResume();

		expect(ws.sent.length).toBe(before + 1);
		const hb = JSON.parse(ws.sent[ws.sent.length - 1]!);
		expect(hb[2]).toBe("phoenix");
		expect(hb[3]).toBe("heartbeat");

		channel.disconnect();
		(globalThis as any).WebSocket = MockWebSocket;
	});

	test("closes a half-dead socket whose pre-suspend heartbeat was never answered", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		const ws = lastWsInstance as TrackingWebSocket;
		ws.onopen?.();

		// A heartbeat went out before the app was backgrounded and was never answered.
		(channel as any).heartbeatTick();
		expect((channel as any).pendingHeartbeatRef).not.toBeNull();
		expect(ws.closeCalls).toBe(0);

		// Resume: the still-pending ref proves the socket is dead → close now.
		channel.onResume();
		expect(ws.closeCalls).toBe(1);

		channel.disconnect();
		(globalThis as any).WebSocket = MockWebSocket;
	});

	test("brings a pending reconnect forward when the socket is down", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		// Simulate mid-backoff: no live socket, a reconnect timer pending.
		(channel as any).ws = null;
		(channel as any).reconnectTimer = window.setTimeout(() => {}, 60_000);

		channel.onResume();

		// The pending timer is cleared and a fresh socket open is kicked off.
		expect((channel as any).reconnectTimer).toBeNull();
		await Promise.resolve();
		expect(lastWsInstance).not.toBeNull();

		channel.disconnect();
		(globalThis as any).WebSocket = MockWebSocket;
	});

	test("is a no-op when intentionally disconnected (no socket, no pending reconnect)", async () => {
		(globalThis as any).WebSocket = TrackingWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		channel.disconnect();
		lastWsInstance = null;

		channel.onResume();
		await Promise.resolve();

		// Nothing reconnected: no new socket was constructed.
		expect(lastWsInstance).toBeNull();

		(globalThis as any).WebSocket = MockWebSocket;
	});
});

describe("makeCrdtCatchupSender (wiring #312/#314)", () => {
	function fakeChannel(vaultId: string | null) {
		const calls: Array<[number, number | undefined, string | null | undefined]> = [];
		return {
			calls,
			getVaultId: () => vaultId,
			crdtCatchupSince: async (
				cursorSeq: number,
				limit?: number,
				cursorId?: string | null,
			) => {
				calls.push([cursorSeq, limit, cursorId]);
				return { changes: [], has_more: false, next_seq: null };
			},
		};
	}

	test("forwards ALL THREE args incl. the composite cursorId (#312)", async () => {
		// Regression guard: the production wiring once dropped cursorId (arity-2
		// closure), making the whole composite-cursor fix inert — TS bivariance
		// didn't flag it.
		const ch = fakeChannel("v1");
		const send = makeCrdtCatchupSender(ch, () => "v1");
		await send(5, 500, "row-id");
		expect(ch.calls[0]).toEqual([5, 500, "row-id"]);
	});

	test("throws on a vault mismatch instead of enumerating the wrong vault (#314)", () => {
		const ch = fakeChannel("old-vault");
		const send = makeCrdtCatchupSender(ch, () => "new-vault");
		expect(() => send(0, 500, null)).toThrow(/vault switching/);
		expect(ch.calls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Repo-review safety batch (2026-08): disconnect() must be able to cancel an
// in-flight openSocketInner. The open suspends on the async token fetch; a
// backend/vault switch calls disconnect() in that window, and the resumed open
// must NOT create a live socket the plugin believes is dead.
// ---------------------------------------------------------------------------

describe("disconnect during in-flight open", () => {
	test("disconnect() while the open awaits the token aborts the open (no zombie socket)", async () => {
		let release: (v: string) => void = () => {};
		const provider: AuthProvider = {
			getToken: mock(
				() =>
					new Promise<string>((res) => {
						release = res;
					}),
			),
			getVaultId: mock(() => "7"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
		};
		const channel = new NoteChannel("http://localhost:4000", "", "42", "7");
		channel.setAuthProvider(provider);
		const opening = channel.connect(); // suspends on getToken
		channel.disconnect(); // intentional teardown mid-open
		release("late-token");
		await opening;
		expect(lastWsInstance).toBeNull(); // no socket may exist after teardown
		expect(channel.isConnected()).toBe(false);
	});

	test("a connect() after the aborted open still works", async () => {
		let release: (v: string) => void = () => {};
		let calls = 0;
		const provider: AuthProvider = {
			getToken: mock(() => {
				calls++;
				if (calls === 1) {
					return new Promise<string>((res) => {
						release = res;
					});
				}
				return Promise.resolve("fresh-token");
			}),
			getVaultId: mock(() => "7"),
			isAuthenticated: mock(() => true),
			signOut: mock(() => {}),
		};
		const channel = new NoteChannel("http://localhost:4000", "", "42", "7");
		channel.setAuthProvider(provider);
		const opening = channel.connect();
		channel.disconnect();
		release("late-token");
		await opening;
		await channel.connect(); // a fresh, wanted connect must not be blocked
		expect(lastWsUrl).toContain("fresh-token");
		channel.disconnect();
	});
});
