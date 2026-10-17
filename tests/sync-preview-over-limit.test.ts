/**
 * The first-sync over-limit step: shown when a sync would add more notes than
 * the plan has room left for, so a new user never ends up with a silently
 * half-synced vault.
 */
import { describe, expect, mock, test } from "bun:test";
import type { BillingUsage } from "../src/plan-usage";
import { simplifiedFirstSync } from "../src/sync-plan-format";
import {
	FolderOverLimitModal,
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
	const fresh = local.filter((p) => !onServer.has(p));
	return {
		localNotePaths: [...local],
		newNotePaths: fresh,
		vaultName: "V",
		serverNoteCount: server.length,
		serverAttachmentCount: 0,
		serverFolderCount: 0,
		localNoteCount: local.length,
		localAttachmentCount: 0,
		localFolderCount: 0,
		localPaths: [...local],
		serverPaths: [...server],
		toPush: { notes: [...fresh], attachments: ["img.png"] },
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

	test("null and negative limits are verifiably unlimited", () => {
		expect(notesQuotaFromUsage(usage(null))).toBe("unlimited");
		expect(notesQuotaFromUsage(usage(-1))).toBe("unlimited");
	});

	test("a missing or malformed notes entry is unknown, not unlimited", () => {
		expect(notesQuotaFromUsage({ tier: "free", usage: {} })).toBeNull();
		const malformed = { tier: "free", usage: { notes: { used: 1 } } } as any;
		expect(notesQuotaFromUsage(malformed)).toBeNull();
	});

	test("fetchNotesQuota keeps the three states apart", async () => {
		expect(await fetchNotesQuota(async () => usage(null))).toBe("unlimited");
		expect(await fetchNotesQuota(async () => ({ tier: "free", usage: {} }))).toBeNull();
	});

	test("a failed usage call is unknown (null) instead of throwing", async () => {
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
		if (u !== undefined) {
			const q = notesQuotaFromUsage(u);
			state.setNotesQuota(q === "unlimited" ? null : q);
		}
		return { state, onResolve };
	}

	test("shown when the notes added exceed the room left", () => {
		const { state, onResolve } = stateWith(usage(10, 6));
		state.pickOption("smart-merge");
		expect(state.view).toBe("over-limit");
		expect(state.overLimitAdded()).toBe(5);
		expect(state.notesQuota?.room).toBe(4);
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
		modal.state.setNotesQuota(quota);
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
		modal.state.setNotesQuota({ limit: 5, room: 0 });
		button(modal, "Done").listeners.click();
		expect(modal.state.view).not.toBe("over-limit");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});
});

function openOverLimit(opts: Record<string, unknown> = {}, quota = { limit: 10, room: 4 }) {
	const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), opts);
	modal.state.setNotesQuota(quota);
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
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
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
		const root = checkboxFor(modal.contentEl, "(top level) 1 note (1 new)");
		expect(root.disabled).toBe(true);
		expect(root.checked).toBe(true);
	});

	test("Continue hands over the unticked folders and proceeds", async () => {
		const applied: string[][] = [];
		const { modal, choice } = openOverLimit({
			applyExclusions: async (folders: string[]) => {
				applied.push(folders);
			},
		});
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
		archive.checked = false;
		archive.listeners.change();

		const cont = button(modal, "Continue");
		expect(cont.disabled).toBe(false);
		cont.listeners.click();
		// The handler fires the async save and returns; let it settle.
		await Bun.sleep(0);

		expect(applied).toEqual([["Archive"]]);
		expect(modal.getPlan().toPush.notes).toEqual(["Root.md", "Notes/d.md", "Notes/e.md"]);
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});

	test("Back cannot strand saved patterns with a stale plan", async () => {
		let release!: () => void;
		const { modal, choice } = openOverLimit({
			applyExclusions: () =>
				new Promise<void>((r) => {
					release = r;
				}),
		});
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
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

		release();
		await Bun.sleep(0);
		// The held plan, minus the excluded folder.
		const kept = ["Root.md", "Notes/d.md", "Notes/e.md"];
		expect(modal.getPlan().localNotePaths).toEqual(kept);
		expect(modal.getPlan().toPush.notes).toEqual(kept);
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

describe("over-limit step never ignores notes for a choice that deletes on the server", () => {
	// push-all-delete-remote treats every server note missing from the local
	// snapshot as an extra and deletes it, and snapshotLocalPaths omits ignored
	// paths. An unticked folder would delete its already-uploaded notes.
	test("push-all-delete-remote renders no folder picker and Continue writes no patterns", async () => {
		const applyExclusions = mock(async (_p: string[]) => {});
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), { applyExclusions });
		modal.state.setNotesQuota({ limit: 10, room: 4 });
		// Even a selection left over from elsewhere must not be written.
		modal.state.setOverLimitExcluded(["Archive"]);
		modal.state.pickOption("push-all-delete-remote");
		modal.render();

		expect(modal.state.view).toBe("over-limit");
		expect(nodes(modal.contentEl).some((n) => n.tag === "ul")).toBe(false);
		expect(
			modal.contentEl.__find(
				"Unticked folders stop syncing, including notes already uploaded.",
			),
		).toBeNull();

		const ack = checkboxFor(modal.contentEl, "I understand 2 notes will not sync.");
		ack.checked = true;
		ack.listeners.change();
		button(modal, "Continue").listeners.click();
		await Bun.sleep(0);

		expect(applyExclusions).not.toHaveBeenCalled();
		expect(modal.state.view).toBe("confirm");
	});
});

