/**
 * Engram#2523 S4: the folder-op wire on NoteChannel and its engine hooks.
 * - `features.folder_ops` on the user-topic join reply turns folder ops on;
 * - `folder_op` frames and their ack / refusal / `unknown_event` mapping;
 * - note creates carry `{ folder_id, name }`, retried by path on
 *   `folder_not_found`;
 * - `folder_changed` is parsed and handed on;
 * - the engine's folder ref: only a folder with a server id is sent by id;
 * - the `crdt_create` reply's `folder_id` teaches the folder's id.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import { NoteChannel } from "../src/channel";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { FolderOp } from "../src/folder-ops";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

let lastWs: any = null;
class MockWebSocket {
	static OPEN = 1;
	readyState = MockWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((e: any) => void) | null = null;
	sent: string[] = [];
	constructor() {
		lastWs = this;
	}
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.onclose = null;
	}
}
(globalThis as any).WebSocket = MockWebSocket;

const msg = (ws: any, frame: unknown[]) => ws.onmessage?.({ data: JSON.stringify(frame) });
const frames = (ws: any, event: string) =>
	ws.sent.map((s: string) => JSON.parse(s)).filter((f: unknown[]) => f[3] === event);
const tick = () => new Promise((r) => setTimeout(r, 0));

async function joined(): Promise<{ channel: NoteChannel; ws: any }> {
	const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
	await channel.connect();
	const ws = lastWs;
	ws.onopen?.();
	msg(ws, [null, "1", "sync:u1:v1", "phx_reply", { status: "ok", response: {} }]);
	msg(ws, [null, "2", "user:u1", "phx_reply", { status: "ok", response: {} }]);
	msg(ws, [null, "3", "crdt:u1:v1", "phx_reply", { status: "ok", response: {} }]);
	return { channel, ws };
}

function reply(ws: any, ref: string, status: "ok" | "error", response: unknown) {
	msg(ws, [null, ref, "crdt:u1:v1", "phx_reply", { status, response }]);
}

const op: FolderOp = {
	op: "move",
	op_id: "op-1",
	folder_id: "f1",
	parent_id: "f2",
	name: "Done",
	from: "Proj",
	to: "Done",
	vaultId: "v1",
};

beforeEach(() => {
	lastWs = null;
});

describe("NoteChannel folder ops", () => {
	test("features.folder_ops on the user join reply is reported", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", null);
		const seen: boolean[] = [];
		channel.onServerFeatures = (f) => seen.push(f.folderOps);
		await channel.connect();
		lastWs.onopen?.();
		msg(lastWs, [
			"2",
			"9",
			"user:u1",
			"phx_reply",
			{ status: "ok", response: { features: { folder_ops: true } } },
		]);
		msg(lastWs, ["2", "10", "user:u1", "phx_reply", { status: "ok", response: {} }]);
		expect(seen).toEqual([true, false]);
		channel.disconnect();
	});

	test("folder_op is sent on the crdt topic and an ack maps to ok + seq", async () => {
		const { channel, ws } = await joined();
		const p = channel.folderOp(op);
		const [frame] = frames(ws, "folder_op");
		expect(frame[2]).toBe("crdt:u1:v1");
		expect(frame[4]).toEqual({
			op: "move",
			op_id: "op-1",
			folder_id: "f1",
			parent_id: "f2",
			name: "Done",
		});
		reply(ws, frame[1], "ok", { seq: 42 });
		await expect(p).resolves.toEqual({ kind: "ok", seq: 42 });
		channel.disconnect();
	});

	for (const [reason, kind] of [
		["cycle", "refused"],
		["conflict", "refused"],
		["not_found", "refused"],
		["invalid_name", "refused"],
		["unknown_event", "unknown_event"],
		// An older crdt channel's catch-all: a server without the handler.
		["bad_frame", "unknown_event"],
		["rate_limited", "retry"],
	] as const) {
		test(`refusal ${reason} maps to ${kind}`, async () => {
			const { channel, ws } = await joined();
			const p = channel.folderOp(op);
			reply(ws, frames(ws, "folder_op")[0][1], "error", { reason });
			const res = await p;
			expect(res.kind).toBe(kind);
			if (res.kind === "refused") expect(res.reason).toBe(reason);
			channel.disconnect();
		});
	}

	test("no socket: held (spends no attempt), never a refusal", async () => {
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		await expect(channel.folderOp(op)).resolves.toEqual({ kind: "held" });
	});

	test("a note create carries folder_id and name from the folder ref", async () => {
		const { channel, ws } = await joined();
		channel.folderRefFor = () => ({ folder_id: "f1", name: "n.md" });
		const p = channel.crdtCreate("id-1", "Proj/n.md");
		await tick();
		const [frame] = frames(ws, "crdt_create");
		expect(frame[4]).toEqual({
			doc_id: "id-1",
			path: "Proj/n.md",
			folder_id: "f1",
			name: "n.md",
		});
		reply(ws, frame[1], "ok", { doc_id: "id-1" });
		await expect(p).resolves.toMatchObject({ docId: "id-1" });
		channel.disconnect();
	});

	test("folder_not_found: the folder is forgotten and the create retried by path", async () => {
		const { channel, ws } = await joined();
		const forgot: string[] = [];
		channel.folderRefFor = () => ({ folder_id: "dead", name: "n.md" });
		channel.onFolderNotFound = (id) => forgot.push(id);
		const p = channel.crdtCreate("id-1", "Proj/n.md");
		await tick();
		reply(ws, frames(ws, "crdt_create")[0][1], "error", { reason: "folder_not_found" });
		await tick();
		const retry = frames(ws, "crdt_create")[1];
		expect(retry[4]).toEqual({ doc_id: "id-1", path: "Proj/n.md" });
		reply(ws, retry[1], "ok", { doc_id: "id-1" });
		await expect(p).resolves.toMatchObject({ docId: "id-1" });
		expect(forgot).toEqual(["dead"]);
		channel.disconnect();
	});

	test("folder_changed is parsed; root parent is null", async () => {
		const { channel, ws } = await joined();
		const seen: unknown[] = [];
		channel.onFolderChanged = (c) => seen.push(c);
		msg(ws, [
			null,
			null,
			"sync:u1:v1",
			"folder_changed",
			{
				folder_id: "f1",
				parent_id: null,
				name: "Done",
				seq: 7,
				deleted: false,
				device_id: "d2",
			},
		]);
		expect(seen).toEqual([
			{ id: "f1", parent_id: null, name: "Done", seq: 7, deleted: false, device_id: "d2" },
		]);
		channel.disconnect();
	});
});

describe("SyncEngine folder ref for note creates", () => {
	function engine() {
		const app = {
			vault: {
				configDir: ".obsidian",
				getAbstractFileByPath: () => null,
				getFileByPath: () => null,
				getName: () => "Vault",
			},
			workspace: { getActiveViewOfType: () => null },
		} as any;
		const e = new SyncEngine(
			app,
			{} as EngramApi,
			{ ...DEFAULT_SETTINGS, vaultId: "v1" },
			// Resolves: the folder-op persist timer awaits it a second later.
			mock().mockResolvedValue(undefined),
		);
		e.setNoteIdMap(new NoteIdMap());
		return e;
	}

	test("off: no ref (path only)", async () => {
		const e = engine();
		e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
		expect(e.folderRefFor("Proj/n.md")).toBeNull();
	});

	test("on: a server-known folder is sent by id; root is null; unknown is path only", async () => {
		const e = engine();
		e.setCrdtPorts({ folderOp: async () => ({ kind: "ok", seq: 1 }) });
		await e.setFolderOpsEnabled(true);
		e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
		expect(e.folderRefFor("Proj/n.md")).toEqual({ folder_id: "f1", name: "n.md" });
		expect(e.folderRefFor("top.md")).toEqual({ folder_id: null, name: "top.md" });
		expect(e.folderRefFor("Never/n.md")).toBeNull();
	});

	test("flag off: a folder_changed event is ignored, as on main", async () => {
		const e = engine();
		e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
		await e.onFolderChanged({ id: "f1", parent_id: null, name: "Done", seq: 3 });
		expect(e.folderOps.index.pathFor("f1")).toBe("Proj");
	});

	test("the crdt_create reply's folder_id teaches the folder", async () => {
		const e = engine();
		e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
		e.learnFolderOf("Proj/New/n.md", "f9");
		e.learnFolderOf("top.md", null);
		expect(e.folderOps.index.idFor("Proj/New")).toBe("f9");
	});
});

describe("crdt_create reply folder_id", () => {
	test("is handed on with the note's path; absent on an older server", async () => {
		const { channel, ws } = await joined();
		const seen: unknown[] = [];
		channel.onCreateFolderId = (p, id) => seen.push([p, id]);
		const p1 = channel.crdtCreate("id-1", "Proj/n.md");
		reply(ws, frames(ws, "crdt_create")[0][1], "ok", { doc_id: "id-1", folder_id: "f7" });
		await p1;
		const p2 = channel.crdtCreate("id-2", "Proj/m.md");
		reply(ws, frames(ws, "crdt_create")[1][1], "ok", { doc_id: "id-2" });
		await p2;
		expect(seen).toEqual([["Proj/n.md", "f7"]]);
		channel.disconnect();
	});

	test("a reply's `folders` chain is handed on", async () => {
		const { channel, ws } = await joined();
		const seen: unknown[] = [];
		channel.onCreateFolders = (rows) => seen.push(rows);
		const chain = [
			{ id: "fa", parent_id: null, name: "A" },
			{ id: "fb", parent_id: "fa", name: "B" },
		];
		const p = channel.crdtCreate("id-1", "A/B/n.md");
		reply(ws, frames(ws, "crdt_create")[0][1], "ok", { doc_id: "id-1", folders: chain });
		await p;
		expect(seen).toEqual([chain]);
		channel.disconnect();
	});
});
