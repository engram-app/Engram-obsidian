import { describe, expect, test } from "bun:test";
import { LimitExceededError } from "../src/limit-error";
import { SyncPreviewState, describeCreateVaultError } from "../src/sync-preview-modal";
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
		expect(state.plan.vaultName).toBe("Switched");
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
