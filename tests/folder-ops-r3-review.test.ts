// Adopted from the round-3 adversarial review of #689 (comment 6708031599).
// Round-3 adversarial review of #689 @ 24fff7f3: a pending op that the server
// never answers must be cleared by a named, bounded event (attempts or age),
// then the per-file fallback. Both tests are red at 24fff7f3.
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { mock } from "bun:test";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { type FolderOp, FolderOps } from "../src/folder-ops";
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

describe("a never-answered folder op is bounded (round 3 review #689)", () => {
	test("an hour of `retry` answers ends in the per-file fallback, not forever", async () => {
		let now = 1_000;
		let sends = 0;
		const fallbacks: string[] = [];
		const ops = new FolderOps({
			send: async (_op: FolderOp) => {
				sends++;
				return { kind: "retry" }; // lost frame, crash, not joined, rate limited
			},
			now: () => now,
			vaultId: () => "v1",
			fallback: async (op, why) => {
				fallbacks.push(`${op.folder_id}:${why}`);
			},
			acked: async () => {},
			apply: async () => {},
			persist: () => {},
		});
		ops.index.load([
			{ id: "fa", parent_id: null, name: "A" },
			{ id: "fb", parent_id: null, name: "B" },
		]);
		await ops.setFeature(true);
		ops.move("fa", "fb", "A", "A", "B/A");
		for (let i = 0; i < 720; i++) {
			now += 5_000; // main.ts ticks every 5 s
			await ops.tick();
		}
		// The CrdtOpQueue precedent: MAX_ATTEMPTS = 8 plus a TTL, then drop.
		expect(sends).toBeLessThan(720);
		expect(ops.hasPending("fa")).toBe(false);
		expect(fallbacks.length).toBe(1);
	});
});

describe("the delete-pass skip under a stuck op's target (round 3 review #689)", () => {
	test("a day later, a note the server deleted is still never trashed", async () => {
		const s = setup();
		s.e.setCrdtPorts({ create: s.crdtCreate, folderOp: async () => ({ kind: "retry" }) });
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		(s.e as any).pendingLocalMoves.clear(); // its own TTL expires; isolate the folder-op skip
		// Author's adaptation (delta check on 1cbe40f3): age counts only time
		// the sync channel is joined, and a manifest pass means it is.
		s.e.folderOps.onSyncStatus(true);
		const clock = (s.e as any).time;
		const t0 = clock.now();
		clock.now = () => t0 + 24 * 3600 * 1000;
		await s.e.folderOps.tick();
		// Author's adaptation: the fallback's own per-file renames re-arm the
		// rename fence, a separate layer with its own bound (PENDING_MOVE_TTL_MS,
		// counted once the relocating creates leave the queue). Clear it again so
		// this test isolates the folder-op layer, which is what it is about.
		(s.e as any).pendingLocalMoves.clear();
		const trashed: string[] = [];
		(s.e as any).app.fileManager = {
			trashFile: async (f: TFile) => {
				trashed.push(f.path);
			},
		};
		(s.e as any).app.vault.getFiles = () => [s.note];
		// The server deleted the note (and its tombstone is GC'd): the backstop pass.
		const manifest = { notes: [], attachments: [], total_notes: 0, total_attachments: 0 };
		await (s.e as any).reconcileFromManifest(manifest);
		expect(trashed).toEqual(["Done/a.md"]);
		expect(s.e.folderOps.hasPending("f1")).toBe(false);
	});
});

describe("chain learning respects a pending op (round 3 review #689, N5)", () => {
	test("a crdt_create chain naming the server's PRE-op row does not overwrite our pending move", async () => {
		const s = setup();
		s.e.setCrdtPorts({ create: s.crdtCreate, folderOp: async () => ({ kind: "retry" }) });
		await s.e.setFolderOpsEnabled(true);
		await s.e.handleRename(s.folder, "Proj");
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Done");
		// A note created under Done/ goes by folder id f1; the server, which has
		// not applied our op yet, replies with f1's chain as it knows it.
		s.e.learnFolderChain([{ id: "f1", parent_id: null, name: "Proj" }]);
		expect(s.e.folderOps.index.pathFor("f1")).toBe("Done");
		expect(s.e.folderRefFor("Done/new.md")?.folder_id).toBe("f1");
	});

	test("malformed chain rows are not learned", () => {
		const s = setup();
		s.e.learnFolderChain([{ id: 7, parent_id: null, name: null } as any, { name: "x" } as any]);
		expect(s.e.folderOps.index.size()).toBe(1);
	});
});
