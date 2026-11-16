// e2e test_107 restart case (backend PR 2607, run 43846246580, plugin
// 4d280cab): with A's folder op still held, the server relocated A's notes per
// file about 14 s after A's rename, over the socket. A crdt_create still queued
// for a note the server already has (a lost or slow ack) was re-keyed to the
// new path by rekeyMoved, and the queue's next tick sent it: the backend reads
// a create for a known id as a rename. A queued create under a pending folder
// op's target must wait for the op, like a path-addressed REST replay.
import { afterAll, describe, expect, test } from "bun:test";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

describe("a queued create under a pending folder op waits for the op", () => {
	for (const seed of [10721, 10722]) {
		test(`seed ${seed}: no per-note relocation while the op is held`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				const [a] = t.replicas;
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
				expect(id).toBeTruthy();
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) }); // never sent
				// A create whose ack never came back: still queued for a note the
				// server already holds (offline here so it stays queued until the rename).
				await a.goOffline();
				ea.crdtEnqueue({ kind: "create", docId: id, path: "Proj/a.md" });
				await a.renameFolder("Proj", "Done", "folder-first");
				await a.goOnline();
				await t.scheduler.drain();
				// The op is held: the server must still have the note where it was.
				expect([...t.server.state().notes.keys()].sort()).toEqual([
					"Proj/a.md",
					"Proj/sub/b.md",
				]);
				// The op lands: one op moves both, and the held create follows it.
				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				expect([...t.server.state().notes.keys()].sort()).toEqual([
					"Done/a.md",
					"Done/sub/b.md",
				]);
			} finally {
				cleanup(t);
			}
		});
	}
});
