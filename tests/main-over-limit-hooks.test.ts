/**
 * The over-limit step's hooks (quota lookup, Upgrade URL, folder exclusions)
 * come from ONE plugin factory, so every SyncPreviewModal entry point gets
 * them. The Sync Center used to build its own modal without any of them.
 */
import { describe, expect, mock, test } from "bun:test";
import { __noticeCapture } from "obsidian";
import EngramSyncPlugin from "../src/main";
import { createSingleFlight } from "../src/single-flight";

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

const FOLDER_PLAN = {
	folder: "Archive",
	actions: [
		{ kind: "upload", path: "Archive/a.md", localHash: 1, creates: true },
		{ kind: "deleteOnServer", path: "Archive/gone.md", localHash: null, creates: false },
	],
};

/** Sync again with a scripted confirm answering `ok`. */
function againSetup(ok: boolean, excluded = ["Archive", "Old"]) {
	const { fake } = makeFakePlugin(async () => PLAN);
	fake.settings.excludedFolders = [...excluded];
	fake.settings.backendMode = "selfhost"; // no quota lookup unless a test asks
	const written: string[][] = [];
	fake.writePluginData = mock(async (d: any) => {
		written.push([...d.settings.excludedFolders]);
	});
	fake.savePluginData = (EngramSyncPlugin.prototype as any).savePluginData;
	Object.assign(fake.syncEngine, {
		getCatchupSeq: () => 0,
		getCatchupId: () => null,
		getManifestSeq: () => 0,
		queue: { persistable: () => [] },
		exportSyncState: () => ({}),
		getSyncStateVaultId: () => null,
		exportHashes: () => ({}),
		issues: { serialize: () => [] },
		ignoredFiles: { serialize: () => [] },
		exportGateJournal: () => [],
		planFolder: mock(async () => FOLDER_PLAN),
		applyFolderPlan: mock(async () => ({ failed: 0, skipped: 0 })),
	});
	fake.noteIdMap = { toJSON: () => ({}) };
	fake.syncPreviewGuard = createSingleFlight();
	fake.confirmSyncAgain = mock(async () => ok);
	return { fake, written };
}

