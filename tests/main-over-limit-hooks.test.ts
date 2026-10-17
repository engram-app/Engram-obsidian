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

describe("applyExclusions persists only after the plan recomputes", () => {
	test("a failed recompute leaves settings and engine patterns unchanged", async () => {
		const { fake, seenByEngine } = makeFakePlugin(() => Promise.reject(new Error("offline")));
		await expect(hooksOf(fake).applyExclusions(["Archive"])).rejects.toThrow("offline");

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		// The live engine never saw the candidate exclusions.
		expect(seenByEngine).toEqual([]);
		expect(fake.savePluginData).not.toHaveBeenCalled();
	});

	test("a failed save leaves settings and engine patterns unchanged", async () => {
		const { fake, seenByEngine } = makeFakePlugin(async () => PLAN);
		fake.savePluginData = mock(() => Promise.reject(new Error("disk full")));
		await expect(hooksOf(fake).applyExclusions(["Archive"])).rejects.toThrow("disk full");

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		// The live engine never saw the candidate exclusions.
		expect(seenByEngine).toEqual([]);
	});

	test("a successful recompute saves the merged patterns after the plan", async () => {
		const { fake, seenByEngine, order } = makeFakePlugin(async () => PLAN);
		expect(await hooksOf(fake).applyExclusions(["Archive"])).toBe(PLAN);

		expect(fake.settings.excludedFolders).toEqual(["Old", "Archive"]);
		expect(seenByEngine.at(-1)).toEqual(["Old", "Archive"]);
		// The user's own ignore text is never touched.
		expect(fake.settings.ignorePatterns).toBe("Templates/");
		expect(order).toEqual(["plan", "save", "engine"]);
	});

	test("the candidate plan is computed without touching the live engine", async () => {
		let engineDuringPlan: string[] | undefined;
		let planOpts: unknown;
		const { fake } = makeFakePlugin(async (opts) => {
			planOpts = opts;
			engineDuringPlan = [...fake.syncEngine.settings.excludedFolders];
			return PLAN;
		});
		fake.syncEngine.settings = fake.settings; // the engine shares the object
		await hooksOf(fake).applyExclusions(["Archive"]);

		expect(planOpts).toEqual({ excludedFolders: ["Old", "Archive"] });
		expect(engineDuringPlan).toEqual(["Old"]);
	});

	test("a modal closed during the recompute commits nothing", async () => {
		const ctrl = new AbortController();
		const { fake, seenByEngine } = makeFakePlugin(async () => {
			ctrl.abort(); // Esc while the plan is computing
			return PLAN;
		});
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
	test("drops the folder, saves, then re-syncs from genesis", async () => {
		const order: string[] = [];
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive", "Old"];
		fake.savePluginData = mock(async () => {
			order.push("save");
		});
		fake.syncEngine.requestFullReplay = mock(() => order.push("rewind"));
		fake.syncEngine.fullSync = mock(async () => {
			order.push("sync");
			return { pulled: 0, pushed: 0 };
		});
		fake.syncEngine.updateSettings = mock(() => order.push("engine"));

		await fake.syncFolderAgain("Archive");
		await Bun.sleep(0);

		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		expect(order).toEqual(["engine", "save", "rewind", "sync"]);
	});
});
