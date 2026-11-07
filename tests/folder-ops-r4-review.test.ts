// Adopted from the round-4 adversarial review of #689 (comment 6708410900):
// P1 and P3 were red at 7dc53500; P2 and the refusal table pin R4-3.
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { mock } from "bun:test";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { FolderOps } from "../src/folder-ops";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// Copied from tests/folder-rename-echo.test.ts (not exported there).
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

describe("round 4 probes", () => {
	test("P1: a crdt_create reply's folder_id (learnFolderOf) does not overwrite a pending row", async () => {
		const s = setup();
		s.e.setCrdtPorts({ create: s.crdtCreate, folderOp: async () => ({ kind: "retry" }) });
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Done");
		// A create sent before the move (old path) is answered after it, by a
		// server that has not applied our op: note at Proj/x.md, folder f1.
		s.e.learnFolderOf("Proj/x.md", "f1");
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Done");
	});

	test("P2: giving up at the cap applies the held change (no stale hold left to expire later)", async () => {
		let now = 1_000;
		const applied: string[] = [];
		const ops = new FolderOps({
			send: async () => ({ kind: "retry" }),
			now: () => now,
			vaultId: () => "v1",
			fallback: async () => {},
			acked: async () => {},
			apply: async (c) => {
				applied.push(`${c.id}:${c.name}`);
			},
			persist: () => {},
		});
		ops.index.load([{ id: "fa", parent_id: null, name: "A" }]);
		await ops.setFeature(true);
		ops.move("fa", null, "Mine", "A", "Mine");
		await ops.inbound({ id: "fa", parent_id: null, name: "Theirs", seq: 3 });
		for (let i = 0; i < 40 && ops.hasPending("fa"); i++) {
			now += 5_000;
			await ops.tick();
		}
		expect(ops.hasPending("fa")).toBe(false);
		expect(applied).toEqual(["fa:Theirs"]);
		// A later change is applied at once, and no old hold resurfaces.
		await ops.inbound({ id: "fa", parent_id: null, name: "Later", seq: 9 });
		now += 10 * 60_000;
		await ops.tick();
		expect(applied).toEqual(["fa:Theirs", "fa:Later"]);
	});

	test("P3: a folder_changed whose name is not one segment is not learned", async () => {
		const s = setup();
		await s.e.setFolderOpsEnabled(true);
		await s.e.onFolderChanged({ id: "f1", parent_id: null, name: "x/y", seq: 2 });
		expect(s.e.folderOps.index.pathFor("f1")).not.toBe("x/y");
	});
});

describe("round 4: each refusal's class", () => {
	for (const [reason, falls] of [
		["not_found", false],
		["failed", false],
		["conflict", true],
		["cycle", true],
		["invalid_name", true],
	] as const)
		test(`${reason}: ${falls ? "falls back at once" : "retried in the budget"}`, async () => {
			const fallbacks: string[] = [];
			const ops = new FolderOps({
				send: async () => ({ kind: "refused", reason }),
				now: () => 1_000,
				vaultId: () => "v1",
				fallback: async (_op, why) => {
					fallbacks.push(why);
				},
				acked: async () => {},
				apply: async () => {},
				persist: () => {},
			});
			ops.index.load([{ id: "fa", parent_id: null, name: "A" }]);
			await ops.setFeature(true);
			ops.move("fa", null, "B", "A", "B");
			await ops.flush();
			expect(fallbacks).toEqual(falls ? [reason] : []);
			expect(ops.hasPending("fa")).toBe(!falls);
		});
});
