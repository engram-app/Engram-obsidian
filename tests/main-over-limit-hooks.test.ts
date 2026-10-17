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
			exportReincludedFolders: () => [],
			holdReinclude: mock(() => () => {}),
			noteExcluded: mock(() => () => {}),
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
		expect(typeof opts.onLateOverLimit).toBe("function");
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

describe("a save landing during an excludedFolders change writes the new list", () => {
	// Any other save (a catch-up cursor persist, a token rotation) writes the
	// live settings. It must not put the old list back on disk. Replaces the
	// round-8 "saves a copy first" tests: see changeExcludedFolders for the
	// trade-off.
	function withConcurrentSave(fake: any) {
		const concurrent: string[][] = [];
		fake.savePluginData = mock(async function (this: any) {
			concurrent.push([...this.settings.excludedFolders]);
		});
		return concurrent;
	}

	test("applyExclusions", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		const written = withConcurrentSave(fake);
		await hooksOf(fake).applyExclusions(["Archive"]);
		expect(written).toEqual([["Old", "Archive"]]);
	});

	test("syncFolderAgain", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive", "Old"];
		fake.syncEngine.reincludeFolder = mock(async () => {});
		fake.syncEngine.fullSync = mock(async () => ({ pulled: 0, pushed: 0 }));
		const written = withConcurrentSave(fake);
		await fake.syncFolderAgain("Archive");
		expect(written).toEqual([["Old"]]);
	});
});

describe("the over-limit step and Sync again do not undo each other", () => {
	test("interleaved, both changes survive", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Old"];
		fake.syncEngine.reincludeFolder = mock(async () => {});
		fake.syncEngine.fullSync = mock(async () => ({ pulled: 0, pushed: 0 }));
		const releases: (() => void)[] = [];
		fake.savePluginData = mock(() => new Promise<void>((r) => releases.push(r)));

		const again = fake.syncFolderAgain("Old");
		const apply = hooksOf(fake).applyExclusions(["Archive"]);
		for (let i = 0; i < 20; i++) {
			await Bun.sleep(0);
			releases.shift()?.();
		}
		await Promise.all([again, apply]);

		expect(fake.settings.excludedFolders).toEqual(["Archive"]);
	});
});

