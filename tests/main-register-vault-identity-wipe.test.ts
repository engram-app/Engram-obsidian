/**
 * Tests: registerVault must not carry a PREVIOUS vault's path -> note_id map
 * into a vault it just registered (#1409 root cause).
 *
 * Two live paths null `settings.vaultId` without touching identity state — the
 * 404 dead-vault heal and `onVaultDeleted` — and neither runs
 * `resetForVaultChange`. registerVault then binds the install to a brand-new
 * server vault while the map still describes the old one, so `crdt_create`
 * proposes foreign-vault ids. The server cannot reuse them (the #1318 collision
 * class), answers with fresh ones, `serverId !== noteId` fails the seeded fast
 * path, and the fallback broadcasts a sync_update that opens a room PER NOTE.
 *
 * Measured on a real 423-item import before this fix: 225 rooms for 317 notes,
 * every one source=edit, ZERO crdt_update_log rows — all redundant, the
 * roomless genesis seed had already stored the state.
 *
 * Same Function.call-on-a-fake-`this` idiom as main-heal-dead-vault.test.ts.
 */
import { describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

function makeFakePlugin(noteIds: Record<string, string>, over: Record<string, unknown> = {}) {
	const fake = {
		// Falsy vaultId is what sends registerVault down the register-fresh leg.
		settings: { vaultId: null, clientId: "client-1", remoteVaultName: undefined },
		app: { vault: { getName: () => "My Vault" } },
		api: {
			registerVault: mock().mockResolvedValue({
				id: "new-vault-id",
				name: "My Vault",
				slug: "my-vault",
			}),
			setVaultId: mock(),
		},
		noteIdMap: { toJSON: () => noteIds },
		syncEngine: { resetForVaultChange: mock().mockResolvedValue(undefined) },
		saveSettings: mock().mockResolvedValue(undefined),
		...over,
	};
	const register = (EngramSyncPlugin.prototype as any).registerVault as (
		this: unknown,
	) => Promise<boolean>;
	return { fake, register: () => register.call(fake) };
}

describe("registerVault identity wipe (#1409)", () => {
	test("wipes per-vault identity state when a map from a PREVIOUS vault is still held", async () => {
		const { fake, register } = makeFakePlugin({
			"Notes/a.md": "id-from-old-vault",
			"Notes/b.md": "another-old-id",
		});

		expect(await register()).toBe(true);

		// THE assertion: the stale map must not survive into the new vault.
		expect(fake.syncEngine.resetForVaultChange as any).toHaveBeenCalled();
		expect(fake.settings.vaultId).toBe("new-vault-id");
	});

	test("first-ever install (empty map) is a silent no-op — no wipe", async () => {
		// The wipe also clears lastSync/cursors; doing that on a fresh install
		// would look like a bug and would re-scan for nothing.
		const { fake, register } = makeFakePlugin({});

		expect(await register()).toBe(true);

		expect(fake.syncEngine.resetForVaultChange as any).not.toHaveBeenCalled();
		expect(fake.settings.vaultId).toBe("new-vault-id");
	});

	test("already-bound vault short-circuits before any of this", async () => {
		const { fake, register } = makeFakePlugin(
			{ "Notes/a.md": "id-1" },
			{ settings: { vaultId: "existing-vault", clientId: "c", remoteVaultName: "X" } },
		);

		expect(await register()).toBe(true);

		// No registration, and emphatically no wipe of a map that is CORRECT
		// for the vault we are already on.
		expect(fake.api.registerVault as any).not.toHaveBeenCalled();
		expect(fake.syncEngine.resetForVaultChange as any).not.toHaveBeenCalled();
	});

	test("wipe happens BEFORE saveSettings, so a crash cannot persist the new vault beside the stale map", async () => {
		const order: string[] = [];
		const { register } = makeFakePlugin(
			{ "Notes/a.md": "id-from-old-vault" },
			{
				syncEngine: {
					resetForVaultChange: mock(async () => {
						order.push("wipe");
					}),
				},
				saveSettings: mock(async () => {
					order.push("save");
				}),
			},
		);

		await register();

		expect(order).toEqual(["wipe", "save"]);
	});
});
