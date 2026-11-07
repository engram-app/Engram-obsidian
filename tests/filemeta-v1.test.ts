/**
 * Engram#2523 S4 step 5: the plugin writes `filemeta_v1` (note id -> folder id
 * + name, folder id -> parent + name) ONLY on a vault whose join reply says
 * `index_v1`. Before S5 stamps a vault, projection reads v0 alone, so a v1
 * written by the plugin would be stale against web, MCP and old-plugin writes,
 * and projecting a stale map is the crdt-create-is-a-rename revert class.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile, TFolder } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteChannel } from "../src/channel";
import { FOLDERS_V1, NOTES_V1 } from "../src/crdt/filemeta-v1";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncStore } from "../src/crdt/sync-store";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function engine() {
	const doc = new Y.Doc();
	const ids = new NoteIdMap(new SyncStore(doc.getMap("filemeta_v0")));
	const folder = new TFolder("Done", [new TFile("Done/n.md")]);
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: (p: string) => (p === "Done" ? folder : null),
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const e = new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1" },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	e.setNoteIdMap(ids);
	e.setCrdtPorts({ folderOp: async () => ({ kind: "retry" }) });
	e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
	return { e, doc, folder };
}

const v1 = (doc: Y.Doc) => ({
	notes: doc.getMap(NOTES_V1).toJSON(),
	folders: doc.getMap(FOLDERS_V1).toJSON(),
});

describe("filemeta_v1 writer", () => {
	test("not written without index_v1", async () => {
		const { e, doc, folder } = engine();
		await e.setFolderOpsEnabled(true);
		await e.folderRefFor("Proj/n.md", "note-1");
		await e.handleRename(folder, "Proj");
		expect(v1(doc)).toEqual({ notes: {}, folders: {} });
	});

	test("with index_v1: a folder move is ONE folders_v1 entry, no per-note entry", async () => {
		const { e, doc, folder } = engine();
		await e.setFolderOpsEnabled(true);
		e.setIndexV1(true);
		await e.handleRename(folder, "Proj");
		expect(v1(doc)).toEqual({ notes: {}, folders: { f1: { parent_id: null, name: "Done" } } });
	});

	test("with index_v1: a note create or move by id writes its notes_v1 entry", async () => {
		const { e, doc } = engine();
		await e.setFolderOpsEnabled(true);
		e.setIndexV1(true);
		await e.folderRefFor("Proj/n.md", "note-1");
		expect(v1(doc).notes).toEqual({ "note-1": { folder_id: "f1", name: "n.md" } });
	});

	test("index_v1 is per vault: a vault switch turns it off", async () => {
		const { e, doc } = engine();
		await e.setFolderOpsEnabled(true);
		e.setIndexV1(true);
		await e.resetForVaultChange();
		await e.setFolderOpsEnabled(true);
		e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
		await e.folderRefFor("Proj/n.md", "note-1");
		expect(v1(doc).notes).toEqual({});
	});
});

describe("index_v1 on the sync join reply", () => {
	class MockWebSocket {
		static OPEN = 1;
		readyState = 1;
		onopen: (() => void) | null = null;
		onmessage: ((evt: { data: string }) => void) | null = null;
		onclose: (() => void) | null = null;
		onerror: (() => void) | null = null;
		sent: string[] = [];
		constructor() {
			ws = this;
		}
		send(d: string) {
			this.sent.push(d);
		}
		close() {}
	}
	let ws: MockWebSocket | null = null;

	test("reported per join, false when absent", async () => {
		(globalThis as any).WebSocket = MockWebSocket;
		const channel = new NoteChannel("http://localhost:4000", "key", "u1", "v1");
		const seen: boolean[] = [];
		channel.onIndexV1 = (on) => seen.push(on);
		await channel.connect();
		ws?.onopen?.();
		const join = (response: unknown) =>
			ws?.onmessage?.({
				data: JSON.stringify([
					null,
					"1",
					"sync:u1:v1",
					"phx_reply",
					{ status: "ok", response },
				]),
			});
		join({ index_v1: true });
		join({});
		expect(seen).toEqual([true, false]);
		channel.disconnect();
	});
});
