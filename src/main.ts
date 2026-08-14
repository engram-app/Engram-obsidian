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
	normalizePath,
	Platform,
	Plugin,
	requestUrl,
	TFile,
	TFolder,
} from "obsidian";
import { EngramApi, withTimeout } from "./api";
import {
	ApiKeyAuth,
	type AuthProvider,
	OAuthAuth,
	type RefreshFn,
	seededAccessToken,
} from "./auth";
import { migrateCloudApiUrl, withClearedAuth } from "./auth-state";
import { migrateBackendMode, switchMode } from "./backend-mode";
import { BaseStore } from "./base-store";
import { connectRetryDelayMs, makeCrdtCatchupSender, NoteChannel } from "./channel";
import { liveBindingPlugin, setLiveBindingCoordinator } from "./crdt/live/live-binding";
import { CrdtLiveViews } from "./crdt/live/live-views";
import { NoteIdMap } from "./crdt/note-id-map";
import type { ProviderRegistry } from "./crdt/provider-registry";
import { ensureDocSchema } from "./crdt/schema";
import { type CrdtWiring, createCrdtWiring } from "./crdt/wiring";
import { makeCrdtOpSend } from "./crdt-op-dispatch";
import { type CrdtOp, CrdtOpQueue } from "./crdt-op-queue";
import { createDebugApi, installDebugApi, uninstallDebugApi } from "./debug-api";
import { destroyDevLog, devLog, initDevLog } from "./dev-log";
import { type FeatureFlags, resolveFlags } from "./feature-flags";
import { isMarkdownPath } from "./file-kind";
import { setLogSink } from "./has-logging";
import { SyncRecorder } from "./sync-recorder";
import { PromiseTracker, setActiveTracker } from "./track-promise";

/** Replaced by esbuild at build time (see esbuild.config.mjs `define`). */
declare const DEV_MODE: boolean;

import { sha256Hex } from "./content-hash";
import { registerDiagnostics } from "./diagnostics";
import { EmailCaptureModal } from "./email-capture-modal";
import { errMsg, isHttpStatus } from "./error-util";
import { ExplicitFolders } from "./explicit-folders";
import { LimitExceededError } from "./limit-error";
import { notifyLimitExceeded } from "./limit-toast";
import { parsePlanState } from "./plan-state";
import { atomicWriteJson, resilientReadJson } from "./plugin-data-io";
import { destroyRemoteLog, initRemoteLog, rlog } from "./remote-log";
import { SearchModal } from "./search-modal";
import { SEARCH_VIEW_TYPE, SearchView } from "./search-view";
import { EngramSyncSettingTab } from "./settings";
import { migrateDiagnosticsEnabled } from "./settings-migrate";
import { createSingleFlight } from "./single-flight";
import { reconcileColdStart, SyncEngine } from "./sync";
import { channelConnectionKey, computeSyncFingerprint } from "./sync-fingerprint";
import { SyncLog } from "./sync-log";
import { SyncLogModal } from "./sync-log-modal";
import { planLoadErrorMessage, SyncPreviewModal } from "./sync-preview-modal";
import {
	describePlannedWork,
	type PlannedPhase,
	plannedPhases,
	SyncProgressModal,
} from "./sync-progress-modal";
import { ENGRAM_CLOUD_URL, engramWebUrl } from "./tabs/urls";
import type { BackendMode, QueueEntry, SyncChoice, SyncIssue, SyncPlan } from "./types";
import {
	DEFAULT_SETTINGS,
	type EngramSyncSettings,
	type FileSyncState,
	type SearchMode,
	type SyncPreviewContext,
	type SyncStatus,
} from "./types";
import { checkForPluginUpdate } from "./update-check";
import { shouldShowWaitlistPrompt } from "./waitlist";

/** Generate a stable client ID for vault registration.
 *  Uses SHA-256 of the vault's absolute path (desktop) or name (mobile fallback). */
