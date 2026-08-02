/**
 * Settings tab for Engram Sync plugin.
 */
import { type App, PluginSettingTab, type Setting } from "obsidian";
import { DeviceFlowModal } from "./device-flow-modal";
import type EngramSyncPlugin from "./main";
import { SyncProgressModal, settingsBarCounts } from "./sync-progress-modal";
import { renderAboutTab } from "./tabs/about-tab";
import { renderAccountTab } from "./tabs/account-tab";
import { renderAdvancedTab } from "./tabs/advanced-tab";
import { renderSelfHostedTab } from "./tabs/self-hosted-tab";
import { pickInitialTab } from "./tabs/start-tab";
import { renderSyncCenterTab } from "./tabs/sync-center-tab";
import type { TabContext } from "./tabs/types";
import type { SyncProgress } from "./types";

export class EngramSyncSettingTab extends PluginSettingTab {
	plugin: EngramSyncPlugin;
	private activeTab: string;
	private statusContainerEl: HTMLElement | null = null;
	/** The wrapper this tab currently has installed in the engine's single
	 *  onSyncProgress slot, and whatever was in the slot before it. See
	 *  installProgressBar. */
	private installedProgressCb: ((progress: SyncProgress) => void) | null = null;
	private prevProgressCb: ((progress: SyncProgress) => void) | null = null;
	/** Container the UI was last drawn into. Differs by path: this.containerEl
	 *  on <1.13 (display()), the render-hatch host on 1.13+. rerender() targets
	 *  it so redisplay/device-flow re-renders land in the right place. */
	private activeContainerEl: HTMLElement | null = null;

	constructor(app: App, plugin: EngramSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.activeTab = pickInitialTab(plugin.settings);
	}

	/** Pre-select a tab before the next display() call. */
	setInitialTab(tabId: string): void {
		this.activeTab = tabId;
	}

	/**
	 * Registers this tab with Obsidian's 1.13+ declarative settings API so it
	 * shows up in the global settings search. We do NOT decompose our settings
	 * into declarative `control` objects: this tab is a rich custom UI (tab bar,
	 * live status dot, progress bar, device-flow) with no 1:1 declarative form.
	 * Instead we expose a single `render` item that draws the existing UI, which
	 * is enough to satisfy the API and index the tab by name.
	 *
	 * On 1.13+ a non-empty return here renders INSTEAD of display(); on <1.13
	 * (minAppVersion is 1.7.2) this method doesn't exist on the base class and
	 * display() is the fallback. Both paths call renderContent(), so there's
	 * one source of truth.
	 *
	 * ponytail: one search entry (indexed by name), not per-setting search.
	 * Upgrade path = decompose each setting into a `control` definition — large,
	 * and would drop the custom tab UX on 1.13+. Not worth it to satisfy a
	 * search-indexing nudge.
	 *
	 * Return type is a local shim for Obsidian 1.13's `SettingDefinitionItem`:
	 * we hold the obsidian typings at 1.8.7 (minAppVersion is 1.7.2), so the
	 * real type isn't available. This covers exactly the `render` item we emit;
	 * swap for `SettingDefinitionItem[]` if the obsidian typings floor is ever
	 * raised to >=1.13.
	 */
	getSettingDefinitions(): Array<{
		name: string;
		desc: string;
		render: (setting: Setting) => void;
	}> {
		return [
			{
				name: "Engram Sync",
				desc: "Cloud and self-hosted sync, connection, and advanced settings.",
				render: (setting: Setting) => {
					// Host the full UI in the row element Obsidian hands us
					// (setting.settingEl — a plain HTMLElement, no version gate).
					// engram-settings-host strips the default .setting-item flex row
					// so our tabbed UI lays out edge-to-edge.
					setting.settingEl.addClass("engram-settings-host");
					this.renderContent(setting.settingEl.createDiv());
				},
			},
		];
	}

	display(): void {
		this.renderContent(this.containerEl);
	}

	/** Re-render into whatever container we last drew into. Public so external
	 *  callers (e.g. a vault switch in main.ts) refresh the tab without calling
	 *  the deprecated display() — which on 1.13+ would draw into the tab root
	 *  instead of the render-hatch host. No-op if the tab isn't currently shown
	 *  (activeContainerEl is cleared on hide()) or if the container was detached
	 *  without hide() firing — on 1.13+ Obsidian can tear down the render-hatch
	 *  row on a settings re-render, so guard with isConnected like renderStatus()
	 *  does; it re-renders on next open. */
	rerender(): void {
		if (this.activeContainerEl?.isConnected) this.renderContent(this.activeContainerEl);
	}

