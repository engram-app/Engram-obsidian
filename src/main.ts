/**
 * Engram Sync — Obsidian plugin for bidirectional note sync with Engram.
 *
 * Pushes vault changes to Engram for indexing/search.
 * Pulls MCP-created notes and changes from other devices.
 */
import { FileSystemAdapter, Notice, Platform, Plugin, TFile, TFolder, requestUrl } from "obsidian";
import { EngramApi } from "./api";
import {
	ApiKeyAuth,
	type AuthProvider,
	OAuthAuth,
	type RefreshFn,
	seededAccessToken,
} from "./auth";
import { migrateCloudApiUrl } from "./auth-state";
import { NoteChannel } from "./channel";
import { ConflictModal } from "./conflict-modal";
import { errMsg } from "./error-util";
import { LimitExceededError } from "./limit-error";
import { notifyLimitExceeded } from "./limit-toast";
import { parsePlanState } from "./plan-state";
import { SearchModal } from "./search-modal";
import { SEARCH_VIEW_TYPE, SearchView } from "./search-view";
import { EngramSyncSettingTab } from "./settings";
import { SyncEngine, reconcileColdStart } from "./sync";
import { SyncPreviewModal } from "./sync-preview-modal";
import { SyncProgressModal } from "./sync-progress-modal";
import { ENGRAM_CLOUD_URL } from "./tabs/urls";
import {
	DEFAULT_SETTINGS,
	type EngramSyncSettings,
	type FileSyncState,
	type SearchMode,
	type SyncPreviewContext,
	type SyncStatus,
} from "./types";

import { BaseStore } from "./base-store";
import { CrdtChannel } from "./crdt/channel";
import { CrdtEnrollment } from "./crdt/enrollment";
import { CrdtManager } from "./crdt/manager";
import { destroyDevLog, devLog, initDevLog } from "./dev-log";
import { ExplicitFolders } from "./explicit-folders";
import { destroyRemoteLog, initRemoteLog, rlog } from "./remote-log";
import { computeSyncFingerprint } from "./sync-fingerprint";
import { SyncLog } from "./sync-log";
import { SyncLogModal } from "./sync-log-modal";
import type { QueueEntry, SyncChoice, SyncIssue } from "./types";

/** Generate a stable client ID for vault registration.
 *  Uses SHA-256 of the vault's absolute path (desktop) or name (mobile fallback). */