describe("Sync again: plan, confirm, carry out exactly that plan", () => {
	test("the confirm shows the plan's counts", async () => {
		const { fake } = againSetup(false);
		await fake.syncFolderAgain("Archive");
		expect(fake.confirmSyncAgain).toHaveBeenCalledWith(
			"Archive",
			{ upload: 1, download: 0, deleteOnServer: 1, conflicts: 0, newNotes: 1 },
			null,
		);
	});

	test("(e) Cancel changes nothing", async () => {
		const { fake, written } = againSetup(false);
		await fake.syncFolderAgain("Archive");
		expect(fake.settings.excludedFolders).toEqual(["Archive", "Old"]);
		expect(written).toEqual([]);
		expect(fake.syncEngine.applyFolderPlan).not.toHaveBeenCalled();
	});

	test("Continue carries out the very plan that was shown, with no extra sync", async () => {
		const { fake, written } = againSetup(true);
		fake.syncEngine.fullSync = mock(async () => ({ pulled: 0, pushed: 0 }));
		await fake.syncFolderAgain("Archive");
		expect(fake.syncEngine.applyFolderPlan).toHaveBeenCalledWith(FOLDER_PLAN);
		expect(fake.syncEngine.planFolder).toHaveBeenCalledTimes(1);
		expect(fake.syncEngine.fullSync).not.toHaveBeenCalled();
		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		expect(written.at(-1)).toEqual(["Old"]);
	});

	test("it cannot open while another sync preview is open", async () => {
		const { fake } = againSetup(true);
		let release!: () => void;
		const other = fake.syncPreviewGuard(() => new Promise<void>((r) => (release = r)));
		await fake.syncFolderAgain("Archive");
		expect(fake.syncEngine.planFolder).not.toHaveBeenCalled();
		release();
		await other;
	});

	test("on a full plan the confirm gets the quota (the over-limit step)", async () => {
		const { fake } = againSetup(false);
		fake.settings.backendMode = "cloud";
		fake.api.getBillingUsage = mock(async () => ({
			tier: "free",
			usage: { notes: { limit: 10, used: 10 } },
		}));
		await fake.syncFolderAgain("Archive");
		expect(fake.confirmSyncAgain.mock.calls[0][2]).toEqual({ limit: 10, room: 0, used: 10 });
	});

	test("(f) a restart mid-apply finds the folder still excluded on disk", async () => {
		const { fake, written } = againSetup(true);
		let finish!: () => void;
		fake.syncEngine.applyFolderPlan = mock(async () => {
			await fake.persistEngineState(); // any save during the apply
			await new Promise<void>((r) => (finish = r));
			return { failed: 0, skipped: 0 };
		});
		const run = fake.syncFolderAgain("Archive");
		for (let i = 0; i < 5; i++) await Bun.sleep(0);
		expect(written.at(-1)).toContain("Archive");
		finish();
		await run;
		expect(written.at(-1)).toEqual(["Old"]);
	});

	test("a failed apply puts the exclusion back", async () => {
		const { fake } = againSetup(true);
		fake.syncEngine.applyFolderPlan = mock(async () => ({ failed: 2, skipped: 0 }));
		await expect(fake.syncFolderAgain("Archive")).rejects.toThrow();
		expect(fake.settings.excludedFolders).toContain("Archive");
	});

	test("notes refused by the plan limit are the outcome the user accepted: no rollback", async () => {
		const { fake } = againSetup(true);
		__noticeCapture.notices.length = 0;
		fake.syncEngine.applyFolderPlan = mock(async () => ({ failed: 0, skipped: 0, capped: 2 }));
		await fake.syncFolderAgain("Archive");
		expect(fake.settings.excludedFolders).toEqual(["Old"]);
		expect(__noticeCapture.notices.map((n) => n.message)).toEqual([
			"2 notes did not sync (plan limit).",
		]);
	});

	test("a real failure says how many files did not sync", async () => {
		const { fake } = againSetup(true);
		fake.syncEngine.applyFolderPlan = mock(async () => ({ failed: 2, skipped: 0, capped: 0 }));
		await expect(fake.syncFolderAgain("Archive")).rejects.toThrow("2 files could not sync.");
	});

	test("a failed apply does not put the folder into a vault switched to meanwhile", async () => {
		const { fake } = againSetup(true);
		fake.settings.vaultId = "v1";
		fake.syncEngine.applyFolderPlan = mock(async () => {
			fake.settings.vaultId = "v2";
			fake.settings.excludedFolders = [];
			return { failed: 1, skipped: 0 };
		});
		await expect(fake.syncFolderAgain("Archive")).rejects.toThrow();
		expect(fake.settings.excludedFolders).toEqual([]);
	});

	test("the excludedFolders queue is not held while the confirm waits", async () => {
		const { fake } = againSetup(true);
		let answer!: (ok: boolean) => void;
		fake.confirmSyncAgain = mock(() => new Promise<boolean>((r) => (answer = r)));
		const again = fake.syncFolderAgain("Archive");
		await Bun.sleep(0);
		await fake.applyOverLimitExclusions(["Projects"]);
		expect(fake.settings.excludedFolders).toContain("Projects");
		answer(true);
		await again;
		expect(fake.settings.excludedFolders).toEqual(["Old", "Projects"]);
	});
});

describe("a rollback never brings back a renamed or cleared list", () => {
	test("a rename during a failing save survives the rollback", async () => {
		const { fake } = makeFakePlugin(async () => PLAN);
		fake.settings.excludedFolders = ["Archive"];
		fake.app = { vault: { getAbstractFileByPath: () => null } };
		let calls = 0;
		fake.savePluginData = mock(async function (this: any) {
			if (++calls > 1) return; // the rename's own queued save
			// The user renames the excluded folder while the over-limit save runs.
			this.followExcludedFolderRename("Old", "Archive");
			throw new Error("disk full");
		});
		await expect(hooksOf(fake).applyExclusions(["Projects"])).rejects.toThrow();
		expect(fake.settings.excludedFolders).toEqual(["Old"]);
	});
});