describe("over-limit picker shows total and new notes per folder", () => {
	test("rows read 'Folder N notes (M new)' and a note says unticking stops syncing uploaded notes", () => {
		// Archive: 3 new + 1 already on the server.
		const local = ["Root.md", ...PATHS, "Archive/old.md"];
		const { modal } = openModal(planWith(local, ["Archive/old.md"]));
		modal.state.setNotesQuota({ limit: 10, room: 4 });
		modal.state.pickOption("smart-merge");
		modal.render();

		expect(checkboxFor(modal.contentEl, "Archive 4 notes (3 new)")).toBeDefined();
		expect(checkboxFor(modal.contentEl, "Notes 2 notes (2 new)")).toBeDefined();
		expect(
			modal.contentEl.__find(
				"Unticked folders stop syncing, including notes already uploaded.",
			),
		).not.toBeNull();
		// Room math still counts new notes only: 6 new, room 4.
		expect(modal.state.overLimitOver()).toBe(2);
	});
});

describe("over-limit save failure leaves the step usable", () => {
	test("a rejected save shows the error and keeps the old plan", async () => {
		const { modal } = openOverLimit({
			applyExclusions: () => Promise.reject(new Error("plan failed")),
		});
		const before = modal.getPlan();
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
		archive.checked = false;
		archive.listeners.change();
		button(modal, "Continue").listeners.click();
		await Bun.sleep(0);

		expect(
			modal.contentEl.__find("Could not save your folder choice. Try again."),
		).not.toBeNull();
		expect(modal.getPlan()).toBe(before);
		expect(modal.state.view).toBe("over-limit");
		expect(button(modal, "Continue").disabled).toBe(false);
	});
});

describe("over-limit state resets when the plan is replaced", () => {
	test("a replaced plan asks again with no stale exclusions", () => {
		const state = new SyncPreviewState(planWith(PATHS), () => {});
		state.setNotesQuota({ limit: 4, room: 4 });
		state.pickOption("push-all-delete-remote");
		state.setOverLimitExcluded(["Archive"]);
		state.toggleOverLimitAck();
		state.finishOverLimit(null);
		expect(state.view).toBe("confirm");
		state.goBack();

		// A vault switch hands in a larger plan.
		state.replacePlan(planWith([...PATHS, "Notes/f.md", "Notes/g.md"]));
		state.pickOption("smart-merge");
		expect(state.view).toBe("over-limit");
		expect(state.overLimitExcluded).toEqual([]);
		expect(state.overLimitAck).toBe(false);
		expect(state.overLimitAdded()).toBe(7);
	});
});

