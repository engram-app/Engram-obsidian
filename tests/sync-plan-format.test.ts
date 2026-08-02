import { describe, expect, test } from "bun:test";
import {
	buildDeletionTree,
	computeMatchPercent,
	isDestructiveChoice,
	isPlanEmpty,
	optionBreakdown,
} from "../src/sync-plan-format";
import type { SyncPlan } from "../src/types";

function makePlan(overrides: Partial<SyncPlan> = {}): SyncPlan {
	return {
		vaultName: "Personal Notes",
		serverNoteCount: 198,
		serverAttachmentCount: 8,
		serverFolderCount: 12,
		localNoteCount: 234,
		localAttachmentCount: 12,
		localFolderCount: 15,
		localPaths: [],
		serverPaths: [],
		toPush: { notes: [], attachments: [] },
		toPull: { notes: [], attachments: [] },
		conflicts: [],
		toDeleteLocal: [],
		toDeleteRemote: [],
		...overrides,
	};
}

describe("isPlanEmpty", () => {
	test("empty plan is empty", () => {
		expect(isPlanEmpty(makePlan())).toBe(true);
	});
	test("plan with pushes is not empty", () => {
		expect(isPlanEmpty(makePlan({ toPush: { notes: ["a.md"], attachments: [] } }))).toBe(false);
	});
	test("plan with deletions is not empty", () => {
		expect(isPlanEmpty(makePlan({ toDeleteLocal: ["a.md"] }))).toBe(false);
	});
});

describe("computeMatchPercent", () => {
	test("returns 100 when local and remote are empty", () => {
		expect(computeMatchPercent(makePlan({ localNoteCount: 0, serverNoteCount: 0 }))).toBe(100);
	});
	test("returns 0 when nothing overlaps", () => {
		const plan = makePlan({
			localNoteCount: 5,
			serverNoteCount: 5,
			toPush: { notes: ["a.md", "b.md", "c.md", "d.md", "e.md"], attachments: [] },
			toPull: { notes: ["v.md", "w.md", "x.md", "y.md", "z.md"], attachments: [] },
		});
		expect(computeMatchPercent(plan)).toBe(0);
	});
	test("computes |intersection| / |union| over note paths", () => {
		// 3 local notes total, 2 remote-only (toPull), 1 local-only (toPush), 1 in
		// both (it's not in toPush or toPull → already in sync).
		// local: total 2 = {shared.md, only-local.md}
		// remote: total 3 = {shared.md, only-remote-a.md, only-remote-b.md}
		// intersection = 1, union = 4 → 25%
		const plan = makePlan({
			localNoteCount: 2,
			serverNoteCount: 3,
			toPush: { notes: ["only-local.md"], attachments: [] },
			toPull: { notes: ["only-remote-a.md", "only-remote-b.md"], attachments: [] },
		});
		expect(computeMatchPercent(plan)).toBe(25);
	});
});

describe("isDestructiveChoice", () => {
	test("pull-all-delete-local is destructive", () => {
		expect(isDestructiveChoice("pull-all-delete-local")).toBe(true);
	});
	test("push-all-delete-remote is destructive", () => {
		expect(isDestructiveChoice("push-all-delete-remote")).toBe(true);
	});
	test("smart-merge is not destructive", () => {
		expect(isDestructiveChoice("smart-merge")).toBe(false);
	});
	test("cancel is not destructive", () => {
		expect(isDestructiveChoice("cancel")).toBe(false);
	});
});

