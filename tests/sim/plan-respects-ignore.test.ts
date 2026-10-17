// tests/sim/plan-respects-ignore.test.ts
//
// Plan, then sync, against the real SyncEngine + model server, with an ignore
// pattern in play. The preview is a promise: every action it lists must happen
// and nothing it does not list may happen. Before the fix the plan counted
// server notes at ignored paths as pulls the sync then skipped, so the modal
// showed a deficit no sync could ever close.
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SyncProgress } from "../../src/types";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

afterAll(() => Replica.restoreGlobals());

function diskFiles(dir: string, rel = ""): string[] {
	const out: string[] = [];
	for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
		const p = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...diskFiles(dir, p));
		else out.push(p);
	}
	return out.sort();
}

test("every planned action runs and nothing unplanned happens, with an ignore pattern in play", async () => {
	const clock = new SimClock();
	const scheduler = new Scheduler(4242, clock);
	const server = new ModelServer({ scheduler });
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-ignore-"));
	try {
		// A seeds the server, including notes under the folder B ignores and one
		// that is then deleted (a tombstone at an ignored path).
		const a = await Replica.boot({ id: "A", server, scheduler, clock, rootDir });
		await scheduler.drain();
		await a.createNote("keep.md", "kept\n");
		await a.createNote("drafts/secret.md", "server draft\n");
		await a.createNote("archive/drafts/old.md", "nested draft\n");
		await a.createNote("drafts/gone.md", "about to go\n");
		await scheduler.drain();
		await a.deleteNote("drafts/gone.md");
		await scheduler.drain();

		// B's vault exists before it ever connects: one note to upload, and two
		// under the ignored folder (one sharing the tombstoned path).
		const bDir = path.join(rootDir, "B");
		fs.mkdirSync(path.join(bDir, "drafts"), { recursive: true });
		fs.writeFileSync(path.join(bDir, "local.md"), "local only\n");
		fs.writeFileSync(path.join(bDir, "drafts/gone.md"), "my local draft\n");
		fs.writeFileSync(path.join(bDir, "drafts/mine.md"), "another draft\n");

		const b = await Replica.boot({ id: "B", server, scheduler, clock, rootDir });
		// Nothing has been delivered yet (boot only enqueues the connect), so the
		// gate is shut before any catch-up can run — the first-sync shape.
		b.engine.setSyncBlocked(true);
		const settings = (b.engine as unknown as { settings: Record<string, unknown> }).settings;
		b.engine.updateSettings({ ...settings, ignorePatterns: "drafts/" } as never);
		await scheduler.drain();

		const planP = b.engine.computeSyncPlan("full");
		await scheduler.drain();
		const plan = await planP;

		expect(plan.toPull.notes).toEqual(["keep.md"]);
		expect(plan.toPush.notes).toEqual(["local.md"]);
		expect(plan.toDeleteLocal).toEqual([]);
		expect(plan.conflicts).toEqual([]);
		expect(plan.serverNoteCount).toBe(1);
		expect(plan.localNoteCount).toBe(1);
		// drafts/secret.md + archive/drafts/old.md (server), drafts/gone.md +
		// drafts/mine.md (local). The tombstone is not a file.
		expect(plan.ignoredCount).toBe(4);

		const before = diskFiles(bDir);
		const progress: SyncProgress[] = [];
		b.engine.onSyncProgress = (p) => progress.push({ ...p });
		b.engine.setSyncBlocked(false);
		const syncP = b.engine.fullSync();
		await scheduler.drain();
		const result = await syncP;
		await scheduler.drain();

		// Local side: exactly the planned pulls arrived, nothing was deleted, and
		// the ignored drafts are untouched.
		const after = diskFiles(bDir);
		expect(after.filter((p) => !before.includes(p))).toEqual(plan.toPull.notes);
		expect(before.filter((p) => !after.includes(p))).toEqual([]);
		expect(fs.readFileSync(path.join(bDir, "drafts/gone.md"), "utf8")).toBe("my local draft\n");
		expect(result).toEqual({ pulled: 1, pushed: 1 });
		const done = progress.filter((p) => p.phase === "complete").at(-1);
		expect(done?.current).toBe(plan.toPull.notes.length + plan.toPush.notes.length);

		// Server side: the planned push landed and the ignored notes are still
		// there (a sync must never delete what it cannot see).
		const serverP = (
			b.engine as unknown as {
				enumerateServerState: () => Promise<{ notes: Map<string, { deleted: boolean }> }>;
			}
		).enumerateServerState();
		await scheduler.drain();
		const live = [...(await serverP).notes]
			.filter(([, v]) => !v.deleted)
			.map(([k]) => k)
			.sort();
		expect(live).toEqual(["archive/drafts/old.md", "drafts/secret.md", "keep.md", "local.md"]);

		// And the plan now has nothing left to do.
		const againP = b.engine.computeSyncPlan("full");
		await scheduler.drain();
		const again = await againP;
		expect(again.toPull.notes).toEqual([]);
		expect(again.toPush.notes).toEqual([]);
		expect(again.localNoteCount).toBe(again.serverNoteCount);
	} finally {
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});
