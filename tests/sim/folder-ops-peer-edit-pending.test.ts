// e2e test_107 "restart mid-op" (backend PR 2607, run 43791484191, plugin
// 8ac3d17e): A's folder op is pending (never sent); B edits a child at the
// path the server still has. B's edit must reach the server, survive on B's
// disk, and follow the note to the new folder once A's op lands. In the e2e
// the edit never left B, then a per-file relocation overwrote it on B's disk.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const read = (r: Replica, rel: string) => {
	const p = path.join(r.vaultDir, rel);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

describe("peer edit while our folder op is pending", () => {
	for (const seed of [10711, 10712, 10713]) {
		test(`seed ${seed}: B's edit at the old path is never lost`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha 107");
				await a.createNote("Proj/sub/b.md", "beta 107");
				await t.scheduler.drain();
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				const ea = a.engine as any;
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) }); // never sent
				const creates0 = t.server.count("crdt_create");
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				await b.editNote("Proj/a.md", "alpha 107\n\npeer edit");
				await t.scheduler.drain();
				// The server still has the note at Proj/: B's edit is there.
				const atOld = t.server.state().notes.get("Proj/a.md");
				expect(atOld?.content).toContain("peer edit");
				expect(read(b, "Proj/a.md")).toContain("peer edit");
				// A's op finally lands (the reload in the e2e): one op, no per-note push.
				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				expect(t.server.count("crdt_create") - creates0).toBe(0);
				const atNew = t.server.state().notes.get("Done/a.md");
				expect(atNew?.content).toContain("peer edit");
				expect(read(b, "Done/a.md")).toContain("peer edit");
				expect(read(a, "Done/a.md")).toContain("peer edit");
			} finally {
				cleanup(t);
			}
		});
	}
});
