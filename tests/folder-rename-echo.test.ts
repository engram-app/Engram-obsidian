/**
 * Engram#2523 S4: the Relay echo rule (Relay `SharedFolder.ts`
 * notifyVaultRename). After a folder op re-keyed a folder's children, a
 * child rename event arriving on a LATER tick (design risk R4: the order is
 * not verified on mobile) must be a pure no-op: no file read, no id
 * un-confirm, nothing on the wire.
 *
 * The sim cannot see this one: without the rule the per-file path still ends
 * in an echo skip, so the cost is local (a read of every child's bytes, an
 * attachment's whole blob) plus an un-confirmed note id. This pins it.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { FolderOpResult } from "../src/folder-ops";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function setup() {
	const note = new TFile("Done/a.md");
	const image = new TFile("Done/img.png");
	(note as any).stat = { mtime: 1, ctime: 1, size: 4 };
	(image as any).stat = { mtime: 1, ctime: 1, size: 3 };
	const folder = new TFolder("Done", [note, image]);
	const byPath = new Map<string, unknown>([
		["Done", folder],
		["Done/a.md", note],
		["Done/img.png", image],
	]);
	const cachedRead = mock().mockResolvedValue("body");
	const readBinary = mock().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead,
			read: cachedRead,
			readBinary,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = {
		renameAttachment: mock(),
		pushAttachment: mock(),
		deleteAttachment: mock(),
		deleteNote: mock(),
	};
	const e = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	const ids = new NoteIdMap();
	e.setNoteIdMap(ids);
	const crdtCreate = mock();
	e.setCrdtPorts({ create: crdtCreate, folderOp: async () => ({ kind: "ok", seq: 5 }) });
	ids.set("Proj/a.md", "id-a");
	(e as any).confirmNoteId("id-a");
	(e as any).syncState.set("Proj/a.md", { hash: 1, crdtHead: "h" });
	(e as any).syncState.set("Proj/img.png", { hash: 2, serverHash: "s" });
	e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
	return { e, ids, folder, note, image, api, crdtCreate, cachedRead, readBinary };
}

describe("Relay echo rule", () => {
	test("children arriving a tick after their folder's op send and read nothing", async () => {
		const s = setup();
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		// A later tick: the batch above has flushed.
		await new Promise((r) => setTimeout(r, 0));
		await s.e.handleRename(s.note, "Proj/a.md");
		await s.e.handleRename(s.image, "Proj/img.png");

		expect(s.ids.get("Done/a.md")).toBe("id-a");
		expect(s.cachedRead).not.toHaveBeenCalled();
		expect(s.readBinary).not.toHaveBeenCalled();
		expect(s.crdtCreate).not.toHaveBeenCalled();
		expect(s.api.renameAttachment).not.toHaveBeenCalled();
		expect(s.api.pushAttachment).not.toHaveBeenCalled();
		expect((s.e as any).isNoteConfirmed("id-a")).toBe(true);
	});

	test("folder ops off: the same child events take today's per-file path", async () => {
		const s = setup();
		await s.e.handleRename(s.note, "Proj/a.md");
		await new Promise((r) => setTimeout(r, 5));
		expect(s.ids.get("Done/a.md")).toBe("id-a");
		expect(s.cachedRead).toHaveBeenCalled();
	});
});

// Adopted from the adversarial review of #689: red at f020b50d (the fallback
// read its target from an index a restart had emptied).
/** A restart after an offline folder rename: the child bookkeeping was
 *  persisted at the NEW path, the op is replayed from disk, and the in-memory
 *  folder index is EMPTY until the next manifest. */
function restarted(reply: FolderOpResult | null) {
	const s = setup();
	s.e.setCrdtPorts({
		create: s.crdtCreate,
		folderOp: async () => reply ?? { kind: "retry" },
	});
	(s.e as any).folderOps.index.load([]);
	(s.e as any).syncState.delete("Proj/a.md");
	(s.e as any).syncState.delete("Proj/img.png");
	s.ids.rename("Proj/a.md", "Done/a.md");
	(s.e as any).syncState.set("Done/a.md", { hash: 1, crdtHead: "h" });
	(s.e as any).syncState.set("Done/img.png", { hash: 2, serverHash: "s" });
	s.e.folderOps.load([
		{
			op: "move",
			op_id: "o1",
			folder_id: "f1",
			parent_id: null,
			name: "Done",
			from: "Proj",
			to: "Done",
			vaultId: "v1",
		},
	]);
	return s;
}

