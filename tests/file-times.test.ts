/**
 * Tests: file times on every create and edit message.
 * One test per payload builder (crdt_create, crdt_msg, crdt_doc_update), plus
 * the helper that is the single reader of a file's stat.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { NoteChannel } from "../src/channel";
import { fileTimes } from "../src/file-times";

let lastWsInstance: any = null;

class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: any) => void) | null = null;
	sent: string[] = [];
	constructor() {
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

function reply(ws: any, ref: unknown, topic: string, response: unknown = {}): void {
	ws.onmessage?.({
		data: JSON.stringify([null, ref, topic, "phx_reply", { status: "ok", response }]),
	});
}

async function joined(): Promise<{ channel: NoteChannel; ws: any }> {
	const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
	await channel.connect();
	const ws = lastWsInstance;
	ws.onopen?.();
	reply(ws, "1", "sync:u1:v1");
	reply(ws, "2", "user:u1");
	reply(ws, "3", "crdt:u1:v1");
	return { channel, ws };
}

function frameOf(ws: any, event: string): unknown[] {
	return ws.sent.map((s: string) => JSON.parse(s)).find((f: unknown[]) => f[3] === event);
}

beforeEach(() => {
	lastWsInstance = null;
});

describe("fileTimes", () => {
	test("reads stat ms as epoch seconds", () => {
		expect(fileTimes({ stat: { mtime: 1_700_000_001_500, ctime: 1_700_000_000_000 } })).toEqual(
			{
				mtime: 1_700_000_001.5,
				ctime: 1_700_000_000,
			},
		);
	});

	test("omits a time the platform does not report (0, absent) and files with no stat", () => {
		expect(fileTimes({ stat: { mtime: 5000, ctime: 0 } })).toEqual({ mtime: 5 });
		expect(fileTimes({ stat: {} })).toEqual({});
		expect(fileTimes({})).toEqual({});
		expect(fileTimes(null)).toEqual({});
		expect(fileTimes(undefined)).toEqual({});
	});
});

describe("file times on the wire", () => {
	const times = { mtime: 1_700_000_001.5, ctime: 1_700_000_000 };

	test("crdt_create carries mtime and ctime", async () => {
		const { channel, ws } = await joined();
		channel.setFileTimes((docId, path) => (docId === "d1" && path === "A.md" ? times : {}));
		void channel.crdtCreate("d1", "A.md").catch(() => {});
		expect(frameOf(ws, "crdt_create")[4]).toEqual({ doc_id: "d1", path: "A.md", ...times });
		channel.disconnect();
	});

	test("crdt_msg (edit frame) carries mtime and ctime", async () => {
		const { channel, ws } = await joined();
		channel.setFileTimes((docId) => (docId === "d1" ? times : {}));
		expect(channel.sendCrdt("d1", "dGVzdA==")).toBe(true);
		expect(frameOf(ws, "crdt_msg")[4]).toEqual({ doc_id: "d1", b64: "dGVzdA==", ...times });
		channel.disconnect();
	});

	test("crdt_doc_update (queued edit) carries mtime and ctime", async () => {
		const { channel, ws } = await joined();
		channel.setFileTimes((docId) => (docId === "d1" ? times : {}));
		void channel.crdtDocUpdate("d1", "dGVzdA==").catch(() => {});
		expect(frameOf(ws, "crdt_doc_update")[4]).toEqual({
			doc_id: "d1",
			b64: "dGVzdA==",
			...times,
		});
		channel.disconnect();
	});

	test("no resolver, or a file with no stat, adds no keys", async () => {
		const { channel, ws } = await joined();
		expect(channel.sendCrdt("d1", "dGVzdA==")).toBe(true);
		channel.setFileTimes(() => ({}));
		expect(channel.sendCrdt("d2", "dGVzdA==")).toBe(true);
		const frames = ws.sent
			.map((s: string) => JSON.parse(s))
			.filter((f: unknown[]) => f[3] === "crdt_msg")
			.map((f: unknown[]) => f[4]);
		expect(frames).toEqual([
			{ doc_id: "d1", b64: "dGVzdA==" },
			{ doc_id: "d2", b64: "dGVzdA==" },
		]);
		channel.disconnect();
	});
});
