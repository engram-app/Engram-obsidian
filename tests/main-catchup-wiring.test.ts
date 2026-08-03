/**
 * Tests: connectChannel's reconnect catch-up (main.ts). Plan B1 Task 6 +
 * the deaf-note reconnect-race fix (PR #251).
 *
 * Root cause the race fix addresses: catch-up was triggered from the sync-topic
 * onStatusChange(true), which acks BEFORE the crdt: topic join sets
 * crdtJoined=true. catchupViaSeqReplay → crdt_catchup_since → channel.sendRequest
 * is refused with "crdt topic not joined" until the crdt join lands, so the sole
 * convergence path was silently skipped and never retried (idle notes and
 * cross-device changes never converged until a later reconnect / manual sync).
 * The fix moves the reconcile + re-enroll + catch-up onto channel.onCrdtJoined,
 * which fires only AFTER the crdt join is server-acked.
 *
 * This exercises the REAL connectChannel() (not a reimplementation) via an
 * `Object.create(EngramSyncPlugin.prototype)` fake `this`: real prototype
 * methods (connectChannel, onCrdtTopicJoined, reEnrollOpenCrdtNotes) run with
 * fake data fields, so the actual wiring is under test. The crdt: block wires
 * channel.onCrdtJoined; the heavy CRDT-room objects
 * (createCrdtWiring, CrdtLiveViews) construct against light fakes and are never
 * exercised (syncEngine is stubbed). connectChannel is `private` (genuinely
 * internal), so the cast bypasses the compile-time visibility check without
 * loosening it for production callers.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

// connectChannel() unconditionally calls channel.connect() (real NoteChannel),
// which opens a real WebSocket, install an inert mock, mirroring channel.test.ts.
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

// The CRDT wiring block probes indexedDB.databases; a bare object makes the probe
// read "not a function" and take the skip-schema-wipe branch (no IDB / localStorage
// needed). Force it per-test: a prior test file in the same run may have set
// indexedDB.databases to a real function, which would otherwise route into
// ensureDocSchema and touch window.localStorage (absent here). Restore after so we
// leave the global as we found it.
const gIdb = globalThis as unknown as { indexedDB?: unknown };
const savedIndexedDB = gIdb.indexedDB;
beforeEach(() => {
	gIdb.indexedDB = {};
});
afterAll(() => {
	gIdb.indexedDB = savedIndexedDB;
});

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

type FakeOpts = {
	reconcile?: () => Promise<number>;
	lastMapReconcileAt?: number;
	flushQueue?: () => Promise<number>;
};

function makeFakeThis(catchup: () => Promise<void>, pull: () => Promise<number>, opts?: FakeOpts) {
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		settings: {
			apiUrl: "https://api.example.com",
			apiKey: "key",
			refreshToken: "",
			vaultId: "vault-1",
			userEmail: "a@example.com",
		},
		deviceId: "device-1",
		channelEpoch: 0,
		authProvider: null,
		liveConnected: false,
		everConnected: false,
		// Recently reconciled (now) by default: throttle window closed, so the
		// manifest-reconcile branch is skipped unless a test opens it explicitly.
		lastMapReconcileAt: opts?.lastMapReconcileAt ?? Date.now(),
		crdtEverJoined: false,
		crdtManager: null,
		crdtEnrollment: undefined,
		crdtWiring: undefined,
		crdtLiveViews: null,
		noteIdMap: {
			getOrMint: (p: string) => p,
			pathForId: () => null,
			set: () => {},
			toJSON: () => ({}),
		},
		app: {
			workspace: { getLeavesOfType: () => [] },
		},
		api: {
			getMe: () => Promise.resolve({ id: "user-1", email: "a@example.com" }),
			failWedgedRequests: () => Promise.resolve(),
		},
		syncEngine: {
			getStatus: () => "idle",
			flushQueue: opts?.flushQueue ?? (() => Promise.resolve(0)),
			clearConfirmedNoteIds: () => {},
			reconcileNoteIdMapFromManifest: opts?.reconcile ?? (() => Promise.resolve(0)),
			// Reconnect convergence replays the seq-ordered op-log over the socket
			// (catchupViaSeqReplay, crdt_catchup_since) — the sole catch-up path.
			catchupViaSeqReplay: catchup,
			pull,
			handleStreamEvent: () => Promise.resolve(),
			isUnchangedSynced: () => false,
			isSyncBlocked: () => false,
			// Wired unconditionally by connectChannel; the fake must accept it to
			// reach a clean, error-free assignment. One port patch per lifecycle
			// stage now, so this stub no longer tracks a setter-per-port list.
			setCrdtPorts: () => {},
		},
		updateStatusBar: () => {},
	});
	return fake as typeof fake & {
		noteStream?: {
			onStatusChange?: (connected: boolean) => void;
			onCrdtJoined?: () => void;
		};
	};
}

function runConnectChannel(fakeThis: unknown): void {
	(
		EngramSyncPlugin.prototype as unknown as {
			connectChannel: (a: number, e: number) => void;
		}
	).connectChannel.call(fakeThis as never, 0, 0);
}

describe("connectChannel reconnect catch-up", () => {
	test("catch-up is deferred to onCrdtJoined, not fired on the sync-topic ack", async () => {
		// Reproduces the deaf-note race: the sync topic acks (onStatusChange true)
		// BEFORE the crdt: topic join. Catch-up must NOT run yet: its sendRequest
		// would be refused as "crdt topic not joined" and silently dropped.
		const catchup = mock(() => Promise.resolve());
		const pull = mock(() => Promise.resolve(0));
		const fakeThis = makeFakeThis(catchup, pull);

		runConnectChannel(fakeThis);
		await flushMicrotasks();
		await flushMicrotasks();

		// Sync topic acked, crdt topic NOT joined yet.
		fakeThis.noteStream?.onStatusChange?.(true);
		await flushMicrotasks();
		await flushMicrotasks();
		expect(catchup).not.toHaveBeenCalled();

		// crdt: topic join acked, NOW catch-up runs, exactly once.
		fakeThis.noteStream?.onCrdtJoined?.();
		await flushMicrotasks();
		await flushMicrotasks();
		await flushMicrotasks();
		expect(catchup).toHaveBeenCalledTimes(1);
	});

	test("on crdt join the engine runs socket seq-replay, not REST pull", async () => {
		const catchup = mock(() => Promise.resolve());
		const pull = mock(() => Promise.resolve(0));
		const fakeThis = makeFakeThis(catchup, pull);

		runConnectChannel(fakeThis);
		await flushMicrotasks();
		await flushMicrotasks();

		fakeThis.noteStream?.onCrdtJoined?.();
		await flushMicrotasks();
		await flushMicrotasks();
		await flushMicrotasks();

		expect(catchup).toHaveBeenCalled();
		expect(pull).not.toHaveBeenCalled();
	});

	test("crdt join drains the durable queue AFTER catch-up (Phase E3 — socket is the only delivery path)", async () => {
		// A crdt edit captured while the topic was down (e.g. held behind its
		// create-ack) sits in the durable queue; the drain deliberately skips
		// it until the topic is LIVE. Without this kick it waits for the next
		// periodic flush (~20s+) — e2e test_82's push stalled past the assert
		// window (CI 29945060029). The deleted REST /updates fallback used to
		// deliver regardless of topic state, masking the missing kick.
		const order: string[] = [];
		const catchup = mock(() => {
			order.push("catchup");
			return Promise.resolve();
		});
		const pull = mock(() => Promise.resolve(0));
		const flushQueue = mock(() => {
			order.push("flush");
			return Promise.resolve(0);
		});
		const fakeThis = makeFakeThis(catchup, pull, { flushQueue });

		runConnectChannel(fakeThis);
		await flushMicrotasks();
		await flushMicrotasks();

		fakeThis.noteStream?.onCrdtJoined?.();
		await flushMicrotasks();
		await flushMicrotasks();
		await flushMicrotasks();

		expect(flushQueue).toHaveBeenCalled();
		expect(order).toEqual(["catchup", "flush"]);
	});

	test("a crdt join after the throttle window reconciles the noteIdMap before catchup", async () => {
		const order: string[] = [];
		const catchup = mock(() => {
			order.push("catchup");
			return Promise.resolve();
		});
		const pull = mock(() => Promise.resolve(0));
		const reconcile = mock(() => {
			order.push("reconcile");
			return Promise.resolve(1); // discovers 1 new id
		});
		// Never reconciled (map is stale/empty) — throttle window is open.
		const fakeThis = makeFakeThis(catchup, pull, { reconcile, lastMapReconcileAt: 0 });

		runConnectChannel(fakeThis);
		await flushMicrotasks();
		await flushMicrotasks();

		fakeThis.noteStream?.onCrdtJoined?.();
		await flushMicrotasks();
		await flushMicrotasks();
		await flushMicrotasks();

		expect(reconcile).toHaveBeenCalledTimes(1);
		expect(catchup).toHaveBeenCalled();
		expect(order).toEqual(["reconcile", "catchup"]);
	});

	test("two crdt joins within the throttle window run the reconcile once", async () => {
		const catchup = mock(() => Promise.resolve());
		const pull = mock(() => Promise.resolve(0));
		const reconcile = mock(() => Promise.resolve(0));
		const fakeThis = makeFakeThis(catchup, pull, { reconcile, lastMapReconcileAt: 0 });

		runConnectChannel(fakeThis);
		await flushMicrotasks();
		await flushMicrotasks();

		// A reconnect storm: two crdt joins back-to-back, well inside the window.
		fakeThis.noteStream?.onCrdtJoined?.();
		fakeThis.noteStream?.onCrdtJoined?.();
		await flushMicrotasks();
		await flushMicrotasks();
		await flushMicrotasks();

		expect(reconcile).toHaveBeenCalledTimes(1);
	});
});
