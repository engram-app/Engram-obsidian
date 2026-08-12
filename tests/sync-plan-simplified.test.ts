/**
 * Tests: simplifiedFirstSync — the decision for the one-click first-sync
 * screens. When one side is empty there is exactly one sane action (a
 * non-destructive merge that uploads/downloads everything), so the five-option
 * preview is ceremony; when BOTH sides have content the full preview stays.
 * The simplified modes may only ever map to smart-merge — a wrong "empty"
 * verdict then costs nothing (merge never deletes).
 */
import { describe, expect, test } from "bun:test";
import { simplifiedFirstSync } from "../src/sync-plan-format";
import type { SyncPlan } from "../src/types";

function plan(over: Partial<SyncPlan>): SyncPlan {
	return {
		vaultName: "Test",
		serverNoteCount: 0,
		serverAttachmentCount: 0,
		serverFolderCount: 0,
		localNoteCount: 0,
		localAttachmentCount: 0,
		localFolderCount: 0,
		localPaths: [],
		serverPaths: [],
		toPush: { notes: [], attachments: [] },
		toPull: { notes: [], attachments: [] },
		conflicts: [],
		toDeleteLocal: [],
		toDeleteRemote: [],
		...over,
	};
}

describe("simplifiedFirstSync", () => {
	test("remote empty + local content → upload mode with local counts", () => {
		expect(
			simplifiedFirstSync(plan({ localNoteCount: 316, localAttachmentCount: 106 })),
		).toEqual({ mode: "upload", notes: 316, attachments: 106 });
	});

	test("local empty + remote content → download mode with server counts", () => {
		expect(
			simplifiedFirstSync(plan({ serverNoteCount: 316, serverAttachmentCount: 106 })),
		).toEqual({ mode: "download", notes: 316, attachments: 106 });
	});

	test("both empty → fresh mode", () => {
		expect(simplifiedFirstSync(plan({}))).toEqual({ mode: "fresh" });
	});

	test("both sides have content → null (full five-option preview)", () => {
		expect(simplifiedFirstSync(plan({ localNoteCount: 3, serverNoteCount: 5 }))).toBeNull();
	});

	test("remote has only attachments → still counts as remote content", () => {
		expect(
			simplifiedFirstSync(plan({ localNoteCount: 3, serverAttachmentCount: 1 })),
		).toBeNull();
	});
});

describe("simplifiedFirstSync — dirty-plan guards (review findings)", () => {
	test("tombstoned server (toDeleteLocal pending) NEVER simplifies — the data-loss trap", () => {
		// serverNoteCount counts live rows only; a fully-tombstoned vault reads
		// "empty" while smart-merge would apply those tombstones and wipe local.
		expect(
			simplifiedFirstSync(
				plan({ localNoteCount: 316, toDeleteLocal: ["Notes/a.md", "Notes/b.md"] }),
			),
		).toBeNull();
	});

	test("conflicts present never simplify", () => {
		expect(
			simplifiedFirstSync(plan({ localNoteCount: 3, conflicts: ["Notes/c.md"] })),
		).toBeNull();
	});

	test("counter-direction pulls block upload mode", () => {
		expect(
			simplifiedFirstSync(
				plan({ localNoteCount: 3, toPull: { notes: ["Notes/ghost.md"], attachments: [] } }),
			),
		).toBeNull();
	});

	test("counter-direction pushes block download mode", () => {
		expect(
			simplifiedFirstSync(
				plan({
					serverNoteCount: 3,
					toPush: { notes: ["Notes/local.md"], attachments: [] },
				}),
			),
		).toBeNull();
	});
});

describe("simplifiedScreenCopy — onboarding copy (review findings)", () => {
	test("attachments-only vault never says '0 notes'", async () => {
		const { simplifiedScreenCopy } = await import("../src/sync-preview-modal");
		const c = simplifiedScreenCopy({ mode: "upload", notes: 0, attachments: 3 });
		expect(c.body).not.toContain("0 notes");
		expect(c.body).toContain("3 attachments");
	});

	test("no-deletion note is scoped to this device (verifiable), not absolute", async () => {
		const { simplifiedScreenCopy } = await import("../src/sync-preview-modal");
		const up = simplifiedScreenCopy({ mode: "upload", notes: 2, attachments: 0 });
		const down = simplifiedScreenCopy({ mode: "download", notes: 2, attachments: 0 });
		expect(up.note).toBe("Nothing will be removed from this device.");
		expect(down.note).toBe("Nothing will be removed from this device.");
	});
});
