/**
 * Tests: NoteChannel CRDT transport.
 * - joins crdt:{userId}:{vaultId} topic on connect
 * - sendCrdt pushes a crdt_msg event on the crdt topic
 * - inbound crdt_msg routes to onCrdtMessage callback
 * - crdt topic join error is graceful (does not affect connected state)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NoteChannel } from "../src/channel";

let _lastWsUrl: string | null = null;
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
		_lastWsUrl = url;
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

/** News up a channel, opens the mock socket, and acks all three joins
 *  (sync, user, crdt) so the crdt: topic is joined and ready for
 *  sendRequest tests. Mirrors the [0]=sync join, [1]=user join,
 *  [2]=crdt join setup used across this file. */
async function joinedCrdtChannel(): Promise<{ channel: NoteChannel; ws: any }> {
	const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
	await channel.connect();
	const ws = lastWsInstance;
	simulateOpen(ws);
	simulateMessage(ws, [null, "1", "sync:u1:v1", "phx_reply", { status: "ok", response: {} }]);
	simulateMessage(ws, [null, "2", "user:u1", "phx_reply", { status: "ok", response: {} }]);
	simulateMessage(ws, [null, "3", "crdt:u1:v1", "phx_reply", { status: "ok", response: {} }]);
	return { channel, ws };
}

