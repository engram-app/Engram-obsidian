import { Setting } from "obsidian";
import { t } from "../i18n";
import type { TabContext } from "./types";
import {
	ENGRAM_DISCORD_URL,
	ENGRAM_DOCS_URL,
	ENGRAM_ISSUES_URL,
	ENGRAM_MCP_URL,
	ENGRAM_PRICING_URL,
	ENGRAM_SELFHOST_URL,
	ENGRAM_SETUP_VIDEO_URL,
	ENGRAM_SIGN_UP_URL,
} from "./urls";

/** Append an external link (opens in the browser) to a parent element. */
function externalLink(parent: HTMLElement, text: string, href: string): void {
	parent.createEl("a", { text, href, attr: { target: "_blank", rel: "noopener" } });
}

/** A bold section heading for the Welcome tab. */
function heading(containerEl: HTMLElement, name: string): void {
	const setting = new Setting(containerEl).setName(name).setHeading();
	setting.settingEl.addClass("engram-about-heading");
}

/** Welcome / orientation tab — what the plugin does, how to get set up, the
 *  plans, and where to learn more. Static content (no plugin state), shown
 *  first and defaulted to for new users (see `pickInitialTab`). */
export function renderAboutTab(ctx: TabContext): void {
	const { containerEl, switchToTab } = ctx;

	// The video is the fastest path to a working setup, so it leads the tab
	// as an accent button rather than an inline link — a text link in the
	// description reads as one more sentence and gets skipped.
	const video = new Setting(containerEl)
		.setName(t("New here? Watch the setup video"))
		.setDesc(t("What Engram does, and how to connect your vault, start to finish."))
		.addButton((btn) =>
			btn
				.setButtonText(t("▶ Watch on YouTube"))
				.setCta()
				// Obsidian's Electron host treats window.open as an external
				// browser open (same pattern as src/limit-toast.ts).
				.onClick(() => window.open(ENGRAM_SETUP_VIDEO_URL, "_blank")),
		);
	video.settingEl.addClass("engram-about-video");

	// ── Getting set up ──
	heading(containerEl, t("Getting set up"));

	const account = new Setting(containerEl).setName(t("1. Make an account"));
	account.descEl.appendText(t("Create a hosted account at "));
	externalLink(account.descEl, "app.engram.page", ENGRAM_SIGN_UP_URL);
	account.descEl.appendText(t(", or self-host the backend ("));
	externalLink(account.descEl, t("setup guide"), ENGRAM_SELFHOST_URL);
	account.descEl.appendText(").");

	new Setting(containerEl)
		.setName(t("2. Connect your vault to Engram"))
		.setDesc(
			t(
				"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.",
			),
		)
		.addButton((btn) =>
			btn
				.setButtonText(t("Open connection tab"))
				.setCta()
				.onClick(() => switchToTab("connection")),
		);

	const ai = new Setting(containerEl).setName(t("3. Connect your AI"));
	ai.descEl.appendText(
		t("Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. "),
	);
	externalLink(ai.descEl, t("See the AI setup guide"), ENGRAM_MCP_URL);

	// ── Plans ──
	heading(containerEl, t("Plans"));

	const plans = containerEl.createEl("ul", { cls: "engram-plans" });
	const plan = (name: string, features: string[]): void => {
		const card = plans.createEl("li", { cls: "engram-plan" });
		card.createEl("h4", { text: name });
		const list = card.createEl("ul", { cls: "engram-plan-features" });
		for (const feature of features) list.createEl("li", { text: feature });
	};
	// Every line here must be checkable against `Engram.Billing.LimitKeys` in
	// the backend. This block drifted badly once: it claimed 1 device (it is 2),
	// read-only AI (MCP `create_note`/`write_note` have no tier gate at all),
	// and "Full API" on Starter when API keys went Pro-only on 2026-08-24.
	//
	// The search lines deliberately name COVERAGE, not the retrieval mechanism.
	// That is the pricing v3.1 positioning (ranking differences are single-digit
	// and imperceptible; "found my note" vs "cannot find my note" is not), and
	// it also keeps this copy true across the pending Free semantic-search flip.
	plan(t("Free"), [
		t("1 vault, 2 devices"),
		t("Real-time sync"),
		t("2,000 notes searchable"),
		t("Connect any AI (MCP)"),
	]);
	plan(t("Starter"), [
		t("10 vaults, unlimited devices"),
		t("Search all your notes"),
		t("10 GB attachments"),
		t("Unlimited AI searches"),
	]);
	plan(t("Pro"), [
		t("Unlimited vaults"),
		t("Search across all vaults at once"),
		t("50 GB attachments"),
		t("API access"),
	]);

	const pricing = containerEl.createEl("p", { cls: "engram-about-link" });
	externalLink(pricing, t("See full pricing"), ENGRAM_PRICING_URL);

	// ── Learn more ──
	heading(containerEl, t("Learn more"));

	const links = containerEl.createEl("ul", { cls: "engram-about-links" });
	externalLink(links.createEl("li"), t("Documentation"), ENGRAM_DOCS_URL);
	externalLink(links.createEl("li"), t("AI / MCP setup guide"), ENGRAM_MCP_URL);
	externalLink(links.createEl("li"), t("Report an issue"), ENGRAM_ISSUES_URL);
	externalLink(links.createEl("li"), t("Join our Discord"), ENGRAM_DISCORD_URL);
}
