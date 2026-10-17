/**
 * The first-sync over-limit step: shown when a sync would add more notes than
 * the plan has room left for, so a new user never ends up with a silently
 * half-synced vault.
 */
import { describe, expect, mock, test } from "bun:test";
import type { BillingUsage } from "../src/plan-usage";
import { simplifiedFirstSync } from "../src/sync-plan-format";
import {
	fetchNotesQuota,
	notesQuotaFromUsage,
	SyncPreviewModal,
	SyncPreviewState,
	simplifiedScreenCopy,
	uploadsNotes,
} from "../src/sync-preview-modal";
import type { SyncChoice, SyncPlan } from "../src/types";

/** `local` notes on this device, `server` on the server. toPush.notes is the
 *  local-only set, as computeSyncPlan builds it. */
function planWith(local: string[], server: string[] = []): SyncPlan {
	const onServer = new Set(server);
	return {
		vaultName: "V",
		serverNoteCount: server.length,
		serverAttachmentCount: 0,
		serverFolderCount: 0,
		localNoteCount: local.length,
		localAttachmentCount: 0,
		localFolderCount: 0,
		localPaths: [...local],
		serverPaths: [...server],
		toPush: { notes: local.filter((p) => !onServer.has(p)), attachments: ["img.png"] },
		toPull: { notes: [], attachments: [] },
		conflicts: [],
		toDeleteLocal: [],
		toDeleteRemote: [],
	};
}

// 5 notes: 3 in Archive, 2 in Notes.
const PATHS = ["Archive/a.md", "Archive/b.md", "Archive/c.md", "Notes/d.md", "Notes/e.md"];

function usage(limit: number | null, used = 0): BillingUsage {
	return { tier: "free", usage: { notes: { used, limit } } };
}

describe("notesQuotaFromUsage / fetchNotesQuota", () => {
	test("room is the limit minus what is already used", () => {
		expect(notesQuotaFromUsage(usage(3000, 1200))).toEqual({ limit: 3000, room: 1800 });
	});

	test("room floors at 0 when the account is already over", () => {
		expect(notesQuotaFromUsage(usage(100, 150))).toEqual({ limit: 100, room: 0 });
	});

	test("null and negative limits are unlimited (no quota)", () => {
		expect(notesQuotaFromUsage(usage(null))).toBeNull();
		expect(notesQuotaFromUsage(usage(-1))).toBeNull();
	});

	test("a missing notes entry means no quota", () => {
		expect(notesQuotaFromUsage({ tier: "free", usage: {} })).toBeNull();
	});

	test("a failed usage call yields no quota instead of throwing", async () => {
		expect(await fetchNotesQuota(() => Promise.reject(new Error("offline")))).toBeNull();
	});

	test("a successful usage call yields the quota", async () => {
		expect(await fetchNotesQuota(() => Promise.resolve(usage(4, 1)))).toEqual({
			limit: 4,
			room: 3,
		});
	});
});

describe("SyncPreviewState over-limit step visibility", () => {
	function stateWith(u: BillingUsage | undefined, plan = planWith(PATHS)) {
		const onResolve = mock((_c: SyncChoice) => {});
		const state = new SyncPreviewState(plan, onResolve);
		if (u !== undefined) state.setNotesQuota(notesQuotaFromUsage(u));
		return { state, onResolve };
	}

	test("shown when the notes added exceed the room left", () => {
		const { state, onResolve } = stateWith(usage(10, 6));
		state.pickOption("smart-merge");
		expect(state.view).toBe("over-limit");
		expect(state.overLimitAdded()).toBe(5);
		expect(state.overLimitRoom()).toBe(4);
		expect(onResolve).not.toHaveBeenCalled();
	});

	test("not shown when the notes added fit the room exactly", () => {
		const { state, onResolve } = stateWith(usage(10, 5));
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});

	test("counts only new notes, not notes already on the server or attachments", () => {
		// 5 local notes, 3 already on the server: the sync adds 2, room is 2.
		const plan = planWith(PATHS, ["Archive/a.md", "Archive/b.md", "Archive/c.md"]);
		// A locally edited note that already exists is an update, not a new note.
		plan.toPush.notes.push("Archive/a.md");
		const { state, onResolve } = stateWith(usage(5, 3), plan);
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});

	test("not shown when the plan is unlimited", () => {
		const { state, onResolve } = stateWith(usage(null));
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});

	test("not shown when the usage call failed (quota never set)", () => {
		const { state, onResolve } = stateWith(undefined);
		state.pickOption("smart-merge");
		expect(onResolve).toHaveBeenCalledWith("smart-merge");
	});

	const cases: [SyncChoice, boolean][] = [
		["smart-merge", true],
		["push-all-keep-remote", true],
		["push-all-delete-remote", true],
		["pull-all-keep-local", false],
		["pull-all-delete-local", false],
		["cancel", false],
		["change-vault", false],
	];
	for (const [choice, shows] of cases) {
		test(`${choice} ${shows ? "shows" : "skips"} the step`, () => {
			expect(uploadsNotes(choice)).toBe(shows);
			const { state } = stateWith(usage(1, 0));
			state.pickOption(choice);
			if (shows) expect(state.view).toBe("over-limit");
			else expect(state.view).not.toBe("over-limit");
		});
	}
});

