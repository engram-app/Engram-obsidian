import { describe, expect, mock, test } from "bun:test";
import { FirstSyncReporter } from "../src/first-sync-report";
import type { SyncPlan } from "../src/types";

const plan = {
	vaultName: "Secret Vault Name",
	localFolderCount: 4,
	serverFolderCount: 1,
	toPush: { notes: ["Divorce draft.md", "b.md"], attachments: ["img/x.png"] },
	toPull: { notes: ["c.md"], attachments: [] },
} as unknown as SyncPlan;

function make(post = mock(async (_p: unknown) => {}), now = { t: 1000 }) {
	return { post, now, r: new FirstSyncReporter(post, "desktop", () => now.t) };
}

describe("FirstSyncReporter", () => {
	test("planned sends counts and enums only, once", () => {
		const { post, r } = make();
		r.planned("smart-merge", plan);
		r.planned("smart-merge", plan);
		expect(post).toHaveBeenCalledTimes(1);
		const p = post.mock.calls[0][0] as Record<string, unknown>;
		expect(p).toEqual({
			phase: "planned",
			notes: 3,
			attachments: 1,
			folders: 4,
			choice: "merge",
			platform: "desktop",
		});
		expect(JSON.stringify(p)).not.toContain("Divorce");
		expect(JSON.stringify(p)).not.toContain("Secret");
	});

	test("maps choices to push/pull/merge", () => {
		for (const [c, e] of [
			["pull-all-keep-local", "pull"],
			["push-all-delete-remote", "push"],
		] as const) {
			const { post, r } = make();
			r.planned(c, plan);
			expect((post.mock.calls[0][0] as any).choice).toBe(e);
		}
	});

	test("finished sends totals and duration once", () => {
		const { post, now, r } = make();
		r.planned("smart-merge", plan);
		now.t = 6000;
		r.finished({ synced: 8, skipped: 1, failed: 2 });
		r.finished({ synced: 1, skipped: 0, failed: 0 });
		expect(post).toHaveBeenCalledTimes(2);
		expect(post.mock.calls[1][0]).toEqual({
			phase: "finished",
			total: 11,
			failed: 2,
			skipped: 1,
			duration_ms: 5000,
			platform: "desktop",
		});
	});

	test("dedupes a path present in both push and pull", () => {
		const { post, r } = make();
		r.planned("smart-merge", {
			...plan,
			toPush: { notes: ["a.md", "b.md"], attachments: ["x.png"] },
			toPull: { notes: ["b.md"], attachments: ["x.png"] },
		} as SyncPlan);
		const p = post.mock.calls[0][0] as any;
		expect([p.notes, p.attachments]).toEqual([2, 1]);
	});

	test("finish(aborted) reports real counts so far, never complete, once", () => {
		const { post, r } = make();
		r.planned("smart-merge", plan);
		r.observe({ phase: "pushing", current: 3000, total: 4000, failed: 0 });
		r.observe({ phase: "pulling", current: 5, total: 10, failed: 0, skipped: 2 });
		r.finish(true);
		r.finish(true);
		expect(post).toHaveBeenCalledTimes(2);
		const p = post.mock.calls[1][0] as any;
		expect([p.total, p.failed, p.skipped]).toEqual([3008, 1, 2]);
	});

	test("finish after a complete event does not double-report", () => {
		const { post, r } = make();
		r.finished({ synced: 1, skipped: 0, failed: 0 });
		r.finish(false);
		expect(post).toHaveBeenCalledTimes(1);
	});

	test("a rejected or throwing post never throws and is logged quietly", async () => {
		const rejecting = mock(async () => {
			throw new Error("offline");
		});
		const throwing = mock(() => {
			throw new Error("sync throw");
		});
		for (const post of [rejecting, throwing]) {
			const r = new FirstSyncReporter(post as any, "desktop");
			expect(() => r.planned("smart-merge", plan)).not.toThrow();
			await Promise.resolve();
			expect(post).toHaveBeenCalledTimes(1);
		}
	});
});
