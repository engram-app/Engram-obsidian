// tests/sim/oracle.test.ts
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { assertConverged, findWipes } from "./oracle";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

const tmpDirs: string[] = [];
function freshRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-sim-"));
	tmpDirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
// Restore the process-globals boot() patches so later files in a full `bun test`
// run don't inherit the frozen virtual clock / no-op setInterval.
afterAll(() => Replica.restoreGlobals());

async function bootPair(seed: number): Promise<{
	clock: SimClock;
	scheduler: Scheduler;
	server: ModelServer;
	a: Replica;
	b: Replica;
}> {
	const clock = new SimClock();
	const scheduler = new Scheduler(seed, clock);
	const server = new ModelServer({ scheduler });
	const rootDir = freshRoot();
	const a = await Replica.boot({ id: "A", server, scheduler, clock, rootDir });
	const b = await Replica.boot({ id: "B", server, scheduler, clock, rootDir });
	await scheduler.drain();
	return { clock, scheduler, server, a, b };
}

describe("assertConverged", () => {
	test("happy path: converged replicas throw nothing", async () => {
		const { scheduler, server, a, b } = await bootPair(3);
		await a.createNote("ok.md", "converged content\n");
		await scheduler.drain();

		await expect(assertConverged([a, b], server, scheduler)).resolves.toBeUndefined();
	});

	test("rigged divergence: throws a full per-replica table + seed + replay cmd", async () => {
		const { scheduler, server, a, b } = await bootPair(99);
		const notePath = "hello.md";
		await a.createNote(notePath, "original content\n");
		await scheduler.drain();

		// Rig a fake divergence: corrupt B's on-disk file directly, bypassing the
		// sync engine (no vault event fires, so the engine never learns and can't
		// self-heal it) — exactly the "replicas silently diverged" case the
		// oracle exists to catch.
		fs.writeFileSync(path.join(b.vaultDir, notePath), "CORRUPTED\n");

		let thrown: Error | null = null;
		try {
			await assertConverged([a, b], server, scheduler);
		} catch (e) {
			thrown = e as Error;
		}

		expect(thrown).not.toBeNull();
		const msg = thrown?.message ?? "";
		expect(msg).toContain(notePath);
		expect(msg).toContain("SERVER");
		expect(msg).toContain("A  disk=");
		expect(msg).toContain("B  disk=");
		expect(msg).toContain("CORRUPTED");
		expect(msg).toContain(`seed=${scheduler.seed}`);
		expect(msg).toContain("SIM_SEED=99");
		expect(msg).toContain("bun test");
	});

	test("rigged wipe: assertConverged fails via findWipes even if content otherwise converges", async () => {
		const { scheduler, server, a, b } = await bootPair(11);
		const notePath = "wipe.md";
		await a.createNote(notePath, "has content\n");
		await scheduler.drain();

		// Rig a wipe: an explicit editNote (vault.modify, journaled) writes the
		// file to empty — NOT via trashFile/delete — the #288 shape.
		await a.editNote(notePath, "");
		await scheduler.drain();

		let thrown: Error | null = null;
		try {
			await assertConverged([a, b], server, scheduler);
		} catch (e) {
			thrown = e as Error;
		}
		expect(thrown).not.toBeNull();
		expect(thrown?.message).toContain("#288 wipe detected");
		expect(thrown?.message).toContain(notePath);
		expect(thrown?.message).toContain(`seed=${scheduler.seed}`);
	});
});

describe("findWipes", () => {
	test("detects a non-empty -> empty write with no explicit delete", async () => {
		const { scheduler, a } = await bootPair(7);
		const notePath = "wipe2.md";
		await a.createNote(notePath, "has content\n");
		await scheduler.drain();

		expect(findWipes([a])).not.toContain(notePath);

		await a.editNote(notePath, "");
		await scheduler.drain();

		expect(findWipes([a])).toContain(notePath);
	});

	test("does not flag a normal create (0 -> non-empty) or a delete (file removed, not zeroed)", async () => {
		const { scheduler, a } = await bootPair(13);
		const notePath = "normal.md";
		await a.createNote(notePath, "fine\n");
		await scheduler.drain();
		expect(findWipes([a])).toEqual([]);

		await a.deleteNote(notePath);
		await scheduler.drain();
		expect(findWipes([a])).toEqual([]);
	});
});
