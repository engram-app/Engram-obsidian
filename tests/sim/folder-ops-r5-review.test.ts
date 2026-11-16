// Adopted from the round-5 adversarial review of #689 (REQUEST_CHANGES @ 26f90b7).
// HIGH-1: a create queued offline must follow an offline folder op (rekeyMoved).
// MEDIUM-3: on reconnect folder ops go before queued creates (main.ts onCrdtJoined).
import { afterAll, describe, expect, test } from "bun:test";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
describe("review 26f90b7", () => {
	test("HIGH-1: offline create in Proj, then offline rename Proj->Done: the note reaches the server", async () => {
		const t = await boot(2701, ["A", "B"], { folderOps: true });
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
			await a.createNote("Proj/new.md", "new body");
			await t.scheduler.drain();
			await a.renameFolder("Proj", "Done", "folder-first");
			await a.goOnline();
			await t.scheduler.drain(); // red at 26f90b7: never quiescent, server lacks Done/new.md
			expect([...t.server.state().notes.keys()].sort()).toEqual(["Done/a.md", "Done/new.md"]);
		} finally {
			cleanup(t);
		}
	});
	test("MEDIUM-3: offline rename Proj->Done, then offline create in Done: still ONE folder_op, no per-file", async () => {
		const t = await boot(2700, ["A", "B"], { folderOps: true });
		try {
			const [a] = t.replicas;
			await a.createNote("Proj/a.md", "alpha body");
			await a.createNote("Proj/b.md", "beta body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			await a.goOffline();
			await a.renameFolder("Proj", "Done", "folder-first");
			await a.createNote("Done/new.md", "new body");
			await t.scheduler.drain();
			const c0 = t.server.count("crdt_create");
			await a.goOnline();
			await t.scheduler.drain();
			await t.scheduler.drain();
			expect([...t.server.state().notes.keys()].sort()).toEqual([
				"Done/a.md",
				"Done/b.md",
				"Done/new.md",
			]);
			expect(t.server.count("crdt_create") - c0).toBe(1); // red at 26f90b7: 4
		} finally {
			cleanup(t);
		}
	});
});
