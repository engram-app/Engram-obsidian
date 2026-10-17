/**
 * The first-sync over-limit step: shown when the vault holds more notes than
 * the plan's notes cap, so a new user never ends up with a silently
 * half-synced vault.
 */
import { describe, expect, mock, test } from "bun:test";
import type { BillingUsage } from "../src/plan-usage";
import {
	fetchNotesCap,
	notesCapFromUsage,
	SyncPreviewModal,
	SyncPreviewState,
} from "../src/sync-preview-modal";
import type { SyncChoice, SyncPlan } from "../src/types";

function planWith(notePaths: string[]): SyncPlan {
	return {
		vaultName: "V",
		serverNoteCount: 0,
		serverAttachmentCount: 0,
		serverFolderCount: 0,
		localNoteCount: notePaths.length,
		localAttachmentCount: 0,
		localFolderCount: 0,
		localPaths: [...notePaths],
		localNotePaths: [...notePaths],
		serverPaths: [],
		toPush: { notes: [...notePaths], attachments: [] },
		toPull: { notes: [], attachments: [] },
		conflicts: [],
		toDeleteLocal: [],
		toDeleteRemote: [],
	};
}

// 5 notes: 3 in Archive, 2 in Notes.
const PATHS = ["Archive/a.md", "Archive/b.md", "Archive/c.md", "Notes/d.md", "Notes/e.md"];

function usage(limit: number | null): BillingUsage {
	return { tier: "free", usage: { notes: { used: 0, limit } } };
}

describe("notesCapFromUsage / fetchNotesCap", () => {
	test("a positive limit is the cap", () => {
		expect(notesCapFromUsage(usage(3000))).toBe(3000);
	});

	test("null and negative limits are unlimited (no cap)", () => {
		expect(notesCapFromUsage(usage(null))).toBeNull();
		expect(notesCapFromUsage(usage(-1))).toBeNull();
	});

	test("a missing notes entry means no cap", () => {
		expect(notesCapFromUsage({ tier: "free", usage: {} })).toBeNull();
	});

	test("a failed usage call yields no cap instead of throwing", async () => {
		expect(await fetchNotesCap(() => Promise.reject(new Error("offline")))).toBeNull();
	});

	test("a successful usage call yields the cap", async () => {
		expect(await fetchNotesCap(() => Promise.resolve(usage(4)))).toBe(4);
	});
});

describe("SyncPreviewState over-limit step visibility", () => {
	function stateWith(cap: number | null | undefined) {
		const onResolve = mock((_c: SyncChoice) => {});
		const state = new SyncPreviewState(planWith(PATHS), onResolve);
		if (cap !== undefined) state.setNotesCap(cap);
		return { state, onResolve };
	}

	test("shown when the note count exceeds the cap", () => {
		const { state, onResolve } = stateWith(4);
		state.pickOption("smart-merge");
		expect(state.view).toBe("over-limit");
		expect(onResolve).not.toHaveBeenCalled();
	});

	test("not shown when the count equals the cap", () => {
		const { state, onResolve } = stateWith(5);
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});

	test("not shown when the cap is unlimited", () => {
		const { state, onResolve } = stateWith(null);
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});

	test("not shown when the usage call failed (cap never set)", () => {
		const { state, onResolve } = stateWith(undefined);
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});
});