describe("over-limit quota is re-fetched", () => {
	test("entering the step re-fetches usage and shows the fresh room", async () => {
		let room = 4;
		const fetchUsage = mock(async () => usage(10, 10 - room));
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		await Bun.sleep(0);
		expect(fetchUsage).toHaveBeenCalledTimes(1);

		// The user upgraded in the browser before picking.
		room = 5;
		// pick() is what every option button calls.
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);

		expect(fetchUsage.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(
			modal.contentEl.__find("This sync adds 6 notes. Your plan has room for 5."),
		).not.toBeNull();
	});
});

describe("over-limit numbers are grouped", () => {
	test("heading, checkbox and rows use locale-grouped numbers", () => {
		const many = Array.from({ length: 2500 }, (_, i) => `Archive/n${i}.md`);
		const { modal } = openModal(planWith(many));
		modal.state.setNotesQuota({ limit: 1000, room: 1000 });
		modal.state.pickOption("smart-merge");
		modal.render();

		expect(
			modal.contentEl.__find("This sync adds 2,500 notes. Your plan has room for 1,000."),
		).not.toBeNull();
		expect(modal.contentEl.__find("Your plan syncs 1,000 notes.")).not.toBeNull();
		expect(
			checkboxFor(modal.contentEl, "I understand 1,500 notes will not sync."),
		).toBeDefined();
		expect(checkboxFor(modal.contentEl, "Archive 2,500 notes (2,500 new)")).toBeDefined();
	});
});

describe("over-limit footer", () => {
	test("is a semantic footer element", () => {
		const { modal } = openOverLimit();
		const footers = nodes(modal.contentEl).filter((n) => n.tag === "footer");
		expect(footers.length).toBeGreaterThan(0);
	});
});

describe("every uploading option counts the plan's new notes", () => {
	// Root.md is on the server; Notes/f.md is local but server-tombstoned (or
	// known to the server by a recorded head while the snapshot lags), so
	// computeSyncPlan leaves it out of newNotePaths. No option may count it.
	function plan() {
		const p = planWith(["Root.md", ...PATHS, "Notes/f.md"], ["Root.md"]);
		p.newNotePaths = p.newNotePaths.filter((n) => n !== "Notes/f.md");
		p.toPush.notes = [...p.newNotePaths, "Root.md"]; // plus an edit to Root.md
		return p;
	}

	for (const choice of [
		"smart-merge",
		"push-all-keep-remote",
		"push-all-delete-remote",
	] as const) {
		test(`${choice} counts plan.newNotePaths`, () => {
			const state = new SyncPreviewState(plan(), () => {});
			state.setNotesQuota({ limit: 1, room: 1 });
			state.pickOption(choice);
			expect(state.overLimitAdded()).toBe(5);
		});
	}
});

describe("Back resets the over-limit answers", () => {
	test("an ack given for one option does not carry to another", () => {
		const state = new SyncPreviewState(planWith(PATHS), () => {});
		state.setNotesQuota({ limit: 4, room: 4 });
		state.pickOption("smart-merge");
		state.setOverLimitExcluded(["Notes"]);
		state.toggleOverLimitAck();
		state.goBack();

		state.pickOption("push-all-delete-remote");
		expect(state.view).toBe("over-limit");
		expect(state.overLimitAck).toBe(false);
		expect(state.overLimitExcluded).toEqual([]);
		expect(state.canContinueOverLimit()).toBe(false);
	});
});