describe("SyncPreviewState Continue matrix", () => {
	// room 4, adds 5
	function overState() {
		const state = new SyncPreviewState(planWith(PATHS), () => {});
		state.setNotesQuota({ limit: 4, room: 4 });
		state.pickOption("smart-merge");
		return state;
	}

	test("under the room after unticking: Continue enabled without the checkbox", () => {
		const state = overState();
		state.setOverLimitExcluded(["Archive"]);
		expect(state.overLimitOver()).toBe(0);
		expect(state.canContinueOverLimit()).toBe(true);
	});

	test("over the room, checkbox unticked: Continue disabled", () => {
		const state = overState();
		expect(state.overLimitOver()).toBe(1);
		expect(state.canContinueOverLimit()).toBe(false);
	});

	test("over the room, checkbox ticked: Continue enabled", () => {
		const state = overState();
		state.toggleOverLimitAck();
		expect(state.canContinueOverLimit()).toBe(true);
	});

	test("the acknowledgment resets when the shortfall changes", () => {
		const state = new SyncPreviewState(planWith(PATHS), () => {});
		state.setNotesQuota({ limit: 1, room: 1 });
		state.pickOption("smart-merge");
		state.setOverLimitExcluded(["Archive"]); // adds 2, over 1
		state.toggleOverLimitAck();
		expect(state.canContinueOverLimit()).toBe(true);

		state.setOverLimitExcluded([]); // tick Archive back: over 4
		expect(state.overLimitAck).toBe(false);
		expect(state.canContinueOverLimit()).toBe(false);
	});

	test("the acknowledgment survives a change that leaves the shortfall alone", () => {
		const state = overState();
		state.toggleOverLimitAck();
		state.setOverLimitExcluded([]);
		expect(state.overLimitAck).toBe(true);
	});

	test("finishing the step proceeds with the chosen option, destructive ones still confirm", () => {
		const onResolve = mock((_c: SyncChoice) => {});
		const state = new SyncPreviewState(planWith(PATHS), onResolve);
		state.setNotesQuota({ limit: 4, room: 4 });
		state.pickOption("push-all-delete-remote");
		expect(state.view).toBe("over-limit");
		state.toggleOverLimitAck();
		state.finishOverLimit(null);
		expect(state.view).toBe("confirm");
		expect(state.pendingChoice).toBe("push-all-delete-remote");
		expect(onResolve).not.toHaveBeenCalled();
	});

	test("while saving, Back and Continue are inert", () => {
		const state = overState();
		state.setOverLimitExcluded(["Archive"]);
		state.beginOverLimitSave();
		expect(state.canContinueOverLimit()).toBe(false);
		state.goBack();
		expect(state.view).toBe("over-limit");
	});
});

/** Every rendered node, depth first. */
function nodes(root: any): any[] {
	return [root, ...root.children.flatMap((c: any) => nodes(c))];
}

/** The mock's empty() keeps old children, so the live button is the LAST match. */
function button(modal: any, text: string): any {
	return nodes(modal.contentEl)
		.filter((n) => n.tag === "button" && n.textContent === text)
		.at(-1);
}

/** The checkbox sharing a row with the element whose text is `text`. */
function checkboxFor(root: any, text: string): any {
	const row = nodes(root)
		.filter((n) => n.children.some((c: any) => c.textContent === text))
		.at(-1);
	return row?.children.find((c: any) => c.tag === "input");
}

function openModal(plan: SyncPlan, opts: Record<string, unknown> = {}) {
	const modal: any = new SyncPreviewModal({ vault: { getName: () => "V" } } as any, plan, {
		showChangeVault: false,
		context: "first-time",
		...opts,
	});
	const choice = modal.awaitChoice() as Promise<SyncChoice>;
	modal.onOpen();
	return { modal, choice };
}

