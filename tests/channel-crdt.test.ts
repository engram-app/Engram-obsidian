/**
 * Tests: NoteChannel CRDT transport.
 * - joins crdt:{userId}:{vaultId} topic on connect
 * - sendCrdt pushes a crdt_msg event on the crdt topic
 * - inbound crdt_msg routes to onCrdtMessage callback
 * - crdt topic join error is graceful (does not affect connected state)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NoteChannel } from "../src/channel";

let lastWsUrl: string | null = null;
let lastWsInstance: any = null;

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
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

(globalThis as any).WebSocket = MockWebSocket;

function simulateOpen(ws: any): void {
	ws.onopen?.();
}

function simulateMessage(ws: any, msg: unknown[]): void {
	ws.onmessage?.({ data: JSON.stringify(msg) });
}

beforeEach(() => {
	lastWsUrl = null;
	lastWsInstance = null;
});

describe("NoteChannel CRDT topic join", () => {
	test("joins crdt:{userId}:{vaultId} topic when vaultId is set", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Messages: [0]=sync topic join, [1]=user topic join, [2]=crdt topic join
		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));

		expect(crdtJoin).toBeDefined();
		expect(crdtJoin![2]).toBe("crdt:u1:v1");
		expect(crdtJoin![3]).toBe("phx_join");

		channel.disconnect();
	});

	test("crdt topic join payload includes crdt_proto: 2", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));

		expect(crdtJoin).toBeDefined();
		expect(crdtJoin![4]).toEqual({ crdt_proto: 2 });

		channel.disconnect();
	});

	test("does NOT join crdt topic when vaultId is null", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));

		expect(crdtJoin).toBeUndefined();

		channel.disconnect();
	});

	test("does NOT join crdt topic when CRDT is disabled (default), even with vaultId", async () => {
		// enableCrdt defaults to false → the plugin must behave exactly like a
		// non-CRDT build: no crdt: join, isCrdtConnected stays false, every save
		// goes through the legacy push path.
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));

		expect(crdtJoin).toBeUndefined();
		expect(channel.isCrdtConnected()).toBe(false);

		channel.disconnect();
	});

	test("crdt topic join error is graceful and does not flip connected", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Simulate crdt topic join error
		expect(() =>
			simulateMessage(lastWsInstance, [
				"3",
				"9",
				"crdt:u1:v1",
				"phx_reply",
				{ status: "error", response: { reason: "unmatched topic" } },
			]),
		).not.toThrow();
		expect(channel.isConnected()).toBe(false); // sync topic not yet joined

		channel.disconnect();
	});
});

describe("NoteChannel.sendCrdt", () => {
	test("pushes a crdt_msg event with doc_id and b64 on the crdt topic", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const beforeCount = lastWsInstance.sent.length;
		channel.sendCrdt("v1/note.md", "dGVzdA==");

		const newMessages = lastWsInstance.sent
			.slice(beforeCount)
			.map((s: string) => JSON.parse(s) as unknown[]);
		const crdtMsg = newMessages.find((m: unknown[]) => m[3] === "crdt_msg");

		expect(crdtMsg).toBeDefined();
		// join_ref MUST match the crdt: topic's join_ref ("3"). Phoenix routes
		// channel messages by (topic, join_ref); a null/mismatched join_ref means
		// the message is silently dropped before reaching the channel — which made
		// every CRDT update vanish before it hit the backend.
		expect(crdtMsg![0]).toBe("3");
		expect(crdtMsg![2]).toBe("crdt:u1:v1"); // topic
		expect((crdtMsg![4] as { doc_id: string }).doc_id).toBe("v1/note.md");
		expect((crdtMsg![4] as { b64: string }).b64).toBe("dGVzdA==");

		channel.disconnect();
	});

	test("sendCrdt is a no-op when vaultId is null (no crdt topic)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const beforeCount = lastWsInstance.sent.length;
		channel.sendCrdt("v1/note.md", "dGVzdA==");
		// No new crdt_msg should be sent
		const newMessages = lastWsInstance.sent
			.slice(beforeCount)
			.map((s: string) => JSON.parse(s) as unknown[]);
		expect(newMessages.every((m: unknown[]) => m[3] !== "crdt_msg")).toBe(true);

		channel.disconnect();
	});
});

describe("NoteChannel inbound crdt_msg", () => {
	test("routes inbound crdt_msg to onCrdtMessage callback", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		const received: { docId: string; b64: string }[] = [];
		channel.onCrdtMessage = (docId, b64) => received.push({ docId, b64 });
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"crdt:u1:v1",
			"crdt_msg",
			{ doc_id: "v1/note.md", b64: "dGVzdA==" },
		]);

		expect(received.length).toBe(1);
		expect(received[0]!.docId).toBe("v1/note.md");
		expect(received[0]!.b64).toBe("dGVzdA==");

		channel.disconnect();
	});

	test("crdt_msg without onCrdtMessage is a no-op (no crash)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		expect(() =>
			simulateMessage(lastWsInstance, [
				null,
				null,
				"crdt:u1:v1",
				"crdt_msg",
				{ doc_id: "v1/note.md", b64: "dGVzdA==" },
			]),
		).not.toThrow();

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// inbound crdt_doc_ready — device-B discovery announce
// ---------------------------------------------------------------------------

describe("NoteChannel inbound crdt_doc_ready", () => {
	test("routes inbound crdt_doc_ready to onCrdtDocReady callback", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		const ready: string[] = [];
		channel.onCrdtDocReady = (docId) => ready.push(docId);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"crdt:u1:v1",
			"crdt_doc_ready",
			{ doc_id: "v1/note.md" },
		]);

		expect(ready).toEqual(["v1/note.md"]);

		channel.disconnect();
	});

	test("crdt_doc_ready without onCrdtDocReady is a no-op (no crash)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		expect(() =>
			simulateMessage(lastWsInstance, [
				null,
				null,
				"crdt:u1:v1",
				"crdt_doc_ready",
				{ doc_id: "v1/note.md" },
			]),
		).not.toThrow();

		channel.disconnect();
	});

	test("crdt_doc_ready without doc_id does not fire callback", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		let fired = false;
		channel.onCrdtDocReady = () => {
			fired = true;
		};
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [null, null, "crdt:u1:v1", "crdt_doc_ready", {}]);

		expect(fired).toBe(false);

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// isCrdtConnected / onCrdtJoined — graceful degradation gate
// ---------------------------------------------------------------------------

describe("NoteChannel.isCrdtConnected and onCrdtJoined", () => {
	test("isCrdtConnected() is false before the crdt: topic join is acknowledged", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Before any phx_reply for the crdt topic
		expect(channel.isCrdtConnected()).toBe(false);

		channel.disconnect();
	});

	test("isCrdtConnected() is true after crdt: topic join ok", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);

		expect(channel.isCrdtConnected()).toBe(true);

		channel.disconnect();
	});

	test("isCrdtConnected() stays false when the crdt: topic join errors (non-CRDT backend)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "unmatched topic" } },
		]);

		expect(channel.isCrdtConnected()).toBe(false);

		channel.disconnect();
	});

	test("onCrdtJoined fires exactly once when crdt: topic join ok", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		const joined = mock();
		channel.onCrdtJoined = joined;
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);

		expect(joined).toHaveBeenCalledTimes(1);

		channel.disconnect();
	});

	test("onCrdtJoined does NOT fire when the crdt: topic join errors", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		const joined = mock();
		channel.onCrdtJoined = joined;
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "unmatched topic" } },
		]);

		expect(joined).not.toHaveBeenCalled();

		channel.disconnect();
	});

	test("onCrdtJoined does NOT fire when vaultId is null (crdt topic not joined)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		const joined = mock();
		channel.onCrdtJoined = joined;
		await channel.connect();
		simulateOpen(lastWsInstance);

		expect(joined).not.toHaveBeenCalled();

		channel.disconnect();
	});

	test("isCrdtConnected() resets to false after disconnect", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);
		expect(channel.isCrdtConnected()).toBe(true);

		// Simulate disconnect via onStatusChange (setConnected(false))
		// In tests we call disconnect() which clears onclose to prevent reconnect
		// and calls setConnected(false) via disconnect().
		// We need to simulate a ws close instead to trigger the same path.
		channel.disconnect();

		expect(channel.isCrdtConnected()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Graceful degradation integration: SyncEngine + NoteChannel join gate
// The key invariant: CRDT routing is only active when onCrdtJoined has fired.
// Against a non-CRDT backend the join errors; setCrdtManager is never called;
// legacy pushNote handles all markdown saves.
// ---------------------------------------------------------------------------

describe("Graceful degradation: setCrdtManager deferred to onCrdtJoined", () => {
	test("onCrdtJoined wires setCrdtManager; before join, manager is not wired", async () => {
		// Simulate the pattern from main.ts: wire onCrdtJoined to call setCrdtManager
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		let managerWired = false;
		channel.onCrdtJoined = () => {
			managerWired = true;
		};

		// Before join acknowledgement: manager not wired
		expect(managerWired).toBe(false);
		expect(channel.isCrdtConnected()).toBe(false);

		// Server acknowledges crdt: join
		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);

		// After join: callback fired, manager wired
		expect(managerWired).toBe(true);
		expect(channel.isCrdtConnected()).toBe(true);

		channel.disconnect();
	});

	test("crdt: join error → onCrdtJoined never fires → manager stays null (non-CRDT backend)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		let managerWired = false;
		channel.onCrdtJoined = () => {
			managerWired = true;
		};

		// Backend does not support CRDT: join error
		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "unmatched topic" } },
		]);

		// Graceful degradation: onCrdtJoined never fired, manager stays null
		expect(managerWired).toBe(false);
		expect(channel.isCrdtConnected()).toBe(false);

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// Task 7 (Part A — T4 folded finding): onCrdtJoinError callback
// A crdt: topic REJOIN error while crdtEverJoined=true must degrade to legacy.
// The callback fires for any error reply on the crdt: topic, so main.ts can
// reset crdtEverJoined + setCrdtManager(null) + clearSynced().
// ---------------------------------------------------------------------------

describe("onCrdtJoinError: crdt join error fires callback with reason", () => {
	// main.ts wires onCrdtJoinError to reset crdtEverJoined, setCrdtManager(null), clearSynced(),
	// and crdtEnrollment.resetAll(). This last step is critical: a later same-socket rejoin must
	// re-fire STEP1s; resetAll clears the once-per-session guard so enrollment can re-enroll paths
	// that were previously marked as synced. Unit testing of this logic is via channel.ts tests below;
	// the enrollment integration is simple enough for review verification.
	//
	// C2 ref-matching: onCrdtJoinError now only fires when the error reply's ref matches
	// crdtJoinMsgRef (the ref sent with the crdt: phx_join). The channel sends 3 frames on
	// connect: sync join (ref="1"), user join (ref="2"), crdt join (ref="3"). So the join
	// error reply must carry ref="3" to trigger onCrdtJoinError. The pre-ref-matching
	// behavior (any error on the crdt topic fires) is intentionally updated here.

	test("fires onCrdtJoinError with the reason string when crdt: topic errors (join ref matches)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Capture the ref the channel sent in the crdt phx_join frame (should be "3").
		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));
		const joinRef = crdtJoin![1] as string; // position 1 = msg ref

		const errors: { reason: string | undefined; min?: number }[] = [];
		channel.onCrdtJoinError = (reason, min) => errors.push({ reason, min });

		// Reply with the actual join ref — this is the join error path.
		simulateMessage(lastWsInstance, [
			"3",
			joinRef,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "unmatched topic" } },
		]);

		expect(errors.length).toBe(1);
		expect(errors[0]!.reason).toBe("unmatched topic");
		expect(errors[0]!.min).toBeUndefined();

		channel.disconnect();
	});

	test("fires onCrdtJoinError with undefined reason when no reason in payload (join ref matches)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));
		const joinRef = crdtJoin![1] as string;

		const errors: { reason: string | undefined; min?: number }[] = [];
		channel.onCrdtJoinError = (reason, min) => errors.push({ reason, min });

		simulateMessage(lastWsInstance, [
			"3",
			joinRef,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: {} },
		]);

		expect(errors.length).toBe(1);
		expect(errors[0]!.reason).toBeUndefined();
		expect(errors[0]!.min).toBeUndefined();

		channel.disconnect();
	});

	test("does NOT fire onCrdtJoinError for a crdt_msg error reply (non-matching ref — rate_limited)", async () => {
		// Backend #846 adds per-message error replies on crdt_msg frames (e.g. "rate_limited",
		// "frame_too_large"). These carry a DIFFERENT ref than the join frame. A single
		// rate-limit trip must NOT tear down the CRDT session.
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		let fired = false;
		channel.onCrdtJoinError = () => {
			fired = true;
		};

		// Simulate a crdt_msg error reply with a ref that does NOT match the join ref.
		// The join ref is "3"; a crdt_msg reply would carry a later ref like "99".
		simulateMessage(lastWsInstance, [
			"3",
			"99",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "rate_limited" } },
		]);

		expect(fired).toBe(false);

		channel.disconnect();
	});

	test("does NOT fire onCrdtJoinError for a user topic join error", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		let fired = false;
		channel.onCrdtJoinError = () => {
			fired = true;
		};

		// Error on the user topic — must NOT trigger onCrdtJoinError
		simulateMessage(lastWsInstance, [
			"2",
			"2",
			"user:u1",
			"phx_reply",
			{ status: "error", response: { reason: "unmatched topic" } },
		]);

		expect(fired).toBe(false);

		channel.disconnect();
	});

	test("does NOT fire onCrdtJoinError for the sync topic join error", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		let fired = false;
		channel.onCrdtJoinError = () => {
			fired = true;
		};

		// Error on the main sync topic — must NOT trigger onCrdtJoinError
		simulateMessage(lastWsInstance, [
			"1",
			"1",
			"sync:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "forbidden" } },
		]);

		expect(fired).toBe(false);

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// Task 7 (Part B — audit F13): crdt_proto_too_old surfaces min version
// When the rejoin error reason is "crdt_proto_too_old", the callback receives
// the server's minimum supported proto version from response.min.
// ---------------------------------------------------------------------------

describe("onCrdtJoinError: crdt_proto_too_old surfaces min proto version", () => {
	test("fires onCrdtJoinError with reason and min when crdt_proto_too_old (join ref matches)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));
		const joinRef = crdtJoin![1] as string;

		const errors: { reason: string | undefined; min?: number }[] = [];
		channel.onCrdtJoinError = (reason, min) => errors.push({ reason, min });

		simulateMessage(lastWsInstance, [
			"3",
			joinRef,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "crdt_proto_too_old", min: 3 } },
		]);

		expect(errors.length).toBe(1);
		expect(errors[0]!.reason).toBe("crdt_proto_too_old");
		expect(errors[0]!.min).toBe(3);

		channel.disconnect();
	});

	test("fires onCrdtJoinError with min undefined when crdt_proto_too_old but no min field (join ref matches)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1", true);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));
		const joinRef = crdtJoin![1] as string;

		const errors: { reason: string | undefined; min?: number }[] = [];
		channel.onCrdtJoinError = (reason, min) => errors.push({ reason, min });

		simulateMessage(lastWsInstance, [
			"3",
			joinRef,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "crdt_proto_too_old" } },
		]);

		expect(errors.length).toBe(1);
		expect(errors[0]!.reason).toBe("crdt_proto_too_old");
		expect(errors[0]!.min).toBeUndefined();

		channel.disconnect();
	});
});
