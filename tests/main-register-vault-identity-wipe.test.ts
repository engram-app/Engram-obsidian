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
	// Prototype-backed: registerVault delegates the transition to the real
	// `discardVaultScopedState`, and a bare literal `this` would leave that
	// undefined — the throw lands in registerVault's own catch and the suite
	// goes green against a registration that wipes nothing.
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		// Falsy vaultId is what sends registerVault down the register-fresh leg.
		settings: { vaultId: null, clientId: "client-1", remoteVaultName: undefined },
		syncGateAcceptedFor: "stale-fingerprint",
		lastMapReconcileAt: 999,
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
	});
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
		// ...and the WHOLE transition, not just the map. This ran one of the
		// five steps on its own for months. The gate fingerprint covers (auth +
		// vault), so leaving it set makes the new vault inherit the old one's
		// consent instead of re-prompting.
		expect(fake.syncGateAcceptedFor).toBeNull();
		expect(fake.lastMapReconcileAt).toBe(0);
		expect((fake.api.setVaultId as any).mock.calls.at(-1)?.[0]).toBe("new-vault-id");
	});

	test("an empty map does NOT prove empty cursors — wipe anyway, just quietly", async () => {
		// This used to assert the opposite, on the reasoning that a fresh
		// install has nothing to wipe. The reasoning skipped a step: the map is
		// only one of the things `resetForVaultChange` clears. `onVaultDeleted`
		// empties the map WITHOUT touching lastSync or the catch-up cursor, so
		// registering after it hit this branch and inherited a watermark from a
		// different vault — the first catch-up then resumed from a seq that
		// means nothing here and skipped every note below it.
		//
		// On a genuine first install the wipe is a no-op, so gating it bought
		// nothing. What the guard is still good for is the LOG.
		const { fake, register } = makeFakePlugin({});

		expect(await register()).toBe(true);

		expect(fake.syncEngine.resetForVaultChange as any).toHaveBeenCalled();
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

/**
 * The persisted `noteIds` cache is per-VAULT identity, and its stamp is the
 * fix's actual root-cause half.
 *
 * An earlier revision of this block RE-IMPLEMENTED the load-time gate inside
 * the test file (`// Mirrors the load-time gate in main.ts`) and asserted
 * against its own copy. It imported nothing and executed no production code, so
 * all four of its tests passed unchanged with the real gate deleted AND with
 * the stamp deleted — the two mutations a reviewer ran to prove it. It carried
 * the label "#1409 root cause" while covering none of it.
 *
 * These drive the real methods.
 */
describe("noteIds cache is vault-scoped (#1409 root cause)", () => {
	const IDS = { "Notes/a.md": "id-from-old-vault" };

	/** Run the REAL load-time gate by calling loadSettings on a fake `this`. */
	function loadWith(data: Record<string, unknown>, activeVault: string | null) {
		const seeded: Array<Record<string, string> | undefined> = [];
		const fake = {
			settings: { vaultId: activeVault },
			noteIdMap: {
				seed: (ids: Record<string, string> | undefined) => seeded.push(ids),
				toJSON: () => ({}),
			},
			loadPluginData: mock().mockResolvedValue(data),
			writePluginData: mock().mockResolvedValue(undefined),
			app: { vault: { getName: () => "V" } },
		} as Record<string, unknown>;

		const load = (EngramSyncPlugin.prototype as any).loadSettings as (
			this: unknown,
		) => Promise<void>;
		return { fake, seeded, run: () => load.call(fake) };
	}

	test("REFUSES a cache whose recorded provenance is a different vault", async () => {
		const { seeded, run } = loadWith(
			{ noteIds: IDS, noteIdsVaultId: "old-vault", settings: { vaultId: "new-vault" } },
			"new-vault",
		);
		await run();
		expect(seeded).toEqual([]);
	});

	test("accepts a cache recorded under the SAME vault", async () => {
		const { seeded, run } = loadWith(
			{ noteIds: IDS, noteIdsVaultId: "same-vault", settings: { vaultId: "same-vault" } },
			"same-vault",
		);
		await run();
		expect(seeded).toEqual([IDS]);
	});

	test("adopts a pre-upgrade cache with no recorded vault (no needless re-mint)", async () => {
		const { seeded, run } = loadWith(
			{ noteIds: IDS, settings: { vaultId: "any-vault" } },
			"any-vault",
		);
		await run();
		expect(seeded).toEqual([IDS]);
	});
});

/**
 * The stamp that feeds the gate. It must record the map's PROVENANCE, not
 * whichever vault happened to be active when the file was written — reading it
 * from `settings.vaultId` at save time made the gate essentially unfireable,
 * because ~10 fire-and-forget saves would restamp a stale map with the new
 * vault before any reload.
 */
describe("noteIdsVaultId records provenance, not the active vault", () => {
	function saveWith(owner: string | null, activeVault: string | null) {
		let written: Record<string, unknown> | undefined;
		const fake = {
			settings: { vaultId: activeVault },
			noteIdsOwner: owner,
			noteIdMap: { toJSON: () => ({ "Notes/a.md": "id-1" }) },
			syncGateAcceptedFor: null,
			syncEngine: {
				exportSyncState: () => ({}),
				exportHashes: () => ({}),
				getCatchupSeq: () => 0,
				getCatchupId: () => null,
				getManifestSeq: () => 0,
				getSyncStateVaultId: () => null,
				queue: { persistable: () => [] },
				issues: { serialize: () => [] },
				ignoredFiles: { serialize: () => [] },
			},
			writePluginData: async (d: Record<string, unknown>) => {
				written = d;
			},
		} as Record<string, unknown>;

		const save = (EngramSyncPlugin.prototype as any).savePluginData as (
			this: unknown,
		) => Promise<void>;
		return {
			run: async () => {
				await save.call(fake);
				return written;
			},
		};
	}

	test("stamps the OWNER even when a different vault is already active", async () => {
		// THE regression. The map still holds vault-A ids; `settings.vaultId` has
		// already moved to B. Stamping B would make the gate accept A's map.
		const written = await saveWith("vault-A", "vault-B").run();
		expect(written?.noteIdsVaultId).toBe("vault-A");
	});

	test("stamps the active vault once the map has been re-owned", async () => {
		const written = await saveWith("vault-B", "vault-B").run();
		expect(written?.noteIdsVaultId).toBe("vault-B");
	});
});
