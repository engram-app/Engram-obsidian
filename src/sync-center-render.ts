/** Shared renderer for the Sync Center UI.
 *
 *  Mounted inside the Sync Center settings tab. The caller passes a `refresh`
 *  callback so in-pane button clicks can re-render the same surface they were
 *  clicked from.
 */
import { Notice, Setting, normalizePath } from "obsidian";
import { type IssueDisposition, issueDisposition, remediation } from "./issue-store";
import type EngramSyncPlugin from "./main";
import { SyncPreviewModal } from "./sync-preview-modal";
import type { SyncIssue, SyncIssueCategory, SyncLogEntry } from "./types";

/** Fallback billing URL when a needs_pro issue didn't carry one. Exported so
 *  other plan-gated surfaces (e.g. the sync progress modal's "skipped" note)
 *  link to the same place. */
export const DEFAULT_UPGRADE_URL = "https://app.engram.page/settings/billing";

/** Build an Obsidian Setting heading inside `parent` so the section title
 *  matches the visual style of the Cloud / Self-hosted / Advanced tabs. */
function sectionHeading(parent: HTMLElement, title: string): Setting {
	return new Setting(parent).setName(title).setHeading();
}

/** Category render order within each section. */
const CATEGORY_ORDER: SyncIssueCategory[] = [
	"needs_pro",
	"quota",
	"too_large",
	"auth",
	"conflict",
	"server",
	"network",
	"other",
];

const CATEGORY_ICON: Partial<Record<SyncIssueCategory, string>> = {
	needs_pro: "🔒",
	quota: "🗄",
	too_large: "📦",
	auth: "🔑",
	conflict: "⚡",
};

export function renderSyncCenter(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
): void {
	parent.empty();
	parent.addClass("engram-sync-center");
	renderHeader(parent, plugin);
	renderActions(parent, plugin, refresh);
	renderPlanSkips(parent, plugin, refresh);
	renderNeedsAttention(parent, plugin, refresh);
	renderRetrying(parent, plugin, refresh);
	renderIgnored(parent, plugin, refresh);
	renderActivity(parent, plugin, refresh);
	renderStats(parent, plugin);
}

/** All current issues whose disposition is in `dispositions`, grouped by
 *  category in CATEGORY_ORDER. Each section passes the single disposition it
 *  owns (informational / actionable / transient) so the three surfaces stay
 *  cleanly partitioned. */
function groupedByCategory(
	issues: SyncIssue[],
	dispositions: IssueDisposition[],
): Array<[SyncIssueCategory, SyncIssue[]]> {
	const groups = new Map<SyncIssueCategory, SyncIssue[]>();
	for (const issue of issues) {
		if (!dispositions.includes(issueDisposition(issue.category))) continue;
		const bucket = groups.get(issue.category) ?? [];
		bucket.push(issue);
		groups.set(issue.category, bucket);
	}
	return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!]);
}

function renderHeader(parent: HTMLElement, plugin: EngramSyncPlugin): void {
	const header = parent.createDiv({ cls: "engram-sync-center-header" });
	const status = plugin.syncEngine.getStatus();
	const all = plugin.syncEngine.issues.all();
	// Three independent buckets, one per disposition. Informational (plan-limit)
	// issues are their own calm "not synced on your plan" tally — never folded
	// into "needs attention" nor "retrying".
	const planSkipCount = all.filter(
		(i) => issueDisposition(i.category) === "informational",
	).length;
	const attentionCount = all.filter((i) => issueDisposition(i.category) === "actionable").length;
	const retryingCount = all.filter((i) => issueDisposition(i.category) === "transient").length;
	const ignoredCount = plugin.syncEngine.ignoredFiles.size();

	const dot = header.createSpan({ cls: `engram-sync-center-dot is-${status.state}` });
	dot.setText("●");

	const title = header.createSpan({ cls: "engram-sync-center-title" });
	title.setText(`Engram Sync — ${status.state}`);

	if (planSkipCount > 0) {
		const badge = header.createSpan({ cls: "engram-sync-center-plan-badge" });
		badge.setText(`${planSkipCount} not on your plan`);
	}
	if (attentionCount > 0) {
		const badge = header.createSpan({ cls: "engram-sync-center-issue-badge" });
		badge.setText(`${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`);
	}
	if (retryingCount > 0) {
		const badge = header.createSpan({ cls: "engram-sync-center-retrying-badge" });
		badge.setText(`${retryingCount} retrying`);
	}
	if (ignoredCount > 0) {
		const badge = header.createSpan({ cls: "engram-sync-center-ignored-badge" });
		badge.setText(`${ignoredCount} ignored`);
	}
}

