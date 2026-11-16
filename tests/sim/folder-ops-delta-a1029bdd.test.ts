// Adopted from the delta review of #689 (REQUEST_CHANGES @ a1029bdd), MEDIUM-1:
// a peer renames a child while our folder op is pending; the ack must count
// as the echo so the post-op path applies (onFolderOpLeft).
import { afterAll, describe, expect, test } from "bun:test";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
describe("delta review a1029bdd", () => {
	for (const seed of [2701, 2703]) {
		test(`MEDIUM-1 ${seed}: peer renames a child while our folder op is pending: we converge`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				const [a, b] = t.replicas;
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
				await t.scheduler.drain();
				await b.renameNote("Proj/a.md", "Proj/z.md");
				await t.scheduler.drain();
				await a.goOnline();
				await t.scheduler.drain();
				await t.scheduler.drain();
				const server = [...t.server.state().notes.keys()].sort();
				const local = (a as any).app.vault
					.getMarkdownFiles()
					.map((f: any) => f.path)
					.sort();
				expect(local).toEqual(server); // red at a1029bdd: A has Done/a.md, server Done/z.md
			} finally {
				cleanup(t);
			}
		});
	}
});
