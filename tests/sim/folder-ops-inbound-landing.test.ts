// e2e test_107 restart case (backend PR 2607, run 44003118650, plugin
// 55611f45): A's folder op is held, B edits Proj/a.md at the moment A
// renames Proj. A applied B's write to the moved file (correct), then the
// SAME pull ran the create-at-old-path step (`rename-trace 3/3 CREATING`)
// and left A's bookkeeping naming the old path; after the reload A minted a
// new id for the moved file and sent crdt_create. Where an inbound write
// lands is one decision: every step of the pull must agree with it. The
// step that disagreed was the crdt_doc_ready discovery: it learned the
// announced (old) path into the id map, and its catch-up replay then
// treated the row as a new note there.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const RELAY = Symbol("index-relay");

function shareIndex(t: Topology): void {
	const docs = t.replicas.map((r) => r.noteIdMap.store.doc as Y.Doc);
	docs.forEach((from, i) => {
		from.on("update", (u: Uint8Array, origin: unknown) => {
			if (origin === RELAY) return;
			docs.forEach((to, j) => {
				if (j !== i) {
					t.scheduler.enqueue(`idx:${t.replicas[j].id}`, () =>
						Y.applyUpdate(to, u, RELAY),
					);
				}
			});
		});
	});
	for (const from of docs) {
		const state = Y.encodeStateAsUpdate(from);
		for (const to of docs) if (to !== from) Y.applyUpdate(to, state, RELAY);
	}
}

const read = (r: Replica, rel: string) => {
	const p = path.join(r.vaultDir, rel);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};

describe("an inbound write for a note our pending folder op moved", () => {
	for (const seed of [10771, 10772, 10773, 10774, 10775, 10776, 10777, 10778]) {
		for (const settle of [false, true]) {
			test(`seed ${seed}${settle ? "" : ", edit races the rename"}: nothing at the old path, no create`, async () => {
				const t = await boot(seed, ["A", "B"], { folderOps: true });
				try {
					shareIndex(t);
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
					const id = ea.noteIdMap.get("Proj/a.md");
					const realOp = ea.folderOpPort;
					ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) });
					const creates0 = t.server.count("crdt_create");
					const journal0 = a.writeJournal().length;
					await a.renameFolder("Proj", "Done", "folder-first");
					// Nothing may re-claim an old path while the op is pending: that
					// claim is what the e2e's replay and restart then acted on.
					const oldClaims: string[] = [];
					const setFirst = ea.noteIdMap.set.bind(ea.noteIdMap);
					ea.noteIdMap.set = (p: string, i: string) => {
						if (p.startsWith("Proj/")) oldClaims.push(p);
						return setFirst(p, i);
					};
					if (settle) await t.scheduler.drain();
					await b.editNote("Proj/a.md", "alpha 107\n\npeer edit");
					await t.scheduler.drain();
					// The real server also announces B's room (crdt_doc_ready) at
					// the path it still has; the e2e's A learned the old path from it.
					const announced = ea.discoverAnnouncedNote(id, "Proj/a.md");
					await t.scheduler.drain();
					await announced;
					await t.scheduler.drain();

					const oldWrites = a
						.writeJournal()
						.slice(journal0)
						.filter((w) => w.path.startsWith("Proj/"));
					expect(oldWrites).toEqual([]);
					expect(oldClaims).toEqual([]);
					expect(read(a, "Proj/a.md")).toBeNull();
					expect(read(a, "Done/a.md")).toContain("peer edit");
					// The bookkeeping a restart reads: the note lives at the new path.
					expect(ea.noteIdMap.get("Done/a.md")).toBe(id);
					expect(ea.noteIdMap.get("Proj/a.md")).toBeNull();
					expect(ea.noteIdMap.pathForId(id)).toBe("Done/a.md");
					expect(ea.syncState.has("Proj/a.md")).toBe(false);
					expect(ea.noteIdMap.toJSON()["Proj/a.md"]).toBeUndefined();

					ea.setCrdtPorts({ folderOp: realOp });
					const sent = ea.folderOps.onReconnect();
					await t.scheduler.drain();
					await sent;
					await t.scheduler.drain();
					expect(t.server.count("crdt_create") - creates0).toBe(0);
					for (const r of [a, b]) {
						expect(read(r, "Proj/a.md")).toBeNull();
						expect(read(r, "Done/a.md")).toContain("peer edit");
					}
				} finally {
					cleanup(t);
				}
			});
		}
	}
});