beforeEach(() => {
	_lastWsUrl = null;
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

	test("crdt topic join payload includes crdt_proto: 2", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));

		expect(crdtJoin).toBeDefined();
		expect(crdtJoin![4]).toEqual({ crdt_proto: 2, client_type: "obsidian" });

		channel.disconnect();
	});

	test("crdt topic join payload tags client_type: obsidian", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		const crdtJoin = lastWsInstance.sent
			.map((s: string) => JSON.parse(s) as unknown[])
			.find((m: unknown[]) => (m[2] as string).startsWith("crdt:"));

		// The tag tells the backend Obsidian rewrites its own [[wikilinks]] on
		// rename, so the server must NOT enqueue its rewriter (engram#648
		// Phase 2, exactly-one-rewriter invariant). Removing this tag would
		// re-enter the untagged compromise path on old backends and, once the
		// backend default flips, cause DOUBLE rewrites. Do not remove.
		expect((crdtJoin![4] as Record<string, unknown>).client_type).toBe("obsidian");

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
	function ackCrdtJoin(): void {
		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);
	}

	// Was: "pushes a crdt_msg event with doc_id and b64 on the crdt topic" —
	// that test sent BEFORE any join ack and asserted the frame WAS emitted,
	// enshrining the plugin #179 failure shape (a frame with a stale/absent
	// join_ref is silently dropped server-side). Flipped below: pre-join must
	// drop, not send.
	test("drops (returns false) before the crdt: join is acked", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);
		// NO join ack delivered for the crdt: topic.

		const beforeCount = lastWsInstance.sent.length;
		const sent = channel.sendCrdt("v1/note.md", "dGVzdA==");

		expect(sent).toBe(false);
		const newMessages = lastWsInstance.sent
			.slice(beforeCount)
			.map((s: string) => JSON.parse(s) as unknown[]);
		expect(newMessages.some((m: unknown[]) => m[3] === "crdt_msg")).toBe(false);

		channel.disconnect();
	});

	test("emits (returns true) a crdt_msg event with doc_id and b64 after the crdt: join is acked", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);
		ackCrdtJoin();

		const beforeCount = lastWsInstance.sent.length;
		const sent = channel.sendCrdt("v1/note.md", "dGVzdA==");

		expect(sent).toBe(true);
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

	test("sendCrdt is a no-op (returns false) when vaultId is null (no crdt topic)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		await channel.connect();
		simulateOpen(lastWsInstance);

		const beforeCount = lastWsInstance.sent.length;
		const sent = channel.sendCrdt("v1/note.md", "dGVzdA==");
		expect(sent).toBe(false);
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

	test("routes inbound note_yjs_update to onNoteYjsUpdate callback, carrying seq", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const received: { noteId: string; b64: string; head: string; seq?: number | null }[] = [];
		channel.onNoteYjsUpdate = (noteId, b64, head, seq) =>
			received.push({ noteId, b64, head, seq });
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ note_id: "id-a", b64: "dGVzdA==", head: "SRV", seq: 42 },
		]);

		expect(received).toEqual([{ noteId: "id-a", b64: "dGVzdA==", head: "SRV", seq: 42 }]);

		channel.disconnect();
	});

	// Task 1 (backend) attaches "seq" to the note_yjs_update broadcast, but an
	// old backend (or a pre-Task-1 release) sends the frame with no "seq" key
	// at all — back-compat must thread through undefined, not crash or coerce
	// to 0 (0 is a valid gap-heal cursor value, not "absent").
	test("note_yjs_update without a seq field passes seq=undefined (old-backend back-compat)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const received: { noteId: string; b64: string; head: string; seq?: number | null }[] = [];
		channel.onNoteYjsUpdate = (noteId, b64, head, seq) =>
			received.push({ noteId, b64, head, seq });
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ note_id: "id-a", b64: "dGVzdA==", head: "SRV" },
		]);

		expect(received).toEqual([
			{ noteId: "id-a", b64: "dGVzdA==", head: "SRV", seq: undefined },
		]);

		channel.disconnect();
	});

	// The compile-time `as number | null | undefined` cast can't stop a
	// malformed/foreign frame from carrying a non-integer at runtime — the
	// frame boundary must guard it, not just trust the cast (final review).
	test("note_yjs_update with a non-integer seq (string) is normalized to undefined", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const received: { noteId: string; b64: string; head: string; seq?: number | null }[] = [];
		channel.onNoteYjsUpdate = (noteId, b64, head, seq) =>
			received.push({ noteId, b64, head, seq });
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ note_id: "id-a", b64: "dGVzdA==", head: "SRV", seq: "42" },
		]);

		expect(received).toEqual([
			{ noteId: "id-a", b64: "dGVzdA==", head: "SRV", seq: undefined },
		]);

		channel.disconnect();
	});

	test("note_yjs_update with a non-integer seq (float) is normalized to undefined", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const received: { noteId: string; b64: string; head: string; seq?: number | null }[] = [];
		channel.onNoteYjsUpdate = (noteId, b64, head, seq) =>
			received.push({ noteId, b64, head, seq });
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ note_id: "id-a", b64: "dGVzdA==", head: "SRV", seq: 8.5 },
		]);

		expect(received).toEqual([
			{ noteId: "id-a", b64: "dGVzdA==", head: "SRV", seq: undefined },
		]);

		channel.disconnect();
	});

	test("note_yjs_update without onNoteYjsUpdate is a no-op (no crash)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		expect(() =>
			simulateMessage(lastWsInstance, [
				null,
				null,
				"sync:u1:v1",
				"note_yjs_update",
				{ note_id: "id-a", b64: "dGVzdA==", head: "SRV" },
			]),
		).not.toThrow();

		channel.disconnect();
	});

	// b#4 (test-coverage review): a malformed note_yjs_update missing a required
	// field must be dropped silently — never delivered as a partial event that
	// would apply undefined bytes / persist an undefined head.
	test("note_yjs_update with a missing field does NOT invoke the callback", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const received: unknown[] = [];
		channel.onNoteYjsUpdate = (noteId, b64, head) => received.push({ noteId, b64, head });
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Missing head.
		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ note_id: "id-a", b64: "dGVzdA==" },
		]);
		// Missing b64.
		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ note_id: "id-a", head: "SRV" },
		]);
		// Missing note_id.
		simulateMessage(lastWsInstance, [
			null,
			null,
			"sync:u1:v1",
			"note_yjs_update",
			{ b64: "dGVzdA==", head: "SRV" },
		]);

		expect(received).toEqual([]);

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// inbound crdt_doc_ready — device-B discovery announce
// ---------------------------------------------------------------------------

