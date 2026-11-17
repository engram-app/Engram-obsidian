// Adversarial review @ 23b5eee2, MEDIUM-2: an inbound write for a path our
// pending folder op moved was redirected into the moved file by the create
// helpers, but its caller recorded the sync row and base at the OLD path,
// where no file is. The moved file kept its old baseline, so the bytes just
// written could later read as a local edit. A peer replacing an attachment
// at the old path reaches that branch through the real inbound route.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const bytes = (r: Replica, rel: string) => {
	const p = path.join(r.vaultDir, rel);
	return fs.existsSync(p) ? [...fs.readFileSync(p)] : null;
};

describe("an inbound write redirected into the moved file", () => {
	for (const seed of [10791, 10792, 10793]) {
		test(`seed ${seed}: records land at the moved path, the new bytes everywhere`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha");
				await a.createAttachment("Proj/img.png", PNG);
				await t.scheduler.drain();
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				expect(bytes(b, "Proj/img.png")).toEqual([...PNG]);
				const ea = a.engine as any;
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) });
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				// B replaces the attachment at the path the server still has.
				const vb = (b as any).app.vault;
				await vb.modifyBinary(
					vb.getAbstractFileByPath("Proj/img.png"),
					PNG2.slice().buffer,
				);
				await t.scheduler.drain();
				await t.scheduler.drain();

				expect(bytes(a, "Proj/img.png")).toBeNull();
				expect(bytes(a, "Done/img.png")).toEqual([...PNG2]);
				expect(ea.syncState.has("Proj/img.png")).toBe(false);
				expect(ea.syncState.has("Done/img.png")).toBe(true);

				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				expect(t.server.hasAttachmentAt("Done/img.png")).toBe(true);
				for (const r of [a, b]) {
					expect(bytes(r, "Proj/img.png")).toBeNull();
					expect(bytes(r, "Done/img.png")).toEqual([...PNG2]);
				}
			} finally {
				cleanup(t);
			}
		});
	}
});