async function generateClientId(app: import("obsidian").App): Promise<string> {
	const adapter = app.vault.adapter;
	const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
	const input = basePath || app.vault.getName();
	return sha256Hex(input);
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
	/** Durable outbound CRDT ops (create/delete) held across reloads. Mirrors
	 *  offlineQueue: flat pending list, restored on startup, pruned past TTL. */
	crdtOpQueue?: CrdtOp[];
	catchupSeq?: number;
	/** Composite-cursor id paired with `catchupSeq` (#312) so an interrupted
	 *  replay resumes at `(seq, id)` and can't skip an equal-seq move sibling. */
	catchupId?: string | null;
	/** Manifest change_seq watermark of the last fully-processed catch-up pass
	 *  (Phase E1 #1065) — sent as ?since_seq= to short-circuit an unchanged vault. */
	manifestSeq?: number;
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

/** Whether a channel may be built for the identity `getMe()` just authenticated
 *  as. connectChannel() freezes the channel's topic userId from the getMe() id
 *  at construction, while the socket later authenticates with this.authProvider's
 *  token. On an OAuth rebind (settings mutated before the provider caught up —
 *  including a rebind BACK to a previously-used account where the email-based
 *  channelConnectionKey coincides, so shouldReuseLiveStream can't tell the
 *  identities apart) getMe() can resolve against the STALE provider, freezing a
 *  prior user's id into the topic while the socket authenticates as the current
 *  user → the backend rejects the crdt: join "unauthorized" with no client-
 *  visible retry (e2e-clerk test_84, the residual #229/#996 flavor). Refuse to
 *  build a channel whose authenticated identity disagrees with the identity we
 *  intend to connect as. Only guarded when an expected email is known (OAuth);
 *  api-key auth carries no email and is single-identity, so an absent expected
 *  or authenticated email accepts (can't verify, no worse than before). Case-
 *  insensitive so a benign casing diff never triggers a false rebuild loop.
 *  Exported pure so the decision is unit-testable without a plugin instance. */
export function channelIdentityMatches(
	expectedEmail: string | undefined,
	authenticatedEmail: string | undefined,
): boolean {
	if (!expectedEmail || !authenticatedEmail) return true;
	return expectedEmail.toLowerCase() === authenticatedEmail.toLowerCase();
}

export default class EngramSyncPlugin extends Plugin {
	settings: EngramSyncSettings = DEFAULT_SETTINGS;
	api: EngramApi = new EngramApi("", "");
	/** Dev-build only: registry of outstanding async work, exposed through the
	 *  debug snapshot so a wedged sync shows up as a long-lived pending entry
	 *  instead of having to be inferred from logs. Null in production. */
	promiseTracker: PromiseTracker | null = null;

	/** Timeline capture for the CRDT seams (#356). Constructed once and kept for
	 *  the plugin's lifetime — it reads the flag on every record call, so
	 *  toggling recording never needs the CRDT stack rebuilt. Its buffer is
	 *  bounded, and it costs one predicate call per seam while off. */
	readonly syncRecorder: SyncRecorder = new SyncRecorder({
		enabled: () => this.flags.crdtRecording,
	});

	/** Resolved feature flags (stored overrides applied over schema defaults).
	 *  Recomputed on every read so a settings toggle takes effect without a
	 *  reload — these are cheap (a fixed-size object literal), and caching one
	 *  would just add an invalidation bug. */
	get flags(): FeatureFlags {
		return resolveFlags(this.settings.featureFlags);
	}
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
	/** Durable outbound CRDT op queue (create/delete). Plugin-lifetime; its `send`
	 *  dispatches over the CURRENT `noteStream`, and `onCrdtJoined` flushes it. */
	private crdtOpQueue: CrdtOpQueue | null = null;
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
	/** Connection identity (backend|account|vault) the PERSISTENT CRDT stack
	 *  (manager + wiring + liveViews + Y.Docs) was built for. Relay model: the
	 *  doc layer outlives the socket. A socket reconnect swaps only the transport
	 *  (a fresh NoteChannel, re-pointed at the surviving wiring via the box) — the
	 *  Y.Docs are NEVER destroyed, so reconnect is a clean syncStep1 diff, not a
	 *  full re-push that doubles the lineage. The stack is torn down ONLY when
	 *  THIS key changes (real vault/account/backend switch) or on unload. */
	private crdtStackKey: string | null = null;

	/** Fires whenever the status bar text/state changes — used by the settings
	 *  panel to keep its top status row in sync with sync engine + WebSocket
	 *  connection state without requiring tab navigation. Single-slot. */
	onStatusBarChange: (() => void) | null = null;

	/** Planned phases for the in-progress manual sync (set by
	 *  runSyncWithProgress). Lets the settings-pane progress bar render the same
	 *  plan-aware, clamped counts as the modal instead of the raw examine-count
	 *  denominator. Null between syncs and during background syncs (no plan). */
	activeSyncPhases: PlannedPhase[] | null = null;

	/** Whether the WebSocket channel is currently connected (for settings UI). */
	isLiveConnected(): boolean {
		return this.liveConnected;
	}

	private baseStore: BaseStore | null = null;
	private explicitFolders: ExplicitFolders | null = null;
	private crdtManager: ProviderRegistry | null = null;
	private crdtEnrollment: ProviderRegistry | null = null;
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
	/** The live SyncPreviewModal, if one is open. Held so healDeadVault can
	 *  close a preview that sits on a just-nulled vault before reopening the
	 *  picker (the syncPreviewGuard makes a reopen a no-op while it lives). */
	private openPreviewModal: { close(): void; setPlanError(msg: string): void } | null = null;

	/** Timestamp (ms) of the last noteIdMap manifest-reconcile attempt.
	 *  Reconciling on EVERY reconnect (not just the first) is required so a
	 *  note another device created during a disconnect is discovered — see
	 *  reconcileNoteIdMapFromManifest — but firing a manifest fetch on every
	 *  connect during a reconnect storm (flaky wifi, deploy-drain churn) is
	 *  the same class of load that caused the 2026-07-09 pool-exhaustion
	 *  incident (docs/context/crdt-sync-pool-exhaustion-loop-2026-07-09.md).
	 *  RECONCILE_THROTTLE_MS bounds a storm to one reconcile per window while
	 *  a genuine reconnect after a real gap still reconciles and discovers.
	 *  Reset to 0 on vault change so the new vault reconciles immediately. */
	private lastMapReconcileAt = 0;

	private static readonly RECONCILE_THROTTLE_MS = 30_000;

	/** Single-flight guard so a vault switch (or any racing trigger) cannot
	 *  stack two SyncPreviewModal instances. A second call while one preview is
	 *  open is a silent no-op. See single-flight.ts. */
	private readonly syncPreviewGuard = createSingleFlight();

	/** Notify-only update nudge for users who don't enable auto-update. Fetches
	 *  the published manifest, and if it's ahead of the installed version shows a
	 *  clickable Notice that opens the Community plugins tab (where Obsidian's own
	 *  Update button lives). Never self-installs — that's Obsidian's job, and
	 *  store policy forbids plugins doing it themselves. */
	private async nudgeIfUpdateAvailable(): Promise<void> {
		const latest = await checkForPluginUpdate(this.manifest.version);
		if (!latest) return;
		// Obsidian's global helper, not activeWindow.createFragment(): the latter
		// is what the eslint autofix suggests, but `activeWindow` is typed as a
		// plain Window, so the call resolves to `any` and cascades a dozen
		// no-unsafe-* errors. The bare global is declared in obsidian.d.ts.
		const frag = createFragment();
		frag.append(`Engram Vault Sync ${latest} is available. `);
		const link = frag.createEl("a", { text: "Update in settings", href: "#" });
		frag.append(".");
		const notice = new Notice(frag, 15000);
		link.addEventListener("click", (e) => {
			e.preventDefault();
			this.openCommunityPluginsUpdate();
			notice.hide();
		});
	}

	/** Take the user to the Community plugins settings tab and refresh Obsidian's
	 *  update check so its own Update button is populated on arrival. All internal
	 *  APIs are feature-detected; a shape change degrades to a no-op, never a throw. */
	private openCommunityPluginsUpdate(): void {
		const app = this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
			plugins?: { checkForUpdates?: () => unknown };
		};
		try {
			app.plugins?.checkForUpdates?.();
		} catch {
			// best-effort badge refresh; the tab still opens below
		}
		app.setting?.open();
		app.setting?.openTabById("community-plugins");
	}

	async onload(): Promise<void> {
		initDevLog();
		// Route HasLogging output to both existing destinations, so a class that
		// extends it needs no logger wiring of its own. devLog is tree-shaken in
		// production; rlog respects the diagnostics switch and level threshold.
		setLogSink((level, category, message) => {
			devLog().log(category, message);
			// "debug" stops at the local ring buffer on purpose. rlog has no debug
			// method, and shipping debug volume to Loki is exactly the cardinality
			// problem the remoteLogLevel dial exists to avoid.
			if (level === "error") rlog().error(category, message);
			else if (level === "warn") rlog().warn(category, message);
			else if (level === "info") rlog().info(category, message);
		});
		if (DEV_MODE) {
			this.promiseTracker = new PromiseTracker();
			setActiveTracker(this.promiseTracker);
		}
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

		// Store users get a silent "update available" badge in Settings; users who
		// don't enable auto-update never see it. Nudge them once per launch with a
		// notify-only Notice (no self-install — Obsidian policy owns that path).
		this.app.workspace.onLayoutReady(() => void this.nudgeIfUpdateAvailable());

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
		remoteLogger.setLevelThreshold(this.settings.remoteLogLevel);
		remoteLogger.setEnabled(this.settings.diagnosticsEnabled);
		remoteLogger.setClientContext(this.deviceId, this.settings.vaultId);
		rlog().info(
			"lifecycle",
			`Plugin loading | v${this.manifest.version} | ${Platform.isMobile ? "mobile" : "desktop"}`,
		);

		this.syncEngine = new SyncEngine(this.app, this.api, this.settings, async (data) => {
			// Merge whichever of {lastSync, catchupSeq, manifestSeq} the engine handed us into
			// the in-memory engine state, then persist the WHOLE PluginData via
			// savePluginData (saveData overwrites data.json wholesale). Each field
			// the payload omits falls through to the engine's current value, so a
			// lastSync-only write never clobbers catchupSeq and vice-versa.
			if (data.lastSync !== undefined) {
				this.syncEngine.setLastSync(data.lastSync);
				// Vault-scoped errors are swallowed inside the sync flows (one bad file
				// must not abort a sync) — this side-channel lets the dead-vault heal see
				// them anyway (review finding 2). healDeadVault self-discriminates: only
				// a 404 whose vault is truly absent from the server list heals.
				this.syncEngine.onVaultScopedError = (e) => void this.healDeadVault(e);
			}
			if (data.catchupSeq !== undefined) {
				this.syncEngine.setCatchupSeq(data.catchupSeq);
			}
			if (data.catchupId !== undefined) {
				this.syncEngine.setCatchupId(data.catchupId);
			}
			if (data.manifestSeq !== undefined) {
				this.syncEngine.setManifestSeq(data.manifestSeq);
			}
			await this.savePluginData(this.syncEngine.getLastSync());
		});

		this.syncEngine.syncLog = this.syncLog;

		// Boot-stage CRDT ports (one patch; the channel-join stage wires the rest).
		// NOTE: the old editorDetach/editorRebind wiring is gone. The editor
		// binding is now a CM6 ViewPlugin (live-binding.ts) that owns its own
		// per-view lifecycle and re-resolves its note_id on every update, so a
		// genesis ADOPT (path -> serverId remap) is picked up automatically and no
		// doc is ever torn down under an open editor (persistent-doc model).
		this.syncEngine.setCrdtPorts({
			// Level-triggered CRDT-liveness check for the push path. The manager
			// port is edge-triggered (set on crdt: join, cleared on disconnect) and
			// can go stale — set, but the channel dead-but-set after an auth swap.
			// Reading the live join state at push time lets pushFile fall back to
			// REST instead of dropping the update into a channel the server no
			// longer routes (#915). Reads this.noteStream at call time, so it
			// always reflects the current channel; null stream → not live → REST.
			live: () => this.noteStream?.isCrdtConnected() ?? false,
			// Path -> note_id sidecar (Task 4/5 of the note_id-keyed CRDT rework).
			// this.noteIdMap is already loaded from data.json by loadSettings()
			// above (called before onload reaches this point), so this wiring sees
			// the persisted map, not an empty one.
			noteIdMap: this.noteIdMap,
			// Own device id (minted in loadSettings, sent as X-Device-Id by the API
			// client) — lets the engine drop server fanout echoes of its own REST
			// deletes (#970).
			deviceId: this.deviceId,
			// Fix wave 7 (#191 slice): commitCrdtConvergence's phantom-binding
			// check reads the bound editor's live buffer, and (on a rebind)
			// nudges its save the same way wiring.ts's onBoundUpdate does.
			boundBufferText: (path) => this.crdtLiveViews?.boundBufferText(path) ?? null,
			requestSave: (path) => this.crdtLiveViews?.requestSaveForBoundPath(path),
		});

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

		// Durable outbound CRDT op queue (create/delete). ONE plugin-lifetime
		// instance whose `send` dispatches over the CURRENT noteStream; the wiring
		// (onJoined flush, retry tick, enqueue hook) is set below/in connectChannel.
		this.crdtOpQueue = new CrdtOpQueue({
			send: makeCrdtOpSend({
				channel: () => this.noteStream,
				onCreated: (localId, serverId, path) =>
					this.syncEngine.applyCrdtCreateAck(localId, serverId, path),
				onTerminal: (op, reason) =>
					// A create/delete that retrying cannot fix. Surface it (error log) so
					// it never silently vanishes; the queue then drops it (no infinite retry).
					rlog().error(
						"crdt",
						`crdt_${op.kind} terminally failed (${reason}), dropping op for ${op.docId}`,
					),
				onLimit: (op, reason) => {
					// A TRANSIENT plan cap (notes_cap_reached): the op is retried, but the
					// user must be TOLD (not just a silent log) so they can free a note /
					// upgrade. Route it to the same limit toast the edit flow uses.
					notifyLimitExceeded(
						new LimitExceededError(reason, null, "notes_cap", null, null),
					);
					rlog().info(
						"crdt",
						`crdt_${op.kind} blocked by plan cap (${reason}), surfaced, retrying: ${op.docId}`,
					);
				},
			}),
			now: () => Date.now(),
			// Read live, never captured: the queue re-checks each op against the
			// vault we are syncing RIGHT NOW, at send time.
			currentVaultId: () => this.settings.vaultId ?? null,
			onDrop: (op, reason) =>
				rlog().warn(
					"crdt",
					`crdt_${op.kind} dropped (${reason}) without delivery: ${op.docId}`,
				),
		});
		// Persist on every mutation (mirrors OfflineQueue); the flat op list is
		// re-listed in savePluginData's wholesale blob via crdtOpQueue.all().
		this.crdtOpQueue.setPersist(() => {
			void this.savePluginData(this.syncEngine.getLastSync());
		});
		// Drive retries: a due op past its backoff is re-sent on each tick (no-op
		// until joined). registerInterval auto-clears on unload.
		this.registerInterval(window.setInterval(() => void this.crdtOpQueue?.tick(), 5000));
		// Wire the SyncEngine's durable create/delete enqueue hook to the queue.
		// The pending-op probe feeds the evidence rule's supersede exception: a
		// create-then-delete must coalesce in-queue, not resurrect (#416 review).
		// CREATE-only and CURRENT-vault-only (pre-merge review of #419): the
		// supersede branch's safety argument — "the delete either supersedes the
		// queued create or no-ops server-side" — collapses for a pending EDIT or
		// a foreign-vault op, where the enqueued delete could reach a note the
		// server genuinely owns despite this device having no sync evidence.
		this.syncEngine.setCrdtHasPendingOp(
			(docId) =>
				this.crdtOpQueue?.all().some((op) => {
					if (op.docId !== docId || op.kind !== "create") return false;
					// Mirror the queue's OWN delivery semantics (dropIfForeignVault):
					// an unstamped/null owner means "current vault" and WILL be
					// delivered — the probe must count it, or a delete for such a
					// doc is refused while its queued create still fires (round-3
					// review finding 1).
					const owner = op.vaultId ?? null;
					return owner === null || owner === (this.settings.vaultId ?? null);
				}) ?? false,
		);
		this.syncEngine.setCrdtPorts({
			enqueue: (op) =>
				this.crdtOpQueue?.enqueue({
					id: crypto.randomUUID(),
					kind: op.kind,
					docId: op.docId,
					payload: { path: op.path },
					enqueuedAt: Date.now(),
					attempts: 0,
					// A docId only means anything inside its vault; stamp the op so a
					// switch cannot deliver it blind on another vault's topic.
					vaultId: this.settings.vaultId ?? null,
				}),
			// Vault change: drop the unsent-doc tracking set, which holds the
			// PREVIOUS vault's note ids and would otherwise be STEP1'd against the
			// new topic by reEnrollUnsent.
			//
			// The op QUEUE is deliberately NOT wiped here. It used to be, and that
			// was wrong twice over: this hook runs at the head of a sync, by which
			// point the topic rejoin has already flushed the queue (so the leak
			// stayed open on the OAuth-relogin route), and it discarded queued
			// DELETES, which have no REST fallback and cannot be re-derived from
			// disk -- the deleted note came back on the next catch-up. Ops now carry
			// their vaultId and self-drop at send time instead.
			resetOutbox: () => {
				this.crdtWiring?.clearUnsent();
			},
		});

		// Restore last sync timestamp, offline queue, and sync state
		const saved = await this.loadPluginData();
		if (saved?.lastSync) {
			this.syncEngine.setLastSync(saved.lastSync);
		}
		if (saved?.catchupSeq !== undefined) {
			this.syncEngine.setCatchupSeq(saved.catchupSeq);
		}
		if (saved?.catchupId !== undefined) {
			this.syncEngine.setCatchupId(saved.catchupId);
		}
		if (saved?.manifestSeq !== undefined) {
			this.syncEngine.setManifestSeq(saved.manifestSeq);
		}
		if (saved?.offlineQueue?.length) {
			this.syncEngine.queue.load(saved.offlineQueue);
		}
		if (saved?.crdtOpQueue?.length) {
			this.crdtOpQueue?.load(saved.crdtOpQueue);
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
				if (file instanceof TFile && isMarkdownPath(file.path)) {
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
					// Resolve the note_id BEFORE handleDelete clears the map, and drop
					// it from the unsent-tracking set so a note deleted while offline is
					// not re-enrolled (a spurious STEP1 racing delete-wins) on rejoin.
					const noteId = this.noteIdMap.get(file.path);
					if (noteId) this.crdtWiring?.forgetUnsent(noteId);
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
				// A silent sync-bases.json write failure degrades 3-way merge to
				// 2-way after the next reload — leave a trace.
				void this.baseStore?.save().catch((e) => {
					devLog().log("base-store", `save failed: ${errMsg(e)}`);
				});
			} else if (activeDocument.visibilityState === "visible") {
				this.noteStream?.onResume();
			}
		});

		// Add commands
		this.addCommand({
			id: "sync-now",
			name: "Sync now",
			callback: async () => {
				try {
					new Notice("Engram sync: syncing...");
					const { pulled, pushed } = await this.syncEngine.fullSync();
					new Notice(`Engram Sync: pulled ${pulled}, pushed ${pushed}`);
				} catch (e) {
					this.handleSyncError("Manual sync", e, { notice: true });
				}
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
				try {
					const count = await this.syncEngine.pushAll();
					new Notice(`Engram Sync: pushed ${count} files`);
				} catch (e) {
					this.handleSyncError("Push all", e, { notice: true });
				}
			},
		});

		this.addCommand({
			id: "check-sync",
			name: "Check sync status",
			callback: async () => {
				try {
					new Notice("Engram sync: checking...");
					const result = await this.syncEngine.reconcile();
					if (!result) {
						new Notice(
							"Engram sync: server does not support reconciliation (update backend)",
						);
						return;
					}
					const { missing, diverged, extraOnServer } = result;
					if (
						missing.length === 0 &&
						diverged.length === 0 &&
						extraOnServer.length === 0
					) {
						new Notice("Engram sync: everything in sync");
					} else {
						const parts: string[] = [];
						if (missing.length > 0) parts.push(`${missing.length} missing on server`);
						if (diverged.length > 0) parts.push(`${diverged.length} diverged`);
						if (extraOnServer.length > 0)
							parts.push(`${extraOnServer.length} only on server`);
						new Notice(`Engram Sync: ${parts.join(", ")}`);
					}
				} catch (e) {
					this.handleSyncError("Sync check", e, { notice: true });
				}
			},
		});

		this.addCommand({
			id: "pull-all",
			name: "Pull all from server (force overwrite)",
			callback: async () => {
				try {
					new Notice("Engram sync: pulling all from server...");
					const count = await this.syncEngine.pullAll();
					new Notice(`Engram Sync: pulled ${count} files from server`);
				} catch (e) {
					this.handleSyncError("Pull all", e, { notice: true });
				}
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
				await this.revealSearchSidebar();
			},
		});

		this.addRibbonIcon("brain-circuit", "Engram search", async () => {
			await this.revealSearchSidebar();
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
			if (!this.hasAuthConfigured()) {
				// Signed out: a silent dead click here was the incident's limbo —
				// route to settings where the re-link lives.
				this.openConnectionSettings();
				return;
			}

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
				.catch((e) => this.handleSyncError("Manual sync", e, { notice: true }));
		});

		// The live editor<->Y.Text binding, registered ONCE for the plugin's
		// lifetime. CodeMirror creates one ViewPlugin instance per EditorView and
		// re-creates it whenever Obsidian rebuilds a leaf's editor, so the binding
		// survives file switches / heavy-load editor rebuilds with no poll and no
		// re-bind race (the old Compartment wedge class is gone). It reaches the
		// ProviderRegistry + noteIdMap through the coordinator set at stack build.
		this.registerEditorExtension([liveBindingPlugin]);
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.handleFileOpen(file)));
		// Frontmatter + reading-mode hooks (NOT the editor text binding) still key
		// off leaf/layout changes; refresh() re-attaches them for the current leaves.
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

			// Task 7C: Cold-start reconcile — diff on-disk content into the CRDT
			// doc for any markdown file that changed while the app was closed
			// (external editor, another sync app, OS). Runs after readiness is
			// set so the resulting applyLocalEdit fires normally through the CRDT
			// route. Only runs when registered and the sync gate is open so that
			// content is never transmitted before the user picks a direction.
			// Storm gate: we only reconcile ACTUALLY-drifted notes (a baseline
			// exists AND disk differs). A fresh note (no baseline) is uploaded by
			// the bounded REST fullSync — the backend bind/3 then seeds CRDT from
			// its content — and an in-sync note is already converged, so neither
			// opens a Y.Doc here. That keeps cold start from minting a doc per
			// markdown file on every connect (the reconnect-storm amplifier).
			if (gateOpen && this.crdtManager) {
				const markdownFiles = this.app.vault.getMarkdownFiles();
				for (const file of markdownFiles) {
					const crdt = this.crdtManager;
					// Resolve-or-mint the note_id up front — reconcileColdStart (Task 6)
					// routes every CRDT call by id, not path.
					const noteId = this.noteIdMap.getOrMint(file.path);
					this.app.vault
						.cachedRead(file)
						.then((diskContent) => {
							// Cheap drift gate BEFORE opening any Y.Doc.
							if (!this.syncEngine.needsColdReconcile(file.path, diskContent)) return;
							return reconcileColdStart(
								{
									path: file.path,
									noteId,
									diskContent,
									// Live reread for the manager's stale-snapshot guard:
									// startup spans the longest entry-await (IndexedDB
									// replay); a frozen diskContent diffed after a
									// concurrent remote merge would revert the merge.
									reread: () => this.app.vault.cachedRead(file),
								},
								{
									applyLocalEdit: crdt.applyLocalEdit.bind(crdt),
									getText: crdt.getText.bind(crdt),
									projectedText: crdt.projectedText.bind(crdt),
									// STEP1 only for a live-bound (open) note. A drifted-but-idle
									// note propagates its captured edit via the room-free /updates
									// send (applyLocalEdit → manager.onUpdate) — no enrollment storm.
									enroll: (id) => {
										if (this.crdtLiveViews?.isBound(file.path)) {
											this.crdtEnrollment?.enroll(id);
										}
									},
								},
								() => {
									rlog().warn(
										"crdt",
										`reconcileColdStart: Y.Doc corrupted for ${file.path} — falling back to disk content`,
									);
									new Notice(
										`Engram Sync: sync state for "${file.path.split("/").pop()}" was unreadable — using the on-disk copy.`,
										8000,
									);
								},
							);
						})
						.catch((e) => {
							rlog().warn(
								"crdt",
								`reconcileColdStart: failed to read ${file.path}: ${errMsg(e)}`,
							);
						});
				}
			}

			if (gateOpen) {
				// User has already accepted a direction for this fingerprint —
				// run an incremental sync without showing the modal.
				try {
					// Plan B1 Task 6: catch-up runs over the socket (already-known
					// notes' diverged heads), not a REST pull. The genesis path
					// (pushFile's crdt_create branch, wired above) still creates a
					// brand-new/never-synced note's server row on push, so
					// pushModifiedFiles below still needs to run to actually push
					// those local-only notes and any other local edits.
					//
					// Only run catch-up once the crdt: topic is joined: its
					// sendRequest is refused pre-join (the deaf-note race), and if the
					// join has not landed yet onCrdtTopicJoined (channel.onCrdtJoined)
					// runs the catch-up when it fires, so skipping here is safe.
					if (this.noteStream?.isCrdtConnected()) {
						await this.syncEngine.catchupViaSeqReplay();
					}
					// ponytail: not sequenced after the crdtOpQueue flush (that flush is
					// driven by the independent onCrdtJoined event; coordinating the two
					// async flows is racy and not worth it). Not a stranding hazard: an
					// offline-created note here routes through pushFile's genesis branch,
					// which itself enqueues a durable crdt_create when the topic is not yet
					// joined (sync.ts:2546). The queue is the safety net either way.
					const res = await this.syncEngine.pushModifiedFiles();
					// joined = this call rode another surface's run (e.g. the modal
					// sync); that surface reports the same numbers — don't double up.
					if (res.pushed > 0 && !res.joined) {
						new Notice(`Engram Sync: pushed ${res.pushed}`);
					}
				} catch (e) {
					this.handleSyncError("Startup sync", e);
				}
			} else {
				// Gate closed — show the preview modal so user picks a direction.
				await this.doSyncWithFirstSyncCheck();
			}
		});
	}

	/** Shared error boundary for user-initiated sync entry points (palette
	 *  commands, status-bar click, startup sync, sync after settings change).
	 *  A limit hit always gets the upgrade toast; anything else lands in
	 *  console + rlog, plus a failure Notice only when the user explicitly
	 *  asked for the sync (`notice: true`) — background syncs must not toast
	 *  every offline launch. */
	private handleSyncError(context: string, e: unknown, opts?: { notice?: boolean }): void {
		if (e instanceof LimitExceededError) {
			notifyLimitExceeded(e);
			rlog().info("lifecycle", `${context} blocked — limit reached (${e.reason})`);
			return;
		}
		// biome-ignore lint/suspicious/noConsole: error boundary
		console.error(`Engram Sync: ${context} failed`, e);
		rlog().error(
			"lifecycle",
			`${context} failed: ${errMsg(e)}`,
			e instanceof Error ? e.stack : undefined,
		);
		// A 404 on a vault-scoped call can mean the ACTIVE vault no longer
		// exists server-side (deleted from the web app / another device). The
		// old behavior — surface "HTTP 404" and keep the dead id — strands the
		// plugin forever: the accepted-gate fingerprint still matches, so every
		// later sync goes straight back to the dead vault and 404s again. Verify
		// against the authoritative vault list and self-heal by reopening the
		// picker (same recovery the web SPA's reconcileActiveVault does).
		void this.healDeadVault(e);
		if (opts?.notice) {
			new Notice("Engram sync: sync failed");
		}
	}

	/** True while a dead-vault check/heal is running — a burst of vault-scoped
	 *  404s (folders + attachments + notes all fail together) must trigger ONE
	 *  heal, not one per failed request. */
	private healingVault = false;

	/** If `e` is an HTTP 404 and the active vault id is absent from the
	 *  server's vault list, the vault is gone: clear the id, re-block sync,
	 *  and reopen the preview in the vault picker so the user re-picks or
	 *  creates one. A 404 for any OTHER reason (note not found etc.) is left
	 *  alone — the vault-list check is the discriminator. */
	private async healDeadVault(e: unknown): Promise<void> {
		if (this.healingVault) return;
		if (!isHttpStatus(e, 404) || !this.settings.vaultId) return;
		this.healingVault = true;
		try {
			const vaults = await this.api.listVaults();
			if (vaults.some((v) => v.id === this.settings.vaultId)) return;
			rlog().warn(
				"lifecycle",
				`Active vault ${this.settings.vaultId} no longer exists server-side — clearing and reopening the picker`,
			);
			this.settings.vaultId = null;
			this.settings.remoteVaultName = undefined;
			// Finding 10: EngramApi keeps its OWN vault id and stamps it on every
			// request — clearing only the settings field leaves non-sync requests
			// (sync-center retries, attachment fetches) 404ing on the dead header.
			this.api.setVaultId(null);
			this.syncGateAcceptedFor = null;
			this.syncEngine.setSyncBlocked(true);
			// Finding 9: a preview/picker already open sits on the now-nulled
			// vault, and the syncPreviewGuard makes the reopen below a silent
			// no-op while it lives. Close it first so the picker reopens fresh.
			this.openPreviewModal?.close();
			this.openPreviewModal = null;
			await this.savePluginData(this.syncEngine.getLastSync());
			new Notice(
				"Engram: this vault no longer exists on the server. Pick or create a vault to continue.",
			);
			await this.doSyncWithFirstSyncCheck({ startInVaultPicker: true });
		} catch {
			// listVaults itself failed (offline?) — nothing to conclude; the next
			// sync error re-runs this check.
		} finally {
			this.healingVault = false;
		}
	}

	onunload(): void {
		// Retire the provider FIRST: a plugin update/reload replaces this whole
		// instance, and an in-flight refresh resolving post-unload would persist
		// over the NEW instance's data.json and fork the rotating token chain
		// (two live refreshers → server reuse detection revokes the family).
		this.retireAuthProvider();
		this.crdtWiring?.dispose();
		devLog().log("lifecycle", "plugin unloading");
		rlog().info("lifecycle", "Plugin unloading");
		activeDocument.body.classList.remove("engram-vault-sync-active");
		// Flush any buffered obsidian.push spans before teardown. The buffer's
		// own 2s timer would otherwise never fire post-unload.
		this.api.beacon.flush();
		// Best-effort save before teardown — hashes must be exported before
		// destroy. Guarded: if onload threw before syncEngine was assigned, the
		// `= null!` initializer is still a lie and this would throw mid-unload.
		if (this.syncEngine) {
			void this.savePluginData(this.syncEngine.getLastSync());
		}
		this.baseStore?.prune();
		void this.baseStore?.save().catch((e) => {
			devLog().log("base-store", `save failed: ${errMsg(e)}`);
		});
		this.crdtOpQueue?.dispose();
		this.syncEngine?.destroy();
		this.noteStream?.disconnect();
		setLiveBindingCoordinator(null);
		// destroy() captures each bound doc's content SYNCHRONOUSLY before it
		// returns, so it is safe to fire destroyAll() right after even though we
		// cannot await here (onunload is synchronous) — the flush already holds the
		// real content, not an empty read of a torn-down doc.
		void this.crdtLiveViews?.destroy();
		this.crdtLiveViews = null;
		void this.crdtManager?.destroyAll();
		// CrdtChannel has no teardown — it is a stateless frame dispatcher with no
		// open resources; the WebSocket it dispatches over is owned by the Phoenix
		// channel and torn down via noteStream?.disconnect().
		if (this.syncInterval) {
			window.clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
		void destroyRemoteLog();
		// The debug API closes over the CRDT stack; leaving the global behind after
		// unload hands the next instance's console a handle to dead objects.
		uninstallDebugApi();
		// Detach the sink BEFORE the loggers go away: a HasLogging subclass torn
		// down after this point would otherwise write into a destroyed devLog.
		setLogSink(null);
		setActiveTracker(null);
		this.promiseTracker?.destroy();
		this.promiseTracker = null;
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
		// enableCrdt: the setting was deleted (CRDT is the sole md path) — drop
		// the stale key from persisted data.json on next save.
		for (const legacy of [
			"remoteLoggingEnabled",
			"diagnosticMode",
			"tracingEnabled",
			"enableCrdt",
		]) {
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
		// Infer backendMode for installs that predate it. Runs AFTER the URL
		// migration above so a legacy Cloud host is already normalized and gets
		// classified as cloud, not self-hosted.
		if (migrateBackendMode(this.settings, ENGRAM_CLOUD_URL)) {
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

	/**
	 * Install or remove `window.__engramDebug` to match the diagnostics setting.
	 *
	 * Called from saveSettings (the user toggled diagnostics) and after the CRDT
	 * stack is rebuilt (the registry it closes over was replaced). Cheap and
	 * idempotent, so both callers can fire it unconditionally.
	 */
	private refreshDebugApi(): void {
		const registry = this.crdtManager;
		if (!this.settings.diagnosticsEnabled || !registry) {
			uninstallDebugApi();
			return;
		}
		installDebugApi(
			createDebugApi({
				registry: {
					hasDoc: (id) => registry.hasDoc(id),
					projectedText: (id) => registry.projectedText(id),
					hasHistory: (id) => registry.hasHistory(id),
					encodeStateVector: (id) => registry.encodeStateVector(id),
					isSynced: (id) => registry.isSynced(id),
					hasPendingGap: (id) => registry.hasPendingGap(id),
					hasUndeliveredOps: (id) => registry.hasUndeliveredOps(id),
					enrolled: registry.enrolled,
					removedIds: registry.removedIds,
					residentIds: () => [...registry.docs.keys()],
				},
				idForPath: (path) => this.noteIdMap.get(path),
				pathForId: (id) => this.noteIdMap.pathForId(id),
				readDisk: async (path) => {
					const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
					if (!(file instanceof TFile)) return null;
					const content = await this.app.vault.read(file);
					return { length: content.length, mtime: file.stat.mtime, content };
				},
				// exportSyncState() copies the whole map per call. Acceptable: this
				// runs only when a human invokes the console API, never on a sync path.
				syncStateFor: (path) => this.syncEngine.exportSyncState()[normalizePath(path)],
				isLiveBound: (path) => this.crdtLiveViews?.isBound(path) ?? false,
				pendingPromises: () => this.promiseTracker?.pending() ?? [],
				recorder: this.syncRecorder,
			}),
		);
	}

	async saveSettings(): Promise<void> {
		this.api.updateConfig(this.settings.apiUrl, this.settings.apiKey);
		this.api.setVaultId(this.settings.vaultId);
		this.api.setTracingEnabled(this.settings.diagnosticsEnabled);
		this.syncEngine.updateSettings(this.settings);
		rlog().setLevelThreshold(this.settings.remoteLogLevel);
		rlog().setEnabled(this.settings.diagnosticsEnabled);
		this.refreshDebugApi();
		this.startSyncInterval();
		this.setupNoteStream();
		await this.savePluginData(this.syncEngine.getLastSync());

		// Re-evaluate sync gate against the new auth+vault. If the fingerprint
		// changed, this re-blocks the engine; the modal fire below will collect
		// the user's choice and unblock on acceptance.
		if (this.hasAuthConfigured()) {
			this.registerVault()
				.then(async (registered) => {
					if (!registered) {
						// Registration failed (e.g. vault cap) but auth is present.
						// Still re-evaluate the gate: a prior sign-out set it closed,
						// and skipping applySyncGate here would strand the engine
						// permanently blocked once the user re-auths. applySyncGate
						// unblocks iff the auth+vault fingerprint is accepted.
						await this.applySyncGate();
						return;
					}
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
						this.handleSyncError("Sync after settings change", e);
					}
				})
				.catch((e) => this.handleSyncError("Sync after settings change", e));
		} else {
			// No auth (signed out / API key cleared): quiesce outbound sync.
			// setupNoteStream above already dropped the WS/CRDT stack; block the
			// queue engine (gates enqueue + flush) and stop remote-log POSTs so
			// nothing hits the server with an empty bearer until re-auth.
			this.syncEngine.setSyncBlocked(true);
			rlog().setEnabled(false);
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
			// Socket op-log replay cursor (seq). Re-listed for the wholesale-save
			// reason (like deviceId) or the next saveData() wipes it; 0 = replay
			// from genesis.
			catchupSeq: this.syncEngine.getCatchupSeq(),
			// Composite-cursor id paired with catchupSeq (#312) — re-listed for the
			// wholesale-save reason.
			catchupId: this.syncEngine.getCatchupId(),
			// Manifest since_seq watermark (E1 #1065) — re-listed for the same
			// wholesale-save reason.
			manifestSeq: this.syncEngine.getManifestSeq(),
			offlineQueue: offlineQueue ?? this.syncEngine.queue.all(),
			// Re-listed on every wholesale save (like offlineQueue) or the next
			// saveData() wipes the durable CRDT ops.
			crdtOpQueue: this.crdtOpQueue?.all() ?? [],
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
		this.replaceAuthProvider(null);
		this.noteStream?.disconnect();
		this.noteStream = null;
		this.liveConnected = false;
		this.everConnected = false;
		// An open preview modal is now waiting on an enumeration that can never
		// succeed — flip it to the sign-in error instead of letting it spin out
		// the 8s enumerate budget and blame the connection.
		this.openPreviewModal?.setPlanError(planLoadErrorMessage(false));
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

	/**
	 * Rework #6: file-open keeps the instant local bind (unchanged, always
	 * synchronous), then fires the mid-session divergence heal for the opened
	 * note fire-and-forget — NOT awaited, so the open path is never blocked.
	 * This restores the coverage the deleted `verifyConvergenceOnOpen` had (a
	 * note that missed a live announce/STEP2 during a fan-out storm) without
	 * its per-open synchronous REST manifest-hash check that caused the lag.
	 */
	private handleFileOpen(file: TFile | null): void {
		this.crdtLiveViews?.refresh();
		if (file && isMarkdownPath(file.path)) {
			void this.syncEngine.healNoteOnOpen(file.path);
		}
	}

	private createAuthProvider(): AuthProvider | null {
		if (this.settings.refreshToken) {
			const refreshFn: RefreshFn = async (token) => {
				const apiUrl = EngramApi.normalizeBaseUrl(this.settings.apiUrl);
				// Bounded: getToken() serializes EVERY api call behind this refresh,
				// so a wedged half-open refresh silences the whole plugin (no HTTP
				// at all — the test_57 300s fullSync stall signature). A timeout
				// rejects with no `status`, which OAuthAuth already classifies as
				// transient (keep token, retry later).
				const resp = await withTimeout(
					requestUrl({
						url: `${apiUrl}/auth/token/refresh`,
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ refresh_token: token }),
						throw: false,
					}),
					15_000,
				);
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
		// #283: mark the identity swap so an in-flight catch-up manifest fetch
		// straddling this call refuses its destructive delete-reconcile (a stale
		// snapshot from the old identity would trash live notes as server-deleted).
		this.syncEngine.bumpAuthGeneration();
		this.settings.refreshToken = refreshToken;
		this.settings.userEmail = userEmail;
		this.settings.authMethod = "oauth";
		this.settings.vaultId = vaultId;
		// Fresh login — discard any stale persisted access token so the next
		// request mints one against the new refresh token.
		this.settings.accessToken = undefined;
		this.settings.accessTokenExpiresAt = undefined;
		this.settings.accessTokenVaultId = undefined;

		// Wire the new auth provider onto this.api BEFORE saveSettings(). saveSettings()
		// rebuilds the note channel (setupNoteStream → connectChannel), which freezes
		// the channel's topic userId from this.api.getMe() at construction. If the
		// provider is still the OLD user's when that getMe() runs, the new channel is
		// minted as crdt:<oldUserId>:<newVaultId> while the socket later authenticates
		// with the NEW user's token → the backend rejects the join "unauthorized" and
		// live sync stays silently dead until a reload. (Unlike the e2e swap helper,
		// this path has no second setupNoteStream, so shouldReuseLiveStream can't
		// recover the doomed channel — see tests/main-stream-reuse.test.ts.)
		this.replaceAuthProvider(this.createAuthProvider());
		await this.commitAuthProviderSwap();
	}

	/** Swap the active backend (Cloud <-> self-hosted). A mode switch is a full
	 *  identity swap, exactly like an OAuth login or logout, so it follows the
	 *  same sequence those do rather than a hand-rolled subset:
	 *
	 *    1. bumpAuthGeneration FIRST (#283) — a catch-up manifest fetch already in
	 *       flight against the OLD backend must refuse its destructive
	 *       delete-reconcile, or notes live in the incoming backend get trashed as
	 *       "server-deleted" against the outgoing backend's stale snapshot.
	 *    2. swap the credential set (switchMode stashes outgoing, restores incoming).
	 *    3. REBUILD the auth provider from the restored credentials. Nulling it
	 *       without rebuilding leaves an OAuth backend with no credential source at
	 *       all until Obsidian is reloaded, while the UI still reads "Signed in".
	 *    4. commitAuthProviderSwap: wire the provider onto the api BEFORE
	 *       saveSettings rebuilds the note channel, then persist.
	 *
	 *  Returns false when already in the target mode. */
	async switchBackendMode(target: BackendMode): Promise<boolean> {
		// Drain any in-flight refresh BEFORE switchMode captures the outgoing
		// credential slot. The server may have already consumed the old token;
		// settling lets the rotation persist into settings so the stash holds
		// the LIVE token — stashing the consumed one would replay a dead token
		// on switch-back and trip reuse detection (revoking the whole family).
		if (this.authProvider instanceof OAuthAuth) await this.authProvider.settle();
		if (!switchMode(this.settings, target, ENGRAM_CLOUD_URL)) return false;
		this.syncEngine.bumpAuthGeneration();
		this.noteStream?.disconnect();
		this.replaceAuthProvider(this.createAuthProvider());
		await this.commitAuthProviderSwap();
		return true;
	}

	async clearOAuthTokens(): Promise<void> {
		// #283: same identity-swap guard as saveOAuthTokens — a logout swaps the
		// provider too, so a straddling manifest fetch must not delete-reconcile.
		this.syncEngine.bumpAuthGeneration();
		// A sign-out must not leave the OTHER backend's credentials sitting in
		// data.json: that file replicates to every machine syncing .obsidian.
		this.settings.inactiveBackend = undefined;
		this.settings.refreshToken = undefined;
		this.settings.userEmail = undefined;
		this.settings.authMethod = null;
		this.settings.accessToken = undefined;
		this.settings.accessTokenExpiresAt = undefined;
		this.settings.accessTokenVaultId = undefined;

		// Same ordering invariant as saveOAuthTokens (see the comment there):
		// swap the provider onto this.api BEFORE saveSettings() rebuilds the note
		// channel, or the rebuild freezes the OUTGOING OAuth user's id into the
		// topic while the socket authenticates with the apiKey identity → the
		// backend rejects the join "unauthorized" and live sync stays dead until
		// a reload.
		this.replaceAuthProvider(
			this.settings.apiKey
				? new ApiKeyAuth(this.settings.apiKey, this.settings.vaultId)
				: null,
		);
		await this.commitAuthProviderSwap();
	}

	/** Reveal the search sidebar, creating its leaf on first use. Shared by the
	 *  palette command and the ribbon icon (previously byte-identical copies). */
	private async revealSearchSidebar(): Promise<void> {
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
	}

	/** Retire the outgoing provider before any swap replaces it. Two live
	 *  OAuthAuth instances refreshing the same rotating token chain fork it,
	 *  and the server's reuse detection revokes the whole family — which is
	 *  what killed a prod first-sync mid-flight on 2026-08-12. Disposal also
	 *  keeps a refresh already in flight on the OLD instance from persisting
	 *  its (forked) result over the NEW instance's tokens on disk. */
	private retireAuthProvider(): void {
		if (this.authProvider instanceof OAuthAuth) {
			this.authProvider.dispose();
		}
	}

	/** The ONLY way to overwrite this.authProvider: retire the outgoing
	 *  instance, then assign. A raw assignment that skips retirement is how
	 *  the two-live-refresher fork silently returns — route every new swap
	 *  path through here. (auth-state.ts's resetAuthProvider closure disposes
	 *  on its own because it types the plugin structurally.) */
	private replaceAuthProvider(next: AuthProvider | null): void {
		this.retireAuthProvider();
		this.authProvider = next;
	}

	/** Shared tail of saveOAuthTokens/clearOAuthTokens: wire the (already
	 *  swapped) provider onto the api BEFORE saveSettings() rebuilds the note
	 *  channel — the rebuild freezes the channel topic's userId from
	 *  api.getMe() at construction, so a stale provider mints a doomed
	 *  crdt:<oldUser>:<vault> topic the backend rejects "unauthorized" and
	 *  live sync stays dead until reload. Then persist and hand the provider
	 *  to the live stream. */
	private async commitAuthProviderSwap(): Promise<void> {
		// Unconditional: wiring null on sign-out matters as much as wiring the
		// new provider — a skipped rewire leaves the api holding the previous
		// (now disposed) instance, and every later call throws "OAuthAuth
		// disposed" instead of running unauthenticated.
		this.api.setAuthProvider(this.authProvider);

		await this.saveSettings();

		if (this.authProvider && this.noteStream) {
			this.noteStream.setAuthProvider(this.authProvider);
			this.noteStream.setAuthProbe(() => this.api.getMe());
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
		// Relay model: tear the persistent CRDT stack down ONLY on a real identity
		// change (vault/account/backend switch). A plain transport reconnect (same
		// identity) KEEPS the manager + Y.Docs — only the socket below is rebuilt.
		// Destroying the stack on every reconnect was the wedge: it forced a full
		// re-push that doubled the lineage server-side, and no LRU/doc-level fix
		// could survive the whole manager being nuked.
		if (connectionKey !== this.crdtStackKey) {
			setLiveBindingCoordinator(null);
			// Sync content capture (see onunload) makes destroy-then-destroyAll safe
			// without an await here (setupNoteStream is synchronous).
			void this.crdtLiveViews?.destroy();
			this.crdtLiveViews = null;
			this.crdtWiring?.dispose();
			this.crdtWiring = null;
			void this.crdtManager?.destroyAll();
			this.crdtManager = null;
			this.crdtEnrollment?.resetAll();
			this.crdtEnrollment = null;
			this.crdtStackKey = null;
			// Clear the SyncEngine references explicitly (setConnected(false) is
			// transition-gated and can no-op under offline retention), so a destroyed
			// manager never outlives its session as a zombie.
			this.syncEngine.setCrdtPorts({ manager: null, enrollment: null });
			// A genuinely new identity must re-confirm CRDT support before offline
			// capture stays active (degrades to legacy until the new server joins).
			this.crdtEverJoined = false;
		}

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

	/**
	 * Reconcile the id-map, re-arm CRDT enrollments, and run the socket catch-up
	 * on a crdt: topic (re)join. Invoked ONLY from channel.onCrdtJoined, i.e. after
	 * the crdt: join is server-acked (crdtJoined=true), so catchupViaSeqReplay's
	 * crdt_catchup_since sendRequest is guaranteed past the join gate. Wiring the
	 * catch-up to the sync-topic onStatusChange (which acks first) let the
	 * sendRequest reject with "crdt topic not joined" and silently drop with no
	 * retry, the deaf-note class:
	 * idle notes and notes another device created during the disconnect never
	 * converged. CRDT socket only, no REST fallback.
	 */
	private async onCrdtTopicJoined(): Promise<void> {
		// Repair a stale noteIdMap from the server manifest BEFORE re-enrolling and
		// catch-up: live pull and catch-up resolve the disk path via
		// noteIdMap.pathForId, and after the id-keying cutover a cursor-bearing
		// device never re-ran bootstrap(), so its map stayed stale and inbound
		// frames stranded ("no known path"). Throttled: a reconnect storm must not
		// fire a manifest fetch per reconnect (the 2026-07-09 pool-exhaustion class,
		// see lastMapReconcileAt). Stamp the timestamp BEFORE the await so a burst
		// arriving faster than one round-trip sees the throttle already engaged.
		const now = Date.now();
		if (now - this.lastMapReconcileAt > EngramSyncPlugin.RECONCILE_THROTTLE_MS) {
			this.lastMapReconcileAt = now;
			try {
				const n = await this.syncEngine.reconcileNoteIdMapFromManifest();
				if (n > 0) {
					rlog().info("crdt", `noteIdMap reconciled from manifest: ${n} notes`);
				}
			} catch (e) {
				rlog().warn(
					"crdt",
					`noteIdMap manifest reconcile failed (live pull may strand until next sync): ${errMsg(e)}`,
				);
			}
		}
		// Reset all CRDT enrollments so a fresh startSync STEP1 handshake fires for
		// each note after reconnect, then re-enroll every open note so the server
		// re-registers this device as a room observer (the active-leaf-change handler
		// only fires on a tab switch). Mirrors the web client's reconnect resync; on
		// the initial join it is a near no-op (already enrolled).
		this.crdtEnrollment?.resetAll();
		// A reconnect just reconciled the noteIdMap above, so any note_id stranded by
		// map drift deserves fresh retry attempts against the now-current map, not a
		// counter left over from before the drift was fixed.
		this.crdtWiring?.clearStrandHealAttempts();
		this.reEnrollOpenCrdtNotes();
		// reEnrollOpenCrdtNotes only re-enrolls notes still open in an editor. A
		// note edited while the socket was down and then switched away from has no
		// leaf, so its held offline edit would never be re-solicited. Re-enroll any
		// doc whose live update was refused while unjoined so the mutual handshake
		// recovers it (switch-away data-loss class).
		this.crdtWiring?.reEnrollUnsent();
		// Sole convergence path on (re)connect: replay the seq-ordered op-log from
		// our persisted cursor. Every op missed while away is delivered IN ORDER
		// with FULL content, so it can't pend the way the old state-vector delta
		// could (deaf-note, e2e test_85). Discovery rides the same feed: a note
		// another device created during the disconnect arrives as an op and
		// materializes. Never throws into the caller; a socket-drop mid-replay is
		// logged and resumed from the persisted cursor on the next join.
		try {
			await this.syncEngine.catchupViaSeqReplay();
		} catch (e) {
			rlog().warn("crdt", `socket seq-replay on reconnect failed: ${errMsg(e)}`);
		}
		// Drain the durable queue now that the crdt topic is LIVE (Phase E3):
		// the socket is the ONLY delivery path for queued crdt edits, and the
		// drain deliberately skips them while the topic is down — without this
		// kick, an edit captured during the pre-join window (e.g. held behind
		// its create-ack) waits for the next periodic flush (~20s+), which
		// stalled e2e test_82's push past the assert window (CI 29945060029).
		// The old REST /updates fallback delivered regardless of topic state,
		// masking the missing kick.
		void this.syncEngine.flushQueue();
	}

	/** Attempt to connect the WebSocket channel with retry on getMe() failure. */
	private connectChannel(attempt = 0, epoch = this.channelEpoch): void {
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
				// Identity guard: the topic userId is frozen from this getMe() id at
				// construction while the socket later authenticates with
				// this.authProvider's token. If the provider is still a PRIOR
				// identity's when getMe() resolves (an OAuth rebind that mutated
				// settings before the provider caught up, incl. a rebind BACK to a
				// previously-used account where the email-based channelConnectionKey
				// coincides), building now would mint crdt:<wrongUserId>:<vaultId> and
				// the backend rejects the join "unauthorized". Retry (epoch-guarded,
				// capped backoff) until the provider catches up or a newer
				// setupNoteStream() supersedes. Never adopt a channel whose
				// authenticated identity disagrees with the one we intend to connect
				// as. See channelIdentityMatches.
				if (!channelIdentityMatches(this.settings.userEmail, user.email)) {
					rlog().warn(
						"channel",
						`connectChannel identity mismatch: getMe()=${user.email} but connecting as ${this.settings.userEmail}; provider not yet swapped, retrying`,
					);
					if (epoch === this.channelEpoch) {
						window.setTimeout(
							() => this.connectChannel(attempt + 1, epoch),
							connectRetryDelayMs(attempt),
						);
					}
					return;
				}
				const channel = new NoteChannel(
					this.settings.apiUrl,
					this.settings.apiKey,
					user.id,
					this.settings.vaultId,
					this.deviceId,
				);
				channel.setAuthProbe(() => this.api.getMe());

				channel.onEvent = (event) => {
					void this.syncEngine.handleStreamEvent(event);
				};

				channel.onStatusChange = (connected) => {
					this.liveConnected = connected;
					if (connected) this.everConnected = true;
					if (!connected) {
						// A dropped channel is the earliest wedge signal: any HTTP
						// request in flight on a now-half-open pooled connection would
						// otherwise hang to its full deadline (issue #244 follow-up).
						// Probe /health on a fresh connection and fail the wedged ones
						// now so pull/push recovery runs in seconds.
						void this.api.failWedgedRequests();
					}
					this.updateStatusBar(this.syncEngine.getStatus());
					if (connected) {
						// Forget confirmed-note-id status: across a (re)connect the
						// server's view may have diverged (another device deleted/renamed
						// a note, or the backing store was reset). A stale "confirmed"
						// entry routes a note's first write to CRDT, which the server
						// silently drops for a note it has no row for. Clearing biases the
						// next write back to durable REST; the crdt-join catch-up re-
						// confirms whatever changed.
						this.syncEngine.clearConfirmedNoteIds();
						// The noteIdMap reconcile, CRDT re-enrollment, and socket catch-up
						// do NOT run here. This is the SYNC-topic ack, which fires BEFORE
						// the crdt: topic join sets crdtJoined=true. Running catch-up now
						// makes catchupViaSeqReplay's crdt_catchup_since sendRequest reject
						// with "crdt topic not joined" and silently drop, the deaf-note
						// reconnect race. They run
						// from channel.onCrdtJoined (onCrdtTopicJoined) instead, which fires
						// only after the crdt: join is server-acked.
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
							this.syncEngine.setCrdtPorts({ manager: null });
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
						// Relay model: mark every resident provider offline so local edits
						// buffer (flushed via syncStep1 on the next setConnected(true)) and
						// no frame is written to a dead socket.
						this.crdtManager?.setConnected(false);
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

				channel.onFoldersChanged = () => {
					this.syncEngine.resyncFolders().catch((e) => {
						rlog().warn("pull", `Live folder resync failed: ${errMsg(e)}`);
					});
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

				// Plan B1 Task 6: wire the socket-native create/delete/catchup senders
				// into the engine. Harmless to wire unconditionally — each sender is
				// only consulted once the engine's own crdt manager is set (vaultId
				// bound), so this is a no-op on a legacy/non-CRDT connection.
				this.syncEngine.setCrdtPorts({
					create: (id, path) => channel.crdtCreate(id, path),
					// Direct AWAITED delete for handleRename's ordered tombstone->
					// resurrect relocation (the durable-queue delete is still wired
					// below for the non-rename / offline paths). Delete (and durable
					// create genesis) otherwise route through the plugin-lifetime
					// crdtOpQueue, wired once in onload, not per-channel here.
					delete: (id) => channel.crdtDeleteAcked(id),
					// Single-path convergence: seq-ordered op-log replayed over the
					// socket. Vault-mismatch guard (#314) + composite-cursor
					// forwarding (#312), extracted to a tested helper so a dropped
					// arg can't silently make the fix inert (TS bivariance accepts a
					// shorter closure).
					catchupSince: makeCrdtCatchupSender(channel, () => this.settings.vaultId),
				});

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
				if (this.settings.vaultId) {
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
					// Relay model: the persistent CRDT stack (manager + wiring +
					// liveViews + Y.Docs) is built ONCE per identity and OUTLIVES the
					// socket. A reconnect rebuilds only the transport (a fresh
					// NoteChannel, below) and re-points it at this surviving wiring — the
					// Y.Docs are NEVER destroyed, so reconnect is a clean syncStep1 diff,
					// not a full re-push that doubles the lineage (the "one breaks, all
					// break" wedge). `sendCrdt` reads `this.noteStream` (assigned just
					// above) at call time so a swapped socket is transparent.
					if (!this.crdtWiring) {
						const wiring = createCrdtWiring({
							noteIdMap: this.noteIdMap,
							syncEngine: this.syncEngine,
							recorder: this.syncRecorder,
							// BaseStore is keyed by vault path and already holds exactly the
							// last-synced content its own docstring calls "the common
							// ancestor for 3-way merge"; the registry is keyed by note_id,
							// so resolve through the id map.
							lcaFor: (noteId) => {
								const path = this.noteIdMap.pathForId(noteId);
								return path ? (this.baseStore?.get(path)?.content ?? null) : null;
							},
							onDirtyMerge: (noteId) =>
								rlog().warn(
									"crdt",
									`LCA merge left unapplied hunks for ${noteId} — fell back to the two-way path`,
								),
							// `?? false`: a null socket (mid-reconnect) must read as REFUSED so
							// the frame is held in unsentDocIds and flushed on rejoin — never
							// silently dropped as if sent.
							sendCrdt: (docId, frame) =>
								this.noteStream?.sendCrdt(docId, frame) ?? false,
							// crdtLiveViews is constructed just below; read the field at call
							// time, never capture a value.
							isBound: (path) => this.crdtLiveViews?.isBound(path) ?? false,
							boundPaths: () => this.crdtLiveViews?.boundPaths() ?? [],
							// Fix wave 6: nudge Obsidian's save pipeline after a remote merge
							// paints into an unfocused bound editor (CI doesn't flush it).
							onBoundUpdate: (path) =>
								this.crdtLiveViews?.requestSaveForBoundPath(path),
							// Gate live crdt_msg on the note's create-ack. hasServerNote
							// (crdtHead-backed) survives reconnect; confirmedNoteIds does not.
							canSendLive: (id) => this.syncEngine.hasServerNote(id),
						});
						this.crdtWiring = wiring;
						this.crdtManager = wiring.manager;
						this.crdtEnrollment = wiring.enrollment;
						this.syncEngine.setCrdtPorts({ enrollment: this.crdtEnrollment });
						this.crdtLiveViews = new CrdtLiveViews({
							app: this.app,
							manager: this.crdtManager,
							enrollment: this.crdtEnrollment,
							// Resolve-or-mint: the editor binding needs a note_id immediately
							// on open, even for a brand-new never-pushed note.
							resolveId: (path) => this.noteIdMap.getOrMint(path),
							resolveExistingId: (path) => this.noteIdMap.get(path),
							flushToDisk: (path, content) =>
								this.syncEngine.flushFromCrdt(path, content).then(() => {}),
							onReleaseError: (path, err) =>
								rlog().warn(
									"crdt",
									`Last-release flush failed for ${path} (doc left resident): ${err instanceof Error ? err.message : String(err)}`,
								),
						});
						// Point the editor ViewPlugin at this stack's coordinator. Set on the
						// module singleton the plugin reads (Relay's getConnectionManager
						// pattern); cleared to null on teardown so a stale stack can't be hit.
						setLiveBindingCoordinator(this.crdtLiveViews);
						// Tell the sync engine which paths have a live editor binding so its
						// disk-modify handler skips re-feeding disk content into the Y.Text
						// for open notes (the binding owns them).
						this.syncEngine.setCrdtPorts({
							liveBound: (path) => this.crdtLiveViews?.isBound(path) ?? false,
						});
						// Remember the identity this stack belongs to. setupNoteStream tears
						// the stack down ONLY when this key changes (real vault/account/backend
						// switch), never on a plain transport reconnect.
						this.crdtStackKey = channelConnectionKey(this.settings);
					}
					// Bind whatever leaves are open now — a fresh stack saw none at build;
					// a reconnect re-checks in case the open set changed while offline.
					this.crdtLiveViews?.refresh();
					this.refreshDebugApi();
					// Re-point the NEW channel's inbound callbacks at the PERSISTENT wiring
					// every (re)connect. The wiring (and its box.channel) outlives the socket.
					const wiring = this.crdtWiring;
					if (wiring) {
						channel.onCrdtMessage = wiring.onCrdtMessage;
						channel.onCrdtDocReady = wiring.onCrdtDocReady;
						channel.onCrdtNoteNotFound = wiring.onCrdtNoteNotFound;
						channel.onNoteYjsUpdate = wiring.onNoteYjsUpdate;
					}
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
						this.syncEngine.setCrdtPorts({ manager: this.crdtManager });
						// Relay model: the crdt: topic is now joined, so frames can go out.
						// Mark every resident provider connected — this re-advertises each
						// via syncStep1 (a state-vector diff, never a full re-push) AND
						// flushes any frames buffered while offline. This is the reconnect
						// convergence trigger; the enroll/catch-up below layer on id-map
						// reconcile + seq replay.
						this.crdtManager?.setConnected(true);
						// Deliver any HELD create/delete ops FIRST, then reconcile the
						// id-map, re-enroll open notes, and run the socket catch-up.
						// onCrdtTopicJoined re-creates NOTHING (it is catch-up/pull-only,
						// no pushModifiedFiles), so this ordering is not a re-push guard.
						// The double-crdt_create guard lives elsewhere: the queue coalesces
						// to one create per docId, pushFile's genesis branch is gated on
						// !hasServerNote (a later edit after the ack's head-flip routes as a
						// crdt_msg, not a re-create), and a genuine duplicate is rejected
						// server-side as id_conflict (terminal). Flushing here is simply the
						// sole convergence trigger on (re)connect; wiring it here (not the
						// sync-topic onStatusChange, which acks first) is what fixes the
						// deaf-note race. See onCrdtTopicJoined.
						void (async () => {
							await this.crdtOpQueue?.onJoined();
							await this.onCrdtTopicJoined();
						})();
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
						this.syncEngine.setCrdtPorts({ manager: null });
						// Invalidate any handshake marks so a future re-join starts clean.
						this.crdtManager?.clearSynced();
						// Relay model: no crdt: topic → providers offline (buffer, don't send).
						this.crdtManager?.setConnected(false);
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
						"vaultId is null — CRDT disabled; legacy pushNote path active",
					);
				}

				void channel.connect();
			})
			.catch((e) => {
				// biome-ignore lint/suspicious/noConsole: error boundary
				console.error("Engram Sync: failed to fetch user id for channel", e);
				rlog().error("channel", `getMe() failed (attempt ${attempt + 1}): ${errMsg(e)}`);

				// Retry forever (capped exponential backoff) — a finite attempt cap
				// left live sync permanently dead after a >30s backend outage, with
				// no recovery until plugin reload. Only a newer setupNoteStream()
				// (epoch bump) may abandon the loop.
				if (epoch === this.channelEpoch) {
					window.setTimeout(
						() => this.connectChannel(attempt + 1, epoch),
						connectRetryDelayMs(attempt),
					);
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
				// Snapshot local files BEFORE opening the gate: markSyncGateAccepted
				// lets queued live WS events into the vault, and a race-delivered
				// remote note would otherwise look "local" to the replace-remote
				// push and dodge the server-only delete (test_86 gate-open race).
				// See SyncEngine.snapshotLocalPaths.
				const localSnapshot = this.syncEngine.snapshotLocalPaths();
				await this.markSyncGateAccepted();
				const pushed = await this.syncEngine.pushAll({
					replaceRemote: true,
					localSnapshot,
				});
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
		// Stash the plan so the settings-pane bar (prev callback) renders the same
		// plan-aware counts as the modal, not the raw examine-count denominator.
		this.activeSyncPhases = phases ?? null;
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
			this.activeSyncPhases = null;
		}
	}

	/** True when both `apiUrl` and at least one of `apiKey` (self-hosted /
	 *  static key) or `refreshToken` (OAuth device flow) are set. Used to gate
	 *  startup sync, post-saveSettings sync, the status-bar click handler, and
	 *  the periodic sync interval — all of which need to fire for OAuth users
	 *  too, not just static-key users. */
	hasAuthConfigured(): boolean {
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
		// Pull what the gate held back (#425). A blocked replay now bails before
		// walking, which preserves the catch-up cursor — so those feed rows are
		// still waiting, and until now nothing asked for them on unblock. The
		// pull only happened if the user separately triggered a FullSync, which
		// is exactly the path that left a vault empty in prod on 2026-08-13.
		// After setSyncBlocked(false), never before, or this bails on the gate
		// it is meant to be draining.
		//
		// Deliberately fire-and-forget and WITHOUT an onFileApplied: this call is
		// the safety net, not the UI. When the user came through the preview modal
		// the follow-on sync owns the progress surface, and the replay's tick
		// fan-out means whichever of the two starts first still feeds that
		// surface. Awaiting here would instead stall the modal's own dismissal
		// behind a full vault pull. The trade is that an accept with no follow-on
		// sync pulls silently — correct, just quiet.
		void this.syncEngine.catchupViaSeqReplay().catch((e) => {
			rlog().warn("lifecycle", `gate-open catch-up failed: ${errMsg(e)}`);
		});
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
						// The picker lists EVERY vault including the active one, so a
						// user can "change" to the vault they are already on. That is
						// not a vault change: falling through would wipe lastSync and
						// the per-vault state for no reason, and the empty lastSync
						// then pulls back anything deleted-but-not-yet-pushed.
						if (id === this.settings.vaultId) {
							this.settings.remoteVaultName = name;
							return this.syncEngine.computeSyncPlan("full");
						}
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
						// New vault = new id/path space; re-reconcile on next connect
						// (bypass the throttle — this isn't a storm, it's a real swap).
						this.lastMapReconcileAt = 0;
						// Strand-heal retry counts are scoped to the previous vault's
						// note_ids (final review MINOR-6) — stale counts here could
						// prematurely give up on a note_id that happens to be reused
						// in the new vault.
						this.crdtWiring?.clearStrandHealAttempts();
						this.syncEngine.setSyncBlocked(true);
						await this.savePluginData(this.syncEngine.getLastSync());
						// Re-render the settings tab so the vault name span and
						// any other vault-derived UI pick up the switch.
						this.settingTab?.rerender();
						// Rebuild the stream for the NEW vault before computing the
						// plan: the preview enumerates server state off the crdt:
						// op-log socket, which is vault-scoped. The connection key
						// includes the vault, so this tears down the old vault's
						// channel and rejoins crdt: for the new one. setupNoteStream
						// (unlike saveSettings) does NOT re-fire doSyncWithFirstSyncCheck,
						// so it won't stack a second modal. computeSyncPlan's
						// enumerateServerState waits for the new join to land before
						// enumerating (SyncEngine.enumerateWaitMs).
						this.setupNoteStream();
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
						modal.setPlanError(planLoadErrorMessage(this.hasAuthConfigured()));
						rlog().error("lifecycle", `Sync plan compute failed: ${errMsg(e)}`);
					});

				this.openPreviewModal = modal;
				const choice = await modal.awaitChoice();
				this.openPreviewModal = null;

				await this.runSyncWithProgress(choice, {
					plan: modal.getPlan(),
					firstSync: context === "first-time",
				});
			} catch (e) {
				// biome-ignore lint/suspicious/noConsole: error boundary
				console.error("Engram Sync: sync failed", e);
				// This boundary wraps BOTH the preview and the sync run it
				// dispatches — "preview failed" here mislabeled real sync failures.
				new Notice("Engram: sync failed. Open the sync log for details.");
				rlog().error("lifecycle", `Sync (preview or run) failed: ${errMsg(e)}`);
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
	/** Register/unregister the preview modal that auth invalidation should poke
	 *  with the sign-in error. Public so BOTH entry points (first-sync command
	 *  and Sync Center) share the seam — the Sync Center modal missing it left
	 *  the incident's 8s-spin-then-blame-connection limbo alive there. */
	trackPreviewModal(modal: { close(): void; setPlanError(msg: string): void }): void {
		this.openPreviewModal = modal;
	}

	untrackPreviewModal(modal: { close(): void; setPlanError(msg: string): void }): void {
		if (this.openPreviewModal === modal) this.openPreviewModal = null;
	}

	openConnectionSettings(): void {
		this.settingTab?.setInitialTab("connection");
		const setting = (
			this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }
		).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

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

		if (!this.hasAuthConfigured()) {
			// Signed out (or never linked): "ready" here was a lie the 2026-08-12
			// incident shipped — after a forced sign-out the bar claimed ready
			// while every sync path was dead.
			text = "Engram: signed out";
			tooltip = "Not signed in. Click to open settings and reconnect.";
		} else if (blocked && status.state !== "syncing") {
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
		// hasAuthConfigured guard: dead auth PRODUCES logged sync errors, so
		// without it the error badge overwrites "signed out" in exactly the
		// forced-sign-out state the branch above exists for.
		if (errorCount > 0 && status.state === "idle" && !blocked && this.hasAuthConfigured()) {
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
					// Socket-only fallback poll (no REST): reconcile manifest
					// server-deletes/folder-markers + replay the op-log. No-ops when
					// the socket is down; a wedged socket recovers on reconnect.
					const { files: pulled, deletes } = await this.syncEngine.catchUp();
					// deletes counted separately (finding: a delete-only poll used to
					// trash local files with NO user-visible indication).
					if (pulled + deletes > 0) {
						new Notice(`Engram Sync: pulled ${pulled + deletes} changes`);
					}
				} catch (e) {
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: periodic catch-up failed", e);
				}
			})();
		}, EngramSyncPlugin.FALLBACK_POLL_MS);
		this.registerInterval(this.syncInterval);
	}
}
