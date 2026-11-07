// Adopted from the adversarial review of #689 (comment 6707480438); they were
// red at f020b50d.
// Review #689: the first server stage ships ONLY features.folder_ops plus the
// folder_op/folder_changed wire. No manifest `folders`, crdt_create ignores
// folder_id/name, no index_v1.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";
import type { FolderRenameOrder } from "./vault-fs";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));
const read = (r: Replica, rel: string) => {
	const p = path.join(r.vaultDir, rel);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

async function stage1(seed: number): Promise<Topology> {
	const t = await boot(seed, ["A", "B"], { folderOps: true, manifestFolders: false });
	const [a] = t.replicas;
	await a.createNote("Proj/a.md", "alpha body");
	await a.createNote("Proj/sub/b.md", "beta body");
	await t.scheduler.drain();
	for (const r of t.replicas) {
		await r.goOffline();
		await r.goOnline();
	}
	await t.scheduler.drain();
	return t;
}

function settled(r: Replica) {
	const e = r.engine as any;
	return {
		pending: e.folderOps.all().length,
		held: e.folderOps.held.size,
		enabled: e.folderOps.enabled(),
	};
}

describe("stage-1 server (folder_ops, no folder ids)", () => {
	const orders: FolderRenameOrder[] = ["folder-first", "children-first", "split"];
	for (const [i, order] of orders.entries()) {
		test(`${order}: per-file, no folder_op, nothing pending or held, converged`, async () => {
			const t = await stage1(2700 + i);
			try {
				const [a, b] = t.replicas;
				const ids = t.server.liveNoteIds().sort();
				const ops0 = t.server.count("folder_op");
				await a.renameFolder("Proj", "Done", order);
				await t.scheduler.drain();
				for (const r of [a, b]) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				expect(t.server.count("folder_op") - ops0).toBe(0);
				expect([...t.server.state().notes.keys()].sort()).toEqual([
					"Done/a.md",
					"Done/sub/b.md",
				]);
				expect(t.server.liveNoteIds().sort()).toEqual(ids);
				for (const r of [a, b]) {
					expect(settled(r)).toEqual({ pending: 0, held: 0, enabled: true });
					expect(read(r, "Done/a.md")).toBe("alpha body");
					expect(read(r, "Done/sub/b.md")).toBe("beta body");
					expect(onDisk(r, "Proj/a.md")).toBe(false);
				}
			} finally {
				cleanup(t);
			}
		});
	}

	test("folder id learned from folder_changed only; moved into an existing unindexed folder", async () => {
		const t = await stage1(2710);
		try {
			const [a, b] = t.replicas;
			await a.createNote("Archive/n.md", "n body");
			await t.scheduler.drain();
			// A server-side (web/MCP) folder event teaches A one root folder id.
			const projId = t.server.folderIdFor("Proj");
			await (a.engine as any).onFolderChanged({
				id: projId,
				parent_id: null,
				name: "Proj",
				seq: 99,
				deleted: false,
				device_id: "web",
			});
			await a.renameFolder("Proj", "Archive/Proj", "folder-first");
			await t.scheduler.drain();
			for (const r of [a, b]) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			expect([...t.server.state().notes.keys()].sort()).toEqual([
				"Archive/Proj/a.md",
				"Archive/Proj/sub/b.md",
				"Archive/n.md",
			]);
			expect(onDisk(a, "Archive/Proj/a.md")).toBe(true);
			expect(settled(a)).toEqual({ pending: 0, held: 0, enabled: true });
		} finally {
			cleanup(t);
		}
	});
});
