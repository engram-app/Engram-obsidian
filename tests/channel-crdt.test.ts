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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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

	test("crdt topic join error is graceful and does not flip connected", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const beforeCount = lastWsInstance.sent.length;
		channel.sendCrdt("v1/note.md", "dGVzdA==");

		const newMessages = lastWsInstance.sent
			.slice(beforeCount)
			.map((s: string) => JSON.parse(s) as unknown[]);
		const crdtMsg = newMessages.find((m: unknown[]) => m[3] === "crdt_msg");

		expect(crdtMsg).toBeDefined();
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
// isCrdtConnected / onCrdtJoined — graceful degradation gate
// ---------------------------------------------------------------------------

describe("NoteChannel.isCrdtConnected and onCrdtJoined", () => {
	test("isCrdtConnected() is false before the crdt: topic join is acknowledged", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Before any phx_reply for the crdt topic
		expect(channel.isCrdtConnected()).toBe(false);

		channel.disconnect();
	});

	test("isCrdtConnected() is true after crdt: topic join ok", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