describe("SyncPreviewModal routes every option click through a re-render", () => {
	const HEADING = "This sync adds 6 notes. Your plan has room for 4.";

	function uploadScreen(quota: { limit: number; room: number }) {
		const plan = planWith(["Root.md", ...PATHS]);
		const { modal, choice } = openModal(plan);
		modal.setNotesQuota(quota);
		const action = simplifiedScreenCopy(simplifiedFirstSync(plan)!).action;
		return { modal, choice, action };
	}

	test("one-click screen: an over-limit plan renders the over-limit view", () => {
		const { modal, action } = uploadScreen({ limit: 4, room: 4 });
		button(modal, action).listeners.click();
		expect(modal.state.view).toBe("over-limit");
		expect(modal.contentEl.__find(HEADING)).not.toBeNull();
	});

	test("one-click screen: an under-limit plan resolves as before", async () => {
		const { modal, choice, action } = uploadScreen({ limit: 100, room: 100 });
		button(modal, action).listeners.click();
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});

	test("empty-plan footer: Done resolves smart-merge (nothing is added, so no step)", async () => {
		// Already in sync and the account is full: adding 0 notes never needs room.
		const plan = planWith(PATHS, PATHS);
		plan.toPush.attachments = [];
		const { modal, choice } = openModal(plan, { gateClosed: true, context: "review" });
		modal.setNotesQuota({ limit: 5, room: 0 });
		button(modal, "Done").listeners.click();
		expect(modal.state.view).not.toBe("over-limit");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});
});

function openOverLimit(opts: Record<string, unknown> = {}, quota = { limit: 10, room: 4 }) {
	const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), opts);
	modal.setNotesQuota(quota);
	modal.state.pickOption("smart-merge");
	modal.render();
	return { modal, choice };
}

describe("SyncPreviewModal over-limit view", () => {
	test("heading states the notes added and the room left, with the plan size", () => {
		const { modal } = openOverLimit();
		expect(
			modal.contentEl.__find("This sync adds 6 notes. Your plan has room for 4."),
		).not.toBeNull();
		expect(modal.contentEl.__find("Your plan syncs 10 notes.")).not.toBeNull();
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

	test("re-ticking a folder that grows the shortfall unticks the acknowledgment", () => {
		const { modal } = openOverLimit({}, { limit: 10, room: 1 }); // adds 6, over 5
		const archive = checkboxFor(modal.contentEl, "Archive (3)");
		archive.checked = false;
		archive.listeners.change(); // adds 3, over 2
		const ack = checkboxFor(modal.contentEl, "I understand 2 notes will not sync.");
		ack.checked = true;
		ack.listeners.change();
		const cont = button(modal, "Continue");
		expect(cont.disabled).toBe(false);

		archive.checked = true;
		archive.listeners.change(); // over 5
		expect(ack.checked).toBe(false);
		expect(cont.disabled).toBe(true);
	});

	test("the top-level row is locked on", () => {
		const { modal } = openOverLimit();
		const root = checkboxFor(modal.contentEl, "(top level) (1)");
		expect(root.disabled).toBe(true);
		expect(root.checked).toBe(true);
	});

	test("Continue writes the unticked folders as anchored ignore patterns and proceeds", async () => {
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

		expect(applied).toEqual([["/Archive/"]]);
		expect(modal.getPlan().toPush.notes).toHaveLength(3);
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});

	test("Back cannot strand saved patterns with a stale plan", async () => {
		let release!: (p: SyncPlan) => void;
		const fresh = planWith(["Root.md", "Notes/d.md", "Notes/e.md"]);
		const { modal, choice } = openOverLimit({
			applyExclusions: () =>
				new Promise<SyncPlan>((r) => {
					release = r;
				}),
		});
		const archive = checkboxFor(modal.contentEl, "Archive (3)");
		archive.checked = false;
		archive.listeners.change();
		const cont = button(modal, "Continue");
		const back = button(modal, "Back");
		cont.listeners.click();

		expect(back.disabled).toBe(true);
		expect(cont.disabled).toBe(true);
		back.listeners.click();
		cont.listeners.click(); // a re-click must not save twice
		expect(modal.state.view).toBe("over-limit");

		release(fresh);
		await Bun.sleep(0);
		expect(modal.getPlan()).toBe(fresh);
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
