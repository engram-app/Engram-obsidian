/** Shared renderer for the Sync Center UI.
 *
 *  Mounted inside the Sync Center settings tab. The caller passes a `refresh`
 *  callback so in-pane button clicks can re-render the same surface they were
 *  clicked from.
 */
import { Notice, Setting, normalizePath } from "obsidian";
import type EngramSyncPlugin from "./main";
import { SyncPreviewModal } from "./sync-preview-modal";
import type { SyncIssue, SyncIssueCategory, SyncLogEntry } from "./types";

/** Build an Obsidian Setting heading inside `parent` so the section title
 *  matches the visual style of the Cloud / Self-hosted / Advanced tabs. */
function sectionHeading(parent: HTMLElement, title: string): Setting {
	return new Setting(parent).setName(title).setHeading();
}

const CATEGORY_LABEL: Record<SyncIssueCategory, string> = {
	too_large: "Too large — server max 5 MB",
	auth: "Auth failure — token invalid or expired",
	server: "Server error",
	network: "Network failure",
	conflict: "Unresolved conflict",
	needs_pro: "Needs Pro — upgrade to sync attachments",
	other: "Other failure",
};

const CATEGORY_ORDER: SyncIssueCategory[] = [
	"needs_pro",
	"too_large",
	"conflict",
	"auth",
	"server",
	"network",
	"other",
];

export function renderSyncCenter(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
): void {
	parent.empty();
	parent.addClass("engram-sync-center");
	renderHeader(parent, plugin);
	renderActions(parent, plugin, refresh);
	renderIssues(parent, plugin, refresh);
	renderIgnored(parent, plugin, refresh);
	renderActivity(parent, plugin, refresh);
	renderStats(parent, plugin);
}

function renderHeader(parent: HTMLElement, plugin: EngramSyncPlugin): void {
	const header = parent.createDiv({ cls: "engram-sync-center-header" });
	const status = plugin.syncEngine.getStatus();
	const issueCount = plugin.syncEngine.issues.count();
	const ignoredCount = plugin.syncEngine.ignoredFiles.size();

	const dot = header.createSpan({ cls: `engram-sync-center-dot is-${status.state}` });
	dot.setText("●");

	const title = header.createSpan({ cls: "engram-sync-center-title" });
	title.setText(`Engram Sync — ${status.state}`);

	if (issueCount > 0) {
		const badge = header.createSpan({ cls: "engram-sync-center-issue-badge" });
		badge.setText(`${issueCount} issue${issueCount === 1 ? "" : "s"}`);
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
			await plugin.runSyncFromChoice(choice);
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

function renderIssues(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const section = parent.createDiv({ cls: "engram-sync-center-section" });
	sectionHeading(section, `Issues (${plugin.syncEngine.issues.count()})`);

	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	const issues = plugin.syncEngine.issues.all();
	if (issues.length === 0) {
		body.createEl("p", {
			cls: "engram-sync-center-empty",
			text: "No sync failures. Everything pushed cleanly.",
		});
		return;
	}

	const grouped = plugin.syncEngine.issues.byCategory();
	for (const category of CATEGORY_ORDER) {
		const list = grouped[category];
		if (!list || list.length === 0) continue;
		renderCategoryGroup(body, plugin, refresh, category, list);
	}
}

function renderCategoryGroup(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	category: SyncIssueCategory,
	issues: SyncIssue[],
): void {
	const group = parent.createDiv({ cls: "engram-sync-center-group" });
	const groupHead = group.createEl("h4", {
		cls: "engram-sync-center-group-head",
		text: `${CATEGORY_LABEL[category]} (${issues.length})`,
	});
	groupHead.createSpan({ cls: "engram-sync-center-group-toggle", text: " ▾" });

	const list = group.createDiv({ cls: "engram-sync-center-issue-list" });
	groupHead.addEventListener("click", () => list.classList.toggle("is-collapsed"));

	for (const issue of issues) {
		renderIssueRow(list, plugin, refresh, issue);
	}
}

function renderIssueRow(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	issue: SyncIssue,
): void {
	const row = parent.createDiv({ cls: "engram-sync-center-issue-row" });

	const main = row.createDiv({ cls: "engram-sync-center-issue-main" });
	const pathRow = main.createDiv({ cls: "engram-sync-center-issue-path" });
	if (issue.category === "needs_pro") {
		// Compact lock marker matches the spec §4.6 "Needs Pro" surface.
		const icon = pathRow.createSpan({ cls: "engram-needs-pro-icon" });
		icon.setText("🔒");
		icon.setAttribute("aria-label", "Upgrade to sync attachments");
		icon.setAttribute("title", "Upgrade to sync attachments");
	}
	pathRow.createSpan({ text: issue.path });

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
	main.createEl("div", { cls: "engram-sync-center-issue-path", text: path });

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
