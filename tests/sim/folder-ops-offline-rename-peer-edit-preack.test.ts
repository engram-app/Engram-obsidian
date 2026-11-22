// e2e test_108 test_offline_nested_folder_rename_keeps_peer_edit (backend run
// 44894721937): A renames a folder while offline, B edits a child online, A
// reconnects. The server answered A's folder_op with a CASCADE (notes_cascaded
// = true) where the test wants an uncascaded move. The real server cascades
// when a folder row or note already sits at the new path, so the plugin must
// put NOTHING on the wire at the new path before the op is answered: no
// per-note create or push, no REST write, and the op is the first write it
// sends. Ordering is injected (the op handler snapshots the server when the
// op arrives), no timers.
import { afterAll, describe, expect, test } from "bun:test";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const WRITES = /^(crdt_create|crdt_delete|crdt_msg|PUT |POST |DELETE |PATCH )/;

describe("offline folder rename + peer edit, reconnect", () => {
	for (const seed of [10801, 10802, 10803]) {
		test(`seed ${seed}: no write at the new path before the folder op`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha 108");
				await a.createNote("Proj/sub/b.md", "beta 108");
				await t.scheduler.drain();
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();

				// What the server saw, in order, up to the moment the op lands.
				const server = t.server as any;
				const wire: string[] = [];
				const realTally = server.tally.bind(server);
				server.tally = (key: string) => {
					wire.push(key);
					realTally(key);
				};
				let atOp: { wire: string[]; newPaths: string[] } | null = null;
				const realHandle = server.handleFolderOp.bind(server);
				server.handleFolderOp = (...args: unknown[]) => {
					atOp = {
						wire: [...wire],
						newPaths: [...t.server.state().notes.keys()].filter((p) =>
							p.startsWith("Done/"),
						),
					};
					return realHandle(...args);
				};

				await a.goOffline();
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				// B, online, edits a child; its edit is on the server before A is back.
				await b.editNote("Proj/a.md", "alpha 108\n\npeer edit");
				await t.scheduler.drain();
				expect(t.server.state().notes.get("Proj/a.md")?.content).toContain("peer edit");

				wire.length = 0;
				await a.goOnline();
				await t.scheduler.drain();

				expect(atOp, "the folder op reached the server").not.toBeNull();
				const seen = atOp as unknown as { wire: string[]; newPaths: string[] };
				expect(seen.newPaths, "nothing at the new path when the op lands").toEqual([]);
				expect(
					seen.wire.filter((k) => WRITES.test(k)),
					"writes before the op",
				).toEqual([]);
				expect(t.server.count("folder_op")).toBe(1);
				expect(t.server.state().notes.get("Done/a.md")?.content).toContain("peer edit");
			} finally {
				cleanup(t);
			}
		});
	}
});
