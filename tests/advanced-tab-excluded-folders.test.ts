/**
 * Folders unticked in the first-sync picker live in settings.excludedFolders,
 * not in the user's ignore text. The Advanced tab lists them so they stay
 * visible and can be synced again.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { __settingCapture } from "obsidian";
import { renderExcludedFolders } from "../src/tabs/advanced-tab";

function render(excludedFolders: string[]) {
	const plugin: any = {
		settings: { excludedFolders },
		saveSettings: mock(async () => {}),
	};
	const redisplay = mock(() => {});
	renderExcludedFolders({} as any, plugin, redisplay);
	return { plugin, redisplay };
}

beforeEach(() => {
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

	test("Sync again removes the folder, saves and redraws", async () => {
		const { plugin, redisplay } = render(["Archive", "Old"]);
		const btn = __settingCapture.buttons.find((b) => b.text === "Sync again");
		await btn?.clickCb?.();
		expect(plugin.settings.excludedFolders).toEqual(["Old"]);
		expect(plugin.saveSettings).toHaveBeenCalled();
		expect(redisplay).toHaveBeenCalled();
	});
});