function renderActions(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const strip = parent.createDiv({ cls: "engram-sync-center-actions" });

	makeActionButton(strip, "Sync...", async () => {
		try {
			const plan = await plugin.syncEngine.computeSyncPlan("full");
			const modal = new SyncPreviewModal(plugin.app, plan, {
				remoteVaultName: plugin.settings.remoteVaultName,
				showChangeVault: false,
				context: "review",
			});
			const choice = await modal.awaitChoice();
			// change-vault is unreachable here (showChangeVault: false), but assert in
			// case a future caller flips that flag without updating this dispatch site.
			if (choice === "change-vault") {
				throw new Error("Sync Center received change-vault choice — caller missing");
			}
			await plugin.runSyncWithProgress(choice);
		} catch (e) {
			new Notice(`Engram Sync: ${e instanceof Error ? e.message : "sync failed"}`);
		}
		refresh();
	});

	makeActionButton(strip, "Refresh", () => refresh());
}

function makeActionButton(
	parent: HTMLElement,
	text: string,
	handler: () => void | Promise<void>,
): void {
	const btn = parent.createEl("button", { text, cls: "engram-sync-center-action-btn" });
	btn.addEventListener("click", () => {
		void handler();
	});
}

/** "Not synced on your plan" — terminal plan-limit facts (needs_pro, quota).
 *  Calm, info-styled section rendered ABOVE "Needs attention": nothing is
 *  broken, these files just exceed the current tier. One card per reason with
 *  an Upgrade CTA; no retry/dismiss churn. */
function renderPlanSkips(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const groups = groupedByCategory(plugin.syncEngine.issues.all(), ["informational"]);
	const total = groups.reduce((n, [, list]) => n + list.length, 0);
	if (total === 0) return; // No section when nothing is plan-skipped.

	const section = parent.createDiv({
		cls: "engram-sync-center-section engram-sync-center-plan-section",
	});
	sectionHeading(section, `Not synced on your plan (${total})`);

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	body.createEl("p", {
		cls: "engram-sync-center-card-hint",
		text: "These files are fine. They just need a paid plan to sync.",
	});

	for (const [category, list] of groups) {
		renderPlanCard(body, plugin, refresh, category, list);
	}
}

/** A calm (info-styled) plan-skip card: remediation copy, file list, and a
 *  single Upgrade button. No Dismiss/Retry — the fact stands until the plan
 *  changes. */
function renderPlanCard(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	category: SyncIssueCategory,
	issues: SyncIssue[],
): void {
	const { title, hint } = remediation(category);
	const card = parent.createDiv({
		cls: "engram-sync-center-card engram-sync-center-card-info",
	});

	const head = card.createDiv({ cls: "engram-sync-center-card-head" });
	head.createSpan({ cls: "engram-sync-center-card-icon", text: CATEGORY_ICON[category] ?? "🔒" });
	head.createSpan({
		cls: "engram-sync-center-card-title",
		text: `${title} (${issues.length})`,
	});

	card.createEl("p", { cls: "engram-sync-center-card-hint", text: hint });

	const actions = card.createDiv({ cls: "engram-sync-center-card-actions" });
	const url = issues.find((i) => i.upgradeUrl)?.upgradeUrl ?? DEFAULT_UPGRADE_URL;
	const upgrade = actions.createEl("button", { text: "Upgrade", cls: "mod-cta" });
	upgrade.addEventListener("click", () => window.open(url, "_blank"));

	// Manual re-attempt for users who upgraded out-of-band (e.g. the plan event
	// hasn't landed yet, or they want to retry without waiting for it).
	const resync = actions.createEl("button", { text: "Sync these now" });
	resync.addEventListener("click", () => {
		void plugin.syncEngine.resyncSkippedAttachments().then(refresh);
	});

	const toggle = actions.createEl("button", {
		text: `Show files (${issues.length}) ▾`,
		cls: "engram-sync-center-card-toggle",
	});
	const fileList = card.createDiv({ cls: "engram-sync-center-issue-list is-collapsed" });
	toggle.addEventListener("click", () => fileList.classList.toggle("is-collapsed"));

	for (const issue of issues) {
		renderFileRow(fileList, plugin, refresh, issue);
	}
}

