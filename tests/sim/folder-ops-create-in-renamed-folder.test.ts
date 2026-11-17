// Adversarial review @ 23b5eee2, MEDIUM-1: a note created in a just-renamed
// folder went out through pushFile's inline crdt_create, which skipped the
// pending-op create gate. The server's find-or-create by path then makes a
// NEW folder at the new name, so the op is refused with `conflict` and the
// whole rename degrades to per file. Every create must wait for the op.
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

describe("a note created in a folder our pending op just renamed", () => {
	for (const seed of [10801, 10802, 10803]) {
		test(`seed ${seed}: no create before the op, then one create in the moved folder`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha");
				await t.scheduler.drain();
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				const ea = a.engine as any;
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) });
				const creates0 = t.server.count("crdt_create");
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				await a.createNote("Done/new.md", "fresh note");
				await t.scheduler.drain();
				await t.scheduler.drain();
				// Nothing reaches the server under the new name before the op.
				expect(t.server.count("crdt_create") - creates0).toBe(0);
				expect(t.server.state().notes.has("Done/new.md")).toBe(false);

				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				await t.scheduler.drain();
				expect(t.server.count("folder_op")).toBeGreaterThanOrEqual(1);
				expect(t.server.state().notes.get("Done/a.md")).toBeTruthy();
				expect(t.server.state().notes.get("Done/new.md")?.content).toContain("fresh note");
				expect(t.server.count("crdt_create") - creates0).toBe(1);
				expect(read(b, "Done/new.md")).toContain("fresh note");
				expect(read(b, "Proj/a.md")).toBeNull();
			} finally {
				cleanup(t);
			}
		});
	}
});