describe("over-limit quota re-check", () => {
	test("an older slow response does not overwrite a newer one", async () => {
		const resolvers: ((u: BillingUsage) => void)[] = [];
		const fetchUsage = () => new Promise<BillingUsage>((r) => resolvers.push(r));
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		resolvers.shift()?.(usage(10, 6)); // the open-time lookup: room 4
		await Bun.sleep(0);
		(modal as any).pick("smart-merge"); // re-check #1 (slow)
		(modal as any).onWindowFocus(); // re-check #2
		const [older, newer] = resolvers;
		newer?.(usage(10, 5)); // room 5
		await Bun.sleep(0);
		older?.(usage(10, 7)); // room 3, stale
		await Bun.sleep(0);
		expect(modal.state.notesQuota).toEqual({ limit: 10, room: 5 });
	});

	test("a plan found unlimited on re-check drops the step; the next click proceeds", async () => {
		let limit: number | null = 10;
		const fetchUsage = async () => usage(limit, 6);
		const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		await Bun.sleep(0);
		limit = null; // upgraded in the browser
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);
		// The step had opened, so the re-check alone must not start the sync.
		expect(modal.state.view).toBe("preview");
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);
		expect(modal.state.view).toBe("done");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});
});

describe("an unknown quota on re-check keeps the step", () => {
	test("a malformed usage body neither proceeds nor drops the user's choices", async () => {
		let body: BillingUsage = usage(10, 6);
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), {
			fetchUsage: async () => body,
		});
		await Bun.sleep(0);
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);
		modal.state.setOverLimitExcluded(["Archive"]);
		modal.state.toggleOverLimitAck();

		body = { tier: "free", usage: {} };
		(modal as any).onWindowFocus();
		await Bun.sleep(0);

		expect(modal.state.view).toBe("over-limit");
		expect(modal.state.overLimitExcluded).toEqual(["Archive"]);
		expect(modal.state.overLimitAck).toBe(true);
		expect(modal.state.notesQuota).toEqual({ limit: 10, room: 4 });
	});
});

describe("over-limit save error survives a re-render", () => {
	test("a focus re-check keeps the error on screen", async () => {
		const ERR = "Could not save your folder choice. Try again.";
		const { modal } = openOverLimit({
			applyExclusions: () => Promise.reject(new Error("disk full")),
			fetchUsage: async () => usage(10, 6),
		});
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
		archive.checked = false;
		archive.listeners.change();
		button(modal, "Continue").listeners.click();
		await Bun.sleep(0);
		const shown = () => nodes(modal.contentEl).filter((n) => n.textContent === ERR).length;
		const before = shown();
		expect(before).toBeGreaterThan(0);

		(modal as any).onWindowFocus();
		await Bun.sleep(0);
		// The mock keeps old children, so the fresh render adds one more.
		expect(shown()).toBe(before + 1);
	});
});

describe("closing the modal while exclusions save", () => {
	test("aborts the pending save so nothing is committed", async () => {
		let signal: AbortSignal | undefined;
		const { modal, choice } = openOverLimit({
			applyExclusions: (_folders: string[], s: AbortSignal) => {
				signal = s;
				return new Promise<SyncPlan>(() => {});
			},
		});
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
		archive.checked = false;
		archive.listeners.change();
		button(modal, "Continue").listeners.click();
		await Bun.sleep(0);
		expect(signal?.aborted).toBe(false);

		modal.onClose(); // Esc / backdrop
		expect(signal?.aborted).toBe(true);
		expect(await choice).toBe("cancel");
	});
});

describe("an option picked before the quota answers waits for it", () => {
	function slowUsage() {
		let settle!: (u: Promise<BillingUsage>) => void;
		const first = new Promise<BillingUsage>((r) => {
			settle = (u) => u.then(r, () => r(Promise.reject(new Error("offline"))));
		});
		let calls = 0;
		const fetchUsage = () => (++calls === 1 ? first : Promise.resolve(usage(10, 6)));
		return { fetchUsage, settle };
	}

	test("an over-limit plan still gets the step", async () => {
		const { fetchUsage, settle } = slowUsage();
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		(modal as any).pick("smart-merge"); // before /billing/usage answers
		expect(modal.state.view).not.toBe("done");
		settle(Promise.resolve(usage(10, 6))); // room 4, 6 new
		await Bun.sleep(0);
		await Bun.sleep(0);
		expect(modal.state.view).toBe("over-limit");
	});

	test("a failed lookup still proceeds (unknown never blocks a sync)", async () => {
		const { fetchUsage, settle } = slowUsage();
		const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		(modal as any).pick("smart-merge");
		settle(Promise.reject(new Error("offline")));
		await Bun.sleep(0);
		await Bun.sleep(0);
		expect(modal.state.view).toBe("done");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});

	test("closing the modal while waiting picks nothing", async () => {
		const { fetchUsage, settle } = slowUsage();
		const { modal, choice } = openModal(planWith(["Root.md"]), { fetchUsage });
		(modal as any).pick("smart-merge");
		modal.onClose();
		settle(Promise.resolve(usage(10, 0)));
		await Bun.sleep(0);
		expect(await choice).toBe("cancel");
		expect(modal.state.view).not.toBe("done");
	});
});

