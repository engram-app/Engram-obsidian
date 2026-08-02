import { Notice, Setting } from "obsidian";
import { applyApiUrlChange, cloudTabAction, pluginSwitchTarget } from "../auth-state";
import { renderAuthSection, renderVaultSection } from "./self-hosted-tab";
import type { TabContext } from "./types";
import { ENGRAM_CLOUD_URL, ENGRAM_MARKETING_URL } from "./urls";

export { ENGRAM_CLOUD_URL, ENGRAM_MARKETING_URL };

export async function renderAccountTab(ctx: TabContext): Promise<void> {
	const { containerEl, plugin, redisplay } = ctx;

	const action = cloudTabAction(plugin.settings, ENGRAM_CLOUD_URL);

	// Self-hosted user with stored credentials: require an explicit click
	// before nuking apiKey/refreshToken/vaultId. The prior auto-switch fired
	// on every tab activation and silently destroyed credentials when a
	// self-hosted user merely navigated to the Cloud tab (e2e apiKey-wipe
	// diagnostic on PR #162 caught this in CI).
	if (action === "prompt-switch") {
		new Setting(containerEl)
			.setName("Currently set to a self-hosted instance")
			.setDesc(
				`Self-hosted URL: ${plugin.settings.apiUrl}. Switching to Engram cloud replaces it and clears any stored credentials for that instance.`,
			)
			.addButton((btn) =>
				btn
					.setButtonText("Switch to Engram cloud")
					.setWarning()
					.onClick(async () => {
						await applyApiUrlChange(pluginSwitchTarget(plugin), ENGRAM_CLOUD_URL, () =>
							plugin.saveSettings(),
						);
						new Notice("Switched to Engram cloud — sign in to continue.");
						redisplay();
					}),
			);
		return;
	}

	if (action === "auto-switch") {
		await applyApiUrlChange(pluginSwitchTarget(plugin), ENGRAM_CLOUD_URL, () =>
			plugin.saveSettings(),
		);
	}

	const aboutSetting = new Setting(containerEl)
		.setName("New to Engram?")
		.setDesc("Create an account, read the docs, and learn more at ");
	aboutSetting.settingEl.addClass("engram-setup-cta");
	aboutSetting.descEl.createEl("a", {
		text: "engram.page",
		href: ENGRAM_MARKETING_URL,
		attr: { target: "_blank", rel: "noopener" },
	});
	aboutSetting.descEl.appendText(".");

	renderAuthSection(ctx);
	renderVaultSection(ctx);
}
