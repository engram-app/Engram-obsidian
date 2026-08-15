import { describe, expect, mock, test } from "bun:test";
import { __settingCapture } from "obsidian";
import { EngramApi } from "../src/api";
import {
	applyVaultSwitch,
	describeListVaultsError,
	renderEngramUrlSetting,
	type VaultSwitchTarget,
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

describe("renderEngramUrlSetting — no Save button", () => {
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

	// The debounced preflight already tells the user whether the address works.
	// A Save button beside it asked them to confirm what the page had just
	// confirmed for them.
	test("renders no button — the preflight is the confirmation", () => {
		render("https://staging.engram.page");
		expect(__settingCapture.buttons.length).toBe(0);
	});

	// applyApiUrlChange is a backend IDENTITY swap (clears auth, bumps the auth
	// generation). Reaching it on every keystroke is the bug this field was
	// rebuilt to fix, so blur has to be a real, separate commit path.
	test("commits on blur, so a server that is not running yet can still be saved", () => {
		render("");
		expect(__settingCapture.texts[0]?.blurCb).toBeTruthy();
	});

	// The probe committing IS the design (there is no Save button), but commit
	// ends in redisplay(), which tears the field out of the DOM. Doing that
	// while the user is still typing in it eats their caret mid-word.
	test("a commit fired while the field is focused hands focus back", async () => {
		__settingCapture.texts.length = 0;
		const plugin: any = {
			settings: { apiUrl: "", apiKey: "", refreshToken: "" },
			api: { setAuthProvider: () => {} },
			noteStream: { disconnect: () => {} },
			resetAuthProvider: () => {},
			saveSettings: async () => {},
		};
		const ctx: any = { containerEl: {}, app: {}, plugin, redisplay: () => {} };
		// redisplay rebuilds the tab — that is what destroys the input.
		ctx.redisplay = () => renderEngramUrlSetting(ctx);
		renderEngramUrlSetting(ctx);

		const typed = __settingCapture.texts[0];
		const g = globalThis as any;
		g.document = { activeElement: typed?.inputEl, hasFocus: () => true };
		const realProbe = (EngramApi as any).probeHealth;
		(EngramApi as any).probeHealth = async () => ({ kind: "engram", version: "1.2.3" });
		try {
			typed?.changeCb?.("http://127.0.0.1:4000");
			// Past the 600ms preflight debounce, then let the probe + commit settle.
			await new Promise((r) => setTimeout(r, 900));
		} finally {
			(EngramApi as any).probeHealth = realProbe;
			g.document = undefined;
		}

		expect(plugin.settings.apiUrl).toBe("http://127.0.0.1:4000");
		const rebuilt = __settingCapture.texts[__settingCapture.texts.length - 1];
		expect(rebuilt).not.toBe(typed);
		expect(rebuilt?.focused).toBe(true);
		// Caret at the end: the user was appending, and a select-all would make
		// their next keystroke wipe the URL.
		expect(rebuilt?.caret).toEqual([
			"http://127.0.0.1:4000".length,
			"http://127.0.0.1:4000".length,
		]);
	});

	// Alt-tabbing out of Obsidian fires blur on the focused input too. That is
	// not "I meant that" — it is a half-typed address the user is coming back
	// to, and committing it swaps the stored backend (and clears auth) behind
	// their back while they are looking at another window.
	test("does NOT commit when blur came from the whole window losing focus", async () => {
		const saved: string[] = [];
		__settingCapture.texts.length = 0;
		const plugin: any = {
			settings: { apiUrl: "https://staging.engram.page", apiKey: "", refreshToken: "" },
			api: { setAuthProvider: () => {} },
			noteStream: { disconnect: () => {} },
			resetAuthProvider: () => {},
			saveSettings: async () => {
				saved.push(plugin.settings.apiUrl);
			},
		};
		renderEngramUrlSetting({
			containerEl: {},
			app: {},
			plugin,
			redisplay: () => {},
		} as any);

		const text = __settingCapture.texts[0];
		text?.changeCb?.("http://halfway");

		// No DOM in this runner, and the guard reads the real one. A blurred
		// window is exactly `document.hasFocus() === false`.
		const g = globalThis as any;
		g.document = { hasFocus: () => false, activeElement: null };
		try {
			text?.blurCb?.();
			await Promise.resolve();
		} finally {
			g.document = undefined;
		}

		expect(saved).toEqual([]);
		expect(plugin.settings.apiUrl).toBe("https://staging.engram.page");
	});
});
