/**
 * Tests: dead-vault self-heal (healDeadVault). A 404 on a vault-scoped call
 * whose vault id is absent from the server's vault list must clear the id,
 * re-block sync, and reopen the picker — the old behavior kept the dead id
 * forever (the accepted-gate fingerprint still matched) and every sync 404'd.
 * Tested via Function.call on a minimal fake plugin `this` — the method only
 * touches the fields stubbed here.
 */
import { describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

function makeFakePlugin(over: Record<string, unknown> = {}) {
	const fake = {
		healingVault: false,
		settings: { vaultId: "dead-vault-id", remoteVaultName: "Dead" },
		syncGateAcceptedFor: "some-fingerprint",
		api: {
			listVaults: mock().mockResolvedValue([{ id: "other-vault" }]),
			setVaultId: mock(),
		},
		openPreviewModal: { close: mock() },
		syncEngine: { setSyncBlocked: mock(), getLastSync: mock().mockReturnValue("") },
		savePluginData: mock().mockResolvedValue(undefined),
		doSyncWithFirstSyncCheck: mock().mockResolvedValue(undefined),
		...over,
	};
	const heal = (EngramSyncPlugin.prototype as any).healDeadVault as (
		this: unknown,
		e: unknown,
	) => Promise<void>;
	return { fake, heal: (e: unknown) => heal.call(fake, e) };
}

const err404 = Object.assign(new Error("HTTP 404"), { status: 404 });

describe("healDeadVault", () => {
	test("vault absent from the server list → clears id, blocks sync, reopens picker", async () => {
		const { fake, heal } = makeFakePlugin();
		// Captured up front: the heal nulls the field after closing.
		const previewClose = (fake.openPreviewModal as { close: unknown }).close;

		await heal(err404);

		expect(fake.settings.vaultId).toBeNull();
		expect(fake.syncGateAcceptedFor).toBeNull();
		expect((fake.syncEngine.setSyncBlocked as any).mock.calls[0][0]).toBe(true);
		expect(fake.doSyncWithFirstSyncCheck as any).toHaveBeenCalledWith({
			startInVaultPicker: true,
		});
		// Finding 10: the API client must drop the dead vault id too, or every
		// non-sync request keeps stamping the dead X-Vault-ID and re-404s.
		expect((fake.api.setVaultId as any).mock.calls[0][0]).toBeNull();
		// Finding 9: a stale open preview must be closed before reopening the
		// picker — the guard makes the reopen a no-op while it is open.
		expect(previewClose as any).toHaveBeenCalled();
	});

	test("vault still exists server-side → 404 was about something else, no heal", async () => {
		const { fake, heal } = makeFakePlugin({
			api: { listVaults: mock().mockResolvedValue([{ id: "dead-vault-id" }]) },
		});

		await heal(err404);

		expect(fake.settings.vaultId).toBe("dead-vault-id");
		expect(fake.doSyncWithFirstSyncCheck as any).not.toHaveBeenCalled();
	});

	test("non-404 errors never trigger the vault-list check", async () => {
		const { fake, heal } = makeFakePlugin();

		await heal(Object.assign(new Error("boom"), { status: 500 }));

		expect(fake.api.listVaults as any).not.toHaveBeenCalled();
		expect(fake.settings.vaultId).toBe("dead-vault-id");
	});
});