/** "Needs attention" — permanent failures the user must act on, one card per
 *  reason. Aggregates the files sharing each reason. */
function renderNeedsAttention(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
): void {
	// Only actionable issues here (too_large, auth, conflict). Informational
	// plan-limit issues now render in their own calm "Not synced on your plan"
	// section above; transient ones go under "Retrying automatically".
	const groups = groupedByCategory(plugin.syncEngine.issues.all(), ["actionable"]);
	const total = groups.reduce((n, [, list]) => n + list.length, 0);

	const section = parent.createDiv({
		cls: "engram-sync-center-section engram-sync-center-attention-section",
	});
	const heading = sectionHeading(section, `Needs attention (${total})`);
	if (total > 0) {
		heading.addButton((btn) =>
			btn.setButtonText("Clear all").onClick(() => {
				for (const [, list] of groups) {
					for (const issue of list) plugin.syncEngine.issues.clear(issue.path);
				}
				void plugin.persistEngineState().then(refresh);
			}),
		);
	}

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	if (total === 0) {
		body.createEl("p", {
			cls: "engram-sync-center-empty",
			text: "Nothing needs your attention. 🎉",
		});
		return;
	}

	for (const [category, list] of groups) {
		renderAttentionCard(body, plugin, refresh, category, list);
	}
}

function renderAttentionCard(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	category: SyncIssueCategory,
	issues: SyncIssue[],
): void {
	const { title, hint } = remediation(category);
	const card = parent.createDiv({ cls: "engram-sync-center-card" });

	const head = card.createDiv({ cls: "engram-sync-center-card-head" });
	head.createSpan({ cls: "engram-sync-center-card-icon", text: CATEGORY_ICON[category] ?? "⚠" });
	head.createSpan({
		cls: "engram-sync-center-card-title",
		text: `${title} (${issues.length})`,
	});

	card.createEl("p", { cls: "engram-sync-center-card-hint", text: hint });

	const actions = card.createDiv({ cls: "engram-sync-center-card-actions" });

	// Per-card dismiss — clears these errors without permanently ignoring the
	// files (unlike "Ignore"). They reappear if they fail again.
	const dismiss = actions.createEl("button", { text: "Dismiss" });
	dismiss.addEventListener("click", () => {
		for (const issue of issues) plugin.syncEngine.issues.clear(issue.path);
		void plugin.persistEngineState().then(refresh);
	});

	const toggle = actions.createEl("button", {
		text: `Show files (${issues.length}) ▾`,
		cls: "engram-sync-center-card-toggle",
	});
	const fileList = card.createDiv({ cls: "engram-sync-center-issue-list is-collapsed" });
	toggle.addEventListener("click", () => fileList.classList.toggle("is-collapsed"));

	for (const issue of issues) {
		renderFileRow(fileList, plugin, refresh, issue);
	}
}

/** "Retrying automatically" — transient failures retried with backoff; clears
 *  itself on success. Offers a manual "Retry all now". */