describe("a failed rollback after Esc keeps the abort error", () => {
	test("the abort is what rejects; the rollback failure is only logged", async () => {
		const ctrl = new AbortController();
		const { fake } = makeFakePlugin(async () => PLAN);
		let calls = 0;
		fake.savePluginData = mock(async () => {
			calls += 1;
			if (calls === 1)
				ctrl.abort(); // Esc while writing the candidate list
			else throw new Error("disk full"); // the rollback write
		});
		const err = await hooksOf(fake)
			.applyExclusions(["Archive"], ctrl.signal)
			.catch((e: unknown) => e);
		expect((err as Error).name).toBe("AbortError");
		expect(fake.settings.excludedFolders).toEqual(["Old"]);
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

describe("Sync again checks the notes quota first", () => {
	function setup(usageBody: unknown, confirm: boolean) {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive"];
		fake.api.getBillingUsage = mock(async () => usageBody);
		fake.syncEngine.untrackedNotePaths = mock(() => ["Archive/a.md", "Archive/b.md"]);
		fake.syncEngine.reincludeFolder = mock(async () => {});
		fake.syncEngine.fullSync = mock(async () => ({ pulled: 0, pushed: 0 }));
		fake.confirmFolderOverLimit = mock(async () => confirm);
		return fake;
	}
	const room = (limit: number, used: number) => ({
		tier: "free",
		usage: { notes: { limit, used } },
	});

	test("a folder that does not fit asks first; declining changes nothing", async () => {
		const fake = setup(room(10, 9), false);
		await fake.syncFolderAgain("Archive");
		expect(fake.confirmFolderOverLimit).toHaveBeenCalledWith(2, { limit: 10, room: 1 });
		expect(fake.settings.excludedFolders).toEqual(["Archive"]);
		expect(fake.savePluginData).not.toHaveBeenCalled();
		expect(fake.syncEngine.fullSync).not.toHaveBeenCalled();
	});

	test("acknowledging the over-limit step re-includes and syncs", async () => {
		const fake = setup(room(10, 9), true);
		await fake.syncFolderAgain("Archive");
		expect(fake.settings.excludedFolders).toEqual([]);
		expect(fake.syncEngine.fullSync).toHaveBeenCalled();
	});

	test("a folder that fits asks nothing", async () => {
		const fake = setup(room(10, 0), false);
		await fake.syncFolderAgain("Archive");
		expect(fake.confirmFolderOverLimit).not.toHaveBeenCalled();
		expect(fake.settings.excludedFolders).toEqual([]);
	});

	test("an unknown quota proceeds as before", async () => {
		const fake = setup({ tier: "free", usage: {} }, false);
		await fake.syncFolderAgain("Archive");
		expect(fake.confirmFolderOverLimit).not.toHaveBeenCalled();
		expect(fake.settings.excludedFolders).toEqual([]);
	});

	test("a lookup that never answers proceeds after the cap, as unknown", async () => {
		const fake = setup(room(10, 9), false);
		fake.api.getBillingUsage = mock(() => new Promise(() => {}));
		fake.quotaWaitMs = 5;
		await fake.syncFolderAgain("Archive");
		expect(fake.confirmFolderOverLimit).not.toHaveBeenCalled();
		expect(fake.settings.excludedFolders).toEqual([]);
	});

	test("self-host makes no billing lookup", async () => {
		const fake = setup(room(10, 9), false);
		fake.settings.backendMode = "selfhost";
		await fake.syncFolderAgain("Archive");
		expect(fake.api.getBillingUsage).not.toHaveBeenCalled();
		expect(fake.settings.excludedFolders).toEqual([]);
	});
});

describe("Sync again on two folders at once", () => {
	test("interleaved re-includes leave both folders included", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive", "Old"];
		fake.syncEngine.reincludeFolder = mock(async () => {});
		fake.syncEngine.fullSync = mock(async () => ({ pulled: 0, pushed: 0 }));
		const saved: string[][] = [];
		const releases: (() => void)[] = [];
		fake.savePluginData = mock(function (this: any) {
			saved.push([...this.settings.excludedFolders]);
			return new Promise<void>((r) => releases.push(r));
		});

		const a = fake.syncFolderAgain("Archive");
		const b = fake.syncFolderAgain("Old");
		for (let i = 0; i < 10 && releases.length < 2; i++) {
			await Bun.sleep(0);
			releases.shift()?.();
		}
		releases.shift()?.();
		await Promise.all([a, b]);

		expect(fake.settings.excludedFolders).toEqual([]);
		expect(saved.at(-1)).toEqual([]);
	});
});

describe("Sync again tells the engine before saving", () => {
	test("held before the save, undone when the save fails", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive"];
		const order: string[] = [];
		const undo = mock(() => order.push("undo"));
		fake.syncEngine.holdReinclude = mock(() => {
			order.push("hold");
			return undo;
		});
		fake.savePluginData = mock(async () => {
			order.push("save");
			throw new Error("disk full");
		});
		await expect(fake.syncFolderAgain("Archive")).rejects.toThrow("disk full");
		expect(order).toEqual(["hold", "save", "undo"]);
	});
});

describe("the over-limit step records where each folder left the sync", () => {
	test("only newly excluded folders, before the save; undone if it fails", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		const order: string[] = [];
		fake.syncEngine.noteExcluded = mock((folders: string[]) => {
			order.push(`note:${folders.join(",")}`);
			return () => order.push("undo");
		});
		fake.savePluginData = mock(async () => {
			order.push("save");
			throw new Error("disk full");
		});
		await expect(hooksOf(fake).applyExclusions(["Old", "Archive"])).rejects.toThrow();
		expect(order).toEqual(["note:Archive", "save", "undo"]);
	});
});
