// End state from paired e2e run 43862890570 (test_107 restart case, plugin
// a9fce9c3): A's folder op is held; B edits a child at the old path, which is
// where the server still has it. On A the edit must land in the MOVED note:
// exactly one a.md on A (at the new path) carrying the edit, nothing at the
// old path, and both id maps bijective. In the e2e, A wrote B's edit as a
// second file at the old path and B hit `invariant violated [id-map-bijective]`.
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

/** Every mapped path's id maps back to that path. */
function bijectiveViolations(r: Replica): string[] {
	const map = (r.engine as any).noteIdMap;
	return Object.entries(map.toJSON() as Record<string, string>)
		.filter(([p, id]) => map.pathForId(id) !== p)
		.map(([p, id]) => `${p}->${id}->${map.pathForId(id)}`);
}

describe("e2e end state: peer edit while our folder op is held (run 43862890570)", () => {
	// flap: a rejoin's features reply says folder_ops=false mid-op, then true
	// again (the e2e toggles the server switch per test; the override cache
	// has a 15 s TTL). A logged `Folder op refused (feature_off)` there.
	for (const [seed, flap] of [
		[10741, false],
		[10742, false],
		[10743, true],
		[10744, true],
	] as const) {
		test(`seed ${seed}${flap ? " + feature flap" : ""}: one a.md on A, at the new path, with the edit`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha 107");
				await a.createNote("Proj/sub/b.md", "beta 107");
				await t.scheduler.drain();
				await t.scheduler.drain();
				const ea = a.engine as any;
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) });
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				if (flap) {
					const off = ea.setFolderOpsEnabled(false); // may run a fallback: drain it
					await t.scheduler.drain();
					await off;
				}
				await b.editNote("Proj/a.md", "alpha 107\n\npeer edit");
				await t.scheduler.drain();
				await t.scheduler.drain();
				if (flap) {
					const on = ea.setFolderOpsEnabled(true);
					await t.scheduler.drain();
					await on;
				}
				await t.scheduler.drain();
				// The harness check that failed: nothing moved back on A.
				expect(read(a, "Proj/a.md")).toBeNull();
				expect(read(a, "Done/a.md")).toContain("peer edit");
				expect(bijectiveViolations(a)).toEqual([]);
				expect(bijectiveViolations(b)).toEqual([]);
				// The op lands: one note per id, the edit everywhere.
				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				expect([...t.server.state().notes.keys()].sort()).toEqual([
					"Done/a.md",
					"Done/sub/b.md",
				]);
				expect(t.server.state().notes.get("Done/a.md")?.content).toContain("peer edit");
				for (const r of t.replicas) {
					expect(read(r, "Proj/a.md")).toBeNull();
					expect(read(r, "Done/a.md")).toContain("peer edit");
					expect(bijectiveViolations(r)).toEqual([]);
				}
			} finally {
				cleanup(t);
			}
		});
	}
});
