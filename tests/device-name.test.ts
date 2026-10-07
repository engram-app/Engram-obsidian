import { afterEach, describe, expect, test } from "bun:test";
import { Platform } from "obsidian";
import { cleanHostname, suggestDeviceName } from "../src/device-name";

// A reader is injected rather than mocking `node:os`: bun's mock.module is
// process-wide and would leak into the other suites that use `os`.
const reader = (name: string | Error) => async () => {
	if (name instanceof Error) {
		throw name;
	}
	return name;
};

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

describe("cleanHostname", () => {
	test.each([
		["Todds-MacBook-Pro.local", "Todds-MacBook-Pro"],
		["wks-123.corp.example.com", "wks-123"],
		["  desk  ", "desk"],
		["fedora", "fedora"],
	])("keeps the first label of %p", (raw, expected) => {
		expect(cleanHostname(raw)).toBe(expected);
	});

	test.each([[""], ["   "], ["localhost"], ["localhost.localdomain"], ["a".repeat(65)]])(
		"drops %p",
		(raw) => {
			expect(cleanHostname(raw)).toBeUndefined();
		},
	);
});

describe("suggestDeviceName", () => {
	test("desktop sends the cleaned hostname", async () => {
		as({ isDesktop: true, isMacOS: true });
		expect(await suggestDeviceName(reader("Todds-MacBook-Pro.local"))).toBe(
			"Todds-MacBook-Pro",
		);
	});

	test.each([
		[{ isMacOS: true }, "Mac"],
		[{ isWin: true }, "Windows PC"],
		[{ isLinux: true }, "Linux PC"],
	])(
		"desktop falls back to the platform when the hostname is unusable %#",
		async (over, expected) => {
			as({ isDesktop: true, ...over });
			expect(await suggestDeviceName(reader("localhost"))).toBe(expected);
		},
	);

	test("desktop falls back to the platform when reading the hostname throws", async () => {
		as({ isDesktop: true, isWin: true });
		expect(await suggestDeviceName(reader(new Error("sandboxed")))).toBe("Windows PC");
	});

	test.each([
		[{ isIosApp: true }, "iPhone"],
		[{ isIosApp: true, isTablet: true }, "iPad"],
		[{ isAndroidApp: true }, "Android phone"],
		[{ isAndroidApp: true, isTablet: true }, "Android tablet"],
	])("mobile never reads the hostname %#", async (over, expected) => {
		as(over);
		expect(await suggestDeviceName(reader(new Error("must not be called on mobile")))).toBe(
			expected,
		);
	});

	test("returns undefined when nothing identifies the device", async () => {
		as({});
		expect(await suggestDeviceName()).toBeUndefined();
	});
});