function renderRetrying(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const groups = groupedByCategory(plugin.syncEngine.issues.all(), ["transient"]);
	const total = groups.reduce((n, [, list]) => n + list.length, 0);
	if (total === 0) return; // No section when nothing is retrying.

	const section = parent.createDiv({ cls: "engram-sync-center-section" });
	const heading = sectionHeading(section, `Retrying automatically (${total})`);
	heading.addButton((btn) =>
		btn
			.setButtonText("Retry all now")
			.setCta()
			.onClick(async () => {
				await plugin.syncEngine.retryFailedNow();
				refresh();
			}),
	);

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	body.createEl("p", {
		cls: "engram-sync-center-card-hint",
		text: "Temporary errors. These clear themselves once the server recovers.",
	});
	const list = body.createDiv({ cls: "engram-sync-center-issue-list" });
	for (const [, issues] of groups) {
		for (const issue of issues) renderFileRow(list, plugin, refresh, issue);
	}
}

function renderFileRow(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	issue: SyncIssue,
): void {
	const row = parent.createDiv({ cls: "engram-sync-center-issue-row" });

	const main = row.createDiv({ cls: "engram-sync-center-issue-main" });
	main.createDiv({ cls: "engram-sync-center-issue-path", text: issue.path });

	const meta = main.createDiv({ cls: "engram-sync-center-issue-meta" });
	const parts: string[] = [];
	if (issue.sizeBytes !== undefined) parts.push(formatBytes(issue.sizeBytes));
	if (issue.status !== undefined) parts.push(`HTTP ${issue.status}`);
	parts.push(`${issue.attempts} attempt${issue.attempts === 1 ? "" : "s"}`);
	parts.push(formatRelative(issue.lastFailedAt));
	meta.setText(parts.join(" · "));

	const actions = row.createDiv({ cls: "engram-sync-center-issue-actions" });

	const openBtn = actions.createEl("button", { text: "Open", cls: "mod-cta" });
	openBtn.addEventListener("click", () => openFile(plugin, issue.path));

	const ignoreBtn = actions.createEl("button", { text: "Ignore" });
	ignoreBtn.addEventListener("click", () => {
		void ignoreFilePermanently(plugin, issue.path, refresh);
	});
}

function renderIgnored(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const ignored = plugin.syncEngine.ignoredFiles.all();
	const section = parent.createDiv({ cls: "engram-sync-center-section" });
	sectionHeading(section, `Ignored (${ignored.length})`);

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	if (ignored.length === 0) {
		body.createEl("p", {
			cls: "engram-sync-center-empty",
			text: "No files ignored. Use the ignore button on a failure row to stop syncing it.",
		});
		return;
	}

	const list = body.createDiv({ cls: "engram-sync-center-issue-list" });
	for (const path of ignored) {
		renderIgnoredRow(list, plugin, refresh, path);
	}
}

function renderIgnoredRow(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	path: string,
): void {
	const row = parent.createDiv({ cls: "engram-sync-center-issue-row" });

	const main = row.createDiv({ cls: "engram-sync-center-issue-main" });
	main.createDiv({ cls: "engram-sync-center-issue-path", text: path });

	const actions = row.createDiv({ cls: "engram-sync-center-issue-actions" });

	const openBtn = actions.createEl("button", { text: "Open" });
	openBtn.addEventListener("click", () => openFile(plugin, path));

	const restoreBtn = actions.createEl("button", { text: "Restore", cls: "mod-cta" });
	restoreBtn.addEventListener("click", () => {
		void restoreFile(plugin, path, refresh);
	});
}

function openFile(plugin: EngramSyncPlugin, path: string): void {
	const file = plugin.app.vault.getFileByPath(normalizePath(path));
	if (!file) {
		new Notice(`File not found locally: ${path}`);
		return;
	}
	void plugin.app.workspace.openLinkText(path, "");
}

async function ignoreFilePermanently(
	plugin: EngramSyncPlugin,
	path: string,
	refresh: () => void,
): Promise<void> {
	plugin.syncEngine.ignoredFiles.add(path);
	plugin.syncEngine.issues.clear(path);
	await plugin.persistEngineState();
	new Notice(`Ignored ${path} — won't sync until restored from Sync Center.`);
	refresh();
}

async function restoreFile(
	plugin: EngramSyncPlugin,
	path: string,
	refresh: () => void,
): Promise<void> {
	plugin.syncEngine.ignoredFiles.remove(path);
	await plugin.persistEngineState();
	new Notice(`Restored ${path} — will sync on next push.`);
	refresh();
}

