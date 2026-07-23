/**
 * Tests: NoteChannel self-heal after a crdt: join rejected "unauthorized".
 *
 * Root cause (e2e-clerk test_84, 2026-07-14 triage): a channel whose frozen
 * topic userId went stale (a caller swapped auth without the setAuthProvider
 * ordering contract) rejoins crdt:<staleUserId>:<vaultId> and the backend
 * rejects it "unauthorized". The reconnect identity-refresh guard exists for
 * exactly this, but identityMaybeStale was only ever set by setAuthProvider
 * and is cleared in onopen BEFORE the join result is known, so a join-level
 * rejection never armed it: every backoff reconnect rejoined with the same
 * stale id forever (poison is permanent until reload).
 *
 * Fix: an "unauthorized" join rejection arms identityMaybeStale, so the next
 * reconnect re-derives the userId via the authProbe and rejoins under the
 * authenticated identity, regardless of which caller got the swap wrong.
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
		// Real sockets fire onclose asynchronously after close(); tests fire it
		// manually. Intentional closes (disconnect()) null onclose FIRST, so
		// keeping the handler here does not resurrect suppressed reconnects.
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

/** Open, reject the crdt join with `reason`, close the socket (schedules the
 *  backoff reconnect), fire that reconnect and settle openSocket's awaits. */
async function rejectedCycleThenReconnect(reason: string, staleTopic: string): Promise<void> {
	lastWsInstance.onopen?.();
	rejectCrdtJoin(lastWsInstance, crdtJoinRef(lastWsInstance), reason, staleTopic);
	lastWsInstance.onclose?.({ code: 1000, reason: "", wasClean: true });
	capturedTimers[capturedTimers.length - 1]!.cb();
	// openSocket awaits the token fetch and (when armed) the identity probe.
	for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("NoteChannel unauthorized-join identity self-heal", () => {
	test("an unauthorized crdt join re-derives the userId on the next reconnect", async () => {
		// Channel frozen under stale-user; the socket authenticates as fresh-user.
		const channel = new NoteChannel("http://localhost:4000", "key", "stale-user", "v1");
		let probes = 0;
		channel.setAuthProbe(async () => {
			probes++;
			return { id: "fresh-user" };
		});
		await channel.connect();
		const staleTopic = "crdt:stale-user:v1";
		await rejectedCycleThenReconnect("unauthorized", staleTopic);

		expect(probes).toBe(1);
		lastWsInstance.onopen?.();
		const rejoined = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.filter((m: unknown[]) => (m[3] as string) === "phx_join")
			.map((m: unknown[]) => m[2] as string);
		expect(rejoined).toContain("crdt:fresh-user:v1");
		expect(rejoined).not.toContain(staleTopic);
		channel.disconnect();
	});

	test("an unauthorized crdt join cycles the socket itself (heal needs no external close)", async () => {
		// review finding channel.ts:786: arming identityMaybeStale only helps on
		// the NEXT socket open, but an unauthorized join neither closes the
		// socket nor schedules a reconnect — on a healthy socket the self-heal
		// never fires and CRDT routing stays degraded until an unrelated blip.
		// The channel must cycle the socket itself; the onclose backoff
		// (crdtJoinFailedReason set) keeps it bounded.
		const channel = new NoteChannel("http://localhost:4000", "key", "stale-user", "v1");
		channel.setAuthProbe(async () => ({ id: "fresh-user" }));
		await channel.connect();
		lastWsInstance.onopen?.();
		rejectCrdtJoin(
			lastWsInstance,
			crdtJoinRef(lastWsInstance),
			"unauthorized",
			"crdt:stale-user:v1",
		);
		expect(lastWsInstance.closed).toBe(true);
		channel.disconnect();
	});

	test("a generic join rejection does NOT cycle the socket", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		channel.setAuthProbe(async () => ({ id: "u1" }));
		await channel.connect();
		lastWsInstance.onopen?.();
		rejectCrdtJoin(lastWsInstance, crdtJoinRef(lastWsInstance), "rate_limited", "crdt:u1:v1");
		expect(lastWsInstance.closed).toBe(false);
		channel.disconnect();
	});

	test("a generic join rejection does NOT trigger the identity probe", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		let probes = 0;
		channel.setAuthProbe(async () => {
			probes++;
			return { id: "u1" };
		});
		await channel.connect();
		await rejectedCycleThenReconnect("rate_limited", "crdt:u1:v1");
		expect(probes).toBe(0);
		channel.disconnect();
	});
});
