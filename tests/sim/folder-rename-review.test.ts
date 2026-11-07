// Adopted from the adversarial review of #689 (comment 6707480438); they were
// red at f020b50d.
// Adversarial review of #689: failing tests.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));

describe("review #689", () => {
	test("move into a folder created this session: refused dependent create must still redo per file", async () => {
		const t = await boot(2600, ["A", "B"], { folderOps: true });
		try {
			const [a, b] = t.replicas;
			await a.createNote("Proj/a.md", "alpha body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			// New this session: the server has the folder, A's index does not.
			await a.createNote("Archive/n.md", "n body");
			await t.scheduler.drain();

			await a.renameFolder("Proj", "Archive/Proj", "folder-first");
			await t.scheduler.drain();
			for (const r of [a, b]) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();

			const keys = [...t.server.state().notes.keys()].sort();
			expect(keys).toEqual(["Archive/Proj/a.md", "Archive/n.md"]);
			expect(onDisk(a, "Archive/Proj/a.md")).toBe(true);
			expect(a.trashed()).toEqual([]);
		} finally {
			cleanup(t);
		}
	});

	test("restart after an offline rename: features arrive after the crdt join; the move must not be undone", async () => {
		const t = await boot(2601, ["A", "B"], { folderOps: true });
		try {
			const [a] = t.replicas;
			await a.createNote("Proj/a.md", "alpha body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			await a.goOffline();
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			// Restart: in-memory state is gone, the persisted op survives.
			const e = a.engine as any;
			const ops = e.folderOps.all();
			expect(ops.length).toBe(1);
			e.folderOps.feature = false;
			e.folderOps.index.load([]);
			e.pendingLocalMoves.clear();
			// The user-topic join reply (features) lands after the crdt join.
			const ch = (a as any).channel;
			const orig = ch.onServerFeatures;
			ch.onServerFeatures = (f: unknown) => setTimeout(() => orig(f), 50);
			await a.goOnline();
			await t.scheduler.drain();
			await t.scheduler.drain();
			expect([...t.server.state().notes.keys()]).toEqual(["Done/a.md"]);
			expect(onDisk(a, "Done/a.md")).toBe(true);
			expect(onDisk(a, "Proj/a.md")).toBe(false);
		} finally {
			cleanup(t);
		}
	});

	test("offline peer restarts: catch-up runs before features arrive, folder moves must still precede the delete pass", async () => {
		const t = await boot(2602, ["A", "B"], { folderOps: true, cascadeBroadcasts: false });
		try {
			const [a, b] = t.replicas;
			await a.createNote("Proj/a.md", "alpha body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			await b.goOffline();
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			// B restarts: features.folder_ops is not known until the user join.
			(b.engine as any).folderOps.feature = false;
			const sync = b.fullSync();
			await t.scheduler.drain();
			await sync;
			expect(b.trashed()).toEqual([]);
		} finally {
			cleanup(t);
		}
	});
});