const ACTIVITY_LIMIT = 50;

const ACTION_ICON: Record<SyncLogEntry["action"], string> = {
	push: "↑",
	pull: "↓",
	delete: "✕",
	conflict: "⚡",
	skip: "·",
	error: "!",
};

const RESULT_CLASS: Record<SyncLogEntry["result"], string> = {
	ok: "is-ok",
	error: "is-error",
	skipped: "is-skipped",
};

function renderActivity(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const section = parent.createDiv({ cls: "engram-sync-center-section" });
	const all = plugin.syncLog.entries();
	const heading = sectionHeading(section, `Activity (${all.length})`);
	if (all.length > 0) {
		heading.addButton((btn) =>
			btn.setButtonText("Clear").onClick(() => {
				plugin.syncLog.clear();
				refresh();
			}),
		);
	}

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	if (all.length === 0) {
		body.createEl("p", {
			cls: "engram-sync-center-empty",
			text: "No activity yet. Push or pull to see entries here.",
		});
		return;
	}

	const list = body.createDiv({ cls: "engram-sync-center-activity-list" });
	const recent = all.slice(-ACTIVITY_LIMIT).reverse();
	for (const entry of recent) {
		renderActivityRow(list, entry);
	}
}

function renderActivityRow(parent: HTMLElement, entry: SyncLogEntry): void {
	const row = parent.createDiv({
		cls: `engram-sync-center-activity-row ${RESULT_CLASS[entry.result]}`,
	});
	row.createSpan({
		cls: "engram-sync-center-activity-icon",
		text: ACTION_ICON[entry.action] ?? "?",
	});
	row.createSpan({ cls: "engram-sync-center-activity-action", text: entry.action });
	row.createSpan({ cls: "engram-sync-center-activity-path", text: entry.path });
	row.createSpan({
		cls: "engram-sync-center-activity-time",
		text: formatRelative(entry.timestamp.getTime()),
	});
	if (entry.error) {
		const err = parent.createDiv({ cls: "engram-sync-center-activity-error" });
		err.setText(entry.error);
	}
}

function renderStats(parent: HTMLElement, plugin: EngramSyncPlugin): void {
	const section = parent.createDiv({ cls: "engram-sync-center-section" });
	sectionHeading(section, "Stats");

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	const grid = body.createDiv({ cls: "engram-sync-center-stats-grid" });

	const allFiles = plugin.app.vault.getFiles();
	let noteCount = 0;
	let attCount = 0;
	for (const f of allFiles) {
		if (!plugin.syncEngine.isSyncable(f)) continue;
		if (plugin.syncEngine.shouldIgnore(f.path)) continue;
		if (plugin.syncEngine.isBinaryFile(f)) attCount++;
		else noteCount++;
	}

	const lastSync = plugin.syncEngine.getLastSync();
	const vaultId = plugin.settings.vaultId;

	addStat(grid, "Local notes", String(noteCount));
	addStat(grid, "Local attachments", String(attCount));
	addStat(grid, "Vault", plugin.app.vault.getName());
	addStat(grid, "Vault ID", vaultId ? String(vaultId) : "—");
	addStat(grid, "Last sync", lastSync ? formatRelative(new Date(lastSync).getTime()) : "never");
	addStat(grid, "Live (WebSocket)", plugin.isLiveConnected() ? "connected" : "disconnected");
	addStat(grid, "Pending in queue", String(plugin.syncEngine.queue.size));
	addStat(grid, "Issues", String(plugin.syncEngine.issues.count()));
	addStat(grid, "Ignored", String(plugin.syncEngine.ignoredFiles.size()));
}

function addStat(parent: HTMLElement, label: string, value: string): void {
	const item = parent.createDiv({ cls: "engram-sync-center-stat" });
	item.createDiv({ cls: "engram-sync-center-stat-label", text: label });
	item.createDiv({ cls: "engram-sync-center-stat-value", text: value });
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}
