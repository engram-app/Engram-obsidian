import { describe, expect, test } from "bun:test";
import { LimitExceededError } from "../src/limit-error";
import type { OptionBreakdown } from "../src/sync-plan-format";
import {
	HEADER_BY_CONTEXT,
	SyncPreviewState,
	confirmActions,
	countSkippedAttachments,
	describeCreateVaultError,
	mergeHelperText,
	skippedAttachmentsLine,
} from "../src/sync-preview-modal";
import type { SyncChoice, SyncPlan } from "../src/types";

describe("SyncPreviewState — create-vault sub-view", () => {
	function picker() {
		const state = new SyncPreviewState(
			{
				vaultName: "T",
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
			},
			() => {},
		);
		state.enterVaultPicker();
		return state;
	}

	test("enterCreateVault toggles the create form on", () => {
		const state = picker();
		state.enterCreateVault();
		expect(state.creatingVault).toBe(true);
	});

	test("exitCreateVault returns to the vault list", () => {
		const state = picker();
		state.enterCreateVault();
		state.exitCreateVault();
		expect(state.creatingVault).toBe(false);
	});

	test("exitVaultPicker clears the create sub-view", () => {
		const state = picker();
		state.enterCreateVault();
		state.exitVaultPicker();
		expect(state.creatingVault).toBe(false);
	});
});

describe("countSkippedAttachments — plan-gated pre-flight count", () => {
	function planWith(attachments: string[]): SyncPlan {
		return {
			vaultName: "T",
			serverNoteCount: 0,
			serverAttachmentCount: 0,
			serverFolderCount: 0,
			localNoteCount: 0,
			localAttachmentCount: 0,
			localFolderCount: 0,
			localPaths: [],
			serverPaths: [],
			toPush: { notes: [], attachments },
			toPull: { notes: [], attachments: [] },
			conflicts: [],
			toDeleteLocal: [],
			toDeleteRemote: [],
		};
	}

	test("text-only plan counts only non-text attachments being pushed", () => {
		const plan = planWith(["a.png", "b.pdf", "notes.txt", "style.css", "doc.md"]);
		// .png + .pdf are non-text → 2; .txt/.css/.md pass the text gate
		expect(countSkippedAttachments(plan, true)).toBe(2);
	});

	test("paid plan (text-only false) skips nothing", () => {
		const plan = planWith(["a.png", "b.pdf"]);
		expect(countSkippedAttachments(plan, false)).toBe(0);
	});

	test("text-only plan with only text attachments counts zero", () => {
		const plan = planWith(["notes.txt", "style.css"]);
		expect(countSkippedAttachments(plan, true)).toBe(0);
	});

	test("extension matching is case-insensitive and handles nested paths", () => {
		const plan = planWith(["sub/dir/Photo.PNG", "x.JPEG"]);
		expect(countSkippedAttachments(plan, true)).toBe(2);
	});
});

describe("skippedAttachmentsLine — pre-flight copy", () => {
	test("free + non-text attachments: shows a skip note with the count", () => {
		const line = skippedAttachmentsLine(12);
		expect(line).not.toBeNull();
		expect(line).toContain("Free syncs notes only");
		expect(line).toContain("12");
	});

	test("zero attachments → no note", () => {
		expect(skippedAttachmentsLine(0)).toBeNull();
	});

	test("singular wording for exactly one attachment", () => {
		const line = skippedAttachmentsLine(1);
		expect(line).toContain("1 attachment will be skipped");
		expect(line).not.toContain("attachments");
	});

	test("plural wording for many attachments", () => {
		expect(skippedAttachmentsLine(3)).toContain("3 attachments will be skipped");
	});
});

describe("describeCreateVaultError", () => {
	test("LimitExceededError → reason-mapped vault limit message", () => {
		const err = new LimitExceededError(
			"vaults_cap_exceeded",
			"https://app.engram.page/settings/billing",
			"vaults_cap",
			1,
			1,
		);
		expect(describeCreateVaultError(err)).toMatch(/vault|upgrade/i);
	});
	test("422 → validation message", () => {
		expect(describeCreateVaultError({ status: 422 })).toMatch(/name|valid|use/i);
	});
	test("other → generic connection message", () => {
		expect(describeCreateVaultError(new Error("boom"))).toMatch(/could not|connection/i);
	});
});

