/**
 * Tests: connectChannel's reconnect catch-up (main.ts) — Plan B1 Task 6.
 *
 * Root cause this task fixes: the file-open handler ran a per-open REST
 * manifest-hash check (verifyConvergenceOnOpen, now deleted) to catch a
 * missed CRDT delivery — the ~1s lag on every note open that started this
 * rewire. The socket-native catch-up (catchupViaSocket, Task 5) now owns
 * that job on (re)connect instead: cheaper (no per-open REST round trip) and
 * covers every open note in one pass instead of one-at-a-time on open.
 *
 * This exercises the REAL connectChannel() (not a reimplementation) via the
 * same `EngramSyncPlugin.prototype.<method>.call(fakeThis, ...)` pattern
 * already used for saveOAuthTokens (main-oauth-token-rebind.test.ts): a fake
 * `this` supplies just what the reconnect branch of channel.onStatusChange
 * touches. `enableCrdt: false` skips the heavier CRDT-room wiring block
 * (createCrdtWiring, ensureDocSchema, CrdtLiveViews) — irrelevant to this
 * reconnect-catchup decision — so the fake stays small. connectChannel is
 * `private` (genuinely internal — only called from within the class, unlike
 * the public saveOAuthTokens/clearOAuthTokens the other tests reach the same
 * way), so this cast bypasses the compile-time visibility check without
 * loosening it for production callers.
 */
import { describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

// connectChannel() unconditionally calls channel.connect() (real NoteChannel),
// which opens a real WebSocket — install a inert mock, mirroring channel.test.ts.
class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: ((evt: unknown) => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	constructor(_url: string) {}
	send(_data: string): void {}
	close(): void {}
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFakeThis(catchup: () => Promise<void>, pull: () => Promise<number>) {
	return {
		settings: {
			apiUrl: "https://api.example.com",
			apiKey: "key",
			refreshToken: "",
			vaultId: "vault-1",
			enableCrdt: false, // skip the CRDT-room wiring block, irrelevant here
			userEmail: "a@example.com",
		},
		deviceId: "device-1",
		channelEpoch: 0,
		authProvider: null,
		liveConnected: false,
		everConnected: false,
		crdtMapReconciled: true, // skip the manifest-reconcile branch, irrelevant here
		crdtEverJoined: false,
		crdtManager: null,
		crdtEnrollment: undefined,
		crdtWiring: undefined,
		api: {
			getMe: () => Promise.resolve({ id: "user-1", email: "a@example.com" }),
			failWedgedRequests: () => Promise.resolve(),
		},
		syncEngine: {
			getStatus: () => "idle",
			clearConfirmedNoteIds: () => {},
			reconcileNoteIdMapFromManifest: () => Promise.resolve(0),
			catchupViaSocket: catchup,
			pull: pull,
			// Wired unconditionally by connectChannel right after this.noteStream
			// is assigned (before the onStatusChange closure under test runs) —
			// the fake must accept them to reach a clean, error-free assignment.
			setCrdtCreate: () => {},
			setCrdtDelete: () => {},
			setCrdtCatchup: () => {},
		},
		updateStatusBar: () => {},
	};
}

describe("connectChannel reconnect catch-up", () => {
	test("on (re)connect the engine runs socket catchup, not REST pull", async () => {
		const catchup = mock(() => Promise.resolve());
		const pull = mock(() => Promise.resolve(0));
		const fakeThis = makeFakeThis(catchup, pull);

		(
			EngramSyncPlugin.prototype as unknown as {
				connectChannel: (a: number, e: number) => void;
			}
		).connectChannel.call(fakeThis as never, 0, 0);
		await flushMicrotasks();
		await flushMicrotasks();

		fakeThis.noteStream?.onStatusChange?.(true);
		await flushMicrotasks();
		await flushMicrotasks();

		expect(catchup).toHaveBeenCalled();
		expect(pull).not.toHaveBeenCalled();
	});
});
