import { Notice, Setting } from "obsidian";
import { connectionState } from "../backend-mode";
import type { BackendMode } from "../types";
import {
	renderAuthSection,
	renderEngramUrlSetting,
	renderSupportSection,
	renderVaultSection,
} from "./connection-sections";
import type { TabContext } from "./types";

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
	// Only the missing-URL case gets a banner. The signed-out case had one too,
	// and it said "Not connected. Sign in below to start syncing." directly
	// above an Authentication section whose only row is a Sign in button — the
	// same sentence twice, the second time with the button attached.
	if (state === "needs-url") {
		const warning = new Setting(containerEl).setName(
			"Not connected. Enter your Engram server URL below to start syncing.",
		);
		warning.settingEl.addClass("engram-connection-warning");
	}

	if (mode === "selfhost") {
		const repo = new Setting(containerEl)
			.setName("Run your own Engram server")
			.setDesc("Engram is the backend that powers sync and semantic search.");
		repo.settingEl.addClass("engram-setup-cta");
		repo.descEl.createEl("a", {
			text: "github.com/engram-app/engram",
			href: "https://github.com/engram-app/engram",
		});
		renderEngramUrlSetting(ctx);
	}

	// Progressive disclosure: signing in and picking a vault are impossible
	// without a server to do them against, so self-host starts with the URL
	// field alone instead of three sections the user cannot act on yet.
	//
	// Keyed on "has a URL been configured", NOT on whether the server answers
	// right now. Hiding on a live probe failure would make a 30-second outage
	// look like the auth and vault sections had been wiped — the exact screen
	// a user in that state most needs to see. A dead server shows as the
	// warning above, never as a disappearance.
	//
	// Cloud has no URL step (the address is fixed), so it always discloses.
	if (mode === "cloud" || state !== "needs-url") {
		renderAuthSection(ctx);
		renderFinishSetupRow(ctx);
		renderVaultSection(ctx);
	}
	if (mode === "selfhost") renderSupportSection(ctx);
}

/** Sitting between auth and vault: the user is signed in and has a vault, but
 *  dismissed the sync preview without choosing a direction.
 *
 *  That leaves the gate closed, and the gate stops EVERY sync path — the vault
 *  syncs nothing at all until it is resolved. The status bar says so, but the
 *  settings page is where someone goes to work out why nothing is happening,
 *  so it has to say so here too. */
function renderFinishSetupRow(ctx: TabContext): void {
	const { containerEl, plugin } = ctx;
	if (!plugin.hasAuthConfigured()) return;
	if (!plugin.syncEngine.isSyncBlocked()) return;

	const row = new Setting(containerEl)
		.setName("Finish sync setup")
		.setDesc("Nothing in this vault syncs until you choose how to merge it with the server.")
		.addButton((btn) =>
			btn
				.setButtonText("Choose sync direction")
				.setCta()
				.onClick(() => {
					void plugin.doSyncWithFirstSyncCheck();
				}),
		);
	row.settingEl.addClass("engram-connection-warning");
}
