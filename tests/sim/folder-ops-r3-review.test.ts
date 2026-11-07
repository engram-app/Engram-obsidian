// Adopted from the round-3 adversarial review of #689 (comment 6708031599).
// Round-3 review of #689 @ 24fff7f3: after a hold expiry applied the other
// writer's move, our op's LATE ack must bring this device to the server's state.
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { HOLD_MAX_MS } from "../../src/folder-ops";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));

for (const cascadeBroadcasts of [true, false])
	test(`late ack after hold expiry: A follows the server (cascade=${cascadeBroadcasts})`, async () => {
		const t = await boot(3300, ["A", "B"], { folderOps: true, cascadeBroadcasts } as any);
		try {
			const [a, b] = t.replicas as [Replica, Replica];
			await a.createNote("Proj/a.md", "alpha body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			const ch = (a as any).channel;
			const real = ch.folderOp.bind(ch);
			(a.engine as any).setCrdtPorts({ folderOp: async () => ({ kind: "retry" }) });
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			await b.renameFolder("Proj", "Theirs", "folder-first");
			await t.scheduler.drain();
			const fo = (a.engine as any).folderOps;
			// Author's adaptation (round 3): expire the hold itself rather than
			// jumping the clock, so our op stays within its attempt and age budget
			// and the late ACK path (not the per-file fallback) is what runs.
			for (const h of fo.held.values()) h.since -= HOLD_MAX_MS + 1;
			// The sim's drains jump virtual time ~5 min with no 5 s tick wired, so
			// the op's age cap (OP_TTL_MS) would end it in the fallback; restart its
			// age so this test reaches the late ack it exists to pin.
			for (const op of fo.all()) op.firstSentAt = fo.deps.now();
			const expired = fo.tick();
			await t.scheduler.drain();
			await expired;
			for (const op of fo.all()) op.nextAttemptAt = 0;
			expect(fo.all()).toHaveLength(1);
			(a.engine as any).setCrdtPorts({ folderOp: real });
			const late = fo.tick(); // the server answers ok this time
			await t.scheduler.drain();
			await late;
			await t.scheduler.drain();
			const server = [...t.server.state().notes.keys()];
			const want = server[0] as string;
			expect(server.length).toBe(1);
			expect(onDisk(a, want)).toBe(true);
			expect(onDisk(b, want)).toBe(true);
		} finally {
			cleanup(t);
		}
	}, 60000);
