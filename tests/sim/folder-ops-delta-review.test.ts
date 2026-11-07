// Adopted from the delta review of #689 (comment 6707764228); both cases were
// red at 5a895089. The trash assertion (N3) is ours.
// tests/sim/folder-ops-delta-review.test.ts (delta review of #689 @ 5a895089)
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { HOLD_MAX_MS } from "../../src/folder-ops";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));

describe("delta review #689: hold from a manifest row, no other writer", () => {
	for (const via of ["idmap-reconcile", "fullSync"])
		test(`${via}: op unanswered 3 min after a manifest read: the user's move must not be undone`, async () => {
			const t = await boot(3200, ["A", "B"], { folderOps: true });
			try {
				const [a, b] = t.replicas;
				await a.createNote("Proj/a.md", "alpha body");
				await t.scheduler.drain();
				for (const r of t.replicas) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				const ch = (a as any).channel;
				const real = ch.folderOp.bind(ch);
				// The server is slow (cascade on a big folder, rate limit, crdt topic not joined).
				(a.engine as any).setCrdtPorts({ folderOp: async () => ({ kind: "retry" }) });
				await a.renameFolder("Proj", "Done", "folder-first");
				await t.scheduler.drain();
				// Any manifest read in that window carries the server's PRE-op row.
				const s =
					via === "fullSync"
						? a.fullSync()
						: (a.engine as any).reconcileNoteIdMapFromManifest();
				await t.scheduler.drain();
				await s;
				const fo = (a.engine as any).folderOps;
				const now0 = fo.deps.now;
				fo.deps.now = () => now0() + HOLD_MAX_MS + 1;
				// Driven through the scheduler (author's adaptation, round 3): the op
				// may now reach its attempt/age cap here, and the per-file fallback
				// waits on replies only drain() delivers.
				const ticked = fo.tick();
				await t.scheduler.drain();
				await ticked;
				fo.deps.now = now0;
				await t.scheduler.drain();
				(a.engine as any).setCrdtPorts({ folderOp: real }); // server recovers
				for (const r of [a, b]) {
					await r.goOffline();
					await r.goOnline();
				}
				await t.scheduler.drain();
				expect([...t.server.state().notes.keys()]).toEqual(["Done/a.md"]);
				expect(onDisk(a, "Done/a.md")).toBe(true);
				expect(onDisk(b, "Done/a.md")).toBe(true);
				// N3: the delete pass must not trash files a pending op moved.
				expect(a.trashed()).toEqual([]);
			} finally {
				cleanup(t);
			}
		}, 60000);
});
