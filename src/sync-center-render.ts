/** Shared renderer for the Sync Center UI.
 *
 *  Mounted inside the Sync Center settings tab. The caller passes a `refresh`
 *  callback so in-pane button clicks can re-render the same surface they were
 *  clicked from.
 */
import { Notice, normalizePath, Setting } from "obsidian";
import { type IssueDisposition, issueDisposition, remediation } from "./issue-store";
import type EngramSyncPlugin from "./main";
import type { QueuedReason } from "./offline-queue";
import { planUsageRows, type UsageRow } from "./plan-usage";
import { ACTION_ICONS } from "./sync-log-modal";
import { plural } from "./sync-plan-format";
import { planLoadErrorMessage, SyncPreviewModal } from "./sync-preview-modal";
import { DEFAULT_UPGRADE_URL } from "./tabs/urls";
import type { SyncIssue, SyncIssueCategory, SyncLogEntry } from "./types";

/** Build an Obsidian Setting heading inside `parent` so the section title
 *  matches the visual style of the Cloud / Self-hosted / Advanced tabs. */
function sectionHeading(parent: HTMLElement, title: string): Setting {
	return new Setting(parent).setName(title).setHeading();
}

/** Category render order within each section. */
const CATEGORY_ORDER: SyncIssueCategory[] = [
	"needs_pro",
	"quota",
	"frontmatter",
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
	frontmatter: "📝",
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
	renderPlanUsage(parent, plugin);
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
		if (!dispositions.includes(issueDisposition(issue.category, issue.parseReason))) continue;
		const bucket = groups.get(issue.category) ?? [];
		bucket.push(issue);
		groups.set(issue.category, bucket);
	}
	return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => [c, groups.get(c)!]);
}

/** User-facing wording for each queued reason. Kept beside the render so the
 *  copy is reviewable in one place rather than inlined into a template. */
const QUEUED_REASON_TEXT: Record<QueuedReason, string> = {
	offline: "waiting for a connection",
	"sync-blocked": "sync is paused",
	"in-progress": "syncing now",
	waiting: "waiting to retry",
};

function renderHeader(parent: HTMLElement, plugin: EngramSyncPlugin): void {
	const status = plugin.syncEngine.getStatus();
	const all = plugin.syncEngine.issues.all();
	// Three independent buckets, one per disposition. Informational (plan-limit)
	// issues are their own calm "not synced on your plan" tally — never folded
	// into "needs attention" nor "retrying".
	const planSkipCount = all.filter(
		(i) => issueDisposition(i.category, i.parseReason) === "informational",
	).length;
	const attentionCount = all.filter(
		(i) => issueDisposition(i.category, i.parseReason) === "actionable",
	).length;
	const retryingCount = all.filter(
		(i) => issueDisposition(i.category, i.parseReason) === "transient",
	).length;
	const ignoredCount = plugin.syncEngine.ignoredFiles.size();
	// Say WHY the queue is holding rather than leaving a bare count that reads
	// as a hang. "waiting" is the case that previously showed an unexplained
	// spinner: online, unblocked, nothing in flight, work still sitting there.
	const reason = plugin.syncEngine.queuedReason();

	// ponytail: badges only — the settings status strip above already shows
	// state + last sync. Nothing to badge means no empty box.
	if (!planSkipCount && !attentionCount && !retryingCount && !ignoredCount && !reason) return;

	const header = parent.createDiv({ cls: "engram-sync-center-header" });

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

	if (reason) {
		const badge = header.createSpan({ cls: "engram-sync-center-queued-badge" });
		badge.setText(`${status.queued} queued — ${QUEUED_REASON_TEXT[reason]}`);
	}
}

