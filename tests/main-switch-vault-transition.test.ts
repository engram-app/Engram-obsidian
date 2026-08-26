/**
 * Tests: `switchVault` — the vault-change entry point the sync-preview picker
 * uses — performs the WHOLE transition, by delegating it.
 *
 * There were two implementations of this transition and they agreed on one of
 * eight steps (#1409). The fix was not "add the missing seven to both": it was
 * to make `discardVaultScopedState` the single owner and have every entry point
 * call it. `switchVault` was the last one still spelling out its own copy, and
 * a duplicated list is exactly how the drift started.
 *
 * The existing coverage in self-hosted-tab.test.ts asserts `applyVaultSwitch`
 * CALLS `switchVault` — against a mocked `switchVault`. That is the right test
 * for that seam and says nothing about this one, which is why the body went
 * unpinned while it was wrong.
 */
import { describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

function makeFakePlugin(over: Record<string, unknown> = {}) {
	// Prototype-backed: `switchVault` delegates to the real
	// `discardVaultScopedState`, and a bare literal `this` leaves that undefined.
	return Object.assign(Object.create(EngramSyncPlugin.prototype), {
		settings: { vaultId: "old-vault", remoteVaultName: "Old" },
		syncGateAcceptedFor: "fingerprint-for-the-old-vault",
		lastMapReconcileAt: 12_345,
		api: { setVaultId: mock() },
		syncEngine: {
			updateSettings: mock(),
			resetForVaultChange: mock().mockResolvedValue(undefined),
			setSyncBlocked: mock(),
		},
		crdtWiring: { clearStrandHealAttempts: mock() },
		...over,
	});
}

describe("switchVault performs the whole vault transition", () => {
	test("every step runs, not just the id", async () => {
		const fake = makeFakePlugin();

		await (fake as { switchVault(id: string, name?: string): Promise<void> }).switchVault(
			"new-vault",
			"New",
		);

		expect(fake.settings.vaultId).toBe("new-vault");
		expect(fake.settings.remoteVaultName).toBe("New");
		// Per-file hashes, lastSync, cursors and the note-id map: note_ids are
		// unique only WITHIN a vault, so carrying the map over makes `crdt_create`
		// propose the old vault's ids (the #1318 collision class).
		expect(fake.syncEngine.resetForVaultChange).toHaveBeenCalled();
		// EngramApi keeps its OWN copy of the id and stamps it on every request.
		expect(fake.api.setVaultId).toHaveBeenCalledWith("new-vault");
		// The accepted-gate fingerprint covers (auth + vault) — a new vault must
		// re-prompt rather than inherit the old vault's consent.
		expect(fake.syncGateAcceptedFor).toBeNull();
		// Re-reconcile on next connect; this is a real swap, not a storm.
		expect(fake.lastMapReconcileAt).toBe(0);
		// Strand-heal retry counts are keyed by the PREVIOUS vault's note_ids.
		expect(fake.crdtWiring.clearStrandHealAttempts).toHaveBeenCalled();
		expect(fake.syncEngine.setSyncBlocked).toHaveBeenCalledWith(true);
	});

	test("an omitted name leaves the previous remote name alone", async () => {
		// The picker passes a name; the Connection-page dropdown does not. An
		// undefined name must not blank the stored one.
		const fake = makeFakePlugin();

		await (fake as { switchVault(id: string, name?: string): Promise<void> }).switchVault(
			"new-vault",
		);

		expect(fake.settings.remoteVaultName).toBe("Old");
		expect(fake.settings.vaultId).toBe("new-vault");
	});

	test("the sync gate is blocked AFTER the wipe, never before it", async () => {
		// Ordering matters: blocking first and wiping second leaves a window
		// where the gate is shut but the old vault's map is still live, and a
		// reconnect in that window re-proposes foreign ids.
		const order: string[] = [];
		const fake = makeFakePlugin({
			syncEngine: {
				updateSettings: mock(),
				resetForVaultChange: mock(async () => {
					order.push("wipe");
				}),
				setSyncBlocked: mock(() => {
					order.push("block");
				}),
			},
		});

		await (fake as { switchVault(id: string): Promise<void> }).switchVault("new-vault");

		expect(order).toEqual(["wipe", "block"]);
	});
});
