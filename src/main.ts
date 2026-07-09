/**
 * Engram Sync — Obsidian plugin for bidirectional note sync with Engram.
 *
 * Pushes vault changes to Engram for indexing/search.
 * Pulls MCP-created notes and changes from other devices.
 */
import {
	FileSystemAdapter,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TFile,
	TFolder,
	normalizePath,
	requestUrl,
} from "obsidian";
import { EngramApi } from "./api";
import {
	ApiKeyAuth,
	type AuthProvider,
	OAuthAuth,
	type RefreshFn,
	seededAccessToken,
} from "./auth";
import { migrateCloudApiUrl, withClearedAuth } from "./auth-state";
import { NoteChannel } from "./channel";
import { ConflictModal } from "./conflict-modal";
import { errMsg } from "./error-util";
import { LimitExceededError } from "./limit-error";
import { notifyLimitExceeded } from "./limit-toast";
import { parsePlanState } from "./plan-state";
import { SearchModal } from "./search-modal";
import { SEARCH_VIEW_TYPE, SearchView } from "./search-view";
import { EngramSyncSettingTab } from "./settings";
import { migrateDiagnosticsEnabled } from "./settings-migrate";
import { createSingleFlight } from "./single-flight";
import { SyncEngine } from "./sync";
import { SyncPreviewModal } from "./sync-preview-modal";
import { SyncProgressModal, describePlannedWork, plannedPhases } from "./sync-progress-modal";
import { ENGRAM_CLOUD_URL, engramWebUrl } from "./tabs/urls";
import {
	DEFAULT_SETTINGS,
	type EngramSyncSettings,
	type FileSyncState,
	type SearchMode,
	type SyncPreviewContext,
	type SyncStatus,
} from "./types";

import { BaseStore } from "./base-store";
import type { CrdtEnrollment } from "./crdt/enrollment";
import { CrdtLiveViews } from "./crdt/live/live-views";
import { ycollabExtension } from "./crdt/live/ycollab-binding";
import type { CrdtManager } from "./crdt/manager";
import { NoteIdMap } from "./crdt/note-id-map";
import { ensureDocSchema } from "./crdt/schema";
import { type CrdtWiring, createCrdtWiring } from "./crdt/wiring";
import { destroyDevLog, devLog, initDevLog } from "./dev-log";
import { registerDiagnostics } from "./diagnostics";
import { EmailCaptureModal } from "./email-capture-modal";
import { ExplicitFolders } from "./explicit-folders";
import { atomicWriteJson, resilientReadJson } from "./plugin-data-io";
import { destroyRemoteLog, initRemoteLog, rlog } from "./remote-log";
import { channelConnectionKey, computeSyncFingerprint } from "./sync-fingerprint";
import { SyncLog } from "./sync-log";
import { SyncLogModal } from "./sync-log-modal";
import type { QueueEntry, SyncChoice, SyncIssue, SyncPlan } from "./types";
import { shouldShowWaitlistPrompt } from "./waitlist";

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
	/** Path -> note_id sidecar (NoteIdMap.toJSON()). See src/crdt/note-id-map.ts. */
	noteIds?: Record<string, string>;
}

/** Whether setupNoteStream() may keep the existing stream instead of
 *  rebuilding it. The short-circuit exists to protect a HEALTHY socket from
 *  unrelated saveSettings() churn (#169) — so beyond the connection-identity
 *  key match it must require the stream to have CONNECTED at least once
 *  (sync: topic joined). A stream that exists but NEVER connected can be a
 *  doomed channel built mid-auth-swap (new settings, old authProvider →
 *  old-user + new-vault join the server refuses with no retry, e2e test_48
 *  run 28919928915); reusing it strands the plugin until the next full setup.
 *
 *  `everConnected` (final review IMPORTANT-3), not "currently connected": the
 *  caller must pass a flag that stays true across a transient disconnect, not
 *  the raw live-status flag, which flips false on every blip. Gating reuse on
 *  raw current-connectedness tore down the entire CRDT stack on any
 *  saveSettings() during a blip (the #169 churn + live-doc clobber family) —
 *  the doomed channel this guard exists to catch NEVER connected at all, so
 *  a sticky "connected at least once this stream" flag still catches it
 *  (everConnected=false) while surviving a healthy stream's later blips
 *  (everConnected stays true). Exported standalone (pure) so the decision is
 *  unit-testable without a plugin instance. */
