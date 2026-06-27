import { Setting } from "obsidian";
import { EmailCaptureState, renderEmailCaptureForm } from "../email-capture-modal";
import type { TabContext } from "./types";
import {
	ENGRAM_DOCS_URL,
	ENGRAM_ISSUES_URL,
	ENGRAM_MARKETING_URL,
	ENGRAM_MCP_URL,
	ENGRAM_PRICING_URL,
	ENGRAM_SELFHOST_URL,
} from "./urls";

/** Inline waitlist signup for the Welcome tab — a permanent counterpart to the
 *  one-time first-run popup, for users who dismissed it but later change their
 *  mind. Reuses the same tested state machine and submit path as the modal. */
function renderWaitlistSection(containerEl: HTMLElement): void {
	const state = new EmailCaptureState();
	const section = containerEl.createDiv({ cls: "engram-about-waitlist" });

	const render = (): void => {
		section.empty();

		if (state.view === "success") {
			section.createEl("p", {
				cls: "engram-about-waitlist-success",
				text: "You're on the list. Thanks for your patience!",
			});
			return;
		}

		section.createEl("p", {
			text:
				"Engram is still in active development. Leave your email for beta access, an " +
				"early-supporter discount, and a say in what comes next.",
		});

		renderEmailCaptureForm({ parent: section, state, rerender: render });
	};

	render();
}

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

	const intro = containerEl.createEl("p", { cls: "engram-about-intro" });
	intro.setText(
		"Engram vault sync keeps your Obsidian vault in sync with Engram and lets your AI assistants read and write the same notes. You edit on any device; your AI works from notes you actually wrote.",
	);

	// ── Stay in the loop ──
	heading(containerEl, "Stay in the loop");
	renderWaitlistSection(containerEl);

	// ── Getting set up ──
	heading(containerEl, "Getting set up");

	const account = new Setting(containerEl).setName("1. Make an account");
	account.descEl.appendText("Create a hosted account at ");
	externalLink(account.descEl, "engram.page", ENGRAM_MARKETING_URL);
	account.descEl.appendText(", or self-host the backend (");
	externalLink(account.descEl, "setup guide", ENGRAM_SELFHOST_URL);
	account.descEl.appendText(").");

	new Setting(containerEl)
		.setName("2. Connect your vault to Engram")
		.setDesc(
			"Sign in (or enter your server URL and key) on the cloud tab, then run your first sync.",
		)
		.addButton((btn) =>
			btn
				.setButtonText("Open cloud tab")
				.setCta()
				.onClick(() => switchToTab("account")),
		);

	const ai = new Setting(containerEl).setName("3. Connect your AI");
	ai.descEl.appendText(
		"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ",
	);
	externalLink(ai.descEl, "See the AI setup guide", ENGRAM_MCP_URL);

	// ── Plans ──
	heading(containerEl, "Plans");

	const plans = containerEl.createEl("ul", { cls: "engram-plans" });
	const plan = (name: string, features: string[]): void => {
		const card = plans.createEl("li", { cls: "engram-plan" });
		card.createEl("h4", { text: name });
		const list = card.createEl("ul", { cls: "engram-plan-features" });
		for (const feature of features) list.createEl("li", { text: feature });
	};
	plan("Free", [
		"1 vault, 1 device",
		"Auto sync",
		"Read-only AI access",
		"Semantic search + MCP",
	]);
	plan("Starter", [
		"Multiple vaults, all devices",
		"Real-time sync",
		"Full API + MCP",
		"Higher daily AI limit",
	]);
	plan("Pro", ["Unlimited notes", "Unlimited AI (fair use)", "Priority support"]);

	const pricing = containerEl.createEl("p", { cls: "engram-about-link" });
	externalLink(pricing, "See full pricing", ENGRAM_PRICING_URL);

	// ── Learn more ──
	heading(containerEl, "Learn more");

	const links = containerEl.createEl("ul", { cls: "engram-about-links" });
	externalLink(links.createEl("li"), "Documentation", ENGRAM_DOCS_URL);
	externalLink(links.createEl("li"), "AI / MCP setup guide", ENGRAM_MCP_URL);
	externalLink(links.createEl("li"), "Report an issue", ENGRAM_ISSUES_URL);
}