	private renderContent(containerEl: HTMLElement): void {
		this.activeContainerEl = containerEl;
		containerEl.empty();

		// ── Status indicator (persists across tabs, live-updates via plugin hook) ──
		this.statusContainerEl = containerEl.createDiv({ cls: "engram-status-bar" });
		this.statusContainerEl.addClasses(["engram-status-container"]);
		this.renderStatus();

		this.plugin.onStatusBarChange = () => this.renderStatus();

		// ── Progress bar (hidden until sync is active, persists across tabs) ──
		const progressContainer = containerEl.createDiv({ cls: "engram-sync-progress" });

		const progressLabel = progressContainer.createEl("p", {
			text: "Syncing...",
			cls: "engram-progress-label",
		});

		const progressBarOuter = progressContainer.createDiv({ cls: "engram-progress-bar-outer" });
		const progressBarInner = progressBarOuter.createDiv({ cls: "engram-progress-bar-inner" });

		// Per-phase previous denominator, so a fallback (plan-less) row keeps its
		// total when the engine momentarily reports 0. Cleared on completion.
		const prevTotals = new Map<string, number>();
		this.installProgressBar((progress) => {
			if (progress.phase === "complete") {
				progressContainer.removeClass("is-active");
				prevTotals.clear();
				return;
			}
			// A new sync's first event (container was inactive): drop any denominators
			// left over from a prior sync that ended without a "complete" (e.g. it
			// errored), so a stale total can't leak into this run's fallback rows.
			if (!progressContainer.hasClass("is-active")) prevTotals.clear();
			progressContainer.addClass("is-active");
			// Route through the same plan-aware, clamped logic as the modal so
			// this bar can't sit stuck-low, pin at a fake 100%, or overshoot.
			const planned = this.plugin.activeSyncPhases?.find((p) => p.phase === progress.phase);
			const { current, total, pct } = settingsBarCounts(
				progress,
				planned,
				prevTotals.get(progress.phase) ?? 0,
			);
			prevTotals.set(progress.phase, total);
			const phaseLabel =
				progress.phase === "deleting"
					? "Deleting local files"
					: progress.phase === "pushing"
						? "Pushing notes"
						: progress.phase === "pulling"
							? "Pulling notes"
							: "Syncing attachments";
			const failedSuffix = progress.failed > 0 ? ` (${progress.failed} failed)` : "";
			// total 0 = indeterminate (unknown-length incremental pull): show the
			// running count as activity, no misleading "N / 0".
			progressLabel.setText(
				total > 0
					? `${phaseLabel}... ${current}/${total}${failedSuffix}`
					: `${phaseLabel}... ${current}${failedSuffix}`,
			);
			progressBarInner.style.width = `${pct}%`;
		});

		// ── Tab bar ──
		const tabs = [
			{ id: "about" as const, label: "👋 Welcome", render: renderAboutTab },
			{ id: "account" as const, label: "☁️ Cloud", render: renderAccountTab },
			{ id: "self-hosted" as const, label: "🖥️ Self-hosted", render: renderSelfHostedTab },
			{ id: "sync-center" as const, label: "🔄 Sync Center", render: renderSyncCenterTab },
			{ id: "advanced" as const, label: "⚙️ Advanced", render: renderAdvancedTab },
		];

		const tabBar = containerEl.createEl("nav", { cls: "engram-tab-bar" });
		const contentEl = containerEl.createEl("section", { cls: "engram-tab-content" });

		const activateTab = (tabId: string) => {
			this.activeTab = tabId;
			for (const btn of Array.from(tabBar.querySelectorAll<HTMLElement>(".engram-tab"))) {
				btn.removeClass("is-active");
			}
			contentEl.empty();
			const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
			if (!tab) return;
			const btn = tabBar.querySelector<HTMLElement>(`[data-tab="${tab.id}"]`);
			btn?.addClass("is-active");
			void tab.render({ ...ctx, containerEl: contentEl });
		};

		const ctx: TabContext = {
			containerEl: contentEl,
			app: this.app,
			plugin: this.plugin,
			redisplay: () => this.rerender(),
			startDeviceFlow: () => this.startDeviceFlow(),
			openProgressModal: () => this.openProgressModal(),
			switchToTab: (id) => activateTab(id),
		};

		for (const tab of tabs) {
			const btn = tabBar.createEl("button", {
				text: tab.label,
				cls: "engram-tab",
			});
			btn.dataset.tab = tab.id;
			btn.addEventListener("click", () => activateTab(tab.id));
		}

		// Activate the remembered tab (or default to "account")
		const startTab = tabs.find((t) => t.id === this.activeTab) ? this.activeTab : "account";
		activateTab(startTab);
	}

