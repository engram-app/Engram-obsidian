/**
 * A create or rename the server refuses because the NAME is taken (another
 * note or folder already holds the path) is terminal: retrying the same name
 * can only be refused again. Before this fix the plugin dropped it with a log
 * line, then the next sync re-sent the unchanged file and the loop restarted,
 * with nothing shown to the user.
 *
 * The contract: one send, no vault-wide create backoff, a Notice and a Sync
 * Center issue, the local file untouched, and no re-send until the file
 * changes (edit or rename). A reason that is not a name conflict still retries.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { __noticeCapture, TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { isNameTaken, NotesCapGate } from "../src/crdt-op-dispatch";
import type { CrdtOp } from "../src/crdt-op-queue";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const ID = "01a011f9-3b85-79b3-af2f-de167b256949";

const api = {
	getManifest: mock().mockResolvedValue(null),
	pushNote: mock().mockResolvedValue({ note: { id: ID }, chunks_indexed: 1 }),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	getRateLimit: mock().mockResolvedValue(0),
} as unknown as EngramApi;

const refusal = (reason: string) =>
	new Error(`crdt_create request failed: ${JSON.stringify({ reason })}`);

function makeVault(initial: Record<string, string>) {
	const present = new Map<string, TFile>();
	const bodies = new Map<string, string>();
	for (const [p, b] of Object.entries(initial)) {
		present.set(p, new TFile(p, 1_000));
		bodies.set(p, b);
	}
	const look = (p: string) => present.get(p) ?? null;
	const vault = {
		configDir: ".obsidian",
		read: mock(async (f: TFile) => bodies.get(f.path) ?? ""),
		cachedRead: mock(async (f: TFile) => bodies.get(f.path) ?? ""),
		getMarkdownFiles: mock(() => [...present.values()]),
		getFiles: mock(() => [...present.values()]),
		getFileByPath: mock(look),
		getAbstractFileByPath: mock(look),
		create: mock(async () => {}),
		createFolder: mock(async () => {}),
		modify: mock(async (f: TFile, b: string) => void bodies.set(f.path, b)),
		rename: mock(async (f: TFile, to: string) => {
			if (present.has(to)) throw new Error(`File already exists: ${to}`);
			present.delete(f.path);
			const b = bodies.get(f.path) ?? "";
			bodies.delete(f.path);
			f.path = to;
			present.set(to, f);
			bodies.set(to, b);
		}),
		trash: mock().mockResolvedValue(undefined),
		getName: mock(() => "V"),
	};
	const app = {
		vault,
		fileManager: { trashFile: mock(async () => {}) },
		workspace: {
			getActiveViewOfType: mock(() => null),
			getLeavesOfType: mock(() => []),
		},
	} as any;
	return { app, vault, present, bodies };
}

/** `reason` is what the server answers every crdt_create with. */
function setup(files: Record<string, string>, reason: string, synced = false) {
	const h = makeVault(Object.fromEntries(Object.keys(files).map((p) => [p, "body"])));
	const engine = new SyncEngine(
		h.app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	const map = new NoteIdMap();
	map.seed(files);
	engine.setNoteIdMap(map);
	const create = mock(async (_docId: string, _path: string) => {
		throw refusal(reason);
	});
	const enqueue = mock(() => {});
	const gate = new NotesCapGate(() => Date.now());
	engine.setCrdtPorts({
		manager: {
			isSynced: mock(() => true),
			projectedText: mock().mockResolvedValue(""),
			removeDoc: mock().mockResolvedValue(undefined),
		},
		enrollment: { enroll: mock(() => {}), reset: mock(() => {}) },
		create,
		enqueue,
		capGate: gate,
	} as never);
	if (synced) {
		for (const p of Object.keys(files)) {
			(engine as unknown as { syncState: Map<string, unknown> }).syncState.set(p, {
				hash: 1,
				seq: 4,
			});
		}
	}
	const push = (path: string) =>
		(engine as unknown as { pushFile(f: TFile): Promise<boolean> }).pushFile(
			h.present.get(path) as TFile,
		);
	return { ...h, engine, map, create, enqueue, gate, push };
}

const settle = () => new Promise((r) => setTimeout(r, 60));
const notices = () => __noticeCapture.notices.map((n) => n.message);

beforeEach(() => {
	__noticeCapture.notices.length = 0;
});

describe("the shared classifier", () => {
	test("id_conflict (note) and conflict (folder op) are name conflicts; transient reasons are not", () => {
		expect(isNameTaken("id_conflict")).toBe(true);
		expect(isNameTaken("conflict")).toBe(true);
		for (const r of ["create_failed", "rate_limited", "version_conflict", null, undefined]) {
			expect(isNameTaken(r)).toBe(false);
		}
	});
});

describe("a create refused because the name is taken", () => {
	test("is sent once, never queued for retry, and does not pause other creates", async () => {
		const h = setup({ "A.md": ID }, "id_conflict");
		expect(await h.push("A.md")).toBe(false);
		expect(h.create).toHaveBeenCalledTimes(1);
		expect(h.enqueue).not.toHaveBeenCalled();
		expect(h.gate.isClosed()).toBe(false);
	});

	test("tells the user, with the path, and records an actionable Sync Center issue", async () => {
		const h = setup({ "A.md": ID }, "id_conflict");
		await h.push("A.md");
		expect(notices()).toEqual(["A note with that name already exists: A.md"]);
		expect(h.engine.issues.get("A.md")?.category).toBe("name_taken");
	});

	test("keeps the local file and does not re-send it until it changes", async () => {
		const h = setup({ "A.md": ID }, "id_conflict");
		await h.push("A.md");
		await h.push("A.md");
		await h.engine.pushModifiedFiles();
		await settle();
		expect(h.create).toHaveBeenCalledTimes(1);
		expect(notices()).toHaveLength(1); // told once, not once per sync
		expect(h.present.has("A.md")).toBe(true);
		expect(h.bodies.get("A.md")).toBe("body");
		expect(h.vault.trash).not.toHaveBeenCalled();
		expect(h.app.fileManager.trashFile).not.toHaveBeenCalled();

		// The user edits it: the clearing event. It is sent again.
		const f = h.present.get("A.md") as TFile;
		f.stat = { ...f.stat, mtime: 2_000, size: 101 };
		h.bodies.set("A.md", "body, edited");
		await h.push("A.md");
		expect(h.create).toHaveBeenCalledTimes(2);
	});

	test("a queued create refused the same way is parked through the same path", async () => {
		const h = setup({ "A.md": ID }, "id_conflict");
		const op: CrdtOp = {
			id: "op1",
			kind: "create",
			docId: ID,
			payload: { path: "A.md" },
			enqueuedAt: 0,
			attempts: 0,
		};
		h.engine.onCrdtOpTerminal(op, "id_conflict");
		expect(notices()).toEqual(["A note with that name already exists: A.md"]);
		await h.push("A.md");
		expect(h.create).not.toHaveBeenCalled();
	});

	test("a queued create for a DIFFERENT note than the file at the path parks nothing", () => {
		const h = setup({ "A.md": ID }, "id_conflict");
		h.engine.onCrdtOpTerminal(
			{
				id: "o",
				kind: "create",
				docId: "other",
				payload: { path: "A.md" },
				enqueuedAt: 0,
				attempts: 0,
			},
			"id_conflict",
		);
		expect(notices()).toEqual([]);
		expect(h.engine.issues.get("A.md")).toBeUndefined();
	});
});

describe("control: a refusal that is not a name conflict still retries", () => {
	test("create_failed is queued for retry, opens the backoff, and parks nothing", async () => {
		const h = setup({ "A.md": ID }, "create_failed");
		await h.push("A.md");
		expect(h.enqueue).toHaveBeenCalledTimes(1);
		expect(h.gate.isClosed()).toBe(true);
		expect(notices()).toEqual([]);
		expect(h.engine.issues.get("A.md")?.category).not.toBe("name_taken");
	});
});

describe("a note rename refused because the name is taken", () => {
	test("is terminal, tells the user, keeps the file, and is not re-sent unchanged", async () => {
		const h = setup({ "Old.md": ID }, "id_conflict", true);
		const f = h.present.get("Old.md") as TFile;
		await h.vault.rename(f, "New.md");
		await h.engine.handleRename(f, "Old.md");
		await settle();
		expect(h.create).toHaveBeenCalledTimes(1);
		expect(h.enqueue).not.toHaveBeenCalled();
		expect(h.gate.isClosed()).toBe(false);
		expect(notices()).toEqual(["A note with that name already exists: New.md"]);
		expect(h.present.has("New.md")).toBe(true);

		await h.push("New.md");
		expect(h.create).toHaveBeenCalledTimes(1);
	});

	test("renaming it again clears the old issue and sends the new name", async () => {
		const h = setup({ "Old.md": ID }, "id_conflict", true);
		const f = h.present.get("Old.md") as TFile;
		await h.vault.rename(f, "New.md");
		await h.engine.handleRename(f, "Old.md");
		await settle();
		expect(h.engine.issues.get("New.md")?.category).toBe("name_taken");

		await h.vault.rename(f, "Newer.md");
		await h.engine.handleRename(f, "New.md");
		await settle();
		expect(h.engine.issues.get("New.md")).toBeUndefined();
		expect(h.create).toHaveBeenCalledTimes(2);
	});
});

describe("a folder rename refused because the name is taken", () => {
	test("tells the user which folder name is taken", async () => {
		const h = setup({}, "id_conflict");
		await (
			h.engine as unknown as {
				folderOpFallback(op: unknown, why: string): Promise<void>;
			}
		).folderOpFallback(
			{
				op: "move",
				op_id: "x",
				folder_id: "f1",
				parent_id: null,
				name: "B",
				from: "A",
				to: "B",
				vaultId: null,
			},
			"conflict",
		);
		expect(notices()).toEqual(["A folder with that name already exists: B"]);
	});

	test("a refusal that is not a name conflict shows no such notice", async () => {
		const h = setup({}, "id_conflict");
		await (
			h.engine as unknown as {
				folderOpFallback(op: unknown, why: string): Promise<void>;
			}
		).folderOpFallback(
			{
				op: "move",
				op_id: "x",
				folder_id: "f1",
				parent_id: null,
				name: "B",
				from: "A",
				to: "B",
				vaultId: null,
			},
			"max-attempts",
		);
		expect(notices()).toEqual([]);
	});
});
