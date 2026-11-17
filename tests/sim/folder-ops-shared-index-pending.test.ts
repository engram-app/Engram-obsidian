// e2e test_107 "restart mid-op" (backend PR 2607, run 44000240952, plugin
// 4a40a509). The shared index room (filemeta_v0) is authoritative for paths:
// the server derives note rows from it and every device reads its id map
// from it. A's re-key for a still-pending folder op published the moved
// paths there, so B's map moved before the server did. B's edit at the old
// path then read as unmapped ("Mint refused but edit PRESERVED"), the
// server's index projection moved the rows one note at a time without the
// op, and B ended keep-both with its edit only in the copy.
//
// The sim has no index room by default; this file relays the replicas'
// index docs through the scheduler, the way the room does.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const RELAY = Symbol("index-relay");

/** Every replica's index doc mirrors the others', delivered on a lane. */
function shareIndex(t: Topology): void {
	const docs = t.replicas.map((r) => r.noteIdMap.store.doc as Y.Doc);
	docs.forEach((from, i) => {
		from.on("update", (u: Uint8Array, origin: unknown) => {
			if (origin === RELAY) return;
			docs.forEach((to, j) => {
				if (j === i) return;
				t.scheduler.enqueue(`idx:${t.replicas[j].id}`, () => Y.applyUpdate(to, u, RELAY));
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

const committed = (r: Replica) => {
	const out: Record<string, string> = {};
	(r.noteIdMap.store.doc as Y.Doc).getMap<{ note_id: string }>("filemeta_v0").forEach((m, p) => {
		out[p] = m.note_id;
	});
	return out;
};

describe("a pending folder op and the shared index", () => {
	for (const seed of [10761, 10762, 10763]) {
		test(`seed ${seed}: peers keep the old paths until the op lands; B's edit survives`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				shareIndex(t);
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha 107");
				await a.createNote("Proj/b.md", "beta 107");
				await t.scheduler.drain();
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				const id = b.noteIdMap.get("Proj/a.md");
				expect(id).toBeTruthy();
				const ea = a.engine as any;
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) }); // never sent
				const creates0 = t.server.count("crdt_create");
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				// A sees its own move; the shared index does not, yet.
				expect(a.noteIdMap.get("Done/a.md")).toBe(id);
				expect(committed(a)["Proj/a.md"]).toBe(id);
				expect(committed(a)["Done/a.md"]).toBeUndefined();
				expect(b.noteIdMap.get("Proj/a.md")).toBe(id);
				expect(b.noteIdMap.pathForId(id as string)).toBe("Proj/a.md");

				await b.editNote("Proj/a.md", "alpha 107\n\npeer edit");
				await t.scheduler.drain();
				expect(t.server.state().notes.get("Proj/a.md")?.content).toContain("peer edit");

				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				expect(t.server.count("crdt_create") - creates0).toBe(0);
				// After the ack the index carries the move.
				expect(committed(a)["Done/a.md"]).toBe(id);
				expect(committed(a)["Proj/a.md"]).toBeUndefined();
				expect(t.server.state().notes.get("Done/a.md")?.content).toContain("peer edit");
				for (const r of [a, b]) {
					expect(read(r, "Done/a.md")).toContain("peer edit");
					expect(read(r, "Proj/a.md")).toBeNull();
					const copies = fs
						.readdirSync(path.join(r.vaultDir, "Done"))
						.filter((f) => f !== "a.md" && f !== "b.md");
					expect(copies).toEqual([]);
				}
			} finally {
				cleanup(t);
			}
		});
	}
});