export function shouldReuseLiveStream(
	hasStream: boolean,
	everConnected: boolean,
	connectionKey: string,
	liveChannelKey: string | null,
): boolean {
	return hasStream && everConnected && connectionKey === liveChannelKey;
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
	/** Path -> note_id sidecar, hydrated from data.json on load. Used by later
	 *  tasks to mint ids for new notes, learn ids from pull responses, and key
	 *  the CRDT manager by note_id instead of path. */
	noteIdMap: NoteIdMap = new NoteIdMap();
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
	/** Sticky per-stream "has this channel EVER connected" flag (final review
	 *  IMPORTANT-3). Set true on the first onStatusChange(true) after a stream
	 *  is created; unlike liveConnected it does NOT flip false on a transient
	 *  disconnect — only when a genuinely NEW stream is about to be built
	 *  (setupNoteStream teardown, or auth fully cleared). setupNoteStream()
	 *  gates reuse on this instead of liveConnected so a saveSettings() during
	 *  a mid-blip disconnect doesn't tear down a healthy CRDT stack. */
	private everConnected = false;
	// Bumped every setupNoteStream(). connectChannel() captures it and aborts if
	// it changed before its async getMe() resolved — otherwise a re-auth (e.g.
	// OAuth swap) that calls setupNoteStream() again while a prior connect is
	// in flight would let the stale connect spawn a SECOND NoteChannel that was
	// never disconnected. That orphan reconnects forever with the old identity,
	// getting `unauthorized` join refusals and churning the socket — dropping
	// live broadcasts that land in the reconnect gaps (#646).
	private channelEpoch = 0;

	/** channelConnectionKey() of the currently-live note stream, or null when no
	 *  stream is up. setupNoteStream() short-circuits when a live stream already
	 *  matches this key, so an unrelated saveSettings() (search-mode toggle, UI
	 *  pref, refresh-token rotation) no longer tears down a healthy socket + CRDT
	 *  stack. That churn was starving CRDT delivery (empty-flush clobber under a
	 *  reconnect that raced note reconciliation). */
	private liveChannelKey: string | null = null;

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
	private crdtEnrollment: CrdtEnrollment | null = null;
	/** CRDT data-plane glue (manager/channel/enrollment + id->path callbacks +
	 *  strand-heal), extracted from the inline setupNoteStream block. Rebuilt on
	 *  each channel setup; disposed on teardown/unload to clear its heal timer. */
	private crdtWiring: CrdtWiring | null = null;
	/** True once onCrdtJoined has fired for the current channel session.
	 *  Allows the disconnect handler to KEEP CRDT routing active while offline
	 *  (Y.Doc + IndexedDB capture edits locally; reconnect handshake delivers
	 *  them). Reset to false in setupNoteStream() so a genuine backend/vault
	 *  switch degrades back to legacy until the new server confirms crdt: join. */
	private crdtEverJoined = false;
	/** Guards the "plugin needs update" Notice from firing more than once per
	 *  session. A crdt_proto_too_old rejoin error can fire on every reconnect;
	 *  showing repeated toasts would be noisy. */
	private crdtProtoTooOldNoticeShown = false;
	private crdtLiveViews: CrdtLiveViews | null = null;

	/** Saved fingerprint from prior session — null on first load or after
	 *  auth/vault change. Compared against current fingerprint to decide
	 *  whether the sync gate should be open. */
	private syncGateAcceptedFor: string | null = null;

	/** Whether the noteIdMap has been reconciled from the server manifest this
	 *  session. The reconcile repairs a stale/empty map (drift is a one-time
	 *  startup/migration event), so it runs ONCE on the first successful connect,
	 *  not on every reconnect — re-fetching the manifest on each network blip adds
	 *  load and perturbs in-flight sync timing. Reset on vault change. */
	private crdtMapReconciled = false;

	/** Single-flight guard so a vault switch (or any racing trigger) cannot
	 *  stack two SyncPreviewModal instances. A second call while one preview is
	 *  open is a silent no-op. See single-flight.ts. */
	private readonly syncPreviewGuard = createSingleFlight();

	async onload(): Promise<void> {
		initDevLog();
		devLog().log("lifecycle", "plugin loading");
		rlog().info("lifecycle", `onload start — v${this.manifest.version}`);
		activeDocument.body.classList.add("engram-vault-sync-active");
		await this.loadSettings();

		// First-run waitlist popup. Engram is in active development; this sets
		// honest expectations and captures an email for launch news. Shown once
		// (submit OR dismiss → flag), then never again. onLayoutReady so the
		// workspace exists before we open a modal. saveSettings persists the
		// flag; on a first run with no auth it has no sync side effects.
		if (shouldShowWaitlistPrompt(this.settings)) {
			this.app.workspace.onLayoutReady(() => {
				new EmailCaptureModal(this.app, () => {
					this.settings.waitlistPromptSeen = true;
					void this.saveSettings();
				}).open();
			});
		}

		this.api = new EngramApi(this.settings.apiUrl, this.settings.apiKey);
		if (this.settings.vaultId) {
			this.api.setVaultId(this.settings.vaultId);
		}
		// Wire the per-install device id (minted in loadSettings) onto the real
		// api instance before any sync runs, so cursor pulls carry X-Device-Id.
		this.api.setDeviceId(this.deviceId);
		this.api.setTracingEnabled(this.settings.diagnosticsEnabled);

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
		remoteLogger.setEnabled(this.settings.diagnosticsEnabled);
		remoteLogger.setClientContext(this.deviceId, this.settings.vaultId);
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

		// Level-triggered CRDT-liveness check for the push path. setCrdtManager is
		// edge-triggered (set on crdt: join, cleared on disconnect) and can go stale
		// — set, but the channel dead-but-set after an auth swap. Reading the live
		// join state at push time lets pushFile fall back to REST instead of
		// dropping the update into a channel the server no longer routes (#915).
		// Reads this.noteStream at call time, so it always reflects the current
		// channel; null stream → not live → REST.
		this.syncEngine.setCrdtLiveCheck(() => this.noteStream?.isCrdtConnected() ?? false);

		// Path -> note_id sidecar (Task 4/5 of the note_id-keyed CRDT rework).
		// this.noteIdMap is already loaded from data.json by loadSettings() above
		// (called before onload reaches this point), so this wiring sees the
		// persisted map, not an empty one.
		this.syncEngine.setNoteIdMap(this.noteIdMap);

		// Own device id (minted in loadSettings, sent as X-Device-Id by the API
		// client) — lets the engine drop server fanout echoes of its own REST
		// deletes (#970).
		this.syncEngine.setDeviceId(this.deviceId);

		// wipeRemote destroys Y.Docs for files that stay open on disk — detach
		// all live editor bindings first so none spans the teardown. Rebind
		// happens via the existing file-open/leaf/layout refresh events.
		this.syncEngine.setCrdtEditorDetach(() => this.crdtLiveViews?.detachAll());

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
		const saved = await this.loadPluginData();
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
		// Enrollment is skipped while the sync gate is closed: the handshake would
		// pull remote content before the user has chosen a direction, which could
		// overwrite local files after a vault switch. After the gate opens,
		// markSyncGateAccepted calls crdtEnrollment.resetAll() so gated-away
		// STEP1s re-fire and remote state re-flushes.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.syncEngine.isSyncBlocked()) return;
				const file = this.app.workspace.getActiveFile();
				if (file instanceof TFile && file.extension === "md") {
					// Resolve-or-mint: opening a brand-new never-synced note has no
					// note_id yet, and enroll (Task 6) is keyed by id, not path.
					// Minting here (same NoteIdMap instance pushFile mints into)
					// keeps behavior identical to the old path-keyed enroll — the
					// note gets a live handshake immediately on open rather than
					// waiting for the next tab-switch after its first save.
					this.crdtEnrollment?.enroll(this.noteIdMap.getOrMint(file.path));
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
				// Task 6: no CrdtManager.renameDoc call — the CRDT doc is keyed by
				// the note's stable note_id (SyncEngine.handleRename already moved
				// that mapping via noteIdMap.rename), so a rename never touches the
				// doc/IndexedDB entry at all. Closing/reopening it here would
				// destroy the live history the id-keying was built to preserve.
				this.crdtLiveViews?.refresh();
			}),
		);

		registerDiagnostics(this);

		// Mobile lifecycle: flush + persist on background, recover the socket on
		// foreground. Mobile OSes suspend the WebSocket while backgrounded, so on
		// resume the channel may be silently half-dead, so onResume probes it (and
		// pulls a pending reconnect forward) instead of waiting ~30s for the next
		// heartbeat tick, which is what made the first post-unlock sync feel laggy.
		this.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (activeDocument.visibilityState === "hidden") {
				void rlog().flush();
				void this.savePluginData(this.syncEngine.getLastSync());
				void this.baseStore?.save();
			} else if (activeDocument.visibilityState === "visible") {
				this.noteStream?.onResume();
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
			id: "disconnect",
			name: "Disconnect (clear login)",
			callback: async () => {
				await this.clearAuthAndPromptRelink("manual disconnect command", false);
				new Notice("Engram: disconnected. Open Engram settings to reconnect.");
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

		// CRDT editor extension; registered ONCE for the plugin's lifetime so that
		// repeated setupNoteStream() calls (settings save / reconnect) never stack
		// additional ViewPlugin instances or workspace event listeners. The
		// ycollabExtension holds an empty Compartment until CrdtLiveViews.refresh()
		// reconfigures it for each open note via EditorController.bindTo().
		this.registerEditorExtension([ycollabExtension()]);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.crdtLiveViews?.refresh();
				// Bind-time convergence check (2026-07-07 catch-up gap): opening a
				// note verifies the local synced state against the server's manifest
				// hash; divergence forces a fresh CRDT handshake so a missed
				// announce/STEP2 heals the moment the user looks at the note.
				if (file?.extension === "md" && !this.syncEngine.isSyncBlocked()) {
					void this.syncEngine.verifyConvergenceOnOpen(file.path);
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.crdtLiveViews?.refresh()),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.crdtLiveViews?.refresh()),
		);
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

			if (!registered) return;

			// The cold-start loop below resolve-or-mints a note_id for EVERY
			// markdown file. With a stale/empty map that mass-mints wrong ids —
			// the highest-volume offender in the 2026-07-07 cross-file-overwrite
			// incident class. Reconcile from the server manifest FIRST so
			// existing notes resolve to their real server ids; a failed fetch
			// (offline startup) degrades to the old behavior instead of blocking.
			// Also warms the manifest snapshot the destructive-op guard uses.
			if (gateOpen) {
				try {
					await this.syncEngine.reconcileNoteIdMapFromManifest();
				} catch (e) {
					rlog().warn("crdt", `cold-start map reconcile failed: ${errMsg(e)}`);
				}
			}

			// Cold-note drift (a markdown file changed while the app was closed:
			// external editor, another sync app, OS) is reconciled by the regular
			// REST fullSync below, NOT by seeding it into a CRDT room. Lazy
			// enrollment only opens a room for editor-open notes, so seeding cold
			// drift into the Y.Doc would bypass the live-bound push gate and risk a
			// duplicate CRDT lineage. Convergent REST push/pull handles it instead.
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
		this.crdtWiring?.dispose();
		devLog().log("lifecycle", "plugin unloading");
		rlog().info("lifecycle", "Plugin unloading");
		activeDocument.body.classList.remove("engram-vault-sync-active");
		// Flush any buffered obsidian.push spans before teardown. The buffer's
		// own 2s timer would otherwise never fire post-unload.
		this.api.beacon.flush();
		// Best-effort save before teardown — hashes must be exported before destroy
		void this.savePluginData(this.syncEngine.getLastSync());
		this.baseStore?.prune();
		void this.baseStore?.save();
		this.syncEngine?.destroy();
		this.noteStream?.disconnect();
		this.crdtLiveViews?.destroy();
		this.crdtLiveViews = null;
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
		// Yjs stamps globalThis['__ $YJS$ __'] = true on import to guard against
		// duplicate copies (yjs#438). Obsidian reloads the plugin module graph on
		// update without restarting the renderer, so that flag outlives us and the
		// next load's yjs import fires a spurious "Yjs was already imported" error.
		// We bundle exactly one copy, so clear the marker on teardown to keep reloads
		// quiet. The flag is re-set when the new instance imports yjs. yjs sets the
		// marker on the realm global; in the Obsidian renderer that is `window`.
		(window as unknown as Record<string, unknown>)["__ $YJS$ __"] = undefined;
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadPluginData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
		// Collapse the legacy remoteLoggingEnabled / diagnosticMode / tracingEnabled
		// toggles into the single diagnosticsEnabled (on if any legacy one was on),
		// then drop the stale keys so the next save persists only the new shape.
		const rawSettings = data?.settings as Record<string, unknown> | undefined;
		this.settings.diagnosticsEnabled = migrateDiagnosticsEnabled(rawSettings);
		for (const legacy of ["remoteLoggingEnabled", "diagnosticMode", "tracingEnabled"]) {
			delete (this.settings as unknown as Record<string, unknown>)[legacy];
		}
		this.syncGateAcceptedFor = data?.syncGateAcceptedFor ?? null;
		this.noteIdMap = NoteIdMap.fromJSON(data?.noteIds);
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
			await this.writePluginData({
				...data,
				settings: this.settings,
				deviceId: this.deviceId,
			});
		}
		// NOTE: this.api is replaced with a configured instance in onload() right
		// after loadSettings() returns; the device id is wired there via
		// setDeviceId(this.deviceId), before any sync runs.
	}

	async saveSettings(): Promise<void> {
		this.api.updateConfig(this.settings.apiUrl, this.settings.apiKey);
		this.api.setVaultId(this.settings.vaultId);
		this.api.setTracingEnabled(this.settings.diagnosticsEnabled);
		this.syncEngine.updateSettings(this.settings);
		rlog().setEnabled(this.settings.diagnosticsEnabled);
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

	/** True once we have surfaced a data.json recovery/corruption Notice this
	 *  session, so the two load paths (loadSettings + onload restore) don't
	 *  double-toast the user. */
	private dataRecoveryNotified = false;

	/** Absolute (vault-relative) path of the plugin's data.json. Matches the
	 *  path Obsidian's own loadData()/saveData() use. */
	private pluginDataPath(): string {
		return normalizePath(`${this.manifest.dir}/data.json`);
	}

	/** Resilient replacement for this.loadData(). Reads data.json, falling back
	 *  to the .bak/.tmp sidecars if the primary was truncated or corrupted (the
	 *  outage scenario: a non-atomic saveData() interrupted mid-write leaves a
	 *  0-byte data.json, which the stock loadData() JSON.parse turns into an
	 *  onload-aborting throw). On a successful recovery the primary is healed in
	 *  place; on unrecoverable corruption the user is warned and we fall back to
	 *  defaults rather than crashing the whole plugin. */
	private async loadPluginData(): Promise<Partial<PluginData> | null> {
		const path = this.pluginDataPath();
		const { data, source } = await resilientReadJson<Partial<PluginData>>(
			this.app.vault.adapter,
			path,
		);
		if (source === "backup" || source === "tmp") {
			rlog().error(
				"lifecycle",
				`data.json was unreadable; recovered settings from ${source} sidecar`,
			);
			// Heal the primary so the next load is clean and the recovered state
			// is the canonical copy again.
			if (data !== null) {
				try {
					await atomicWriteJson(this.app.vault.adapter, path, data);
				} catch (e) {
					rlog().error(
						"lifecycle",
						`Failed to heal data.json after recovery: ${errMsg(e)}`,
					);
				}
			}
			if (!this.dataRecoveryNotified) {
				this.dataRecoveryNotified = true;
				new Notice(
					"Engram: recovered plugin settings from a backup after a corrupted save.",
				);
			}
		} else if (source === "corrupt") {
			rlog().error(
				"lifecycle",
				"data.json and its backups were all unreadable; falling back to defaults",
			);
			if (!this.dataRecoveryNotified) {
				this.dataRecoveryNotified = true;
				new Notice(
					"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.",
				);
			}
		}
		return data;
	}

	/** Resilient replacement for this.saveData(). Writes data.json atomically
	 *  (stage .tmp, demote current to .bak, rename .tmp over primary) so an
	 *  interrupted write can never leave a 0-byte data.json. */
	private async writePluginData(data: Partial<PluginData>): Promise<void> {
		await atomicWriteJson(this.app.vault.adapter, this.pluginDataPath(), data);
	}

	private async savePluginData(lastSync: string, offlineQueue?: QueueEntry[]): Promise<void> {
		await this.writePluginData({
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
			noteIds: this.noteIdMap.toJSON(),
		});
	}

	/**
	 * Clear all persisted login state and drop back to the unlinked state so the
	 * user can re-link. Used by both the auto-heal path (the server definitively
	 * rejected the stored refresh token) and the manual "Disconnect" command.
	 * Idempotent — a no-op once auth is already cleared.
	 */
	private async clearAuthAndPromptRelink(reason: string, notify: boolean): Promise<void> {
		if (!this.settings.refreshToken && !this.settings.apiKey) return;
		rlog().info("auth", `Clearing auth + prompting re-link (${reason})`);
		Object.assign(this.settings, withClearedAuth(this.settings));
		this.api.setAuthProvider(null);
		this.authProvider = null;
		this.noteStream?.disconnect();
		this.noteStream = null;
		this.liveConnected = false;
		this.everConnected = false;
		await this.savePluginData(this.syncEngine.getLastSync());
		this.updateStatusBar(this.syncEngine.getStatus());
		if (notify) {
			new Notice("Engram: your login expired — open Engram settings to reconnect.");
		}
	}

	/**
	 * Fired by OAuthAuth when the server DEFINITIVELY rejects the stored refresh
	 * token (revoked / rotated-away / expired → 4xx). Self-heals the previously
	 * stuck "token invalid" state: without this, the plugin replayed a dead token
	 * forever with no recovery and no unlink button.
	 */
	private handleAuthInvalidated(): void {
		void this.clearAuthAndPromptRelink("server rejected refresh token", true);
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
					// Carry the HTTP status so OAuthAuth can distinguish a definitive
					// rejection (revoked/expired token → 4xx, clear + re-link) from a
					// transient failure (5xx/network → keep the token, retry later).
					const e = new Error(`Refresh failed: ${resp.status}`) as Error & {
						status?: number;
					};
					e.status = resp.status;
					throw e;
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
				() => this.handleAuthInvalidated(),
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
				this.noteStream.setAuthProbe(() => this.api.getMe());
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
		// Short-circuit when a live stream already matches the current connection
		// identity (backend + account + vault). saveSettings() calls this on EVERY
		// settings write — a search-mode toggle or an OAuth refresh-token rotation
		// would otherwise tear down and rebuild a healthy socket + CRDT stack. That
		// reconnect churn raced note reconciliation and clobbered live docs (empty
		// flush on a transient disconnect). Only rebuild when the identity changes.
		const connectionKey = channelConnectionKey(this.settings);
		if (
			shouldReuseLiveStream(
				this.noteStream !== null,
				this.everConnected,
				connectionKey,
				this.liveChannelKey,
			)
		) {
			return;
		}
		this.liveChannelKey = connectionKey;
		// A genuinely new stream is about to be built below — the "ever
		// connected" flag is per-stream, not per-plugin-lifetime.
		this.everConnected = false;

		// Tear down any existing CRDT instances before disconnecting the channel.
		// Without this, repeated calls (settings save / reconnect) leak Y.Doc and
		// IndexeddbPersistence listeners — each overwrites the references but the
		// old objects stay alive with their observers still firing.
		this.crdtLiveViews?.destroy();
		this.crdtLiveViews = null;
		this.crdtWiring?.dispose();
		this.crdtWiring = null;
		void this.crdtManager?.destroy();
		this.crdtManager = null;
		this.crdtEnrollment?.resetAll();
		this.crdtEnrollment = null;
		// Teardown must NOT depend on the connection-state transition that nulls
		// the SyncEngine's CRDT manager via setConnected(false): when the offline-
		// retention branch is active (crdtEverJoined = true and the socket was
		// already disconnected), setConnected is transition-gated and becomes a
		// no-op. Clear the SyncEngine references explicitly here so that a
		// destroyed manager never outlives its channel session as a zombie.
		this.syncEngine.setCrdtManager(null);
		this.syncEngine.setCrdtEnrollment(null);
		// Reset the joined flag: a new channel session must re-confirm CRDT support
		// before offline capture stays active. This ensures a genuine backend/vault
		// switch degrades back to legacy (crdtEverJoined = false → disconnect handler
		// nulls the manager) until the new server confirms the crdt: topic join.
		this.crdtEverJoined = false;

		// Disconnect existing channel + invalidate any in-flight connectChannel()
		// (its async getMe() may still be pending) so it can't spawn a zombie.
		this.noteStream?.disconnect();
		this.noteStream = null;
		this.channelEpoch++;

		// Keep the remote logger's client context current. vaultId can change on a
		// vault switch or first-run registration after onload, so refresh it here;
		// setupNoteStream fires on every settings save, reconnect, or vault switch.
		rlog().setClientContext(this.deviceId, this.settings.vaultId);

		const hasAuth = this.settings.apiKey || this.settings.refreshToken;
		if (!this.settings.apiUrl || !hasAuth) {
			this.liveConnected = false;
			this.updateStatusBar(this.syncEngine.getStatus());
			return;
		}

		this.connectChannel();
	}

	/**
	 * Re-enroll every currently-open markdown note into the CRDT handshake so the
	 * server re-registers this device as an observer of each note's room. Called
	 * on every crdt: topic (re)join. For each open note it clears the once-per-doc
	 * STEP1 guard (reset) then enrolls (sends STEP1), which is order-independent
	 * and idempotent — on the initial join the active note is already enrolled, so
	 * this just re-advertises; after a reconnect it restores the observer
	 * subscription that a tab left open across the drop would otherwise lose.
	 */
	private reEnrollOpenCrdtNotes(): void {
		const enrollment = this.crdtEnrollment;
		if (!enrollment) return;
		const seen = new Set<string>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const file = view.file;
			if (!(file instanceof TFile) || file.extension !== "md") continue;
			if (seen.has(file.path)) continue;
			seen.add(file.path);
			const noteId = this.noteIdMap.getOrMint(file.path);
			enrollment.reset(noteId);
			enrollment.enroll(noteId);
		}
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
			.then(async (user) => {
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
					this.deviceId,
				);
				channel.setAuthProbe(() => this.api.getMe());

				channel.onEvent = (event) => {
					void this.syncEngine.handleStreamEvent(event);
				};

				channel.onStatusChange = (connected) => {
					this.liveConnected = connected;
					if (connected) this.everConnected = true;
					this.updateStatusBar(this.syncEngine.getStatus());
					// Catch-up pull on reconnect to cover missed events during disconnect
					if (connected) {
						// Forget confirmed-note-id status: across a (re)connect the
						// server's view may have diverged (another device deleted/renamed
						// a note, or the backing store was reset). A stale "confirmed"
						// entry routes a note's first write to CRDT, which the server
						// silently drops for a note it has no row for. Clearing biases the
						// next write back to durable REST; the catch-up pull below re-
						// confirms whatever changed.
						this.syncEngine.clearConfirmedNoteIds();
						// Repair a stale noteIdMap from the server manifest BEFORE
						// re-enrolling. Live pull of an existing note is CRDT-only and
						// onFlushToDisk resolves the disk path via noteIdMap.pathForId;
						// after the id-keying cutover a cursor-bearing device never
						// re-ran bootstrap(), so its map stayed stale and every inbound
						// frame stranded ("no known path"). The manifest is authoritative
						// id->path (id+path+hash only, no content), so reconciling it here
						// makes live pull resolve. Await it so the map is ready before the
						// STEP1/STEP2 handshakes below deliver content.
						void (async () => {
							// Once per session (first successful connect): a stale map is a
							// startup/migration condition, not a per-reconnect one. On failure
							// (e.g. offline at first connect) leave the flag unset so a later
							// connect retries.
							if (!this.crdtMapReconciled) {
								try {
									const n =
										await this.syncEngine.reconcileNoteIdMapFromManifest();
									this.crdtMapReconciled = true;
									if (n > 0) {
										rlog().info(
											"crdt",
											`noteIdMap reconciled from manifest: ${n} notes`,
										);
									}
								} catch (e) {
									rlog().warn(
										"crdt",
										`noteIdMap manifest reconcile failed (live pull may strand until next sync): ${errMsg(e)}`,
									);
								}
							}
							// Reset all CRDT enrollments so a fresh startSync STEP1
							// handshake fires for each open note after reconnect.
							this.crdtEnrollment?.resetAll();
							// A reconnect just reconciled the noteIdMap above — any
							// note_id that was stranded due to map drift deserves
							// fresh retry attempts against the now-current map
							// (final review MINOR-6), not a counter left over from
							// before the drift was fixed.
							this.crdtWiring?.clearStrandHealAttempts();
							this.syncEngine.pull().catch((e) => {
								// biome-ignore lint/suspicious/noConsole: error boundary
								console.error("Engram Sync: catch-up pull failed", e);
								rlog().error(
									"channel",
									`Catch-up pull on reconnect failed: ${errMsg(e)}`,
								);
							});
						})();
					} else {
						// On disconnect: if onCrdtJoined has already fired for this
						// channel session (crdtEverJoined), KEEP the CRDT manager wired
						// in the SyncEngine. Y.Doc + IndexedDB are offline-native —
						// edits accumulate locally and the reconnect STEP1/STEP2
						// handshake delivers them to the server. channel.send() drops
						// frames on the closed socket (readyState guard in channel.ts),
						// but the OPS survive: they are committed to the Y.Doc and
						// persisted in IndexedDB, and travel via the reconnect handshake.
						//
						// If crdtEverJoined is false the server never confirmed CRDT
						// support for this channel session (e.g. non-CRDT backend, or
						// a brand-new channel pre-join). Fall back to the legacy path
						// exactly as before so we don't hold a null manager as "active".
						if (!this.crdtEverJoined) {
							this.syncEngine.setCrdtManager(null);
							rlog().info(
								"crdt",
								"Disconnected before crdt: join — CRDT routing cleared, legacy path active",
							);
						} else {
							rlog().info(
								"crdt",
								"Disconnected — CRDT routing RETAINED for offline capture (Y.Doc + IDB)",
							);
						}
						// Always invalidate synced marks on disconnect: a mark means
						// "doc reflected server state at some past connection" — a
						// disconnect invalidates that because another device may have
						// written content while offline. T1's gate then declines
						// empty-doc seeds offline (correct: fall to legacy/queue),
						// and re-establishes marks when a non-empty STEP2 arrives
						// after reconnect.
						this.crdtManager?.clearSynced();
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
					// setAuthProbe already wired above at construction (same channel
					// object, same closure), so re-wiring it here would be a no-op.
					this.noteStream.setAuthProvider(this.authProvider);
				}

				// Wire CRDT transport through this channel.
				// Only wire when vaultId is known: the crdt: topic is keyed by
				// vaultId, and doc_id is the note's bare note_id, matching the
				// backend's note_id resolution. Without a vaultId the crdt:
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
					// One-time schema upgrade: wipe v1 CRDT stores if needed.
					if (typeof indexedDB.databases === "function") {
						await ensureDocSchema(dbPrefix, window.localStorage, {
							list: () => indexedDB.databases(),
							drop: (name) =>
								new Promise<void>((resolve) => {
									const req = indexedDB.deleteDatabase(name);
									req.onsuccess = req.onerror = req.onblocked = () => resolve();
								}),
						});
					} else {
						rlog().warn(
							"crdt",
							"indexedDB.databases() not available — skipping v1 schema wipe",
						);
					}
					// Re-check epoch after the async wipe — a superseding setupNoteStream
					// during a long schema wipe must not be overwritten by this stale continuation.
					if (epoch !== this.channelEpoch) {
						rlog().info(
							"channel",
							"connectChannel aborted after ensureDocSchema — superseded by newer setup",
						);
						return;
					}
					// Task 6 (note_id-keyed CRDT): the CrdtManager/CrdtChannel/CrdtEnrollment
					// trio and their id->path resolving callbacks (plus the strand-heal
					// self-heal and the onCrdtMessage/onCrdtDocReady handlers) live in
					// createCrdtWiring — see src/crdt/wiring.ts. Everything below (the
					// Obsidian-bound CrdtLiveViews and the onCrdtJoined/JoinError control-
					// plane) stays here because it touches plugin lifecycle, not keying.
					const wiring = createCrdtWiring({
						noteIdMap: this.noteIdMap,
						syncEngine: this.syncEngine,
						sendCrdt: (docId, frame) => channel.sendCrdt(docId, frame),
						// Backed lazily: crdtLiveViews is constructed just below, so this
						// closure must read the field at call time, not capture a value.
						isBound: (path) => this.crdtLiveViews?.isBound(path) ?? false,
					});
					this.crdtWiring = wiring;
					this.crdtManager = wiring.manager;
					this.crdtEnrollment = wiring.enrollment;
					// Level-triggered discovery: a pull that surfaces a CRDT-managed
					// note we don't have locally enrolls it (sync-step-1), so the body
					// arrives over the handshake. Backstops the edge-triggered
					// crdt_doc_ready announce for a device that was offline / not yet
					// subscribed when the other device opened the room.
					this.syncEngine.setCrdtEnrollment(this.crdtEnrollment);
					this.crdtLiveViews = new CrdtLiveViews({
						app: this.app,
						manager: this.crdtManager,
						enrollment: this.crdtEnrollment,
						// Resolve-or-mint: the editor binding needs a note_id immediately
						// on open, even for a brand-new note that has never been pushed
						// (pushFile would otherwise be the only minter, deferring the live
						// binding until after the first save).
						resolveId: (path) => this.noteIdMap.getOrMint(path),
						flushToDisk: (path, content) =>
							this.syncEngine.flushFromCrdt(path, content),
					});
					// Tell the sync engine which paths have a live editor binding so its
					// disk-modify handler skips re-feeding disk content into the Y.Text for
					// open notes (the binding owns them). Without this, Obsidian's autosave
					// churns the doc every ~2s.
					this.syncEngine.setLiveBoundCheck(
						(path) => this.crdtLiveViews?.isBound(path) ?? false,
					);
					// Editor extension + workspace events are registered once in onload
					// so repeated setupNoteStream() calls don't stack them. Trigger an
					// initial refresh here so the new manager sees currently-open leaves.
					this.crdtLiveViews.refresh();
					// Inbound frame + remote room-open discovery handlers (id->path
					// resolution, enrollment gating, #955 note_not_found id-map heal)
					// are built by createCrdtWiring.
					channel.onCrdtMessage = wiring.onCrdtMessage;
					channel.onCrdtDocReady = wiring.onCrdtDocReady;
					channel.onCrdtNoteNotFound = wiring.onCrdtNoteNotFound;
					// Deferred activation: only engage CRDT routing in the SyncEngine
					// after the server confirms the crdt: topic join. Against a non-CRDT
					// backend this never fires and setCrdtManager stays null → every
					// markdown save uses the legacy pushNote path (graceful degradation).
					channel.onCrdtJoined = () => {
						rlog().info(
							"crdt",
							"crdt: topic joined — activating CRDT routing in SyncEngine",
						);
						this.crdtEverJoined = true;
						this.syncEngine.setCrdtManager(this.crdtManager);
						// Re-enroll every open markdown note so the server re-registers
						// this device as a room observer after a (re)connect. The active-
						// leaf-change handler only fires on a tab switch, so a note left
						// open across a socket drop would otherwise never re-send STEP1 and
						// go deaf to live updates until the user switches tabs or hits Sync.
						// Mirrors the web client's reconnect resync. Runs on every crdt:
						// (re)join; on the initial join it is a near no-op (already enrolled).
						this.reEnrollOpenCrdtNotes();
					};
					// T4 folded finding + audit F13: when the crdt: topic REJOIN fails
					// (backend downgrade, transient error, or this plugin being too old),
					// CRDT routing must be torn down even if it was previously active.
					// Without this, crdtEverJoined stays true and the disconnect handler
					// retains the manager, routing every md edit into a dead transport
					// where frames are silently dropped and legacy never engages.
					channel.onCrdtJoinError = (reason, min) => {
						rlog().warn(
							"crdt",
							`crdt: topic join rejected (reason=${reason ?? "unknown"}) — degrading to legacy pushNote path`,
						);
						// Degrade to legacy: mirror the "never-joined disconnect" path.
						this.crdtEverJoined = false;
						this.syncEngine.setCrdtManager(null);
						// Invalidate any handshake marks so a future re-join starts clean.
						this.crdtManager?.clearSynced();
						// A later same-socket rejoin must re-fire STEP1s; resetAll clears the once-per-session guard.
						this.crdtEnrollment?.resetAll();
						if (reason === "crdt_proto_too_old") {
							// The server requires a newer CRDT protocol than this plugin
							// speaks — surface a user-visible notice, but only once per
							// session to avoid toast spam on every reconnect.
							if (!this.crdtProtoTooOldNoticeShown) {
								this.crdtProtoTooOldNoticeShown = true;
								new Notice(
									"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.",
									10000,
								);
								rlog().warn(
									"crdt",
									`crdt_proto_too_old: server requires proto >= ${min ?? "unknown"}; update the plugin`,
								);
							}
						}
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
				const pushed = await this.syncEngine.pushAll({ replaceRemote: true });
				new Notice(`Engram Sync: replaced remote with local (${pushed} uploaded)`);
				return true;
			}

			case "push-all-keep-remote": {
				await this.markSyncGateAccepted();
				const pushed = await this.syncEngine.pushAll({ replaceRemote: false });
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
	async runSyncWithProgress(
		choice: SyncChoice,
		opts: { plan?: SyncPlan | null; firstSync?: boolean } = {},
	): Promise<boolean> {
		if (choice === "cancel" || choice === "change-vault") {
			return this.runSyncFromChoice(choice);
		}
		const intro = opts.plan
			? describePlannedWork(choice, opts.plan, opts.firstSync ?? false)
			: undefined;
		const phases = opts.plan ? plannedPhases(choice, opts.plan) : undefined;
		const modal = new SyncProgressModal(this.app, {
			intro,
			phases,
			webUrl: engramWebUrl(this.settings.apiUrl),
		});
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
		// Re-fire gated-away STEP1 handshakes now that writes are allowed.
		// Active-leaf-change enrollment was skipped while the gate was closed;
		// resetAll clears the once-per-session guards so the next enroll re-issues STEP1.
		this.crdtEnrollment?.resetAll();
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
		// Single-flight: if a preview is already open (e.g. a vault switch fired
		// two saveSettings gate-chains), this call is a silent no-op so we never
		// stack two modals.
		await this.syncPreviewGuard(async () => {
			try {
				const context = this.derivePreviewContext();
				// Open the modal immediately in a loading state, then stream the
				// plan in when computeSyncPlan resolves. Previously we awaited the
				// full server round-trip (manifest + changes) BEFORE opening, so
				// the modal appeared to hang on slow connections.
				const modal = new SyncPreviewModal(this.app, null, {
					remoteVaultName: this.settings.remoteVaultName,
					showChangeVault: true,
					context,
					initialView: opts.startInVaultPicker ? "vault-picker" : "preview",
					attachmentsTextOnly:
						this.syncEngine.getPlanState()?.attachmentsTextOnly ?? false,
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
						// New vault = new id/path space; re-reconcile on next connect.
						this.crdtMapReconciled = false;
						// Strand-heal retry counts are scoped to the previous vault's
						// note_ids (final review MINOR-6) — stale counts here could
						// prematurely give up on a note_id that happens to be reused
						// in the new vault. (The wiring is also rebuilt on the next
						// setupNoteStream, but clear defensively — the rebuild is not
						// this handler's contract.)
						this.crdtWiring?.clearStrandHealAttempts();
						this.syncEngine.setSyncBlocked(true);
						await this.savePluginData(this.syncEngine.getLastSync());
						// Re-render the settings tab so the vault name span and
						// any other vault-derived UI pick up the switch.
						this.settingTab?.display();
						return this.syncEngine.computeSyncPlan("full");
					},
				});

				// Compute the plan off the critical path and stream it into the
				// already-open modal. A failure surfaces in the modal's loading
				// view rather than blocking the open.
				void this.syncEngine
					.computeSyncPlan("full")
					.then((plan) => modal.setPlan(plan))
					.catch((e) => {
						modal.setPlanError(
							"Could not compare with the cloud. Check your connection.",
						);
						rlog().error("lifecycle", `Sync plan compute failed: ${errMsg(e)}`);
					});

				const choice = await modal.awaitChoice();

				await this.runSyncWithProgress(choice, {
					plan: modal.getPlan(),
					firstSync: context === "first-time",
				});
			} catch (e) {
				// biome-ignore lint/suspicious/noConsole: error boundary
				console.error("Engram Sync: sync preview failed", e);
				new Notice("Engram sync: preview failed — check connection");
				rlog().error("lifecycle", `Sync preview failed: ${errMsg(e)}`);
			}
		});
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