	/** Install `render` into the engine's single onSyncProgress slot by
	 *  CHAINING, mirroring runSyncWithProgress: capture the previous callback
	 *  and forward to it. A bare assignment here silently disconnected an open
	 *  SyncProgressModal whenever settings (re)rendered mid-sync, and the
	 *  modal's own restore then wiped the settings bar. Re-install replaces the
	 *  prior wrapper (re-render must not stack), and a wrapper that is no
	 *  longer current renders nothing but keeps forwarding — it may be held
	 *  mid-chain by a modal that captured it. */
	private installProgressBar(render: (progress: SyncProgress) => void): void {
		this.uninstallProgressBar();
		this.prevProgressCb = this.plugin.syncEngine.onSyncProgress;
		const wrapper = (progress: SyncProgress): void => {
			if (this.installedProgressCb === wrapper) render(progress);
			this.prevProgressCb?.(progress);
		};
		this.installedProgressCb = wrapper;
		this.plugin.syncEngine.onSyncProgress = wrapper;
	}

	/** Detach the settings progress bar (hide/re-render). Restores the slot
	 *  when this wrapper is still at the head; if a modal chained on top, the
	 *  wrapper stays in its chain but goes inert (see installProgressBar). */
	private uninstallProgressBar(): void {
		const wrapper = this.installedProgressCb;
		if (!wrapper) return;
		this.installedProgressCb = null;
		if (this.plugin.syncEngine.onSyncProgress === wrapper) {
			this.plugin.syncEngine.onSyncProgress = this.prevProgressCb;
		}
	}

	/** Open a progress modal and wire it to the sync engine's progress callback. */
	async openProgressModal(): Promise<SyncProgressModal> {
		const modal = new SyncProgressModal(this.app);
		const prevCallback = this.plugin.syncEngine.onSyncProgress;
		this.plugin.syncEngine.onSyncProgress = (progress) => {
			modal.update(progress);
			prevCallback?.(progress);
		};
		modal.open();
		// Yield to allow the modal to render before sync starts
		await new Promise((resolve) => window.requestAnimationFrame(resolve));
		return modal;
	}

	async startDeviceFlow(): Promise<void> {
		const modal = new DeviceFlowModal(this.app, this.plugin);
		const result = await modal.waitForResult();
		if (result) {
			await this.plugin.saveOAuthTokens(
				result.refresh_token,
				result.vault_id,
				result.user_email,
			);
			this.rerender();
		}
	}

	/** Render (or re-render) the connection status row in place. Idempotent —
	 *  empties the container first so it can be wired to live status events. */
	private renderStatus(): void {
		const statusEl = this.statusContainerEl;
		if (!statusEl?.isConnected) return;
		statusEl.empty();

		const status = this.plugin.syncEngine.getStatus();
		const live = this.plugin.isLiveConnected();
		const blocked = this.plugin.syncEngine.isSyncBlocked();

		let dotState: "is-error" | "is-connected" | "is-polling" | "is-idle" | "is-waiting";
		let label: string;

		if (status.state === "offline") {
			dotState = "is-error";
			label = "Disconnected";
		} else if (status.state === "error") {
			dotState = "is-error";
			label = `Error: ${status.error || "unknown"}`;
		} else if (
			blocked &&
			this.plugin.settings.apiUrl &&
			(this.plugin.settings.apiKey || this.plugin.settings.refreshToken)
		) {
			dotState = "is-waiting";
			label = "Connected — waiting for first sync decision";
		} else if (live) {
			dotState = "is-connected";
			label = "Connected — live sync active";
		} else if (
			this.plugin.settings.apiUrl &&
			(this.plugin.settings.apiKey || this.plugin.settings.refreshToken)
		) {
			dotState = "is-polling";
			label = "Connected — polling";
		} else {
			dotState = "is-idle";
			label = "Not configured";
		}

		statusEl.createSpan({ cls: `engram-status-dot ${dotState}` });
		statusEl.createSpan({ text: label });

		if (dotState === "is-waiting") {
			const openBtn = statusEl.createEl("button", {
				cls: "engram-status-open-sync-btn mod-cta",
				text: "Open sync setup",
			});
			openBtn.addEventListener("click", () => {
				void this.plugin.doSyncWithFirstSyncCheck();
			});
		}

		if (status.lastSync) {
			const date = new Date(status.lastSync);
			const timeEl = statusEl.createDiv({ cls: "engram-status-time" });
			timeEl.setText(`Last sync: ${date.toLocaleString()}`);
		}
	}

	hide(): void {
		this.plugin.onStatusBarChange = null;
		this.uninstallProgressBar();
		this.statusContainerEl = null;
		this.activeContainerEl = null;
	}
}
