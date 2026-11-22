/**
 * Tests: file times on every create and edit message.
 * One test per payload builder (crdt_create, crdt_msg, crdt_doc_update), plus
 * the helper that is the single reader of a file's stat.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NoteChannel } from "../src/channel";
import { encodeUpdateFrame, isUpdateFrame, toB64 } from "../src/crdt/wire";
import { fileTimes, liveEditTimes, msToSeconds } from "../src/file-times";

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
		expect(channel.sendCrdt("d1", updateFrame)).toBe(true);
		expect(frameOf(ws, "crdt_msg")[4]).toEqual({ doc_id: "d1", b64: updateFrame, ...times });
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
		expect(channel.sendCrdt("d1", updateFrame)).toBe(true);
		channel.setFileTimes(() => ({}));
		expect(channel.sendCrdt("d2", updateFrame)).toBe(true);
		const frames = ws.sent
			.map((s: string) => JSON.parse(s))
			.filter((f: unknown[]) => f[3] === "crdt_msg")
			.map((f: unknown[]) => f[4]);
		expect(frames).toEqual([
			{ doc_id: "d1", b64: updateFrame },
			{ doc_id: "d2", b64: updateFrame },
		]);
		channel.disconnect();
	});
});

// A real y-protocols frame: messageSync (0), then the sync sub-type, then an
// empty payload. 0 = syncStep1, 2 = update (what a keystroke sends).
const step1Frame = toB64(new Uint8Array([0, 0, 0]));
const updateFrame = encodeUpdateFrame(new Uint8Array([0, 0]));

describe("liveEditTimes", () => {
	const file = { stat: { mtime: 1_700_000_001_500, ctime: 1_700_000_000_000 } };

	test("an editor-bound note never carries a time older than now (Obsidian saves ~2s later)", () => {
		const nowMs = 1_700_000_100_999;
		expect(liveEditTimes(file, true, nowMs)).toEqual({
			mtime: 1_700_000_100,
			ctime: 1_700_000_000,
		});
	});

	test("a file time ahead of now wins; the server only moves mtime forward", () => {
		expect(liveEditTimes(file, true, 1_700_000_000_000).mtime).toBe(1_700_000_001.5);
	});

	test("a bound file with no stat still carries now", () => {
		expect(liveEditTimes(null, true, 5_000)).toEqual({ mtime: 5 });
	});

	test("a note not bound in an editor (changed on disk) keeps the file's own times", () => {
		expect(liveEditTimes(file, false, 1_700_000_100_999)).toEqual({
			mtime: 1_700_000_001.5,
			ctime: 1_700_000_000,
		});
	});
});

describe("isUpdateFrame", () => {
	test("reads only the head of the frame, however large", () => {
		const big = encodeUpdateFrame(new Uint8Array(2_000_000));
		const real = globalThis.atob;
		const lengths: number[] = [];
		globalThis.atob = (s: string) => {
			lengths.push(s.length);
			return real(s);
		};
		try {
			expect(isUpdateFrame(big)).toBe(true);
		} finally {
			globalThis.atob = real;
		}
		expect(Math.max(...lengths)).toBeLessThanOrEqual(4);
	});

	test("is false for a handshake frame, a non-frame and garbage", () => {
		expect(isUpdateFrame(step1Frame)).toBe(false);
		expect(isUpdateFrame("dGVzdA==")).toBe(false);
		expect(isUpdateFrame("")).toBe(false);
		expect(isUpdateFrame("!!!")).toBe(false);
	});
});

describe("msToSeconds", () => {
	test("is the one ms to seconds conversion", () => {
		expect(msToSeconds(1500)).toBe(1.5);
	});
});

describe("live edit frames use the live time, queued and create frames the file's own", () => {
	const lookup = (docId: string, _path?: string, live?: boolean) => ({
		mtime: live ? 200 : 100,
		...(docId ? { ctime: 50 } : {}),
	});

	test("crdt_msg update frame asks for the live time", async () => {
		const { channel, ws } = await joined();
		channel.setFileTimes(lookup);
		expect(channel.sendCrdt("d1", updateFrame)).toBe(true);
		expect(frameOf(ws, "crdt_msg")[4]).toEqual({
			doc_id: "d1",
			b64: updateFrame,
			mtime: 200,
			ctime: 50,
		});
		channel.disconnect();
	});

	test("crdt_doc_update and crdt_create keep the file's own mtime", async () => {
		const { channel, ws } = await joined();
		channel.setFileTimes(lookup);
		void channel.crdtDocUpdate("d1", "dGVzdA==").catch(() => {});
		void channel.crdtCreate("d2", "A.md").catch(() => {});
		expect((frameOf(ws, "crdt_doc_update")[4] as any).mtime).toBe(100);
		expect((frameOf(ws, "crdt_create")[4] as any).mtime).toBe(100);
		channel.disconnect();
	});

	test("a handshake frame (syncStep1) skips the lookup and carries no times", async () => {
		const { channel, ws } = await joined();
		let calls = 0;
		channel.setFileTimes(() => {
			calls++;
			return { mtime: 1 };
		});
		expect(channel.sendCrdt("d1", step1Frame)).toBe(true);
		expect(calls).toBe(0);
		expect(frameOf(ws, "crdt_msg")[4]).toEqual({ doc_id: "d1", b64: step1Frame });
		channel.disconnect();
	});

	test("a throwing lookup still sends every frame, without times", async () => {
		const { channel, ws } = await joined();
		channel.setFileTimes(() => {
			throw new Error("stat blew up");
		});
		expect(channel.sendCrdt("d1", updateFrame)).toBe(true);
		void channel.crdtDocUpdate("d1", "dGVzdA==").catch(() => {});
		void channel.crdtCreate("d2", "A.md").catch(() => {});
		expect(frameOf(ws, "crdt_msg")[4]).toEqual({ doc_id: "d1", b64: updateFrame });
		expect(frameOf(ws, "crdt_doc_update")[4]).toEqual({ doc_id: "d1", b64: "dGVzdA==" });
		expect(frameOf(ws, "crdt_create")[4]).toEqual({ doc_id: "d2", path: "A.md" });
		channel.disconnect();
	});
});

// `/ 1000`, `/ 1e3`, `/ 1_000`, `* 0.001` and `* .001` on a ctime / mtime.
const DIVIDES_TIME = /\b[mc]time(Ms)?\)?\s*(\/\s*(1000|1e3|1_000)\b|\*\s*0?\.001\b)/;

describe("one ms to seconds converter", () => {
	test("the scan flags every spelling of the conversion", () => {
		for (const line of [
			"a = file.stat.mtime / 1000;",
			"a = stat.ctime/1e3",
			"a = f.stat.mtime / 1_000",
			"a = (file.stat.mtime) * 0.001",
			"a = stat.mtimeMs * .001",
		]) {
			expect(DIVIDES_TIME.test(line), line).toBe(true);
		}
		expect(DIVIDES_TIME.test("a = Date.now() / 1000")).toBe(false);
	});

	function sources(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? sources(join(dir, e.name))
				: e.name.endsWith(".ts")
					? [join(dir, e.name)]
					: [],
		);
	}

	test("no source file but file-times.ts divides a file time by 1000", () => {
		const offenders = sources("src")
			.filter((f) => !f.endsWith("file-times.ts"))
			.flatMap((f) =>
				readFileSync(f, "utf8")
					.split("\n")
					.map((line, i) => ({ f, i: i + 1, line }))
					.filter(({ line }) => /\b[mc]time(Ms)?\)?\s*\/\s*1000/.test(line)),
			)
			.map(({ f, i }) => `${f}:${i}`);
		expect(offenders).toEqual([]);
	});
});

describe("main.ts wires the real lookup", () => {
	// The wiring sits inside plugin onload (no seam to call); pin its shape.
	test("the resolver reads the vault file and picks the live time for live edits", () => {
		const main = readFileSync("src/main.ts", "utf8");
		expect(main).toMatch(/channel\.setFileTimes\(\(docId, path, live\) => \{/);
		expect(main).toContain("this.app.vault.getFileByPath(p)");
		expect(main).toContain("liveEditTimes(file, isLiveBound)");
		expect(main).toContain("this.crdtLiveViews?.isBound(p)");
	});
});