describe("an unlimited quota found on focus waits for the user", () => {
	test("drops the step back to the options without starting a sync", async () => {
		let limit: number | null = 10;
		const fetchUsage = async () => usage(limit, 6);
		const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		await Bun.sleep(0);
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);
		expect(modal.state.view).toBe("over-limit");

		limit = null; // upgraded in the browser, then came back
		(modal as any).onWindowFocus();
		await Bun.sleep(0);
		expect(modal.state.view).toBe("preview");
		expect(modal.state.notesQuota).toBeNull();

		// The user's own click is what starts the sync, with no step now.
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);
		expect(modal.state.view).toBe("done");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});
});

describe("a slow re-check after the step opened never starts a sync", () => {
	test("unlimited arriving once the step is showing waits for the user", async () => {
		let release!: (u: BillingUsage) => void;
		let calls = 0;
		const fetchUsage = () =>
			++calls === 1
				? Promise.resolve(usage(10, 6))
				: new Promise<BillingUsage>((r) => {
						release = r;
					});
		const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		await Bun.sleep(0);
		(modal as any).pick("smart-merge"); // the step opens; its re-check is slow
		await Bun.sleep(0);
		expect(modal.state.view).toBe("over-limit");

		release(usage(null)); // upgraded meanwhile
		await Bun.sleep(0);
		expect(modal.state.view).not.toBe("done");

		(modal as any).pick("smart-merge"); // the user's own click
		await Bun.sleep(0);
		expect(modal.state.view).toBe("done");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});
});

describe("no exclusions hook fails closed", () => {
	test("unticked folders without a way to save them never upload everything", async () => {
		const { modal } = openOverLimit(); // no applyExclusions
		const archive = checkboxFor(modal.contentEl, "Archive 3 notes (3 new)");
		archive.checked = false;
		archive.listeners.change();
		button(modal, "Continue").listeners.click();
		await Bun.sleep(0);

		expect(modal.state.view).toBe("over-limit");
		expect(
			modal.contentEl.__find("Could not save your folder choice. Try again."),
		).not.toBeNull();
	});
});

describe("a click waiting on the quota shows it and is capped", () => {
	const never = () => new Promise<BillingUsage>(() => {});

	test("the clicked card shows a pending state", () => {
		const plan = planWith(["Root.md", ...PATHS]);
		const { modal } = openModal(plan, { fetchUsage: never });
		const action = simplifiedScreenCopy(simplifiedFirstSync(plan)!).action;
		const btn = button(modal, action);
		btn.listeners.click();
		expect(btn.disabled).toBe(true);
	});

	test("after the cap the pick proceeds as an unknown quota", async () => {
		const { modal, choice } = openModal(planWith(["Root.md"]), { fetchUsage: never });
		(modal as any).quotaWaitMs = 5;
		(modal as any).pick("smart-merge");
		await Bun.sleep(30);
		expect(modal.state.view).toBe("done");
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});
});