function renderActions(parent: HTMLElement, plugin: EngramSyncPlugin, refresh: () => void): void {
	const strip = parent.createDiv({ cls: "engram-sync-center-actions" });

	makeActionButton(strip, "Sync...", async () => {
		try {
			// Open instantly in a loading state, then stream the plan in (mirrors
			// the first-sync path) so the modal never waits on the server to appear.
			const modal = new SyncPreviewModal(plugin.app, null, {
				remoteVaultName: plugin.settings.remoteVaultName,
				showChangeVault: false,
				context: "review",
				gateClosed: plugin.syncEngine.isSyncBlocked(),
			});
			void plugin.syncEngine
				.computeSyncPlan("full")
				.then((p) => modal.setPlan(p))
				.catch(() => modal.setPlanError(planLoadErrorMessage(plugin.hasAuthConfigured())));
			// Registered so auth invalidation can flip this modal to the sign-in
			// error too, not just the first-sync command's modal.
			plugin.trackPreviewModal(modal);
			let choice: Awaited<ReturnType<typeof modal.awaitChoice>>;
			try {
				choice = await modal.awaitChoice();
			} finally {
				plugin.untrackPreviewModal(modal);
			}
			// change-vault is unreachable here (showChangeVault: false), but assert in
			// case a future caller flips that flag without updating this dispatch site.
			if (choice === "change-vault") {
				throw new Error("Sync Center received change-vault choice, caller missing");
			}
			await plugin.runSyncWithProgress(choice, { plan: modal.getPlan() });
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

/** "Your plan" — caps and current usage, ALWAYS shown once we know the tier.
 *
 *  Replaces an earlier version that only appeared once the user was over the
 *  index cap. That was wrong for the same reason the cap itself is a problem:
 *  a Free user at 300 of 2,000 saw nothing at all, so the first thing they
 *  learned about the limit was a search quietly failing to find a note they
 *  had just written. Showing a healthy row is the whole point.
 *
 *  Caps come from the channel plan state, which the plugin already has.
 *  Usage needs `GET /api/billing/usage`, so the panel renders its rows
 *  synchronously and fills numbers in when the fetch lands. Advisory only:
 *  nothing here gates client behaviour, per the endpoint's own contract. */
function renderPlanUsage(parent: HTMLElement, plugin: EngramSyncPlugin): void {
	const tier = plugin.syncEngine?.getPlanState()?.tier;
	// Plan state arrives on channel join, so it IS absent for a moment after
	// load, and forever when signed out. No tier, no panel.
	if (!tier) return;

	const section = parent.createDiv({
		cls: "engram-sync-center-section engram-sync-center-plan-usage-section",
	});
	sectionHeading(section, `Your plan: ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`);
	const body = section.createDiv({ cls: "engram-sync-center-section-body" });
	const rowsEl = body.createDiv({ cls: "engram-sync-center-usage-rows" });
	rowsEl.createEl("p", { cls: "engram-sync-center-card-hint", text: "Loading usage…" });

	// `plugin.api`, not `syncEngine.api` — the latter is private to the engine.
	const api = plugin.api;
	if (!api?.getBillingUsage) {
		rowsEl.empty();
		return;
	}

	void api
		.getBillingUsage()
		.then((data) => {
			rowsEl.empty();
			const rows = planUsageRows(data);
			if (rows.length === 0) return;
			for (const row of rows) renderUsageRow(rowsEl, row);
			if (tier === "free") {
				const actions = rowsEl.createDiv({ cls: "engram-sync-center-card-actions" });
				const upgrade = actions.createEl("button", { text: "Upgrade", cls: "mod-cta" });
				upgrade.addEventListener("click", () => window.open(DEFAULT_UPGRADE_URL, "_blank"));
			}
		})
		.catch(() => {
			// Advisory panel: a failed usage read must never look like a sync
			// problem. Say the numbers are unavailable and leave it at that.
			rowsEl.empty();
			rowsEl.createEl("p", {
				cls: "engram-sync-center-card-hint",
				text: "Plan usage is unavailable right now.",
			});
		});
}

function renderUsageRow(parent: HTMLElement, row: UsageRow): void {
	const el = parent.createDiv({
		cls: `engram-sync-center-usage-row${row.atLimit ? " is-at-limit" : ""}`,
	});
	const head = el.createDiv({ cls: "engram-sync-center-usage-head" });
	head.createSpan({ cls: "engram-sync-center-usage-label", text: row.label });
	head.createSpan({ cls: "engram-sync-center-usage-value", text: row.value });

	if (row.fraction !== null) {
		const track = el.createDiv({ cls: "engram-sync-center-usage-track" });
		const fill = track.createDiv({ cls: "engram-sync-center-usage-fill" });
		fill.setAttribute("style", `width: ${Math.round(row.fraction * 100)}%`);
	}
	if (row.hint) {
		el.createEl("p", { cls: "engram-sync-center-card-hint", text: row.hint });
	}
}

/** Shared card chrome for the plan-skip and needs-attention sections: head
 *  (icon + title-with-count), hint line, an actions strip filled by the
 *  caller, and the collapsed "Show files (N)" list. The two card renderers
 *  were line-for-line copies differing only in buttons and CSS modifier. */
function renderIssueCard(
	parent: HTMLElement,
	plugin: EngramSyncPlugin,
	refresh: () => void,
	issues: SyncIssue[],
	opts: {
		cardCls: string;
		icon: string;
		title: string;
		hint: string;
		buttons: (actions: HTMLElement) => void;
	},
): void {
	const card = parent.createDiv({ cls: opts.cardCls });

	const head = card.createDiv({ cls: "engram-sync-center-card-head" });
	head.createSpan({ cls: "engram-sync-center-card-icon", text: opts.icon });
	head.createSpan({
		cls: "engram-sync-center-card-title",
		text: `${opts.title} (${issues.length})`,
	});

	card.createEl("p", { cls: "engram-sync-center-card-hint", text: opts.hint });

	const actions = card.createDiv({ cls: "engram-sync-center-card-actions" });
	opts.buttons(actions);

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
	renderIssueCard(parent, plugin, refresh, issues, {
		cardCls: "engram-sync-center-card engram-sync-center-card-info",
		icon: CATEGORY_ICON[category] ?? "🔒",
		title,
		hint,
		buttons: (actions) => {
			const url = issues.find((i) => i.upgradeUrl)?.upgradeUrl ?? DEFAULT_UPGRADE_URL;
			const upgrade = actions.createEl("button", { text: "Upgrade", cls: "mod-cta" });
			upgrade.addEventListener("click", () => window.open(url, "_blank"));

			// Manual re-attempt for users who upgraded out-of-band (e.g. the plan
			// event hasn't landed yet, or they want to retry without waiting for it).
			const resync = actions.createEl("button", { text: "Sync these now" });
			resync.addEventListener("click", () => {
				void plugin.syncEngine.resyncSkippedAttachments().then(refresh);
			});
		},
	});
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
	// Issues grouped here share a disposition (actionable), so for the "other"
	// category they're all note_processing_failed. Pass the reason through so
	// the card gets the accurate non-retrying copy instead of the generic
	// "Sync failed... retrying automatically" default.
	const { title, hint } = remediation(category, issues[0]?.parseReason);
	renderIssueCard(parent, plugin, refresh, issues, {
		cardCls: "engram-sync-center-card",
		icon: CATEGORY_ICON[category] ?? "⚠",
		title,
		hint,
		buttons: (actions) => {
			// Per-card dismiss — clears these errors without permanently ignoring
			// the files (unlike "Ignore"). They reappear if they fail again.
			const dismiss = actions.createEl("button", { text: "Dismiss" });
			dismiss.addEventListener("click", () => {
				for (const issue of issues) plugin.syncEngine.issues.clear(issue.path);
				void plugin.persistEngineState().then(refresh);
			});
		},
	});
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
	parts.push(plural(issue.attempts, "attempt"));
	parts.push(formatRelative(issue.lastFailedAt));
	meta.setText(parts.join(" · "));

	if (issue.parseReason) {
		const reason = main.createDiv({ cls: "engram-sync-center-issue-reason" });
		reason.createSpan({ text: issue.parseReason.message });
		const snippet = issue.parseReason.detail?.snippet;
		if (snippet) reason.createEl("code", { text: snippet });
		// note_processing_failed now has its own accurate, non-retrying card in
		// the "Needs attention" section (issueDisposition treats it as
		// actionable), so no per-row hint duplication is needed here.
	}

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
		text: ACTION_ICONS[entry.action] ?? "?",
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

	const vaultId = plugin.settings.vaultId;

	// Static facts only. Live counters (last sync, socket, queue, issues,
	// ignored) are already on the status strip and in their own sections.
	addStat(grid, "Local notes", String(noteCount));
	addStat(grid, "Local attachments", String(attCount));
	addStat(grid, "Vault", plugin.app.vault.getName());
	addStat(grid, "Vault ID", vaultId ? String(vaultId) : "—");
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
