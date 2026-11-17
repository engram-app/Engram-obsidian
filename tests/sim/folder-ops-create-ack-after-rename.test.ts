// e2e test_107 restart case (backend PR 2607 + #2615, run 43976104537, plugin
// d3e6f2cf): A wrote the folder's notes about 2 s before renaming it, so a
// genesis crdt_create was still in flight when the folder op re-keyed them.
// Its ack re-claimed the path the create was SENT with (the old one) and put
// A's id map back there; the next inbound row re-created the note at the old
// path and the reload re-pushed it per note (`crdt_create=1`). An ack that
// lands after our own move must keep the moved bookkeeping.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

describe("a create ack that lands after our folder op re-keyed the note", () => {
	for (const seed of [10751, 10752, 10753]) {
		test(`seed ${seed}: the map stays at the new path; no per-note create`, async () => {
			const t = await boot(seed, ["A", "B"], { folderOps: true });
			try {
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				const [a, b] = t.replicas;
				await a.createNote("Proj/seed.md", "makes the folder server-known");
				await t.scheduler.drain();
				await t.scheduler.drain();
				const ea = a.engine as any;
				const realOp = ea.folderOpPort;
				ea.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) });
				// The create goes out; the rename lands before its reply is applied.
				await a.createNote("Proj/a.md", "alpha 107");
				await t.scheduler.drain(); // debounce fires, the create is sent
				const ackFirst = ea.adoptCreateAck.bind(ea); // the sink of both create paths
				let held: (() => Promise<void>) | null = null;
				ea.adoptCreateAck = (...args: unknown[]) =>
					new Promise<void>((resolve) => {
						held = async () => {
							await ackFirst(...args);
							resolve();
						};
					});
				await a.createNote("Proj/b.md", "beta 107");
				await t.scheduler.drain();
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				ea.adoptCreateAck = ackFirst;
				if (held) await (held as () => Promise<void>)();
				await t.scheduler.drain();
				const id = ea.noteIdMap.get("Done/b.md");
				expect(id).toBeTruthy();
				expect(ea.noteIdMap.get("Proj/b.md")).toBeNull();
				expect(ea.noteIdMap.pathForId(id)).toBe("Done/b.md");
				// The op lands: one op, and no child is re-pushed per note.
				const creates0 = t.server.count("crdt_create");
				ea.setCrdtPorts({ folderOp: realOp });
				const sent = ea.folderOps.onReconnect();
				await t.scheduler.drain();
				await sent;
				await t.scheduler.drain();
				expect(t.server.count("crdt_create") - creates0).toBe(0);
				for (const r of [a, b]) {
					expect(fs.existsSync(path.join(r.vaultDir, "Proj/b.md"))).toBe(false);
					expect(fs.existsSync(path.join(r.vaultDir, "Done/b.md"))).toBe(true);
				}
			} finally {
				cleanup(t);
			}
		});
	}
});
