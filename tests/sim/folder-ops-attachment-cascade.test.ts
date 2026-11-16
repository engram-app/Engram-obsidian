// e2e test_107 (backend PR 2607, run 43791484191) on plugin 8ac3d17e: A renames
// a folder holding an attachment with folder ops on. The server's cascade
// announces each attachment as delete(old) + upsert(new), BEFORE
// folder_changed. B must follow without ever sending a DELETE: the e2e lost
// the attachment on the server and both vaults.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));

describe("folder op cascade with an attachment", () => {
	for (const folderOps of [true, false]) {
		for (const seed of [10701, 10702]) {
			test(`folder_ops=${folderOps} seed ${seed}: the attachment survives everywhere`, async () => {
				const t = await boot(seed, ["A", "B"], { folderOps });
				try {
					const [a, b] = t.replicas;
					await a.createNote("Proj/a.md", "alpha body");
					await a.createAttachment("Proj/img.png", PNG);
					await t.scheduler.drain();
					for (const r of t.replicas) {
						await r.goOffline();
						await r.goOnline();
					}
					await t.scheduler.drain();
					expect(onDisk(b, "Proj/img.png")).toBe(true); // B has its copy first
					const deletes0 = t.server.count("DELETE /attachments/*");
					await a.renameFolder("Proj", "Done", "folder-first");
					await t.scheduler.drain();
					await t.scheduler.drain();
					expect(t.server.hasAttachmentAt("Done/img.png")).toBe(true);
					expect(t.server.count("DELETE /attachments/*") - deletes0).toBe(0);
					for (const r of [a, b]) {
						expect(onDisk(r, "Done/img.png")).toBe(true);
						expect(onDisk(r, "Proj/img.png")).toBe(false);
					}
				} finally {
					cleanup(t);
				}
			});
		}
	}
});
