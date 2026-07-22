// tests/sim/replica.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

const tmpDirs: string[] = [];
function freshRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replica-sim-"));
	tmpDirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("Replica — two-replica convergence (no faults)", () => {
	test("A.createNote converges to B, the server row, and both noteIdMaps", async () => {
		const clock = new SimClock();
		const scheduler = new Scheduler(1, clock);
		const server = new ModelServer({ scheduler });
		const rootDir = freshRoot();

		const a = await Replica.boot({ id: "A", server, scheduler, clock, rootDir });
		const b = await Replica.boot({ id: "B", server, scheduler, clock, rootDir });
		// Settle both boots: sync/user/crdt joins land, CRDT routing activates.
		await scheduler.drain();

		const notePath = "hello.md";
		const content = "# Hello\n\nfrom A\n";
		await a.createNote(notePath, content);
		await scheduler.drain();

		// Disk: BOTH replicas hold the identical bytes A authored.
		const aDisk = fs.readFileSync(path.join(a.vaultDir, notePath), "utf8");
		const bDisk = fs.readFileSync(path.join(b.vaultDir, notePath), "utf8");
		expect(aDisk).toBe(content);
		expect(bDisk).toBe(content);

		// Server: the model backend holds the same content under one row.
		const srvNote = server.state().notes.get(notePath);
		expect(srvNote).toBeDefined();
		expect(srvNote?.content).toBe(content);

		// noteIdMaps: both replicas resolve the path to the SAME server id.
		const aId = a.noteIdMap.get(notePath);
		const bId = b.noteIdMap.get(notePath);
		expect(aId).toBeTruthy();
		expect(aId).toBe(srvNote?.id ?? null);
		expect(bId).toBe(aId);
	});
});
