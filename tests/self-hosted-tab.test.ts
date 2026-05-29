import { describe, expect, mock, test } from "bun:test";
import { __settingCapture } from "obsidian";
import {
	type VaultSwitchTarget,
	applyVaultSwitch,
	describeListVaultsError,
	renderEngramUrlSetting,
} from "../src/tabs/self-hosted-tab";

describe("renderEngramUrlSetting", () => {
	function render(apiUrl: string) {
		__settingCapture.texts.length = 0;
		__settingCapture.buttons.length = 0;
		const plugin: any = {
			settings: { apiUrl, apiKey: "", refreshToken: "" },
			api: {},
			noteStream: {},
			saveSettings: async () => {},
		};
		renderEngramUrlSetting({ containerEl: {}, app: {}, plugin, redisplay: () => {} } as any);
	}

	test("pre-fills the field with the saved apiUrl so it stays visible", () => {
		render("https://staging.engram.page");
		expect(__settingCapture.texts[0]?.getValue()).toBe("https://staging.engram.page");
	});

	test("leaves the field empty on a fresh install (no apiUrl) so the placeholder shows", () => {
		render("");
		expect(__settingCapture.texts[0]?.getValue()).toBe("");
	});
});

function makePlugin(initial: string | null): VaultSwitchTarget & {
	api: { setVaultId: ReturnType<typeof mock> };
	saveSettings: ReturnType<typeof mock>;
} {
	return {
		settings: { vaultId: initial },
		api: { setVaultId: mock(() => {}) },
		saveSettings: mock(async () => {}),
	};
}

describe("applyVaultSwitch", () => {
	test("ignores empty value", async () => {
		const plugin = makePlugin("3");
		const changed = await applyVaultSwitch(plugin, "");
		expect(changed).toBe(false);
		expect(plugin.api.setVaultId).not.toHaveBeenCalled();
	});

	test("ignores no-op value (selecting the already-active vault)", async () => {
		const plugin = makePlugin("7");
		const changed = await applyVaultSwitch(plugin, "7");
		expect(changed).toBe(false);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	test("switches vault and persists", async () => {
		const plugin = makePlugin("3");
		const changed = await applyVaultSwitch(plugin, "9");

		expect(changed).toBe(true);
		expect(plugin.settings.vaultId).toBe("9");
		expect(plugin.api.setVaultId).toHaveBeenCalledWith("9");
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	test("first-time switch from null vault persists", async () => {
		const plugin = makePlugin(null);
		const changed = await applyVaultSwitch(plugin, "1");
		expect(changed).toBe(true);
		expect(plugin.settings.vaultId).toBe("1");
	});

	test("setVaultId runs before saveSettings", async () => {
		const order: string[] = [];
		const plugin: VaultSwitchTarget = {
			settings: { vaultId: "3" },
			api: {
				setVaultId: () => {
					order.push("setVaultId");
				},
			},
			saveSettings: async () => {
				order.push("saveSettings");
			},
		};

		await applyVaultSwitch(plugin, "9");

		expect(order).toEqual(["setVaultId", "saveSettings"]);
	});
});

describe("describeListVaultsError", () => {
	test("401 → sign-in required", () => {
		expect(describeListVaultsError({ status: 401 })).toBe("Sign-in required to load vaults");
	});

	test("403 → sign-in required (forbidden surfaced same as 401)", () => {
		expect(describeListVaultsError({ status: 403 })).toBe("Sign-in required to load vaults");
	});

	test("5xx → server error with status", () => {
		expect(describeListVaultsError({ status: 500 })).toBe(
			"Server error (500) — check Engram logs",
		);
		expect(describeListVaultsError({ status: 503 })).toBe(
			"Server error (503) — check Engram logs",
		);
	});

	test("other 4xx → request failed with status", () => {
		expect(describeListVaultsError({ status: 404 })).toBe("Request failed (404)");
	});

	test("no status (timeout/network) → connection message", () => {
		expect(describeListVaultsError(new Error("ETIMEDOUT"))).toBe(
			"Could not reach Engram — check connection",
		);
		expect(describeListVaultsError(undefined)).toBe(
			"Could not reach Engram — check connection",
		);
	});
});