async function generateClientId(app: import("obsidian").App): Promise<string> {
	const adapter = app.vault.adapter;
	const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
	const input = basePath || app.vault.getName();
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

interface PluginData {
	settings: EngramSyncSettings;
	lastSync: string;
	/** Per-install device id (random UUID). Sent as X-Device-Id on cursor pulls
	 *  so the backend tracks its sync watermark per device. Device-local; NOT a
	 *  user-facing setting. Distinct from settings.clientId (a path hash that
	 *  collides across devices). */
	deviceId?: string;
	offlineQueue?: QueueEntry[];
	/** Opaque cursor marking the durably-applied position in the backend's
	 *  ordered sync feed (PR B2 cursor pull). Separate from `lastSync`, which is
	 *  retained for rollback. Omitted when no cursor has been established yet. */
	syncCursor?: string;
	/** New unified sync state (hash + version per file). */
	syncState?: Record<string, FileSyncState>;
	/** The server vaultId that `syncState` was recorded under. Used to
	 *  auto-invalidate stale state when the active vault changes. */
	syncStateVaultId?: string | null;
	/** Legacy hash-only format. Kept for rollback safety (dual-write). */
	syncedHashes?: Record<string, number>;
	/** Persistent failures surfaced in the Sync Center "Issues" panel. */
	syncIssues?: SyncIssue[];
	/** User-explicit per-file ignores (Sync Center "Ignore" button). */
	ignoredFiles?: string[];
	/** Hash fingerprint of (apiKey/refreshToken + vaultId) that the user
	 *  has confirmed via SyncPreviewModal. When `null` or out-of-date,
	 *  the plugin closes the sync gate and shows the modal. */
	syncGateAcceptedFor?: string | null;
}

export default class EngramSyncPlugin extends Plugin {
	settings: EngramSyncSettings = DEFAULT_SETTINGS;
	api: EngramApi = new EngramApi("", "");
	/** Persist the user's chosen search mode as the new default. Passed to the
	 *  search view + modal so a mode switch in either surface sticks. */
	private persistSearchMode = (mode: SearchMode): void => {
		this.settings.searchDefaultMode = mode;
		void this.saveSettings();
	};
	authProvider: AuthProvider | null = null;
	syncEngine: SyncEngine = null!;
	syncLog: SyncLog = new SyncLog();
	/** Per-install device id sent as X-Device-Id so the backend attributes its
	 *  sync watermark per device. Random UUID minted on first load, persisted
	 *  top-level in PluginData (device-local; NOT a user-facing setting). A
	 *  reinstall/reset mints a new id → one clean re-bootstrap. */
	deviceId: string | null = null;
	private syncInterval: number | null = null;
	noteStream: NoteChannel | null = null;
	private statusBarEl: HTMLElement | null = null;
	private settingTab: EngramSyncSettingTab | null = null;
	private liveConnected = false;
	// Bumped every setupNoteStream(). connectChannel() captures it and aborts if
	// it changed before its async getMe() resolved — otherwise a re-auth (e.g.
	// OAuth swap) that calls setupNoteStream() again while a prior connect is
	// in flight would let the stale connect spawn a SECOND NoteChannel that was
	// never disconnected. That orphan reconnects forever with the old identity,
	// getting `unauthorized` join refusals and churning the socket — dropping
	// live broadcasts that land in the reconnect gaps (#646).
	private channelEpoch = 0;

	/** Fires whenever the status bar text/state changes — used by the settings
	 *  panel to keep its top status row in sync with sync engine + WebSocket
	 *  connection state without requiring tab navigation. Single-slot. */
	onStatusBarChange: (() => void) | null = null;

	/** Whether the WebSocket channel is currently connected (for settings UI). */
	isLiveConnected(): boolean {
		return this.liveConnected;
	}

	private baseStore: BaseStore | null = null;
	private explicitFolders: ExplicitFolders | null = null;
	private crdtManager: CrdtManager | null = null;
	private crdtChannel: CrdtChannel | null = null;
	private crdtEnrollment: CrdtEnrollment | null = null;

	/** Saved fingerprint from prior session — null on first load or after
	 *  auth/vault change. Compared against current fingerprint to decide
	 *  whether the sync gate should be open. */
	private syncGateAcceptedFor: string | null = null;

	async onload(): Promise<void> {
		initDevLog();
		devLog().log("lifecycle", "plugin loading");
		rlog().info("lifecycle", `onload start — v${this.manifest.version}`);
		activeDocument.body.classList.add("engram-vault-sync-active");
		await this.loadSettings();

		this.api = new EngramApi(this.settings.apiUrl, this.settings.apiKey);
		if (this.settings.vaultId) {
			this.api.setVaultId(this.settings.vaultId);
		}
		// Wire the per-install device id (minted in loadSettings) onto the real
		// api instance before any sync runs, so cursor pulls carry X-Device-Id.
		this.api.setDeviceId(this.deviceId);

		this.authProvider = this.createAuthProvider();
		if (this.authProvider) {
			this.api.setAuthProvider(this.authProvider);
		}

		// Remote logging for mobile debugging
		const remoteLogger = initRemoteLog();
		remoteLogger.configure(
			(entries) => this.api.pushLogs(entries),
			this.manifest.version,
			Platform.isMobile ? "mobile" : "desktop",
		);
		remoteLogger.setEnabled(this.settings.remoteLoggingEnabled);
		rlog().info(
			"lifecycle",
			`Plugin loading | v${this.manifest.version} | ${Platform.isMobile ? "mobile" : "desktop"}`,
		);

		this.syncEngine = new SyncEngine(this.app, this.api, this.settings, async (data) => {
			// Merge whichever of {lastSync, syncCursor} the engine handed us into
			// the in-memory engine state, then persist the WHOLE PluginData via
			// savePluginData (saveData overwrites data.json wholesale). Each field
			// the payload omits falls through to the engine's current value, so a
			// lastSync-only write never clobbers syncCursor and vice-versa.
			if (data.lastSync !== undefined) {
				this.syncEngine.setLastSync(data.lastSync);
			}
			if (data.syncCursor !== undefined) {
				// null clears the cursor (persisted as undefined/omitted).
				this.syncEngine.setSyncCursor(data.syncCursor);
			}
			await this.savePluginData(this.syncEngine.getLastSync());
		});

		this.syncLog = new SyncLog();
		this.syncEngine.syncLog = this.syncLog;

		// Base content store for 3-way merge (lazy-loaded after layout ready)
		const basesPath = `${this.manifest.dir}/sync-bases.json`;
		this.baseStore = new BaseStore(this.app.vault.adapter, basesPath);
		this.syncEngine.baseStore = this.baseStore;

		// Persisted explicit-folders set (server's kind='folder' markers).
		// Loaded alongside baseStore; consulted by removeEmptyFolders + the
		// vault folder-create/delete handlers.
		const explicitFoldersPath = `${this.manifest.dir}/explicit-folders.json`;
		this.explicitFolders = new ExplicitFolders(this.app.vault.adapter, explicitFoldersPath);
		this.syncEngine.explicitFolders = this.explicitFolders;

		this.syncEngine.onStatusChange = (status) => {
			this.updateStatusBar(status);
		};

		this.syncEngine.onConflict = async (info) => {
			const modal = new ConflictModal(this.app, info, this.settings, (mode) => {
				this.settings.conflictViewMode = mode;
				void this.saveSettings();
			});
			return modal.waitForChoice();
		};

		// Persist plan state to settings whenever the channel reports a new one.
		// MUST use savePluginData (a plain disk write), NOT saveSettings:
		// saveSettings() calls setupNoteStream(), which tears down and recreates
		// the WebSocket channel. Since plan state arrives FROM that channel's
		// message handler (onPlanState), saveSettings would destroy the channel
		// mid-message → reconnect → re-join user:* → plan arrives → repeat, a
		// reconnect loop that leaves the socket permanently "not connected".
		this.syncEngine.onPlanStatePersist = (p) => {
			this.settings.planState = p;
			void this.savePluginData(this.syncEngine.getLastSync());
		};

		// Wire up queue persistence
		this.syncEngine.queue.onPersist(async (entries) => {
			await this.savePluginData(this.syncEngine.getLastSync(), entries);
		});

		// Restore last sync timestamp, offline queue, and sync state
		const saved = (await this.loadData()) as Partial<PluginData> | null;
		if (saved?.lastSync) {
			this.syncEngine.setLastSync(saved.lastSync);
		}
		if (saved?.syncCursor) {
			this.syncEngine.setSyncCursor(saved.syncCursor);
		}
		if (saved?.offlineQueue?.length) {
			this.syncEngine.queue.load(saved.offlineQueue);
		}
		if (saved?.syncStateVaultId !== undefined) {
			this.syncEngine.setSyncStateVaultId(saved.syncStateVaultId);
		}
		if (saved?.syncState) {
			// New format — hash + version per file
			this.syncEngine.importSyncState(saved.syncState);
		} else if (saved?.syncedHashes) {
			// Legacy format — migrate hash-only data
			this.syncEngine.importHashes(saved.syncedHashes);
			devLog().log("lifecycle", "Migrated legacy syncedHashes → syncState");
		}
		this.syncEngine.issues.hydrate(saved?.syncIssues);
		this.syncEngine.ignoredFiles.hydrate(saved?.ignoredFiles);

		// Seed plan state from persisted settings WITHOUT re-syncing. A normal
		// reload is not an upgrade — hydratePlanState sets the field but skips the
		// capability-gain check so we don't spuriously re-push parked attachments
		// every launch.
		if (this.settings.planState) {
			this.syncEngine.hydratePlanState(this.settings.planState);
		}

		// Register settings tab
		this.settingTab = new EngramSyncSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Register vault events (create is registered in onLayoutReady to avoid
		// processing the startup burst — Obsidian fires 'create' for every existing
		// file when the vault loads)
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				this.syncEngine.handleModify(file);
			}),
		);

		// Task 7B: enroll each opened markdown note into the CRDT handshake so the
		// state-vector exchange fires and the note pulls remote history (down-sync).
		// `active-leaf-change` fires whenever the user switches tabs/panes — we
		// filter to the active file and enroll once per path per channel session.
		// The once-per-doc guard inside CrdtEnrollment and CrdtChannel ensures the
		// STEP1 handshake fires exactly once even if the same note is opened
		// repeatedly, and resets on channel reconnect for a fresh handshake.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				const file = this.app.workspace.getActiveFile();
				if (file instanceof TFile && file.extension === "md") {
					this.crdtEnrollment?.enroll(file.path);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFolder) {
					void this.syncEngine.handleFolderDelete(file);
				} else {
					void this.syncEngine.handleDelete(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				void this.syncEngine.handleRename(file, oldPath);
			}),
		);

		// Flush remote logs when app goes to background (mobile)
		this.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (activeDocument.visibilityState === "hidden") {
				void rlog().flush();
				void this.savePluginData(this.syncEngine.getLastSync());
				void this.baseStore?.save();
			}
		});

		// Add commands
		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: async () => {
				new Notice("Engram sync: syncing...");
				const { pulled, pushed } = await this.syncEngine.fullSync();
				new Notice(`Engram Sync: pulled ${pulled}, pushed ${pushed}`);
			},
		});

		this.addCommand({
			id: "push-all",
			name: "Push entire vault",
			callback: async () => {
				const count = await this.syncEngine.pushAll();
				new Notice(`Engram Sync: pushed ${count} files`);
			},
		});

		this.addCommand({
			id: "check-sync",
			name: "Check sync status",
			callback: async () => {
				new Notice("Engram sync: checking...");
				const result = await this.syncEngine.reconcile();
				if (!result) {
					new Notice(
						"Engram sync: server does not support reconciliation (update backend)",
					);
					return;
				}
				const { missing, diverged, extraOnServer } = result;
				if (missing.length === 0 && diverged.length === 0 && extraOnServer.length === 0) {
					new Notice("Engram sync: everything in sync");
				} else {
					const parts: string[] = [];
					if (missing.length > 0) parts.push(`${missing.length} missing on server`);
					if (diverged.length > 0) parts.push(`${diverged.length} diverged`);
					if (extraOnServer.length > 0)
						parts.push(`${extraOnServer.length} only on server`);
					new Notice(`Engram Sync: ${parts.join(", ")}`);
				}
			},
		});

		this.addCommand({
			id: "pull-all",
			name: "Pull all from server (force overwrite)",
			callback: async () => {
				new Notice("Engram sync: pulling all from server...");
				const count = await this.syncEngine.pullAll();
				new Notice(`Engram Sync: pulled ${count} files from server`);
			},
		});

		this.addCommand({
			id: "show-sync-log",
			name: "Show sync log",
			callback: () => {
				new SyncLogModal(this.app, this.syncLog).open();
			},
		});

		// Register search view
		this.registerView(
			SEARCH_VIEW_TYPE,
			(leaf) =>
				new SearchView(
					leaf,
					this.api,
					this.settings.searchDefaultMode,
					this.persistSearchMode,
				),
		);

		this.addCommand({
			id: "search",
			name: "Semantic search",
			callback: () => {
				new SearchModal(
					this.app,
					this.api,
					this.settings.searchDefaultMode,
					this.persistSearchMode,
				).open();
			},
		});

		this.addCommand({
			id: "open-search-sidebar",
			name: "Open search sidebar",
			callback: async () => {
				const existing = this.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE);
				if (existing[0]) {
					void this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				const leaf = this.app.workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({ type: SEARCH_VIEW_TYPE, active: true });
					void this.app.workspace.revealLeaf(leaf);
				}
			},
		});

		this.addRibbonIcon("brain-circuit", "Engram search", async () => {
			const existing = this.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE);
			if (existing[0]) {
				void this.app.workspace.revealLeaf(existing[0]);
				return;
			}
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: SEARCH_VIEW_TYPE, active: true });
				void this.app.workspace.revealLeaf(leaf);
			}
		});

		this.addCommand({
			id: "open-sync-center",
			name: "Open sync center",
			callback: () => {
				this.openSyncCenterSettings();
			},
		});

		// Start periodic sync if configured
		this.startSyncInterval();

		// Status bar (click to sync)
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.setText("Engram: ready");
		this.statusBarEl.addClass("engram-status-bar-clickable");

		this.registerDomEvent(this.statusBarEl, "click", () => {
			if (!this.hasAuthConfigured()) return;

			if (this.syncEngine.isSyncBlocked()) {
				// Gate is closed — open SyncPreviewModal so the user can pick
				// a direction. doSyncWithFirstSyncCheck handles plan compute,
				// modal open, and dispatch.
				void this.doSyncWithFirstSyncCheck();
				return;
			}

			new Notice("Engram sync: syncing...");
			this.syncEngine
				.fullSync()
				.then(({ pulled, pushed }) => {
					new Notice(`Engram Sync: pulled ${pulled}, pushed ${pushed}`);
				})
				.catch((e) => {
					if (e instanceof LimitExceededError) {
						notifyLimitExceeded(e);
						rlog().info(
							"lifecycle",
							`Manual sync blocked — limit reached (${e.reason})`,
						);
						return;
					}
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: manual sync failed", e);
					rlog().error(
						"lifecycle",
						`Manual sync failed: ${errMsg(e)}`,
						e instanceof Error ? e.stack : undefined,
					);
					new Notice("Engram sync: sync failed");
				});
		});

		// WebSocket live sync
		this.setupNoteStream();

		// Initial sync on startup (after workspace is ready)
		this.app.workspace.onLayoutReady(async () => {
			devLog().log("lifecycle", "layout ready — starting initial sync");
			rlog().info("lifecycle", "Layout ready — starting initial sync");

			// Register create handler here — vault.on('create') fires for every
			// existing file during vault load, so we wait until layout is ready
			// to avoid processing thousands of no-op events on startup.
			this.registerEvent(
				this.app.vault.on("create", (file) => {
					if (file instanceof TFolder) {
						void this.syncEngine.handleFolderCreate(file);
					} else {
						this.syncEngine.handleModify(file);
					}
				}),
			);

			await this.baseStore?.load();
			await this.explicitFolders?.load();

			let registered = false;
			let gateOpen = false;
			if (this.hasAuthConfigured()) {
				try {
					registered = await this.registerVault();
					if (registered) {
						gateOpen = await this.applySyncGate();
					} else {
						rlog().info("lifecycle", "Vault not registered — skipping initial sync");
					}
				} catch (e) {
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: startup setup failed", e);
					rlog().error("lifecycle", `Startup setup failed: ${errMsg(e)}`);
				}
			}

			// Engine setup is complete: baseStore loaded, vault registered (or
			// skipped), sync gate evaluated, listeners armed. Flip readiness
			// now so handlers can respond to vault events. The sync gate
			// (`syncBlocked`) independently controls whether handlers push;
			// readiness must not depend on a user-driven modal choice.
			this.syncEngine.setReady();

			// Task 7C: Cold-start reconcile — diff on-disk content into the CRDT
			// doc for any markdown file that changed while the app was closed
			// (external editor, another sync app, OS). Runs after readiness is
			// set so the resulting applyLocalEdit fires normally through the CRDT
			// route. Only runs when a CrdtManager is available (auth configured).
			if (this.crdtManager) {
				const markdownFiles = this.app.vault.getMarkdownFiles();
				for (const file of markdownFiles) {
					const crdt = this.crdtManager;
					this.app.vault
						.cachedRead(file)
						.then((diskContent) =>
							reconcileColdStart({ path: file.path, diskContent }, crdt, () => {
								rlog().warn(
									"crdt",
									`reconcileColdStart: Y.Doc corrupted for ${file.path} — falling back to disk content`,
								);
							}),
						)
						.catch((e) => {
							rlog().warn(
								"crdt",
								`reconcileColdStart: failed to read ${file.path}: ${errMsg(e)}`,
							);
						});
				}
			}

			if (!registered) return;

			if (gateOpen) {
				// User has already accepted a direction for this fingerprint —
				// run an incremental sync without showing the modal.
				try {
					const { pulled, pushed } = await this.syncEngine.fullSync();
					if (pulled > 0 || pushed > 0) {
						new Notice(`Engram Sync: pulled ${pulled}, pushed ${pushed}`);
					}
				} catch (e) {
					if (e instanceof LimitExceededError) {
						notifyLimitExceeded(e);
						rlog().info(
							"lifecycle",
							`Startup sync blocked — limit reached (${e.reason})`,
						);
						return;
					}
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: startup sync failed", e);
					rlog().error("lifecycle", `Startup sync failed: ${errMsg(e)}`);
				}
			} else {
				// Gate closed — show the preview modal so user picks a direction.
				await this.doSyncWithFirstSyncCheck();
			}
		});
	}

	onunload(): void {
		devLog().log("lifecycle", "plugin unloading");
		rlog().info("lifecycle", "Plugin unloading");
		activeDocument.body.classList.remove("engram-vault-sync-active");
		// Best-effort save before teardown — hashes must be exported before destroy
		void this.savePluginData(this.syncEngine.getLastSync());
		this.baseStore?.prune();
		void this.baseStore?.save();
		this.syncEngine?.destroy();
		this.noteStream?.disconnect();
		void this.crdtManager?.destroy();
		// CrdtChannel has no teardown — it is a stateless frame dispatcher with no
		// open resources; the WebSocket it dispatches over is owned by the Phoenix
		// channel and torn down via noteStream?.disconnect().
		if (this.syncInterval) {
			window.clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
		void destroyRemoteLog();
		destroyDevLog();
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
		this.syncGateAcceptedFor = data?.syncGateAcceptedFor ?? null;
		// Migrate a stored Cloud apiUrl off the legacy SPA host (app.engram.page,
		// which 405s API POSTs post-cutover) onto the canonical REST host. Same
		// backend + credentials — only the edge hostname moved, so auth is kept.
		// Mint/migrate everything in a single load/save round-trip so first load
		// writes data.json at most once (avoids redundant double-writes).
		let dirty = false;
		const migratedUrl = migrateCloudApiUrl(this.settings.apiUrl, ENGRAM_CLOUD_URL);
		if (migratedUrl && migratedUrl !== this.settings.apiUrl) {
			this.settings.apiUrl = migratedUrl;
			dirty = true;
		}
		// Generate stable client ID on first load (persisted forever)
		if (!this.settings.clientId) {
			this.settings.clientId = await generateClientId(this.app);
			dirty = true;
		}
		// Mint per-install device id on first load. Distinct from clientId (a
		// path hash that collides across devices); device id is a fresh random
		// UUID so the backend tracks its sync watermark per install.
		this.deviceId = data?.deviceId ?? null;
		if (!this.deviceId) {
			this.deviceId = crypto.randomUUID();
			dirty = true;
		}
		if (dirty) {
			await this.saveData({ ...data, settings: this.settings, deviceId: this.deviceId });
		}
		// NOTE: this.api is replaced with a configured instance in onload() right
		// after loadSettings() returns; the device id is wired there via
		// setDeviceId(this.deviceId), before any sync runs.
	}

	async saveSettings(): Promise<void> {
		this.api.updateConfig(this.settings.apiUrl, this.settings.apiKey);
		this.api.setVaultId(this.settings.vaultId);
		this.syncEngine.updateSettings(this.settings);
		rlog().setEnabled(this.settings.remoteLoggingEnabled);
		this.startSyncInterval();
		this.setupNoteStream();
		await this.savePluginData(this.syncEngine.getLastSync());

		// Re-evaluate sync gate against the new auth+vault. If the fingerprint
		// changed, this re-blocks the engine; the modal fire below will collect
		// the user's choice and unblock on acceptance.
		if (this.hasAuthConfigured()) {
			this.registerVault()
				.then(async (registered) => {
					if (!registered) return;
					const gateOpen = await this.applySyncGate();
					if (!gateOpen) {
						return this.doSyncWithFirstSyncCheck();
					}
					// Gate already open — run an incremental sync silently.
					try {
						const { pulled, pushed } = await this.syncEngine.fullSync();
						if (pulled > 0 || pushed > 0) {
							new Notice(`Engram Sync: pulled ${pulled}, pushed ${pushed}`);
						}
					} catch (e) {
						if (e instanceof LimitExceededError) {
							notifyLimitExceeded(e);
							rlog().info(
								"lifecycle",
								`Sync after settings change blocked — limit reached (${e.reason})`,
							);
							return;
						}
						// biome-ignore lint/suspicious/noConsole: error boundary
						console.error("Engram Sync: sync after settings change failed", e);
						rlog().error(
							"lifecycle",
							`Sync after settings change failed: ${errMsg(e)}`,
						);
					}
				})
				.catch((e) => {
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: sync after settings change failed", e);
					rlog().error("lifecycle", `Sync after settings change failed: ${errMsg(e)}`);
				});
		}
	}

	/** Register this vault with the backend. Must be called before sync starts.
	 *  Returns true if registration succeeded (or vault was already registered).
	 *  Returns false if the user hit their vault limit (402). */
	private async registerVault(): Promise<boolean> {
		if (this.settings.vaultId) {
			this.api.setVaultId(this.settings.vaultId);
			return true;
		}

		try {
			const result = await this.api.registerVault(
				this.app.vault.getName(),
				this.settings.clientId,
			);
			this.settings.vaultId = result.id;
			this.settings.remoteVaultName = result.name;
			this.api.setVaultId(this.settings.vaultId);
			await this.saveSettings();
			rlog().info("lifecycle", `Vault registered: id=${result.id} slug=${result.slug}`);
			return true;
		} catch (e: unknown) {
			if (e instanceof LimitExceededError) {
				notifyLimitExceeded(e);
				rlog().info(
					"lifecycle",
					`Vault registration blocked — limit reached (${e.reason})`,
				);
				return false;
			}
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: vault registration failed", e);
			rlog().error("lifecycle", `Vault registration failed: ${errMsg(e)}`);
			return false;
		}
	}

	private async savePluginData(lastSync: string, offlineQueue?: QueueEntry[]): Promise<void> {
		await this.saveData({
			settings: this.settings,
			lastSync,
			// Top-level, device-local; saveData() overwrites data.json wholesale,
			// so every field must be re-listed here or it's wiped on the next save.
			deviceId: this.deviceId ?? undefined,
			// Top-level cursor; like deviceId it must be re-listed here or the
			// next wholesale saveData() wipes it. null → omit (cursor cleared).
			syncCursor: this.syncEngine.getSyncCursor() ?? undefined,
			offlineQueue: offlineQueue ?? this.syncEngine.queue.all(),
			syncState: this.syncEngine.exportSyncState(),
			syncStateVaultId: this.syncEngine.getSyncStateVaultId(),
			// Dual-write legacy format for rollback safety (remove after one release cycle)
			syncedHashes: this.syncEngine.exportHashes(),
			syncIssues: this.syncEngine.issues.serialize(),
			ignoredFiles: this.syncEngine.ignoredFiles.serialize(),
			syncGateAcceptedFor: this.syncGateAcceptedFor,
		});
	}

	private createAuthProvider(): AuthProvider | null {
		if (this.settings.refreshToken) {
			const refreshFn: RefreshFn = async (token) => {
				const base = this.settings.apiUrl.replace(/\/+$/, "");
				const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
				const resp = await requestUrl({
					url: `${apiUrl}/auth/token/refresh`,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ refresh_token: token }),
					throw: false,
				});
				if (resp.status < 200 || resp.status >= 300) {
					throw new Error(`Refresh failed: ${resp.status}`);
				}
				return resp.json as {
					access_token: string;
					refresh_token: string;
					expires_in: number;
				};
			};
			// Only reuse a persisted access token if it was minted for the
			// active vault; otherwise it's a stale token from a prior account
			// and would 404 against this vault. Drop it and let getToken refresh.
			const seed = seededAccessToken(this.settings);
			if (this.settings.accessToken && !seed.token) {
				rlog().warn(
					"auth",
					`Discarding persisted access token — minted for vault ${this.settings.accessTokenVaultId ?? "unknown"}, active vault ${this.settings.vaultId ?? "none"}; will refresh`,
				);
			}
			return new OAuthAuth(
				this.settings.refreshToken,
				this.settings.vaultId,
				this.settings.userEmail ?? null,
				refreshFn,
				async ({ refreshToken, accessToken, expiresAt }) => {
					// Token rotation must NOT call saveSettings — that path
					// disconnects + reconnects the WebSocket, which triggers a
					// fresh refresh, which rotates again, which... loops forever.
					// Persist the new tokens in place and write to disk without
					// reconfiguring the api/channel.
					//
					// Await the save: OAuthAuth.doRefresh awaits this callback
					// before resolving the access token, so the rotated refresh
					// token is durable on disk before any further request — or
					// plugin update — can race against it. Without the await,
					// a BRAT update between rotation and flush left the disk
					// holding a server-invalidated token (forced re-login).
					//
					// Persisting the access token + expiry too lets a reload
					// within the access-token lifetime skip the refresh entirely,
					// so a restart/update no longer consumes the single-use
					// refresh token (the cause of the load-time 401 loop).
					this.settings.refreshToken = refreshToken;
					this.settings.accessToken = accessToken;
					this.settings.accessTokenExpiresAt = expiresAt;
					// Bind the cached token to the vault it was minted for, so a
					// later account swap can't resurrect a stale token.
					this.settings.accessTokenVaultId = this.settings.vaultId;
					rlog().info("auth", "Tokens rotated — persisting refresh + access");
					await this.savePluginData(this.syncEngine.getLastSync());
				},
				seed.token,
				seed.expiresAt,
			);
		}

		if (this.settings.apiKey) {
			return new ApiKeyAuth(this.settings.apiKey, this.settings.vaultId);
		}

		return null;
	}

	async saveOAuthTokens(refreshToken: string, vaultId: string, userEmail: string): Promise<void> {
		this.settings.refreshToken = refreshToken;
		this.settings.userEmail = userEmail;
		this.settings.authMethod = "oauth";
		this.settings.vaultId = vaultId;
		// Fresh login — discard any stale persisted access token so the next
		// request mints one against the new refresh token.
		this.settings.accessToken = undefined;
		this.settings.accessTokenExpiresAt = undefined;
		this.settings.accessTokenVaultId = undefined;
		await this.saveSettings();

		this.authProvider = this.createAuthProvider();
		if (this.authProvider) {
			this.api.setAuthProvider(this.authProvider);
			if (this.noteStream) {
				this.noteStream.setAuthProvider(this.authProvider);
			}
		}
	}

	async clearOAuthTokens(): Promise<void> {
		this.settings.refreshToken = undefined;
		this.settings.userEmail = undefined;
		this.settings.authMethod = null;
		this.settings.accessToken = undefined;
		this.settings.accessTokenExpiresAt = undefined;
		this.settings.accessTokenVaultId = undefined;
		await this.saveSettings();
		this.authProvider = this.settings.apiKey
			? new ApiKeyAuth(this.settings.apiKey, this.settings.vaultId)
			: null;
		if (this.authProvider) {
			this.api.setAuthProvider(this.authProvider);
		}
	}

	setupNoteStream(): void {
		// Tear down any existing CRDT instances before disconnecting the channel.
		// Without this, repeated calls (settings save / reconnect) leak Y.Doc and
		// IndexeddbPersistence listeners — each overwrites the references but the
		// old objects stay alive with their observers still firing.
		void this.crdtManager?.destroy();
		this.crdtManager = null;
		this.crdtChannel = null;
		this.crdtEnrollment?.resetAll();
		this.crdtEnrollment = null;

		// Disconnect existing channel + invalidate any in-flight connectChannel()
		// (its async getMe() may still be pending) so it can't spawn a zombie.
		this.noteStream?.disconnect();
		this.noteStream = null;
		this.channelEpoch++;

		const hasAuth = this.settings.apiKey || this.settings.refreshToken;
		if (!this.settings.apiUrl || !hasAuth) {
			this.liveConnected = false;
			this.updateStatusBar(this.syncEngine.getStatus());
			return;
		}

		this.connectChannel();
	}

	/** Attempt to connect the WebSocket channel with retry on getMe() failure. */
	private connectChannel(attempt = 0, epoch = this.channelEpoch): void {
		const maxAttempts = 5;
		const baseDelay = 2000;

		rlog().info(
			"channel",
			`connectChannel(attempt=${attempt}) — apiKeyLen=${this.settings.apiKey?.length ?? 0} refreshTokenLen=${this.settings.refreshToken?.length ?? 0} hasAuthProvider=${this.authProvider !== null} authProviderType=${this.authProvider?.constructor.name ?? "none"} vaultId=${this.settings.vaultId ?? "null"}`,
		);

		this.api
			.getMe()
			.then((user) => {
				// A newer setupNoteStream() superseded this connect while getMe()
				// was in flight — abort so we don't create an orphan channel.
				if (epoch !== this.channelEpoch) {
					rlog().info("channel", "connectChannel aborted — superseded by newer setup");
					return;
				}
				const channel = new NoteChannel(
					this.settings.apiUrl,
					this.settings.apiKey,
					user.id,
					this.settings.vaultId,
					this.settings.enableCrdt,
				);

				channel.onEvent = (event) => {
					void this.syncEngine.handleStreamEvent(event);
				};

				channel.onStatusChange = (connected) => {
					this.liveConnected = connected;
					this.updateStatusBar(this.syncEngine.getStatus());
					// Catch-up pull on reconnect to cover missed events during disconnect
					if (connected) {
						// Reset all CRDT enrollments so a fresh startSync STEP1
						// handshake fires for each open note after reconnect.
						this.crdtEnrollment?.resetAll();
						this.syncEngine.pull().catch((e) => {
							// biome-ignore lint/suspicious/noConsole: error boundary
							console.error("Engram Sync: catch-up pull failed", e);
							rlog().error(
								"channel",
								`Catch-up pull on reconnect failed: ${errMsg(e)}`,
							);
						});
					} else {
						// On disconnect the crdt: topic is also gone. Clear the CRDT
						// manager from the SyncEngine so markdown saves fall back to
						// the legacy pushNote path until the crdt: topic re-joins on
						// the next connection. This is the graceful-degradation gate:
						// non-CRDT backends never fire onCrdtJoined and therefore never
						// set the manager, but we also reset here defensively in case
						// the channel drops mid-session.
						this.syncEngine.setCrdtManager(null);
						rlog().info(
							"crdt",
							"Disconnected — CRDT routing cleared, legacy path active",
						);
					}
				};

				channel.onVaultDeleted = () => {
					new Notice("Engram: This vault has been deleted on the server.");
					rlog().info("lifecycle", "Vault deleted on server — clearing vaultId");
					this.settings.vaultId = null;
					this.api.setVaultId(null);
					// Use savePluginData instead of saveSettings to avoid triggering re-registration
					void this.savePluginData(this.syncEngine.getLastSync());
					this.noteStream?.disconnect();
				};

				channel.onPlanState = (raw) => {
					const parsed = parsePlanState(raw, Date.now());
					// Defer off the channel's synchronous message-handler tick:
					// applyPlanState can persist + re-sync, and must never run
					// re-entrantly inside the WebSocket onmessage that delivered it.
					if (parsed) queueMicrotask(() => this.syncEngine.applyPlanState(parsed));
				};

				this.noteStream = channel;
				if (this.authProvider) {
					this.noteStream.setAuthProvider(this.authProvider);
				}

				// Wire CRDT transport through this channel.
				// Only wire when vaultId is known: the crdt: topic is keyed by
				// vaultId and the doc_id = "{vaultId}/{path}" must match the
				// backend's path_hmac resolution. Without a vaultId the crdt:
				// topic join is silently a no-op, CRDT updates go nowhere, AND
				// the legacy pushNote path is suppressed — so this.crdt must stay
				// null to let the legacy path continue working.
				//
				// Graceful degradation: the CrdtManager and CrdtChannel are wired
				// eagerly (so they're ready to handle frames), but `setCrdtManager`
				// is deferred to `channel.onCrdtJoined` — only called once the
				// server acknowledges the `crdt:` topic join. Against a non-CRDT
				// backend the join errors out, onCrdtJoined never fires, and the
				// SyncEngine's `this.crdt` stays null → legacy pushNote path active.
				if (this.settings.enableCrdt && this.settings.vaultId) {
					const dbPrefix = this.settings.vaultId;
					this.crdtManager = new CrdtManager({
						dbPrefix,
						onUpdate: (docId, update) => this.crdtChannel?.sendUpdateRaw(docId, update),
						onFlushToDisk: (path, content) =>
							this.syncEngine.flushFromCrdt(path, content),
						onPersistError: (path, err) => {
							rlog().warn(
								"crdt",
								`IndexedDB persist error for ${path} — sync continues in-memory: ${errMsg(err)}`,
							);
						},
					});
					this.crdtChannel = new CrdtChannel({
						manager: this.crdtManager,
						send: (docId, frame) => channel.sendCrdt(docId, frame),
					});
					// Enrollment tracker: calls startSync(path) exactly once per note
					// per channel session so the state-vector handshake fires and the
					// note pulls remote CRDT state (the down-sync gap). Reset on
					// reconnect so a fresh handshake fires with updated server state.
					this.crdtEnrollment = new CrdtEnrollment({
						startSync: (path) => this.crdtChannel?.startSync(path) ?? Promise.resolve(),
						resetSync: (path) => this.crdtChannel?.resetSync(path),
						// After the handshake fires, compact any bloated docs. This is a
						// no-op below the AND threshold (≥500 KB and ≥1000 client-IDs),
						// so it is safe to run on every note open.
						onAfterEnroll: async (path) => {
							await this.crdtManager?.flattenIfBloated(path);
						},
					});
					// Level-triggered discovery: a pull that surfaces a CRDT-managed
					// note we don't have locally enrolls it (sync-step-1), so the body
					// arrives over the handshake. Backstops the edge-triggered
					// crdt_doc_ready announce for a device that was offline / not yet
					// subscribed when the other device opened the room.
					this.syncEngine.setCrdtEnrollment(this.crdtEnrollment);
					channel.onCrdtMessage = (docId, b64) => {
						const prefix = `${dbPrefix}/`;
						const path = docId.startsWith(prefix) ? docId.slice(prefix.length) : docId;
						void this.crdtChannel?.handleFrame(path, b64);
					};
					// Discovery: when another device opens a room (server announces
					// `crdt_doc_ready`), enroll the note here so a sync-step-1 fires and
					// we pull the note even if we've never opened it. Without this a
					// brand-new note created on device A is never observed on device B
					// (B only observes rooms it itself sends a `crdt_msg` for), and the
					// C1 guard suppresses the legacy note_changed discovery path.
					channel.onCrdtDocReady = (docId) => {
						const prefix = `${dbPrefix}/`;
						const path = docId.startsWith(prefix) ? docId.slice(prefix.length) : docId;
						this.crdtEnrollment?.enroll(path);
					};
					// Deferred activation: only engage CRDT routing in the SyncEngine
					// after the server confirms the crdt: topic join. Against a non-CRDT
					// backend this never fires and setCrdtManager stays null → every
					// markdown save uses the legacy pushNote path (graceful degradation).
					channel.onCrdtJoined = () => {
						rlog().info(
							"crdt",
							"crdt: topic joined — activating CRDT routing in SyncEngine",
						);
						this.syncEngine.setCrdtManager(this.crdtManager);
					};
				} else {
					rlog().info(
						"crdt",
						this.settings.enableCrdt
							? "vaultId is null — CRDT disabled; legacy pushNote path active"
							: "CRDT opt-in disabled — legacy pushNote path active",
					);
				}

				void channel.connect();
			})
			.catch((e) => {
				// biome-ignore lint/suspicious/noConsole: error boundary
				console.error("Engram Sync: failed to fetch user id for channel", e);
				rlog().error(
					"channel",
					`getMe() failed (attempt ${attempt + 1}/${maxAttempts}): ${errMsg(e)}`,
				);

				if (attempt < maxAttempts - 1 && epoch === this.channelEpoch) {
					const delay = baseDelay * 2 ** attempt;
					window.setTimeout(() => this.connectChannel(attempt + 1, epoch), delay);
				}
			});
	}

	/** Dispatch a user's SyncChoice to the appropriate engine method.
	 *  Returns true if a sync ran (regardless of success); false if the choice
	 *  was a no-op (`cancel`, `change-vault`). Caller is responsible for the
	 *  side effects of `change-vault` (clearing vaultId + reopening the picker). */
	async runSyncFromChoice(choice: SyncChoice): Promise<boolean> {
		switch (choice) {
			case "cancel":
			case "change-vault": // change-vault side effects are the caller's responsibility
				return false;

			case "smart-merge": {
				await this.markSyncGateAccepted();
				const { pulled, pushed } = await this.syncEngine.fullSync();
				new Notice(`Engram Sync: pulled ${pulled}, pushed ${pushed}`);
				return true;
			}

			case "pull-all-delete-local": {
				await this.markSyncGateAccepted();
				const pulled = await this.syncEngine.pullAll({ deleteLocalExtras: true });
				new Notice(`Engram Sync: pulled ${pulled} (local extras deleted)`);
				return true;
			}

			case "pull-all-keep-local": {
				await this.markSyncGateAccepted();
				const pulled = await this.syncEngine.pullAll({ deleteLocalExtras: false });
				new Notice(`Engram Sync: pulled ${pulled}`);
				return true;
			}

			case "push-all-delete-remote": {
				await this.markSyncGateAccepted();
				const pushed = await this.syncEngine.pushAll({ deleteRemoteExtras: true });
				new Notice(`Engram Sync: pushed ${pushed} (remote extras deleted)`);
				return true;
			}

			case "push-all-keep-remote": {
				await this.markSyncGateAccepted();
				const pushed = await this.syncEngine.pushAll({ deleteRemoteExtras: false });
				new Notice(`Engram Sync: pushed ${pushed}`);
				return true;
			}
		}
	}

	/** Run a sync choice with a live progress modal. Opens SyncProgressModal
	 *  immediately so feedback ("Preparing…") shows the instant the preview
	 *  closes — no dead gap — then streams engine progress into it and restores
	 *  the prior progress callback when the sync settles. The modal's "Run in
	 *  background" closes it while the sync keeps running. No-op choices
	 *  (cancel / change-vault) skip the modal entirely. */
	async runSyncWithProgress(choice: SyncChoice): Promise<boolean> {
		if (choice === "cancel" || choice === "change-vault") {
			return this.runSyncFromChoice(choice);
		}
		const modal = new SyncProgressModal(this.app);
		const prev = this.syncEngine.onSyncProgress;
		this.syncEngine.onSyncProgress = (progress) => {
			modal.update(progress);
			prev?.(progress);
		};
		modal.open();
		try {
			return await this.runSyncFromChoice(choice);
		} catch (e) {
			// Don't leave the modal stuck on "Preparing…" — close it so the
			// caller's error Notice is the visible signal.
			modal.close();
			throw e;
		} finally {
			this.syncEngine.onSyncProgress = prev;
		}
	}

	/** True when both `apiUrl` and at least one of `apiKey` (self-hosted /
	 *  static key) or `refreshToken` (OAuth device flow) are set. Used to gate
	 *  startup sync, post-saveSettings sync, the status-bar click handler, and
	 *  the periodic sync interval — all of which need to fire for OAuth users
	 *  too, not just static-key users. */
	private hasAuthConfigured(): boolean {
		return (
			Boolean(this.settings.apiUrl) &&
			Boolean(this.settings.apiKey || this.settings.refreshToken)
		);
	}

	/** Re-evaluate the sync gate against the current auth+vault fingerprint.
	 *  Sets engine.syncBlocked accordingly. Returns true if the gate is open
	 *  (sync allowed), false if blocked. Idempotent — safe to call repeatedly. */
	async applySyncGate(): Promise<boolean> {
		const fp = await computeSyncFingerprint(this.settings);
		const accepted = fp !== "" && fp === this.syncGateAcceptedFor;
		this.syncEngine.setSyncBlocked(!accepted);
		this.updateStatusBar(this.syncEngine.getStatus());
		return accepted;
	}

	/** Mark the current fingerprint as accepted (called after the user picks
	 *  a real sync direction in the modal). Persists the fingerprint and
	 *  unblocks the engine. */
	async markSyncGateAccepted(): Promise<void> {
		const fp = await computeSyncFingerprint(this.settings);
		if (fp === "") {
			rlog().warn(
				"lifecycle",
				"markSyncGateAccepted called with empty fingerprint — auth or vault not configured",
			);
			return;
		}
		this.syncGateAcceptedFor = fp;
		this.syncEngine.setSyncBlocked(false);
		await this.savePluginData(this.syncEngine.getLastSync());
		this.updateStatusBar(this.syncEngine.getStatus());
	}

	/** Decide which header copy the SyncPreviewModal should use based on the
	 *  saved gate fingerprint. Never accepted before = first-time onboarding;
	 *  accepted but for a different fingerprint = vault/account switched;
	 *  otherwise the user is re-reviewing. */
	private derivePreviewContext(): SyncPreviewContext {
		if (this.syncGateAcceptedFor == null) return "first-time";
		return "vault-switch";
	}

	/** Compute a sync plan and show SyncPreviewModal. Used after every
	 *  saveSettings once auth + vault are configured. First-sync is just
	 *  one case of the preview UX. */
	async doSyncWithFirstSyncCheck(opts: { startInVaultPicker?: boolean } = {}): Promise<void> {
		try {
			const plan = await this.syncEngine.computeSyncPlan("full");
			const context = this.derivePreviewContext();
			const modal = new SyncPreviewModal(this.app, plan, {
				remoteVaultName: this.settings.remoteVaultName,
				showChangeVault: true,
				context,
				initialView: opts.startInVaultPicker ? "vault-picker" : "preview",
				attachmentsTextOnly: this.syncEngine.getPlanState()?.attachmentsTextOnly ?? false,
				listVaults: () => this.api.listVaults(),
				createVault: (name) => this.api.createVault(name),
				applyVaultChange: async (id, name) => {
					// Persist the new vault target without going through
					// saveSettings — that path would re-fire
					// doSyncWithFirstSyncCheck for the closed gate and stack
					// a second modal on top of this one.
					this.settings.vaultId = id;
					this.settings.remoteVaultName = name;
					this.api.setVaultId(id);
					this.syncEngine.updateSettings(this.settings);
					// Last sync and per-file hashes are scoped to the previous
					// server vault. Without this reset, fullSync compares
					// local mtime to a stale lastSync and pushes nothing —
					// even when the new vault is empty.
					await this.syncEngine.resetForVaultChange();
					this.syncGateAcceptedFor = null;
					this.syncEngine.setSyncBlocked(true);
					await this.savePluginData(this.syncEngine.getLastSync());
					// Re-render the settings tab so the vault name span and
					// any other vault-derived UI pick up the switch.
					this.settingTab?.display();
					return this.syncEngine.computeSyncPlan("full");
				},
			});
			const choice = await modal.awaitChoice();

			await this.runSyncWithProgress(choice);
		} catch (e) {
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: sync preview failed", e);
			new Notice("Engram sync: preview failed — check connection");
			rlog().error("lifecycle", `Sync preview failed: ${errMsg(e)}`);
		}
	}

	/** Persist current sync engine state (issues, ignored files, etc.) to plugin
	 *  data. Public so Sync Center button handlers can save without owning a
	 *  reference to the private savePluginData method. */
	async persistEngineState(): Promise<void> {
		await this.savePluginData(this.syncEngine.getLastSync());
	}

	/** Open the plugin settings on the Sync Center tab. */
	openSyncCenterSettings(): void {
		this.settingTab?.setInitialTab("sync-center");
		const setting = (
			this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }
		).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	/** Update status bar text and tooltip based on sync state + WebSocket connection. */
	private updateStatusBar(status: SyncStatus): void {
		if (!this.statusBarEl) return;

		const blocked = this.syncEngine?.isSyncBlocked() ?? false;

		let text: string;
		let tooltip: string;

		if (blocked && status.state !== "syncing") {
			// Sync gate closed — user has not picked a direction in SyncPreviewModal
			// for the current auth+vault fingerprint. Show a click-to-resolve nag.
			text =
				status.pending > 0
					? `Engram: sync paused (${status.pending} queued)`
					: "Engram: sync paused";
			tooltip = "Sync paused — click to choose a sync direction";
		} else if (status.state === "offline") {
			text =
				status.queued > 0 ? `Engram: offline (${status.queued} queued)` : "Engram: offline";
			tooltip = "Server unreachable — changes will sync when connected";
		} else if (status.state === "error") {
			text = "Engram: error";
			tooltip = status.error || "Unknown error";
		} else if (status.state === "syncing") {
			text = status.pending > 0 ? `Engram: syncing (${status.pending})` : "Engram: syncing";
			tooltip = "Sync in progress...";
		} else if (status.pending > 0) {
			text = `Engram: pending (${status.pending})`;
			tooltip = `${status.pending} file(s) queued`;
		} else if (this.liveConnected) {
			text = "Engram: live";
			tooltip = "WebSocket connected — live sync active";
		} else {
			text = "Engram: ready";
			tooltip = "Click to sync";
		}

		const errorCount = this.syncLog?.errorCount() ?? 0;
		if (errorCount > 0 && status.state === "idle" && !blocked) {
			text = `Engram: ⚠ ${errorCount} sync errors`;
		}

		if (status.lastSync) {
			const date = new Date(status.lastSync);
			tooltip += `\nLast sync: ${date.toLocaleString()}`;
		}

		this.statusBarEl.setText(text);
		this.statusBarEl.setAttribute("aria-label", tooltip);

		this.onStatusBarChange?.();
	}

	private static readonly FALLBACK_POLL_MS = 5 * 60 * 1000;

	private startSyncInterval(): void {
		if (this.syncInterval) {
			window.clearInterval(this.syncInterval);
			this.syncInterval = null;
		}

		if (!this.hasAuthConfigured()) return;

		this.syncInterval = window.setInterval(() => {
			void (async () => {
				try {
					const pulled = await this.syncEngine.pull();
					if (pulled > 0) {
						new Notice(`Engram Sync: pulled ${pulled} changes`);
					}
				} catch (e) {
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: periodic pull failed", e);
				}
			})();
		}, EngramSyncPlugin.FALLBACK_POLL_MS);
		this.registerInterval(this.syncInterval);
	}
}
