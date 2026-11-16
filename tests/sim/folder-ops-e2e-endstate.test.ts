// End states from the paired e2e run 43862890570 (backend PR 2607, plugin
// a9fce9c3). Setup mirrors test_107: devices reconnect BEFORE the folder is
// seeded (so B learns its ids only from live events), the folder holds a note,
// a subfolder note and an attachment, and the server sends its real order.
// Assert the END STATE, not a log line: no folder left at the old path on any
// device or the server, every file at the new path, ids unchanged.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));

async function seededLive(seed: number): Promise<Topology> {
	const t = await boot(seed, ["A", "B"], { folderOps: true });
	for (const r of t.replicas) {
		await r.goOffline();
		await r.goOnline();
	}
	await t.scheduler.drain();
	const [a] = t.replicas;
	await a.createNote("Proj/a.md", "alpha body");
	await a.createNote("Proj/sub/b.md", "beta body");
	await a.createAttachment("Proj/img.png", PNG);
	await t.scheduler.drain();
	await t.scheduler.drain();
	return t;
}

function expectMovedEverywhere(t: Topology): void {
	expect([...t.server.state().notes.keys()].sort()).toEqual(["Done/a.md", "Done/sub/b.md"]);
	expect(t.server.hasAttachmentAt("Done/img.png")).toBe(true);
	expect(t.server.folderPaths()).not.toContain("Proj");
	expect(t.server.folderPaths()).not.toContain("Proj/sub");
	for (const r of t.replicas) {
		for (const p of ["Done/a.md", "Done/sub/b.md", "Done/img.png"])
			expect(onDisk(r, p)).toBe(true);
		expect(onDisk(r, "Proj")).toBe(false);
	}
}

describe("e2e end state: folder rename with folder ops on (run 43862890570)", () => {
	for (const seed of [10731, 10732, 10733]) {
		test(`seed ${seed}: plugin rename, no old folder anywhere`, async () => {
			const t = await seededLive(seed);
			try {
				const [a, b] = t.replicas;
				expect(onDisk(b, "Proj/sub/b.md")).toBe(true);
				const ids0 = [...t.server.state().notes.values()].map((n) => n.id).sort();
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				await t.scheduler.drain();
				expectMovedEverywhere(t);
				expect([...t.server.state().notes.values()].map((n) => n.id).sort()).toEqual(ids0);
			} finally {
				cleanup(t);
			}
		});
	}
});