describe("SyncPreviewState Continue matrix", () => {
	function overState(cap: number) {
		const state = new SyncPreviewState(planWith(PATHS), () => {});
		state.setNotesCap(cap);
		state.pickOption("smart-merge");
		return state;
	}

	test("under the limit after unticking: Continue enabled without the checkbox", () => {
		const state = overState(4);
		state.setOverLimitExcluded(["Archive"]);
		expect(state.overLimitOver()).toBe(0);
		expect(state.canContinueOverLimit()).toBe(true);
	});

	test("over the limit, checkbox unticked: Continue disabled", () => {
		const state = overState(4);
		expect(state.overLimitOver()).toBe(1);
		expect(state.canContinueOverLimit()).toBe(false);
	});

	test("over the limit, checkbox ticked: Continue enabled", () => {
		const state = overState(4);
		state.toggleOverLimitAck();
		expect(state.canContinueOverLimit()).toBe(true);
	});

	test("finishing the step proceeds with the chosen option, destructive ones still confirm", () => {
		const onResolve = mock((_c: SyncChoice) => {});
		const state = new SyncPreviewState(planWith(PATHS), onResolve);
		state.setNotesCap(4);
		state.pickOption("push-all-delete-remote");
		expect(state.view).toBe("over-limit");
		state.toggleOverLimitAck();
		state.finishOverLimit(null);
		expect(state.view).toBe("confirm");
		expect(state.pendingChoice).toBe("push-all-delete-remote");
		expect(onResolve).not.toHaveBeenCalled();
	});
});

/** Every rendered node, depth first. */
function nodes(root: any): any[] {
	return [root, ...root.children.flatMap((c: any) => nodes(c))];
}

function button(modal: any, text: string): any {
	return nodes(modal.contentEl).find((n) => n.tag === "button" && n.textContent === text);
}

/** The checkbox sharing a row with the element whose text is `text`. */
function checkboxFor(root: any, text: string): any {
	const row = nodes(root).find((n) => n.children.some((c: any) => c.textContent === text));
	return row?.children.find((c: any) => c.tag === "input");
}

function openOverLimit(opts: Record<string, unknown> = {}) {
	const modal: any = new SyncPreviewModal(
		{ vault: { getName: () => "V" } } as any,
		planWith(["Root.md", ...PATHS]),
		{ showChangeVault: false, context: "first-time", ...opts },
	);
	const choice = modal.awaitChoice() as Promise<SyncChoice>;
	modal.onOpen();
	modal.setNotesCap(4);
	modal.state.pickOption("smart-merge");
	modal.render();
	return { modal, choice };
}

describe("SyncPreviewModal over-limit view", () => {
	test("heading states the count and the plan cap", () => {
		const { modal } = openOverLimit();
		expect(modal.contentEl.__find("This vault has 6 notes. Your plan syncs 4.")).not.toBeNull();
	});

	test("Continue is disabled until the selection fits or the user acknowledges", () => {
		const { modal } = openOverLimit();
		const cont = button(modal, "Continue");
		expect(cont.disabled).toBe(true);

		const ack = checkboxFor(modal.contentEl, "I understand 2 notes will not sync.");
		ack.checked = true;
		ack.listeners.change();
		expect(cont.disabled).toBe(false);
	});

	test("Continue writes the unticked folders as ignore patterns and proceeds", async () => {
		const applied: string[][] = [];
		const { modal, choice } = openOverLimit({
			applyExclusions: async (patterns: string[]) => {
				applied.push(patterns);
				return planWith(["Root.md", "Notes/d.md", "Notes/e.md"]);
			},
		});
		const archive = checkboxFor(modal.contentEl, "Archive (3)");
		archive.checked = false;
		archive.listeners.change();

		const cont = button(modal, "Continue");
		expect(cont.disabled).toBe(false);
		cont.listeners.click();
		// The handler fires the async save and returns; let it settle.
		await Bun.sleep(0);

		expect(applied).toEqual([["Archive/"]]);
		expect(modal.getPlan().localNotePaths).toHaveLength(3);
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});

	test("Upgrade shows when an upgrade URL is offered", () => {
		const { modal } = openOverLimit({ upgradeUrl: "https://app.engram.page/settings/billing" });
		expect(button(modal, "Upgrade")).toBeDefined();
	});

	test("Upgrade is hidden when the server offers no upgrades (self-host)", () => {
		const { modal } = openOverLimit();
		expect(button(modal, "Upgrade")).toBeUndefined();
	});
});
