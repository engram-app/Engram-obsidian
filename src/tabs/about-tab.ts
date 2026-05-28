import { Setting } from "obsidian";
import type { TabContext } from "./types";
import { ENGRAM_DOCS_URL, ENGRAM_ISSUES_URL, ENGRAM_MCP_URL, ENGRAM_PRICING_URL } from "./urls";

/** Append an external link (opens in the browser) to a parent element. */
function externalLink(parent: HTMLElement, text: string, href: string): void {
	parent.createEl("a", { text, href, attr: { target: "_blank", rel: "noopener" } });
}

/** Welcome / orientation tab — what the plugin does, how to get set up, what to
 *  try, the plans, and where to learn more. Static content (no plugin state),
 *  shown first and defaulted to for new users (see `pickInitialTab`). */
export function renderAboutTab(ctx: TabContext): void {
	const { containerEl, switchToTab } = ctx;

	const intro = containerEl.createEl("p", { cls: "engram-about-intro" });
	intro.setText(
		"Engram vault sync keeps your Obsidian vault in sync with Engram and lets your AI assistants read and write the same notes. You edit on any device; your AI works from notes you actually wrote.",
	);

	// ── Getting set up ──
	new Setting(containerEl).setName("Getting set up").setHeading();

	new Setting(containerEl)
		.setName("1. Connect your account")
		.setDesc("Sign in to Engram cloud, or point the plugin at your own server.")
		.addButton((btn) =>
			btn
				.setButtonText("Open cloud tab")
				.setCta()
				.onClick(() => switchToTab("account")),
		);

	new Setting(containerEl)
		.setName("2. Run your first sync")
		.setDesc(
			"Push your vault to Engram — the plugin walks you through it, and nothing is sent until you confirm.",
		);

	new Setting(containerEl)
		.setName("3. Search by meaning")
		.setDesc(
			"Open the command palette and run “Engram: Semantic search”. Describe what you want in plain language — exact keywords aren't needed.",
		);

	// ── Make the most of it ──
	new Setting(containerEl).setName("Make the most of it").setHeading();

	const tips = containerEl.createEl("ul", { cls: "engram-about-list" });
	tips.createEl("li", {
		text: "Keep a search sidebar open while you write — click the search icon in the left ribbon.",
	});
	tips.createEl("li", {
		text: "Watch sync status and fix any failures in the sync center (the sync icon in the ribbon).",
	});
	const aiTip = tips.createEl("li");
	aiTip.appendText("Connect an AI assistant — Claude, Cursor, ChatGPT, and others. ");
	externalLink(aiTip, "Read the AI setup guide", ENGRAM_MCP_URL);
	tips.createEl("li", { text: "It works on mobile too, not just desktop." });

	// ── Plans ──
	new Setting(containerEl).setName("Plans").setHeading();

	const plans = containerEl.createEl("ul", { cls: "engram-about-list" });
	plans.createEl("li", {
		text: "Free — get started with one vault and core sync, search, and AI.",
	});
	plans.createEl("li", {
		text: "Paid plans — more vaults and storage, real-time sync, and higher AI limits.",
	});
	const pricing = containerEl.createEl("p", { cls: "engram-about-link" });
	externalLink(pricing, "See full pricing", ENGRAM_PRICING_URL);

	// ── Learn more ──
	new Setting(containerEl).setName("Learn more").setHeading();

	const links = containerEl.createEl("ul", { cls: "engram-about-list" });
	const docs = links.createEl("li");
	externalLink(docs, "Documentation", ENGRAM_DOCS_URL);
	const mcp = links.createEl("li");
	externalLink(mcp, "AI / MCP setup guide", ENGRAM_MCP_URL);
	const issues = links.createEl("li");
	externalLink(issues, "Report an issue", ENGRAM_ISSUES_URL);
}
