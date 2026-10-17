/**
 * The over-limit step's hooks (quota lookup, Upgrade URL, folder exclusions)
 * come from ONE plugin factory, so every SyncPreviewModal entry point gets
 * them. The Sync Center used to build its own modal without any of them.
 */
import { describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

const PLAN = { vaultName: "V" };

function makeFakePlugin(computeSyncPlan: (opts?: unknown) => Promise<unknown>) {
	const seenByEngine: string[][] = [];
	const order: string[] = [];
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		app: {},
		settings: {
			ignorePatterns: "Templates/",
			excludedFolders: ["Old"],
			backendMode: "cloud",
			apiUrl: "https://api.engram.page",
		},
		api: { getBillingUsage: mock(async () => ({ tier: "free", usage: {} })) },
		syncEngine: {
			updateSettings: mock((s: { excludedFolders: string[] }) => {
				order.push("engine");
				seenByEngine.push([...s.excludedFolders]);
			}),
			computeSyncPlan: mock(async (_mode: string, opts?: unknown) => {
				order.push("plan");
				return computeSyncPlan(opts);
			}),
			getLastSync: () => "",
		},
		savePluginData: mock(async () => {
			order.push("save");
		}),
		settingTab: { rerender: mock() },
	});
	return { fake, seenByEngine, order };
}

function hooksOf(fake: any) {
	const modal = fake.newSyncPreviewModal({ showChangeVault: false, context: "review" });
	return modal.opts;
}

describe("newSyncPreviewModal supplies the over-limit hooks", () => {
	test("quota lookup, Upgrade URL and exclusions are all wired", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		const opts = hooksOf(fake);
		expect(opts.upgradeUrl).toContain("/settings/billing");
		expect(typeof opts.applyExclusions).toBe("function");
		await opts.fetchUsage();
		expect(fake.api.getBillingUsage).toHaveBeenCalled();
	});
});

describe("self-host makes no billing lookups", () => {
	test("no fetchUsage and no Upgrade URL when the server sells no plans", () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.backendMode = "selfhost";
		const opts = hooksOf(fake);
		expect(opts.fetchUsage).toBeUndefined();
		expect(opts.upgradeUrl).toBeNull();
	});
});

describe("applyExclusions persists the merged list", () => {
	test("a failed save leaves settings and engine patterns unchanged", async () => {
		const { fake, seenByEngine } = makeFakePlugin(async () => PLAN);
		fake.savePluginData = mock(() => Promise.reject(new Error("disk full")));
		await expect(hooksOf(fake).applyExclusions(["Archive"])).rejects.toThrow("disk full");

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		// The live engine never saw the candidate exclusions.
		expect(seenByEngine).toEqual([]);
	});

	test("a successful save stores the merged list, then tells the engine", async () => {
		const { fake, seenByEngine, order } = makeFakePlugin(async () => PLAN);
		await hooksOf(fake).applyExclusions(["Archive"]);

		expect(fake.settings.excludedFolders).toEqual(["Old", "Archive"]);
		expect(seenByEngine.at(-1)).toEqual(["Old", "Archive"]);
		// The user's own ignore text is never touched.
		expect(fake.settings.ignorePatterns).toBe("Templates/");
		expect(order).toEqual(["save", "engine"]);
	});

	test("a modal closed before the save commits nothing", async () => {
		const ctrl = new AbortController();
		ctrl.abort();
		const { fake, seenByEngine } = makeFakePlugin(async () => PLAN);
		await expect(hooksOf(fake).applyExclusions(["Archive"], ctrl.signal)).rejects.toThrow();

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		expect(fake.savePluginData).not.toHaveBeenCalled();
		expect(seenByEngine).toEqual([]);
	});

	test("a modal closed during the save rolls the exclusions back", async () => {
		const ctrl = new AbortController();
		const { fake, seenByEngine } = makeFakePlugin(async () => PLAN);
		const saved: string[][] = [];
		fake.savePluginData = mock(async function (this: any) {
			saved.push([...this.settings.excludedFolders]);
			if (saved.length === 1) ctrl.abort(); // Esc while writing
		});
		await expect(hooksOf(fake).applyExclusions(["Archive"], ctrl.signal)).rejects.toThrow();

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		expect(saved.at(-1)).toEqual(["Old"]);
		expect(seenByEngine).toEqual([]);
	});
});

