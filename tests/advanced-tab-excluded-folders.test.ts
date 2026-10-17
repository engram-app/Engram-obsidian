/**
 * Folders unticked in the first-sync picker live in settings.excludedFolders,
 * not in the user's ignore text. The Advanced tab lists them so they stay
 * visible and can be synced again.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { __noticeCapture, __settingCapture } from "obsidian";
import { renderExcludedFolders } from "../src/tabs/advanced-tab";

function render(excludedFolders: string[]) {
	const plugin: any = {
		settings: { excludedFolders },
		syncFolderAgain: mock(async (folder: string) => {
			plugin.settings.excludedFolders = plugin.settings.excludedFolders.filter(
				(f: string) => f !== folder,
			);
		}),
	};
	const redisplay = mock(() => {});
	renderExcludedFolders({} as any, plugin, redisplay);
	return { plugin, redisplay };
}

beforeEach(() => {
	__noticeCapture.notices.length = 0;
	__settingCapture.names.length = 0;
	__settingCapture.buttons.length = 0;
});

describe("renderExcludedFolders", () => {
	test("lists each excluded folder", () => {
		render(["Archive", "Old"]);
		expect(__settingCapture.names).toContain("Archive");
		expect(__settingCapture.names).toContain("Old");
	});

	test("renders nothing when no folder is excluded", () => {
		render([]);
		expect(__settingCapture.names).toEqual([]);
	});

	test("Sync again hands the folder to the plugin and redraws", async () => {
		const { plugin, redisplay } = render(["Archive", "Old"]);
		const btn = __settingCapture.buttons.find((b) => b.text === "Sync again");
		await btn?.clickCb?.();
		expect(plugin.syncFolderAgain).toHaveBeenCalledWith("Archive");
		expect(redisplay).toHaveBeenCalled();
	});

	test("a failed Sync again says so and still redraws", async () => {
		const { plugin, redisplay } = render(["Archive"]);
		plugin.syncFolderAgain = mock(() => Promise.reject(new Error("disk full")));
		const btn = __settingCapture.buttons.find((b) => b.text === "Sync again");
		await btn?.clickCb?.();
		expect(__noticeCapture.notices.length).toBe(1);
		expect(redisplay).toHaveBeenCalled();
	});
});
