import { Notice, Setting } from "obsidian";
import { connectionState } from "../backend-mode";
import type { BackendMode } from "../types";
import {
	renderAuthSection,
	renderEngramUrlSetting,
	renderSupportSection,
	renderVaultSection,
} from "./self-hosted-tab";
import type { TabContext } from "./types";
import { ENGRAM_MARKETING_URL } from "./urls";

const MODE_LABELS: Record<BackendMode, string> = {
	cloud: "Engram Cloud",
	selfhost: "Self-hosted",
};

/** The single Connection tab. Replaces the former Cloud and Self-hosted tabs.
 *
 *  Mode is read from explicit settings.backendMode, never inferred from apiUrl.
 *  That inference is what made merely VISITING the old Cloud tab a mutation
 *  (see the deleted cloudTabAction and PR #162): navigation is now inert, and
 *  only the toggle changes anything. */
export function renderConnectionTab(ctx: TabContext): void {
	const { containerEl, plugin, redisplay } = ctx;
	const mode: BackendMode = plugin.settings.backendMode ?? "selfhost";

	// ponytail: a dropdown, not a custom segmented control. Same two-choice
	// semantics, standard Obsidian affordance, zero new CSS. Swap for segmented
	// buttons only if the visual matters more than the maintenance.
	new Setting(containerEl)
		.setName("Backend")
		.setDesc("Where this vault syncs to. Each backend keeps its own sign-in.")
		.addDropdown((dd) => {
			dd.addOption("cloud", MODE_LABELS.cloud);
			dd.addOption("selfhost", MODE_LABELS.selfhost);
			dd.setValue(mode);
			dd.onChange(async (value) => {
				const target = value as BackendMode;
				// Delegate: a mode switch is a full identity swap and must follow the
				// same bump/rebuild/commit sequence as an OAuth login. Hand-rolling a
				// subset here previously nulled the auth provider without rebuilding
				// it and skipped bumpAuthGeneration.
				if (!(await plugin.switchBackendMode(target))) return;
				new Notice(`Switched to ${MODE_LABELS[target]}.`);
				redisplay();
			});
		});

	const state = connectionState(plugin.settings);
	if (state !== "connected") {
		const message =
			state === "needs-url"
				? "Not connected. Enter your Engram server URL below to start syncing."
				: "Not connected. Sign in below to start syncing.";
		const warning = new Setting(containerEl).setName(message);
		warning.settingEl.addClass("engram-connection-warning");
	}

	// No standalone "New to Engram?" block. Sign-in already covers signup: the
	// device-flow page (/link) sits behind the web app's AuthGuard, which sends a
	// signed-out visitor to the sign-in screen, and that screen offers account
	// creation. A separate "create an account first" CTA read as a prerequisite
	// step that does not exist. The marketing link now rides along with sign-in.
	if (mode === "selfhost") {
		const repo = new Setting(containerEl)
			.setName("Run your own Engram server")
			.setDesc("Engram is the backend that powers sync and semantic search.");
		repo.settingEl.addClass("engram-setup-cta");
		repo.descEl.addClass("engram-server-cta-desc");
		repo.descEl.createEl("a", {
			text: "github.com/engram-app/engram",
			href: "https://github.com/engram-app/engram",
		});
		renderEngramUrlSetting(ctx);
	}

	renderAuthSection(ctx, mode === "cloud" ? { learnMoreUrl: ENGRAM_MARKETING_URL } : undefined);
	renderVaultSection(ctx);
	if (mode === "selfhost") renderSupportSection(ctx);
}