describe("NoteChannel inbound crdt_doc_ready", () => {
	test("routes inbound crdt_doc_ready to onCrdtDocReady callback", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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

	test("forwards the announce path to onCrdtDocReady (empty-note discovery, test_27)", async () => {
		// The backend now carries the note's path on the announce so an empty note
		// (zero Y.Doc ops → no note_yjs_update) can be discovered immediately.
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const calls: Array<[string, string | undefined]> = [];
		channel.onCrdtDocReady = (docId, path) => calls.push([docId, path]);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			null,
			"crdt:u1:v1",
			"crdt_doc_ready",
			{ doc_id: "v1/note.md", path: "v1/note.md" },
		]);

		expect(calls).toEqual([["v1/note.md", "v1/note.md"]]);

		channel.disconnect();
	});

	test("a note_not_found error reply routes to onCrdtNoteNotFound (backend #955)", async () => {
		// The backend now replies {reason: "note_not_found", doc_id} when a
		// crdt_msg names an id it has no row for — the create-race cross-wire
		// signature. The plugin must surface it so the sync engine can run its
		// live id-map reconcile immediately instead of waiting for an announce.
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const missing: string[] = [];
		channel.onCrdtNoteNotFound = (docId) => missing.push(docId);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			"7",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "note_not_found", doc_id: "dead-id-123" } },
		]);

		expect(missing).toEqual(["dead-id-123"]);

		channel.disconnect();
	});

	test("note_not_found on a NON-crdt topic does not fire the heal callback", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const missing: string[] = [];
		channel.onCrdtNoteNotFound = (docId) => missing.push(docId);
		await channel.connect();
		simulateOpen(lastWsInstance);

		simulateMessage(lastWsInstance, [
			null,
			"8",
			"sync:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "note_not_found", doc_id: "x" } },
		]);

		expect(missing).toEqual([]);
		channel.disconnect();
	});

	test("note_not_found without doc_id falls through (no crash, no callback)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const missing: string[] = [];
		channel.onCrdtNoteNotFound = (docId) => missing.push(docId);
		await channel.connect();
		simulateOpen(lastWsInstance);

		expect(() =>
			simulateMessage(lastWsInstance, [
				null,
				"9",
				"crdt:u1:v1",
				"phx_reply",
				{ status: "error", response: { reason: "note_not_found" } },
			]),
		).not.toThrow();

		expect(missing).toEqual([]);
		channel.disconnect();
	});

	test("crdt_doc_ready without onCrdtDocReady is a no-op (no crash)", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
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

// ---------------------------------------------------------------------------
// #191: crdtJoined must reset on UNCLEAN close.
// If the crdt: join ack lands but the sync-topic ack never does, `connected`
// is still false, so onclose's setConnected(false) is a transition-gated
// no-op — crdtJoined must not survive the socket via that hole.
// ---------------------------------------------------------------------------

describe("crdtJoined resets on unclean close (#191)", () => {
	test("crdt ack without sync ack, then unclean close: crdt gate closes", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await channel.connect();
		simulateOpen(lastWsInstance);

		// Only the crdt: join is acked; the sync-topic ack never lands.
		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);
		expect(channel.isCrdtConnected()).toBe(true);
		expect(channel.isConnected()).toBe(false);

		// Unclean close (network drop) — real browsers pass a CloseEvent.
		lastWsInstance.onclose?.({ code: 1006, reason: "", wasClean: false });

		// The join-ack contract must be re-established on the next socket:
		// a stale crdtJoined lets sendCrdt claim success with no socket
		// (send() silently drops frames when the ws is not OPEN).
		expect(channel.isCrdtConnected()).toBe(false);
		expect(channel.sendCrdt("v1/note.md", "dGVzdA==")).toBe(false);

		channel.disconnect();
	});

	test("onCrdtJoined re-fires after an unclean close and rejoin", async () => {
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

		// Unclean close, then a new socket joins and the server acks again.
		lastWsInstance.onclose?.({ code: 1006, reason: "", wasClean: false });
		await channel.connect();
		simulateOpen(lastWsInstance);
		simulateMessage(lastWsInstance, [
			"3",
			"2",
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: {} },
		]);

		// A stale crdtJoined makes the join-ack handler's !crdtJoined guard
		// skip this second fire, leaving main.ts unwired on the new session.
		expect(joined).toHaveBeenCalledTimes(2);

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// Task 1: channel request/reply plumbing (sendRequest + pendingReplies)
// The one await-reply path the channel has — foundation for the socket-frame
// senders that route create/delete/catch-up over the CRDT socket.
// ---------------------------------------------------------------------------

describe("NoteChannel.sendRequest", () => {
	test("sendRequest resolves on the matching phx_reply ref", async () => {
		const { channel, ws } = await joinedCrdtChannel();
		const p = channel.sendRequest("crdt_catchup_since", { cursor_seq: 0 });
		// last outbound frame is the request; extract its ref (index 1 of the Phoenix array)
		const frames = ws.sent.map((s: string) => JSON.parse(s));
		const reqFrame = frames.find((f: unknown[]) => f[3] === "crdt_catchup_since");
		const ref = reqFrame[1];
		simulateMessage(ws, [
			null,
			ref,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: { changes: [], has_more: false, next_seq: null } },
		]);
		await expect(p).resolves.toEqual({ changes: [], has_more: false, next_seq: null });

		channel.disconnect();
	});

	test("sendRequest rejects on an error reply", async () => {
		const { channel, ws } = await joinedCrdtChannel();
		const p = channel.sendRequest("crdt_catchup_since", { cursor_seq: 0 });
		const frames = ws.sent.map((s: string) => JSON.parse(s));
		const ref = frames.find((f: unknown[]) => f[3] === "crdt_catchup_since")[1];
		simulateMessage(ws, [
			null,
			ref,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "error", response: { reason: "not_found" } },
		]);
		await expect(p).rejects.toThrow(/not_found/);

		channel.disconnect();
	});
});

