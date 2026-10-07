import { afterEach, describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import { Platform } from "obsidian";
import { suggestDeviceName } from "../src/device-name";

const flags = { ...Platform };
afterEach(() => Object.assign(Platform, flags));

const as = (over: Partial<typeof Platform>) =>
	Object.assign(Platform, {
		isDesktop: false,
		isIosApp: false,
		isAndroidApp: false,
		isTablet: false,
		isMacOS: false,
		isWin: false,
		isLinux: false,
		...over,
	});

describe("suggestDeviceName", () => {
	test("desktop uses the machine hostname without a .local suffix", async () => {
		as({ isDesktop: true });
		const expected = hostname()
			.trim()
			.replace(/\.local$/iu, "");
		expect(await suggestDeviceName()).toBe(expected || undefined);
	});

	test.each([
		[{ isIosApp: true }, "iPhone"],
		[{ isIosApp: true, isTablet: true }, "iPad"],
		[{ isAndroidApp: true }, "Android phone"],
		[{ isAndroidApp: true, isTablet: true }, "Android tablet"],
	])("mobile %#", async (over, expected) => {
		as(over);
		expect(await suggestDeviceName()).toBe(expected);
	});

	test("returns undefined when nothing identifies the device", async () => {
		as({});
		expect(await suggestDeviceName()).toBeUndefined();
	});
});