describe("review #689: replayed op after a restart", () => {
	test("server has no folder_ops: the replayed op is redone per file", async () => {
		const s = restarted(null);
		await s.e.setFolderOpsEnabled(false);
		await new Promise((r) => setTimeout(r, 5));
		expect(s.e.folderOps.all()).toEqual([]);
		expect(s.cachedRead).toHaveBeenCalled();
	});

	test("replayed op refused (conflict): redone per file", async () => {
		const s = restarted({ kind: "refused", reason: "conflict" });
		await s.e.setFolderOpsEnabled(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(s.e.folderOps.all()).toEqual([]);
		expect(s.cachedRead).toHaveBeenCalled();
	});
});

describe("review #689: control (same session, index populated)", () => {
	test("in-session refusal does redo per file", async () => {
		const s = restarted({ kind: "refused", reason: "conflict" });
		(s.e as any).folderOps.index.set({ id: "f1", parent_id: null, name: "Done" });
		await s.e.setFolderOpsEnabled(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(s.cachedRead).toHaveBeenCalled();
	});
});

describe("folder walk includes tracked rows not on disk (Relay parity)", () => {
	test("a synced note with no file yet moves with its folder", async () => {
		const s = setup();
		s.ids.set("Proj/later.md", "id-l");
		(s.e as any).syncState.set("Proj/later.md", { hash: 3 });
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		expect(s.ids.get("Done/later.md")).toBe("id-l");
		expect((s.e as any).syncState.has("Done/later.md")).toBe(true);
		expect((s.e as any).syncState.has("Proj/later.md")).toBe(false);
	});
});

describe("attachment move bookkeeping waits for the server", () => {
	test("the row stays at the old path until the move is confirmed", async () => {
		const s = setup();
		let confirm: () => void = () => {};
		s.api.renameAttachment.mockImplementation(
			() =>
				new Promise<void>((r) => {
					confirm = r;
				}),
		);
		const rename = s.e.handleRename(s.image, "Proj/img.png");
		await new Promise((r) => setTimeout(r, 0));
		expect((s.e as any).syncState.has("Proj/img.png")).toBe(true);
		expect((s.e as any).syncState.has("Done/img.png")).toBe(false);
		confirm();
		await rename;
		expect((s.e as any).syncState.has("Done/img.png")).toBe(true);
		expect(s.api.pushAttachment).not.toHaveBeenCalled();
	});
});

describe("a folder_op is only sent when the target parent has a server id", () => {
	test("move under an unknown parent: no op, per file instead", async () => {
		const s = setup();
		const sent: unknown[] = [];
		s.e.setCrdtPorts({
			create: s.crdtCreate,
			folderOp: async (op) => {
				sent.push(op);
				return { kind: "ok", seq: 1 };
			},
		});
		await s.e.setFolderOpsEnabled(true);
		const moved = new TFolder("New/Done", []);
		await s.e.handleRename(moved, "Proj");
		expect(sent).toEqual([]);
		expect(s.e.folderOps.all()).toEqual([]);
		// Not re-keyed: the children's own events take the per-file path.
		expect(s.ids.get("Proj/a.md")).toBe("id-a");
	});
});

describe("the manifest delete pass spares unconfirmed local moves (N3)", () => {
	function trashRun(s: ReturnType<typeof setup>) {
		const trashed: string[] = [];
		(s.e as any).app.fileManager = {
			trashFile: async (f: TFile) => {
				trashed.push(f.path);
			},
		};
		(s.e as any).app.vault.getFiles = () => [s.note];
		// The server still lists the note at its OLD path.
		const manifest = {
			notes: [{ id: "id-a", path: "Proj/a.md", content_hash: "x" }],
			attachments: [],
			total_notes: 1,
			total_attachments: 0,
		};
		return { trashed, run: () => (s.e as any).reconcileFromManifest(manifest) };
	}

	test("flag off: a note whose own rename is unconfirmed is not trashed", async () => {
		const s = setup();
		s.e.setCrdtPorts({ create: () => new Promise(() => {}) });
		void s.e.handleRename(s.note, "Proj/a.md");
		await new Promise((r) => setTimeout(r, 0));
		const { trashed, run } = trashRun(s);
		await run();
		expect(trashed).toEqual([]);
	});

	test("folder op pending: files under its target are not trashed", async () => {
		const s = setup();
		s.e.setCrdtPorts({ create: s.crdtCreate, folderOp: async () => ({ kind: "retry" }) });
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		(s.e as any).pendingLocalMoves.clear(); // the folder op alone must cover it
		const { trashed, run } = trashRun(s);
		await run();
		expect(trashed).toEqual([]);
	});
});

describe("inbound folder move that cannot happen leaves the index where the disk is (L1)", () => {
	function inbound(renameThrows: boolean, occupied: boolean) {
		const s = setup();
		const app = (s.e as any).app;
		const proj = new TFolder("Proj", []);
		const realGet = app.vault.getAbstractFileByPath;
		app.vault.getAbstractFileByPath = (p: string) =>
			p === "Proj" ? proj : p === "Moved" && occupied ? new TFolder("Moved", []) : realGet(p);
		app.vault.getFileByPath = () => null;
		app.vault.rename = async () => {
			if (renameThrows) throw new Error("EBUSY");
		};
		app.vault.createFolder = async () => {};
		return s;
	}
	const change = { id: "f1", parent_id: null, name: "Moved", seq: 9, device_id: "web" };

	test("rename throws: index and bookkeeping restored", async () => {
		const s = inbound(true, false);
		await s.e.setFolderOpsEnabled(true);
		await s.e.onFolderChanged(change);
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Proj");
		expect(s.ids.get("Proj/a.md")).toBe("id-a");
		expect(s.ids.get("Moved/a.md")).toBeNull();
	});

	test("target occupied: nothing moves, index stays", async () => {
		const s = inbound(false, true);
		await s.e.setFolderOpsEnabled(true);
		await s.e.onFolderChanged(change);
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Proj");
		expect(s.ids.get("Proj/a.md")).toBe("id-a");
	});

	test("control: a clean move moves the index", async () => {
		const s = inbound(false, false);
		await s.e.setFolderOpsEnabled(true);
		await s.e.onFolderChanged(change);
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Moved");
		expect(s.ids.get("Moved/a.md")).toBe("id-a");
	});
});

describe("flag off is main (N4)", () => {
	test("a persisted folder index alone does not switch the echo rule on", async () => {
		const s = setup();
		// A row known at the new path, nothing at the old one: the echo rule's
		// shape. With the flag off and no manifest folders this session, the
		// per-file path must still run (it reads the file).
		(s.e as any).syncState.delete("Proj/a.md");
		(s.e as any).syncState.set("Done/a.md", { hash: 1 });
		s.ids.rename("Proj/a.md", "Done/a.md");
		s.e.restoreFolderIndex({
			vaultId: "v1",
			rows: [{ id: "f1", parent_id: null, name: "Done" }],
		});
		await s.e.handleRename(s.note, "Proj/a.md");
		await new Promise((r) => setTimeout(r, 5));
		expect(s.cachedRead).toHaveBeenCalled();
	});
});

describe("the server's folder chain teaches every id (N5)", () => {
	test("POST /folders returning a root-first chain: a move into it goes by id", async () => {
		const s = setup();
		const sent: { parent_id: string | null }[] = [];
		s.e.setCrdtPorts({
			create: s.crdtCreate,
			folderOp: async (op) => {
				sent.push(op);
				return { kind: "ok", seq: 1 };
			},
		});
		(s.e as any).explicitFolders = { has: () => false, add: async () => {} };
		(s.e as any).api.createFolder = async () => ({
			folder: { name: "Archive/2026", count: 0 },
			folders: [
				{ id: "fa", parent_id: null, name: "Archive" },
				{ id: "f26", parent_id: "fa", name: "2026" },
			],
		});
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleFolderCreate({ path: "Archive/2026" });
		expect(s.e.folderOps.index.idFor("Archive/2026")).toBe("f26");
		await s.e.handleRename(new TFolder("Archive/2026/Proj", []), "Proj");
		expect(sent.map((o) => o.parent_id)).toEqual(["f26"]);
	});

	test("a crdt_create reply chain is learned; without one, nothing changes", () => {
		const s = setup();
		s.e.learnFolderChain([
			{ id: "fx", parent_id: null, name: "X" },
			{ id: "fy", parent_id: "fx", name: "Y" },
		]);
		s.e.learnFolderChain(undefined);
		expect(s.e.folderOps.index.idFor("X/Y")).toBe("fy");
	});
});

describe("a refusal after an inbound move keeps the index at the truth (R3-5)", () => {
	test("the fallback does not rewrite the index to the op's stale `from`", async () => {
		const s = setup();
		let answer: { kind: "retry" } | { kind: "refused"; reason: string } = { kind: "retry" };
		s.e.setCrdtPorts({ create: s.crdtCreate, folderOp: async () => answer });
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		// An expired hold applied another writer's move: index (and disk) at Theirs.
		s.e.folderOps.index.set({ id: "f1", parent_id: null, name: "Theirs" });
		answer = { kind: "refused", reason: "conflict" };
		await s.e.folderOps.onReconnect();
		expect(s.e.folderOps.hasPending("f1")).toBe(false);
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Theirs");
	});
});
