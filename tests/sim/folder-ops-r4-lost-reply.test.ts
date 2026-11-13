// Adopted from the round-4 adversarial review of #689 (comment 6708410900).
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));

for (const cascadeBroadcasts of [true, false])
	test(`server applied, every reply lost: the cap's fallback loses nothing (cascade=${cascadeBroadcasts})`, async () => {
		const t = await boot(3400, ["A", "B"], { folderOps: true, cascadeBroadcasts } as any);
		try {
			const [a, b] = t.replicas as [Replica, Replica];
			await a.createNote("Proj/a.md", "alpha body");
			await a.createNote("Proj/sub/b.md", "beta body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			const ch = (a as any).channel;
			const real = ch.folderOp.bind(ch);
			let sends = 0;
			(a.engine as any).setCrdtPorts({
				folderOp: async (op: any) => {
					sends++;
					const p = real(op);
					await p;
					return { kind: "retry" };
				},
			});
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			const fo = (a.engine as any).folderOps;
			for (let i = 0; i < 20 && fo.all().length; i++) {
				for (const op of fo.all()) op.nextAttemptAt = 0;
				const k = fo.tick();
				await t.scheduler.drain();
				await k;
			}
			expect(fo.all()).toHaveLength(0);
			(a.engine as any).setCrdtPorts({ folderOp: real });
			for (const r of [a, b]) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			const server = [...t.server.state().notes.keys()].sort();
			expect(server).toEqual(["Done/a.md", "Done/sub/b.md"]);
			for (const r of [a, b]) for (const p of server) expect(onDisk(r, p)).toBe(true);
			expect(a.trashed()).toEqual([]);
			expect(b.trashed()).toEqual([]);
			expect(sends).toBeGreaterThan(1);
		} finally {
			cleanup(t);
		}
	}, 60000);
