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

	test("a rejected post never throws", async () => {
		const post = mock(async () => {
			throw new Error("offline");
		});
		const { r } = make(post);
		expect(() => r.planned("smart-merge", plan)).not.toThrow();
		await Promise.resolve();
	});
});