describe("optionBreakdown", () => {
	const plan = makePlan({
		localNoteCount: 5,
		localAttachmentCount: 2,
		serverNoteCount: 4,
		serverAttachmentCount: 3,
		toPush: { notes: ["a.md", "b.md"], attachments: ["pic.png"] },
		toPull: { notes: ["x.md"], attachments: ["img.png"] },
		conflicts: ["dup.md"],
		toDeleteLocal: ["gone-on-server.md"],
		toDeleteRemote: [],
	});

	test("smart-merge: counts include attachments alongside notes", () => {
		const b = optionBreakdown(plan, "smart-merge");
		expect(b.pullCount).toBe(2); // 1 note + 1 attachment
		expect(b.pushCount).toBe(3); // 2 notes + 1 attachment
		expect(b.conflictCount).toBe(1);
		expect(b.deleteLocalCount).toBe(0);
		expect(b.deleteRemoteCount).toBe(0);
	});

	test("pull-all-delete-local: pulls all remote files, deletes local-only files", () => {
		const b = optionBreakdown(plan, "pull-all-delete-local");
		expect(b.pullCount).toBe(7); // serverNoteCount + serverAttachmentCount
		expect(b.deleteLocalCount).toBe(3); // local-only notes + attachments
		expect(b.deleteRemoteCount).toBe(0);
		expect(b.pushCount).toBe(0);
	});

	test("pull-all-keep-local: pulls all remote files, no deletions", () => {
		const b = optionBreakdown(plan, "pull-all-keep-local");
		expect(b.pullCount).toBe(7);
		expect(b.deleteLocalCount).toBe(0);
		expect(b.deleteRemoteCount).toBe(0);
		expect(b.pushCount).toBe(0);
	});

	test("push-all-delete-remote: pushes all local files, deletes remote-only files", () => {
		const b = optionBreakdown(plan, "push-all-delete-remote");
		expect(b.pushCount).toBe(7); // localNoteCount + localAttachmentCount
		expect(b.deleteRemoteCount).toBe(2); // remote-only notes + attachments
		expect(b.deleteLocalCount).toBe(0);
		expect(b.pullCount).toBe(0);
	});

	test("push-all-keep-remote: pushes all local files, no deletions", () => {
		const b = optionBreakdown(plan, "push-all-keep-remote");
		expect(b.pushCount).toBe(7);
		expect(b.deleteRemoteCount).toBe(0);
		expect(b.deleteLocalCount).toBe(0);
		expect(b.pullCount).toBe(0);
	});

	test("change-vault: all-zero breakdown", () => {
		const b = optionBreakdown(plan, "change-vault");
		expect(b.pullCount).toBe(0);
		expect(b.pushCount).toBe(0);
		expect(b.conflictCount).toBe(0);
		expect(b.deleteLocalCount).toBe(0);
		expect(b.deleteRemoteCount).toBe(0);
	});
});

describe("buildDeletionTree", () => {
	test("empty input yields no rows", () => {
		expect(buildDeletionTree([])).toEqual([]);
	});

	test("single root file is a file row at depth 0", () => {
		expect(buildDeletionTree(["scratch.md"])).toEqual([
			{ kind: "file", depth: 0, label: "scratch.md" },
		]);
	});

	test("emits each parent folder once for siblings", () => {
		const rows = buildDeletionTree([
			"daily/2024-01-01.md",
			"daily/2024-01-02.md",
			"inbox/note.md",
		]);
		expect(rows).toEqual([
			{ kind: "folder", depth: 0, label: "daily/", deleted: false },
			{ kind: "file", depth: 1, label: "2024-01-01.md" },
			{ kind: "file", depth: 1, label: "2024-01-02.md" },
			{ kind: "folder", depth: 0, label: "inbox/", deleted: false },
			{ kind: "file", depth: 1, label: "note.md" },
		]);
	});

	test("nested folders indent by depth", () => {
		const rows = buildDeletionTree(["a/b/c/leaf.md", "a/b/sibling.md"]);
		expect(rows).toEqual([
			{ kind: "folder", depth: 0, label: "a/", deleted: false },
			{ kind: "folder", depth: 1, label: "b/", deleted: false },
			{ kind: "folder", depth: 2, label: "c/", deleted: false },
			{ kind: "file", depth: 3, label: "leaf.md" },
			{ kind: "file", depth: 2, label: "sibling.md" },
		]);
	});

	test("folder is marked deleted when no kept path lives inside it", () => {
		const rows = buildDeletionTree(
			["old/a.md", "old/b.md", "shared/c.md"],
			["shared/survivor.md", "shared/c.md"],
		);
		const old = rows.find((r) => r.kind === "folder" && r.label === "old/");
		const shared = rows.find((r) => r.kind === "folder" && r.label === "shared/");
		expect(old).toEqual({ kind: "folder", depth: 0, label: "old/", deleted: true });
		expect(shared).toEqual({
			kind: "folder",
			depth: 0,
			label: "shared/",
			deleted: false,
		});
	});

	test("parent of a partially-deleted child is not marked deleted", () => {
		const rows = buildDeletionTree(["projects/old/file.md"], ["projects/keep.md"]);
		const projects = rows.find((r) => r.kind === "folder" && r.label === "projects/");
		const old = rows.find((r) => r.kind === "folder" && r.label === "old/");
		expect(projects?.kind === "folder" && projects.deleted).toBe(false);
		expect(old?.kind === "folder" && old.deleted).toBe(true);
	});
});