// ---------------------------------------------------------------------------
// Task 2: the four socket-frame senders (crdt_create/delete/catchup_heads/delta)
// ---------------------------------------------------------------------------

describe("NoteChannel CRDT frame senders", () => {
	test("crdtCreate returns the server's doc_id (adopt returns a different id)", async () => {
		const { channel, ws } = await joinedCrdtChannel();
		const p = channel.crdtCreate("client-id-X", "Notes/n.md");
		const ref = ws.sent
			.map((s: string) => JSON.parse(s))
			.find((f: unknown[]) => f[3] === "crdt_create")[1];
		simulateMessage(ws, [
			null,
			ref,
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: { doc_id: "server-id-Y" } },
		]);
		await expect(p).resolves.toBe("server-id-Y");

		channel.disconnect();
	});

	test("crdtCreateBatch sends crdt_create_batch with the creates and returns results", async () => {
		const { channel, ws } = await joinedCrdtChannel();
		const creates = [{ doc_id: "id1", path: "A.md", b64: "Zg==" }];
		const p = channel.crdtCreateBatch(creates);
		const frame = ws.sent
			.map((s: string) => JSON.parse(s))
			.find((f: unknown[]) => f[3] === "crdt_create_batch");
		expect(frame[4]).toEqual({ creates });
		const reply = { results: [{ doc_id: "id1", status: "ok" }] };
		simulateMessage(ws, [
			null,
			frame[1],
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: reply },
		]);
		await expect(p).resolves.toEqual(reply);

		channel.disconnect();
	});

	test("crdtDeleteAcked sends the frame and resolves on the server ack", async () => {
		const { channel, ws } = await joinedCrdtChannel();
		const p = channel.crdtDeleteAcked("n1");
		const f = ws.sent
			.map((s: string) => JSON.parse(s))
			.find((x: unknown[]) => x[3] === "crdt_delete");
		expect(f[4]).toEqual({ doc_id: "n1" });
		simulateMessage(ws, [
			null,
			f[1],
			"crdt:u1:v1",
			"phx_reply",
			{ status: "ok", response: { doc_id: "n1" } },
		]);
		await expect(p).resolves.toEqual({ doc_id: "n1" });

		channel.disconnect();
	});
});

describe("in-flight sendRequest on unclean close (repo-review 2026-08)", () => {
	test("an unintentional socket close rejects pending replies promptly instead of hanging to the timeout", async () => {
		const { channel, ws } = await joinedCrdtChannel();
		const outcomeOf = (p: Promise<unknown>) =>
			p.then(
				() => "resolved",
				() => "rejected",
			);
		const p = outcomeOf(channel.crdtCatchupSince(0));
		ws.onclose?.({ code: 1006, reason: "", wasClean: false }); // network drop, NOT disconnect()
		const outcome = await Promise.race([
			p,
			new Promise((r) => setTimeout(() => r("still-pending"), 100)),
		]);
		expect(outcome).toBe("rejected");
		channel.disconnect();
	});
});
