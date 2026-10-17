/**
 * The over-limit step's hooks (quota lookup, Upgrade URL, folder exclusions)
 * come from ONE plugin factory, so every SyncPreviewModal entry point gets
 * them. The Sync Center used to build its own modal without any of them.
 */
import { describe, expect, mock, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

const PLAN = { vaultName: "V" };

function makeFakePlugin(computeSyncPlan: () => Promise<unknown>) {
	const seenByEngine: string[] = [];
	const order: string[] = [];
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		app: {},
		settings: {
			ignorePatterns: "Templates/",
			backendMode: "cloud",
			apiUrl: "https://api.engram.page",
		},
		api: { getBillingUsage: mock(async () => ({ tier: "free", usage: {} })) },
		syncEngine: {
			updateSettings: mock((s: { ignorePatterns: string }) => {
				seenByEngine.push(s.ignorePatterns);
			}),
			computeSyncPlan: mock(async () => {
				order.push("plan");
				return computeSyncPlan();
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

describe("applyExclusions persists only after the plan recomputes", () => {
	test("a failed recompute leaves settings and engine patterns unchanged", async () => {
		const { fake, seenByEngine } = makeFakePlugin(() => Promise.reject(new Error("offline")));
		await expect(hooksOf(fake).applyExclusions(["/Archive/"])).rejects.toThrow("offline");

		expect(fake.settings.ignorePatterns).toBe("Templates/");
		expect(seenByEngine.at(-1)).toBe("Templates/");
		expect(fake.savePluginData).not.toHaveBeenCalled();
	});

	test("a failed save leaves settings and engine patterns unchanged", async () => {
		const { fake, seenByEngine } = makeFakePlugin(async () => PLAN);
		fake.savePluginData = mock(() => Promise.reject(new Error("disk full")));
		await expect(hooksOf(fake).applyExclusions(["/Archive/"])).rejects.toThrow("disk full");

		expect(fake.settings.ignorePatterns).toBe("Templates/");
		expect(seenByEngine.at(-1)).toBe("Templates/");
	});

	test("a successful recompute saves the merged patterns after the plan", async () => {
		const { fake, seenByEngine, order } = makeFakePlugin(async () => PLAN);
		expect(await hooksOf(fake).applyExclusions(["/Archive/"])).toBe(PLAN);

		expect(fake.settings.ignorePatterns).toBe("Templates/\n/Archive/");
		expect(seenByEngine.at(-1)).toBe("Templates/\n/Archive/");
		expect(order).toEqual(["plan", "save"]);
	});
});