function makePlan(overrides: Partial<SyncPlan> = {}): SyncPlan {
	return {
		vaultName: "Test Vault",
		serverNoteCount: 100,
		serverAttachmentCount: 0,
		serverFolderCount: 0,
		localNoteCount: 80,
		localAttachmentCount: 0,
		localFolderCount: 0,
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

function newState(plan = makePlan()): {
	state: SyncPreviewState;
	resolved: { value: SyncChoice | null };
} {
	const resolved = { value: null as SyncChoice | null };
	const state = new SyncPreviewState(plan, (choice) => {
		resolved.value = choice;
	});
	return { state, resolved };
}

describe("SyncPreviewState — non-destructive choices", () => {
	test("smart-merge resolves immediately", () => {
		const { state, resolved } = newState();
		state.pickOption("smart-merge");
		expect(resolved.value).toBe("smart-merge");
		expect(state.view).toBe("done");
	});

	test("pull-all-keep-local resolves immediately", () => {
		const { state, resolved } = newState();
		state.pickOption("pull-all-keep-local");
		expect(resolved.value).toBe("pull-all-keep-local");
	});

	test("push-all-keep-remote resolves immediately", () => {
		const { state, resolved } = newState();
		state.pickOption("push-all-keep-remote");
		expect(resolved.value).toBe("push-all-keep-remote");
	});

	test("cancel resolves with cancel", () => {
		const { state, resolved } = newState();
		state.cancel();
		expect(resolved.value).toBe("cancel");
	});

	test("enterVaultPicker switches view and primes loading state", () => {
		const { state, resolved } = newState();
		state.enterVaultPicker();
		expect(state.view).toBe("vault-picker");
		expect(state.vaultsLoading).toBe(true);
		expect(resolved.value).toBeNull();
	});

	test("exitVaultPicker returns to preview without resolving", () => {
		const { state, resolved } = newState();
		state.enterVaultPicker();
		state.exitVaultPicker();
		expect(state.view).toBe("preview");
		expect(state.vaultsLoading).toBe(false);
		expect(resolved.value).toBeNull();
	});

	test("onVaultsLoaded clears loading flag and stores list", () => {
		const { state } = newState();
		state.enterVaultPicker();
		state.onVaultsLoaded([
			{ id: "vault-7", name: "Alt", slug: "alt", is_default: false, created_at: "" },
		]);
		expect(state.vaultsLoading).toBe(false);
		expect(state.vaults?.length).toBe(1);
	});

	test("onVaultsError surfaces a message and clears loading", () => {
		const { state } = newState();
		state.enterVaultPicker();
		state.onVaultsError("nope");
		expect(state.vaultsLoading).toBe(false);
		expect(state.vaultsError).toBe("nope");
	});

	test("replacePlan swaps the plan reference", () => {
		const { state } = newState();
		const next = makePlan({ vaultName: "Switched" });
		state.replacePlan(next);
		expect(state.plan?.vaultName).toBe("Switched");
	});
});

describe("SyncPreviewState — advanced options accordion", () => {
	test("advancedOpen defaults to collapsed", () => {
		const { state } = newState();
		expect(state.advancedOpen).toBe(false);
	});

	test("toggleAdvanced flips the flag open then closed", () => {
		const { state } = newState();
		state.toggleAdvanced();
		expect(state.advancedOpen).toBe(true);
		state.toggleAdvanced();
		expect(state.advancedOpen).toBe(false);
	});

	test("toggleAdvanced is a no-op once resolved", () => {
		const { state } = newState();
		state.pickOption("smart-merge");
		state.toggleAdvanced();
		expect(state.advancedOpen).toBe(false);
	});
});

describe("SyncPreviewState — destructive choices route through confirm view", () => {
	test("pull-all-delete-local swaps to confirm view, does not resolve", () => {
		const { state, resolved } = newState();
		state.pickOption("pull-all-delete-local");
		expect(state.view).toBe("confirm");
		expect(state.pendingChoice).toBe("pull-all-delete-local");
		expect(resolved.value).toBeNull();
	});

	test("push-all-delete-remote swaps to confirm view", () => {
		const { state, resolved } = newState();
		state.pickOption("push-all-delete-remote");
		expect(state.view).toBe("confirm");
		expect(resolved.value).toBeNull();
	});

	test("confirm button disabled until input matches delete exactly", () => {
		const { state } = newState();
		state.pickOption("pull-all-delete-local");
		expect(state.canSubmitConfirm()).toBe(false);

		state.typeConfirm("DELETE");
		expect(state.canSubmitConfirm()).toBe(false); // case-sensitive

		state.typeConfirm("delete ");
		expect(state.canSubmitConfirm()).toBe(false); // trailing space rejected

		state.typeConfirm("delete");
		expect(state.canSubmitConfirm()).toBe(true);
	});

	test("submitConfirm resolves with the pending destructive choice", () => {
		const { state, resolved } = newState();
		state.pickOption("pull-all-delete-local");
		state.typeConfirm("delete");
		state.submitConfirm();
		expect(resolved.value).toBe("pull-all-delete-local");
	});

	test("submitConfirm is a no-op until canSubmitConfirm is true", () => {
		const { state, resolved } = newState();
		state.pickOption("push-all-delete-remote");
		state.typeConfirm("nope");
		state.submitConfirm();
		expect(resolved.value).toBeNull();
		expect(state.view).toBe("confirm");
	});

	test("goBack returns to preview view without resolving", () => {
		const { state, resolved } = newState();
		state.pickOption("pull-all-delete-local");
		state.typeConfirm("delete");
		state.goBack();
		expect(state.view).toBe("preview");
		expect(state.pendingChoice).toBeNull();
		expect(state.confirmInput).toBe("");
		expect(resolved.value).toBeNull();
	});
});

describe("SyncPreviewState — multiple resolutions ignored", () => {
	test("once resolved, subsequent calls are no-ops", () => {
		const { state, resolved } = newState();
		state.pickOption("smart-merge");
		state.pickOption("cancel");
		state.cancel();
		expect(resolved.value).toBe("smart-merge");
	});
});

describe("SyncPreviewState — deferred plan (instant open)", () => {
	test("accepts a null initial plan (modal opens before the plan resolves)", () => {
		const state = new SyncPreviewState(null, () => {});
		expect(state.plan).toBeNull();
		expect(state.planError).toBeNull();
	});

	test("replacePlan swaps in the plan and clears any planError", () => {
		const state = new SyncPreviewState(null, () => {});
		state.planError = "Could not load the sync plan";
		state.replacePlan(makePlan({ vaultName: "Loaded" }));
		expect(state.plan?.vaultName).toBe("Loaded");
		expect(state.planError).toBeNull();
	});
});

describe("confirmActions", () => {
	test("push-all-delete-remote: deletes the WHOLE server, then re-uploads all local", () => {
		const p = makePlan({
			serverNoteCount: 48,
			serverAttachmentCount: 2,
			localNoteCount: 188,
			localAttachmentCount: 2,
		});
		expect(confirmActions("push-all-delete-remote", p)).toEqual([
			"Delete all 50 files currently on the server",
			"Upload 190 files from this vault",
		]);
	});

	test("push-all-delete-remote with an empty server: only the upload line", () => {
		const p = makePlan({
			serverNoteCount: 0,
			serverAttachmentCount: 0,
			localNoteCount: 190,
			localAttachmentCount: 0,
		});
		expect(confirmActions("push-all-delete-remote", p)).toEqual([
			"Upload 190 files from this vault",
		]);
	});

	test("pull-all-delete-local: wipes the whole vault, then downloads all remote", () => {
		const p = makePlan({
			localNoteCount: 80,
			localAttachmentCount: 0,
			serverNoteCount: 20,
			serverAttachmentCount: 0,
		});
		expect(confirmActions("pull-all-delete-local", p)).toEqual([
			"Delete all 80 files in this vault",
			"Download 20 files from the server",
		]);
	});

	test("singular file wording", () => {
		const p = makePlan({
			serverNoteCount: 1,
			serverAttachmentCount: 0,
			localNoteCount: 1,
			localAttachmentCount: 0,
		});
		expect(confirmActions("push-all-delete-remote", p)).toEqual([
			"Delete all 1 file currently on the server",
			"Upload 1 file from this vault",
		]);
	});
});

describe("mergeHelperText", () => {
	const b = (over: Partial<OptionBreakdown> = {}): OptionBreakdown => ({
		pullCount: 0,
		pushCount: 0,
		conflictCount: 0,
		deleteLocalCount: 0,
		deleteRemoteCount: 0,
		samplePaths: [],
		...over,
	});

	test("states upload and download counts for a review sync", () => {
		expect(mergeHelperText(b({ pushCount: 12, pullCount: 3 }), "review")).toBe(
			"Uploads 12, downloads 3. Nothing is deleted.",
		);
	});

	test("appends conflicts when present", () => {
		expect(mergeHelperText(b({ pushCount: 1, pullCount: 0, conflictCount: 2 }), "review")).toBe(
			"Uploads 1. 2 conflicts to resolve. Nothing is deleted.",
		);
	});

	test("leads with reassurance on first-time", () => {
		expect(mergeHelperText(b({ pushCount: 5 }), "first-time")).toBe(
			"Safe choice: combines both sides, nothing is deleted. Uploads 5.",
		);
	});

	test("leads with reassurance on vault-switch", () => {
		expect(mergeHelperText(b(), "vault-switch")).toBe(
			"Safe choice: combines both sides, nothing is deleted.",
		);
	});
});

describe("HEADER_BY_CONTEXT", () => {
	test("uses clearer vault-switch header copy", () => {
		expect(HEADER_BY_CONTEXT["vault-switch"]).toBe(
			"You are now pointing at a different cloud vault",
		);
	});
});