describe("FolderOverLimitModal (Sync again on a full plan)", () => {
	function open(count = 5, quota = { limit: 10, room: 2 }) {
		const modal: any = new FolderOverLimitModal({} as any, count, quota, null);
		const answer = modal.awaitAnswer() as Promise<boolean>;
		modal.onOpen();
		return { modal, answer };
	}

	test("reuses the step's copy; Continue waits for the acknowledgement", async () => {
		const { modal, answer } = open();
		expect(
			modal.contentEl.__find("This sync adds 5 notes. Your plan has room for 2."),
		).not.toBeNull();
		const cont = button(modal, "Continue");
		expect(cont.disabled).toBe(true);
		const ack = checkboxFor(modal.contentEl, "I understand 3 notes will not sync.");
		ack.checked = true;
		ack.listeners.change();
		expect(cont.disabled).toBe(false);
		cont.listeners.click();
		expect(await answer).toBe(true);
	});

	test("Back or closing declines", async () => {
		const { modal, answer } = open();
		button(modal, "Back").listeners.click();
		expect(await answer).toBe(false);
	});
});

describe("only a pick that can hit the limit waits for the quota", () => {
	const never = () => new Promise<BillingUsage>(() => {});

	test("nothing new to upload: no wait", async () => {
		const { modal } = openModal(planWith(PATHS, PATHS), { fetchUsage: never });
		(modal as any).pick("smart-merge");
		await Bun.sleep(0);
		expect(modal.state.view).toBe("done");
	});

	test("a download-only option: no wait", async () => {
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage: never });
		(modal as any).pick("pull-all-keep-local");
		await Bun.sleep(0);
		expect(modal.state.view).toBe("done");
	});
});

describe("the plan-size line is pluralized", () => {
	test("a 1-note plan reads 'note', not 'notes'", () => {
		const modal: any = new FolderOverLimitModal({} as any, 3, { limit: 1, room: 0 }, null);
		void modal.awaitAnswer();
		modal.onOpen();
		expect(modal.contentEl.__find("Your plan syncs 1 note.")).not.toBeNull();
	});
});

describe("a quota answer arriving after the cap", () => {
	function late() {
		let answer!: (u: BillingUsage) => void;
		const fetchUsage = () =>
			new Promise<BillingUsage>((r) => {
				answer = r;
			});
		return { fetchUsage, answer: (u: BillingUsage) => answer(u) };
	}

	test("over limit after the sync started: the caller is told, so it can say so", async () => {
		const { fetchUsage, answer } = late();
		const onLateOverLimit = mock((_q: unknown) => {});
		const { modal, choice } = openModal(planWith(["Root.md", ...PATHS]), {
			fetchUsage,
			onLateOverLimit,
		});
		(modal as any).quotaWaitMs = 5;
		(modal as any).pick("smart-merge");
		await Bun.sleep(20); // past the cap: proceeded as unknown
		expect(modal.state.view).toBe("done");
		answer(usage(10, 6)); // room 4, 6 new: over
		await Bun.sleep(0);
		expect(onLateOverLimit).toHaveBeenCalledWith({ limit: 10, room: 4 });
		modal.onClose();
		expect(await choice).toBe("smart-merge");
	});

	test("over limit while the delete confirm is still open: the step is shown", async () => {
		const { fetchUsage, answer } = late();
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), { fetchUsage });
		(modal as any).quotaWaitMs = 5;
		(modal as any).pick("push-all-delete-remote");
		await Bun.sleep(20);
		expect(modal.state.view).toBe("confirm");
		answer(usage(10, 6));
		await Bun.sleep(0);
		expect(modal.state.view).toBe("over-limit");
	});

	test("a late answer that fits changes nothing", async () => {
		const { fetchUsage, answer } = late();
		const onLateOverLimit = mock((_q: unknown) => {});
		const { modal } = openModal(planWith(["Root.md", ...PATHS]), {
			fetchUsage,
			onLateOverLimit,
		});
		(modal as any).quotaWaitMs = 5;
		(modal as any).pick("smart-merge");
		await Bun.sleep(20);
		answer(usage(100, 0));
		await Bun.sleep(0);
		expect(onLateOverLimit).not.toHaveBeenCalled();
	});
});