describe("applyExclusions only persists", () => {
	test("never re-enumerates the server: the modal filters the plan it holds", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		await hooksOf(fake).applyExclusions(["Archive"]);
		expect(fake.syncEngine.computeSyncPlan).not.toHaveBeenCalled();
	});
});

describe("applyExclusions keeps token rotation", () => {
	function rotateDuringSave(fake: any, fail: () => void) {
		fake.settings.refreshToken = "rt-old";
		let calls = 0;
		fake.savePluginData = mock(async function (this: any) {
			if (++calls > 1) return; // the rollback's own save
			// OAuth rotation lands while the save is in flight.
			this.settings.refreshToken = "rt-rotated";
			fail();
		});
	}

	test("a failed save keeps a refresh token rotated during it", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		rotateDuringSave(fake, () => {
			throw new Error("disk full");
		});
		await expect(hooksOf(fake).applyExclusions(["Archive"])).rejects.toThrow("disk full");
		expect(fake.settings.refreshToken).toBe("rt-rotated");
		expect(fake.settings.excludedFolders).toEqual(["Old"]);
	});

	test("a modal closed during the save keeps a rotated refresh token", async () => {
		const ctrl = new AbortController();
		const { fake } = makeFakePlugin(async () => PLAN);
		rotateDuringSave(fake, () => ctrl.abort());
		await expect(hooksOf(fake).applyExclusions(["Archive"], ctrl.signal)).rejects.toThrow();
		expect(fake.settings.refreshToken).toBe("rt-rotated");
		expect(fake.settings.excludedFolders).toEqual(["Old"]);
	});

	test("settings are changed in place: holders of the object see the result", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		const held = fake.settings; // the API client and engine hold this object
		await hooksOf(fake).applyExclusions(["Archive"]);
		expect(fake.settings).toBe(held);
		expect(held.excludedFolders).toEqual(["Old", "Archive"]);
	});
});

describe("loadSettings defaults excludedFolders", () => {
	async function load(settings: Record<string, unknown>) {
		const fake: any = {
			settings: {},
			noteIdMap: { seed: () => {}, toJSON: () => ({}) },
			loadPluginData: mock(async () => ({ settings })),
			writePluginData: mock(async () => {}),
			app: { vault: { getName: () => "V" } },
		};
		await (EngramSyncPlugin.prototype as any).loadSettings.call(fake);
		return fake.settings;
	}

	test("older data without the field loads as []", async () => {
		expect((await load({ ignorePatterns: "x/" })).excludedFolders).toEqual([]);
	});

	test("saved folders load as saved", async () => {
		expect((await load({ excludedFolders: ["Archive"] })).excludedFolders).toEqual(["Archive"]);
	});
});

describe("syncFolderAgain", () => {
	test("drops the folder, saves, re-includes it in the engine, then syncs", async () => {
		const order: string[] = [];
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive", "Old"];
		fake.savePluginData = mock(async () => {
			order.push("save");
		});
		fake.syncEngine.reincludeFolder = mock(async (f: string) => order.push(`reinclude:${f}`));
		fake.syncEngine.fullSync = mock(async () => {
			order.push("sync");
			return { pulled: 0, pushed: 0 };
		});
		fake.syncEngine.updateSettings = mock(() => order.push("engine"));

		await fake.syncFolderAgain("Archive");
		await Bun.sleep(0);

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		expect(order).toEqual(["save", "engine", "reinclude:Archive", "sync"]);
	});

	test("a failed save changes nothing and touches no engine state", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive", "Old"];
		fake.settings.refreshToken = "rt-old";
		fake.savePluginData = mock(async function (this: any) {
			this.settings.refreshToken = "rt-rotated"; // rotation during the save
			throw new Error("disk full");
		});
		fake.syncEngine.reincludeFolder = mock(async () => {});
		fake.syncEngine.fullSync = mock(async () => ({ pulled: 0, pushed: 0 }));

		await expect(fake.syncFolderAgain("Archive")).rejects.toThrow("disk full");

		expect(fake.settings.excludedFolders).toEqual(["Archive", "Old"]);
		expect(fake.settings.refreshToken).toBe("rt-rotated");
		expect(fake.syncEngine.updateSettings).not.toHaveBeenCalled();
		expect(fake.syncEngine.reincludeFolder).not.toHaveBeenCalled();
		expect(fake.syncEngine.fullSync).not.toHaveBeenCalled();
	});
});
