/**
 * Sync engine — handles push/pull logic, debouncing, and ignore patterns.
 */
import { type App, Notice, type TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { type EngramApi, arrayBufferToBase64, base64ToArrayBuffer } from "./api";
import type { BaseStore } from "./base-store";
import { devLog } from "./dev-log";
import { errMsg } from "./error-util";
import type { ExplicitFolders } from "./explicit-folders";
import { IgnoredFiles } from "./ignored-files";
import {
	IssueStore,
	categorizeError,
	healthCheckDelay,
	issueDisposition,
	shouldGoOffline,
	shouldRetryAfterFailure,
} from "./issue-store";
import { isTextAttachment } from "./mime";
import { OfflineQueue } from "./offline-queue";
import { type PlanState, attachmentCapabilityGained } from "./plan-state";
import { rlog } from "./remote-log";
import type { SyncLog } from "./sync-log";
import { threeWayMerge } from "./three-way-merge";
import type {
	AttachmentChange,
	BatchUpsertResult,
	ConflictInfo,
	ConflictResolution,
	EngramSyncSettings,
	FileSyncState,
	NoteChange,
	NoteStreamEvent,
	QueueEntry,
	ReconcileResult,
	SyncIssueCategory,
	SyncLogEntry,
	SyncPlan,
	SyncProgress,
	SyncStatus,
} from "./types";

/** Check if an error is an HTTP response with the given status code.
 *  Obsidian's requestUrl() throws objects with a `status` property on non-2xx. */
function isHttpStatus(e: unknown, status: number): boolean {
	return typeof e === "object" && e !== null && (e as { status?: number }).status === status;
}

/** Count distinct parent folders across the given file paths. Files at the
 *  root contribute nothing; "a/b/c.md" contributes "a/b". Used by the sync
 *  preview to surface "how many folders contain files" per side. */
function countFolders(paths: Iterable<string>): number {
	const set = new Set<string>();
	for (const p of paths) {
		const idx = p.lastIndexOf("/");
		if (idx > 0) set.add(p.substring(0, idx));
	}
	return set.size;
}

/** How long (ms) after a push completes to suppress WebSocket echoes for that path. */
const ECHO_COOLDOWN_MS = 5000;

/** Paths that are always ignored regardless of user settings.
 *  Note: Obsidian's config dir defaults to `.obsidian` but can be customized;
 *  shouldIgnore() reads `app.vault.configDir` at runtime to handle that. */
const ALWAYS_IGNORED = [".trash/", ".git/"];

/** If we have no sync hash and the local file's mtime is older than the remote
 *  mtime by at least this many seconds, treat the file as stale (not locally
 *  modified) and skip conflict detection. 1 hour is conservative — if a user
 *  edited a file, its mtime will be within seconds/minutes of the remote push,
 *  not hours behind. */
const STALE_THRESHOLD_S = 3600;

/** Fast string hash (FNV-1a 32-bit). Not cryptographic — just for content change detection. */
export function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Binary file extensions that sync as attachments. */
const BINARY_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"bmp",
	"svg",
	"webp",
	"pdf",
	"mp3",
	"wav",
	"ogg",
	"m4a",
	"webm",
	"flac",
	"mp4",
	"mov",
	"zip",
]);

/** All syncable extensions (text + binary). Canvas files are text (JSON). */
const TEXT_EXTENSIONS = new Set(["md", "canvas"]);

/** MIME types by extension. */
const MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	bmp: "image/bmp",
	svg: "image/svg+xml",
	webp: "image/webp",
	pdf: "application/pdf",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
	flac: "audio/flac",
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	zip: "application/zip",
	canvas: "application/json",
};

export class SyncEngine {
	private debounceTimers: Map<string, number> = new Map();
	private ignorePatterns: string[] = [];
	private pushing: Set<string> = new Set();
	private recentlyPushed: Map<string, number> = new Map();
	private pulling = false;
	private lastSync = "";
	private lastError = "";
	private offline = false;
	private healthCheckTimer: number | null = null;
	/** Consecutive failed health probes — drives exponential backoff. */
	private healthCheckFailures = 0;
	private ready = false;
	/** When true, all sync actions (file events, stream events, bulk methods)
	 *  short-circuit to a no-op. Controlled by the plugin layer based on
	 *  whether the user has accepted a sync direction in SyncPreviewModal for
	 *  the current auth+vault fingerprint. */
	private syncBlocked = false;
	private activePushCount = 0;
	private maxConcurrentPushes = 5;
	private pushWaiters: (() => void)[] = [];
	private rateLimitRPM = 0; // 0 = unlimited
	private requestTimestamps: number[] = [];
	readonly queue: OfflineQueue = new OfflineQueue();

	/** Per-file sync metadata (content hash + server version).
	 *  Used to detect whether the user actually modified a file since
	 *  the last sync (Obsidian sets mtime to "now" on vault.modify(),
	 *  making mtime-based detection unreliable). */
	private syncState: Map<string, FileSyncState> = new Map();

	/** The server vaultId that the current syncState belongs to. lastSync and
	 *  per-file hashes are scoped to one server vault; if the active vault
	 *  changes out from under us, this stale bookkeeping must be invalidated
	 *  or fullSync compares against the wrong vault and pushes nothing / wrong
	 *  files. `null` means "not yet recorded" (fresh install or pre-upgrade
	 *  data) and is adopted without wiping. */
	private syncStateVaultId: string | null = null;

	/** Optional base content store for 3-way merge (Step 2+). */
	baseStore: BaseStore | null = null;

	/** Persisted set of server-side "explicit empty folder" markers. Owned by
	 *  the plugin layer (main.ts) and assigned after construction, matching the
	 *  baseStore pattern. */
	explicitFolders: ExplicitFolders | null = null;

	/** Called whenever sync status changes (for status bar updates). */
	onStatusChange: ((status: SyncStatus) => void) | null = null;

	/** Called when a conflict is detected. Return the user's resolution.
	 *  If null, conflicts are auto-resolved as keep-remote (legacy behavior). */
	onConflict: ((info: ConflictInfo) => Promise<ConflictResolution>) | null = null;

	/** Called after each batch during pushAll/pullAll to report progress. */
	onSyncProgress: ((progress: SyncProgress) => void) | null = null;

	/** Last-known plan/entitlement state, fed by the channel's `onPlanState`
	 *  callback (user-topic join reply + `subscription_activated`). Drives the
	 *  upgrade-triggered re-sync of plan-skipped attachments. Null until the
	 *  first plan event arrives (or an older backend that never sends one). */
	private planState: PlanState | null = null;

	/** Set by main.ts to persist plan state to settings when it changes. */
	onPlanStatePersist: ((p: PlanState) => void) | null = null;

	/** Optional sync log — receives an entry for each push/pull outcome. */
	syncLog: SyncLog | null = null;

	/** Persistent record of files that failed to sync, with reason. Surfaced
	 *  in the Sync Center "Issues" panel and used to short-circuit the offline
	 *  queue for terminal failures (e.g. 413 Payload Too Large). */
	readonly issues: IssueStore = new IssueStore();

	/** Per-file explicit ignores (the Sync Center "Ignore" button). Honored by
	 *  shouldIgnore so excluded files never enter push plans, isSyncable filters,
	 *  or the Issues list. Distinct from settings.ignorePatterns (regex textarea). */
	readonly ignoredFiles: IgnoredFiles = new IgnoredFiles();

	/** Count of attachments skipped this session because the backend returned
	 *  402 attachments_disabled (Free tier). Reset on each batch via
	 *  drainAttachmentLimitedCount() so a single batched toast can be fired
	 *  per push cycle (spec §4.6). */
	private attachmentLimitedThisBatch = 0;

	/** Count of generic (non-needs_pro) push failures this batch, plus the
	 *  first server message seen — drained by main.ts into a single aggregated
	 *  "N file(s) failed to sync — open Sync Center" Notice. */
	private failuresThisBatch = 0;
	private firstFailureMessageThisBatch: string | undefined;

	/** Suppresses re-toasting once we've already shown the "N attachments
	 *  skipped" notice in this plugin session. Re-armed only when the engine
	 *  is destroyed/reloaded so the user isn't nagged on every fullSync. */
	private attachmentLimitToastShown = false;

	constructor(
		private app: App,
		private api: EngramApi,
		private settings: EngramSyncSettings,
		private saveData: (data: { lastSync: string }) => Promise<void>,
	) {
		this.parseIgnorePatterns();
	}

	updateSettings(settings: EngramSyncSettings): void {
		this.settings = settings;
		this.parseIgnorePatterns();
	}

	/** Mark the engine as ready to handle vault events.
	 *  Called after layout is ready and initial sync completes. */
	setReady(): void {
		this.ready = true;
		devLog().log("lifecycle", "setReady — event handlers enabled");
		rlog().info("lifecycle", "Engine ready — event handlers enabled");
	}

	setSyncBlocked(blocked: boolean): void {
		this.syncBlocked = blocked;
		devLog().log("lifecycle", `setSyncBlocked(${blocked})`);
	}

	isSyncBlocked(): boolean {
		return this.syncBlocked;
	}

	setLastSync(timestamp: string): void {
		this.lastSync = timestamp;
	}

	getLastSync(): string {
		return this.lastSync;
	}

	/** Reset all per-vault sync bookkeeping. Used when the user switches the
	 *  active server vault inside the SyncPreviewModal so the next sync starts
	 *  from a clean slate (lastSync empty, no stale per-file hashes). */
	async resetForVaultChange(): Promise<void> {
		this.syncState.clear();
		this.lastSync = "";
		this.syncStateVaultId = this.settings.vaultId ?? null;
		await this.saveData({ lastSync: "" });
		devLog().log("lifecycle", "resetForVaultChange: lastSync + syncState cleared");
	}

	getSyncStateVaultId(): string | null {
		return this.syncStateVaultId;
	}

	setSyncStateVaultId(id: string | null): void {
		this.syncStateVaultId = id;
	}

	/** Invalidate stale per-vault bookkeeping if the active server vault no
	 *  longer matches the one syncState was recorded under. This is the
	 *  self-healing backstop for vault switches that bypass the SyncPreviewModal
	 *  picker (e.g. OAuth re-login, ensureVault) and so never call
	 *  resetForVaultChange. A `null` recorded id (fresh install / pre-upgrade
	 *  data) is adopted WITHOUT wiping, so upgrading doesn't drop valid state. */
	private async invalidateIfVaultChanged(): Promise<void> {
		const current = this.settings.vaultId ?? null;
		if (!current) return; // no active vault to compare against
		if (this.syncStateVaultId === null) {
			this.syncStateVaultId = current; // adopt; migration-safe, no wipe
			return;
		}
		if (this.syncStateVaultId === current) return;

		rlog().warn(
			"lifecycle",
			`Vault changed (${this.syncStateVaultId} → ${current}) — invalidating stale syncState`,
		);
		devLog().log(
			"lifecycle",
			`vault changed ${this.syncStateVaultId} → ${current} — clearing syncState + lastSync`,
		);
		this.syncState.clear();
		this.lastSync = "";
		this.syncStateVaultId = current;
		await this.saveData({ lastSync: "" });
	}

	/** Export sync state for persistence across sessions. */
	exportSyncState(): Record<string, FileSyncState> {
		return Object.fromEntries(this.syncState);
	}

	/** Export hash-only projection for backwards-compatible dual-write. */
	exportHashes(): Record<string, number> {
		const result: Record<string, number> = {};
		for (const [path, state] of this.syncState) {
			result[path] = state.hash;
		}
		return result;
	}

	/** Import sync state from persisted data. */
	importSyncState(data: Record<string, FileSyncState>): void {
		for (const [path, state] of Object.entries(data)) {
			this.syncState.set(path, state);
		}
	}

	/** Import legacy hash-only format (migration from old plugin versions). */
	importHashes(data: Record<string, number>): void {
		for (const [path, hash] of Object.entries(data)) {
			this.syncState.set(path, { hash });
		}
	}

	/** Get current sync status snapshot. */
	getStatus(): SyncStatus {
		const isSyncing = this.pulling || this.pushing.size > 0;
		let state: SyncStatus["state"];
		if (this.offline) {
			state = "offline";
		} else if (this.lastError) {
			state = "error";
		} else if (isSyncing) {
			state = "syncing";
		} else {
			state = "idle";
		}
		return {
			state,
			pending: this.debounceTimers.size,
			queued: this.queue.size,
			lastSync: this.lastSync,
			error: this.lastError || undefined,
		};
	}

	/** Whether the engine is currently offline. */
	isOffline(): boolean {
		return this.offline;
	}

	/** Emit current status to listener. */
	private emitStatus(): void {
		this.onStatusChange?.(this.getStatus());
	}

	/** Append an entry to the sync log (no-op if syncLog is null). */
	private logEntry(
		action: SyncLogEntry["action"],
		path: string,
		result: SyncLogEntry["result"],
		error?: string,
		details?: string,
	): void {
		this.syncLog?.append({ timestamp: new Date(), action, path, result, error, details });
	}

	// --- Ignore pattern matching ---

	private parseIgnorePatterns(): void {
		this.ignorePatterns = this.settings.ignorePatterns
			.split("\n")
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
	}

	shouldIgnore(path: string): boolean {
		// Hardcoded ignores — always enforced, cannot be overridden
		const configDir = `${this.app.vault.configDir}/`;
		if (path.startsWith(configDir) || path.includes(`/${configDir}`)) {
			return true;
		}
		for (const pattern of ALWAYS_IGNORED) {
			if (path.startsWith(pattern) || path.includes(`/${pattern}`)) {
				return true;
			}
		}
		// User-explicit per-file ignores (from Sync Center)
		if (this.ignoredFiles.has(path)) return true;
		return this.ignorePatterns.some((pattern) => {
			if (pattern.endsWith("/")) {
				return path.startsWith(pattern) || path.includes(`/${pattern}`);
			}
			return path === pattern || path.endsWith(`/${pattern}`);
		});
	}

	isMarkdown(file: TAbstractFile): boolean {
		return file instanceof TFile && file.extension === "md";
	}

	/** Check if a file should be synced (markdown, canvas, or binary attachment). */
	isSyncable(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile)) return false;
		return TEXT_EXTENSIONS.has(file.extension) || BINARY_EXTENSIONS.has(file.extension);
	}

	/** Check if a file is a binary attachment (not text). */
	isBinaryFile(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) return false;
		return BINARY_EXTENSIONS.has(file.extension);
	}

	/** Get MIME type for a file. */
	getMimeType(file: TFile): string {
		return MIME_TYPES[file.extension] || "application/octet-stream";
	}

	// --- Push: local → Engram ---

	/** Handle a vault modify/create event with debounce. */
	handleModify(file: TAbstractFile): void {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "handleModify short-circuited — gate closed");
			return;
		}
		if (!this.ready) return;
		if (!this.isSyncable(file)) return;
		if (this.shouldIgnore(file.path)) return;
		// During pull, vault events are usually echoes from sync writes.
		// But real user edits can happen too — queue them for post-pull push.
		if (this.pulling) {
			this.pendingPostPullPushes.add(file.path);
			return;
		}

		// Clear existing debounce timer for this file
		const existing = this.debounceTimers.get(file.path);
		if (existing) window.clearTimeout(existing);

		const timer = window.setTimeout(() => {
			this.debounceTimers.delete(file.path);
			void this.pushFile(file);
		}, this.settings.debounceMs);

		this.debounceTimers.set(file.path, timer);
		this.emitStatus();
	}

	/** When true, vault delete events are suppressed (used during local wipe). */
	suppressDeletes = false;

	/** Handle a vault delete event. */
	async handleDelete(file: TAbstractFile): Promise<void> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "handleDelete short-circuited — gate closed");
			return;
		}
		if (!this.ready) return;
		if (this.suppressDeletes) return;
		if (!this.isSyncable(file)) return;
		if (this.shouldIgnore(file.path)) return;

		const isBinary = this.isBinaryFile(file);

		// Cancel any pending push for this file
		const existing = this.debounceTimers.get(file.path);
		if (existing) {
			window.clearTimeout(existing);
			this.debounceTimers.delete(file.path);
		}

		try {
			if (isBinary) {
				await this.api.deleteAttachment(file.path);
			} else {
				await this.api.deleteNote(file.path);
			}
			this.goOnline();
		} catch (e) {
			// 404 means already deleted — treat as success
			if (isHttpStatus(e, 404)) {
				this.goOnline();
				return;
			}
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error(`Engram Sync: failed to delete ${file.path}`, e);
			await this.enqueueChange({
				path: file.path,
				action: "delete",
				kind: isBinary ? "attachment" : "note",
				timestamp: Date.now(),
				vaultId: this.settings.vaultId ?? undefined,
			});
			this.maybeGoOffline(e);
		}
	}

	/** Handle a vault rename event. */
	async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "handleRename short-circuited — gate closed");
			return;
		}
		if (!this.ready) return;
		if (!this.isSyncable(file)) return;

		const isBinary = this.isBinaryFile(file);

		// Delete old path if it wasn't ignored
		if (!this.shouldIgnore(oldPath)) {
			try {
				if (isBinary) {
					await this.api.deleteAttachment(oldPath);
				} else {
					await this.api.deleteNote(oldPath);
				}
				this.goOnline();
			} catch (e) {
				// 404 means already deleted — treat as success
				if (isHttpStatus(e, 404)) {
					this.goOnline();
				} else {
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error(`Engram Sync: failed to delete old path ${oldPath}`, e);
					await this.enqueueChange({
						path: oldPath,
						action: "delete",
						kind: isBinary ? "attachment" : "note",
						timestamp: Date.now(),
						vaultId: this.settings.vaultId ?? undefined,
					});
					this.maybeGoOffline(e);
				}
			}
		}

		// Move base content entry to new path before pushing
		if (!isBinary) {
			this.baseStore?.rename(normalizePath(oldPath), normalizePath(file.path));
		}

		// Push new path if it isn't ignored
		if (!this.shouldIgnore(file.path)) {
			await this.pushFile(file);
		}
	}

	/** Push a folder-create from the vault to the server's explicit-folder
	 *  table. Idempotent client-side (skips folders already in the set) and
	 *  best-effort on the wire (server errors are warn-logged but don't fail
	 *  the user's vault op). */
	async handleFolderCreate(folder: TFolder): Promise<void> {
		if (this.syncBlocked) return;
		if (!this.ready) return;
		if (!this.explicitFolders) return;
		const path = folder.path;
		if (this.shouldIgnore(path)) return;
		if (this.explicitFolders.has(path)) return;

		try {
			await this.api.createFolder(path);
			await this.explicitFolders.add(path);
		} catch (e) {
			devLog().log("push", `createFolder("${path}") failed: ${errMsg(e)}`);
			rlog().warn("push", `createFolder("${path}") failed: ${errMsg(e)}`);
		}
	}

	/** Push a folder-delete to the server. Only fires for folders we believe
	 *  the server tracks (in the explicit set) — unknown folders are no-ops
	 *  since the server has nothing to clean. Even on server error we drop the
	 *  local marker; the next pull will reconcile. */
	async handleFolderDelete(folder: TFolder): Promise<void> {
		if (this.syncBlocked) return;
		if (!this.ready) return;
		if (this.suppressDeletes) return;
		if (!this.explicitFolders) return;
		const path = folder.path;
		if (!this.explicitFolders.has(path)) return;

		try {
			await this.api.deleteFolder(path);
		} catch (e) {
			devLog().log("push", `deleteFolder("${path}") failed: ${errMsg(e)}`);
			rlog().warn("push", `deleteFolder("${path}") failed: ${errMsg(e)}`);
		} finally {
			await this.explicitFolders.delete(path);
		}
	}

	/** Acquire a push slot, blocking if at max concurrency. */
	private async acquirePushSlot(): Promise<void> {
		if (this.activePushCount < this.maxConcurrentPushes) {
			this.activePushCount++;
			return;
		}
		await new Promise<void>((resolve) => {
			this.pushWaiters.push(resolve);
		});
		this.activePushCount++;
	}

	/** Release a push slot and wake the next waiter if any. */
	private releasePushSlot(): void {
		this.activePushCount--;
		const next = this.pushWaiters.shift();
		if (next) next();
	}

	/** Query the server's rate limit and configure the pacer.
	 *  Applies a 10% safety margin (e.g. 100 RPM → 90 effective). */
	async configureRateLimit(): Promise<void> {
		try {
			const serverRPM = await this.api.getRateLimit();
			if (serverRPM > 0) {
				this.rateLimitRPM = Math.floor(serverRPM * 0.9);
				devLog().log(
					"pacer",
					`server limit=${serverRPM} RPM, effective=${this.rateLimitRPM} RPM`,
				);
				rlog().info(
					"pacer",
					`Rate limit: server=${serverRPM} RPM, effective=${this.rateLimitRPM} RPM`,
				);
			} else {
				this.rateLimitRPM = 0;
				devLog().log("pacer", "server reports unlimited — pacer disabled");
				rlog().info("pacer", "Server reports unlimited — pacer disabled");
			}
		} catch {
			this.rateLimitRPM = 0;
			devLog().log("pacer", "failed to query rate limit — assuming unlimited");
			rlog().warn("pacer", "Failed to query rate limit — assuming unlimited");
		}
	}

	/** Wait if needed to stay within the server's rate limit. */
	private async paceRequest(): Promise<void> {
		if (this.rateLimitRPM <= 0) return;

		const now = Date.now();
		const windowMs = 60_000;
		const cutoff = now - windowMs;

		// Prune timestamps outside the window
		this.requestTimestamps = this.requestTimestamps.filter((t) => t > cutoff);

		if (this.requestTimestamps.length < this.rateLimitRPM) {
			this.requestTimestamps.push(now);
			return;
		}

		// At capacity — wait until the oldest request exits the window
		const oldest = this.requestTimestamps[0]!;
		const waitMs = oldest + windowMs - now + 50; // +50ms buffer
		devLog().log(
			"pacer",
			`at capacity (${this.requestTimestamps.length}/${this.rateLimitRPM}), waiting ${waitMs}ms`,
		);
		rlog().info(
			"pacer",
			`Throttled: ${this.requestTimestamps.length}/${this.rateLimitRPM} RPM, waiting ${waitMs}ms`,
		);
		await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));

		// Prune again and record
		this.requestTimestamps = this.requestTimestamps.filter((t) => t > Date.now() - windowMs);
		this.requestTimestamps.push(Date.now());
	}

	/** Paths modified during a pull that need pushing once pull completes. */
	private pendingPostPullPushes: Set<string> = new Set();

	/** Push a single file to Engram. Returns true on success.
	 *  When force is true, skip echo suppression (used by pushAll).
	 *  When bypassPlanSkip is true, also skip the needs_pro short-circuit so a
	 *  parked attachment is actually re-uploaded — used ONLY by
	 *  resyncSkippedAttachments on a plan upgrade. The bulk paths (pushAll /
	 *  pushModifiedFiles) pass force without this, so they stay quiet on
	 *  plan-gated attachments. */
	private async pushFile(file: TFile, force = false, bypassPlanSkip = false): Promise<boolean> {
		if (this.pushing.has(file.path)) return false;

		// Persistence shortcut: if this attachment was already marked needs_pro
		// (Free-tier 402 on a previous push), skip it without re-hitting the
		// backend. The issue stays in the Sync Center until the user upgrades or
		// dismisses it. This is what makes the batched toast quiet on the next
		// sync — there's nothing left to fail, so the count is 0.
		if (!bypassPlanSkip && this.isBinaryFile(file) && this.hasNeedsProIssue(file.path)) {
			devLog().log("push", `skip (needs_pro): ${file.path}`);
			return false;
		}

		// Plan-limit pre-gate: with known limits, don't even attempt an upload the
		// backend WILL reject. Records the same informational/actionable issue a
		// 402/413 would have, but with no network round-trip — this is what removes
		// the noise at the source. Only for binary attachments; notes are never
		// pre-gated. bypassPlanSkip (resyncSkippedAttachments after an upgrade)
		// skips this so a parked attachment is actually re-uploaded.
		if (!bypassPlanSkip && this.isBinaryFile(file)) {
			const gate = this.preGateAttachment(file);
			if (gate) {
				const now = Date.now();
				this.issues.record({
					path: file.path,
					kind: "attachment",
					category: gate.category,
					message: gate.message,
					sizeBytes: gate.category === "too_large" ? file.stat.size : undefined,
					upgradeUrl: gate.upgradeUrl,
					firstFailedAt: now,
					lastFailedAt: now,
					attempts: 1,
				});
				if (issueDisposition(gate.category) === "informational") {
					this.attachmentLimitedThisBatch += 1;
				}
				devLog().log("push", `skip (pre-gate ${gate.category}): ${file.path}`);
				return false;
			}
		}

		await this.acquirePushSlot();
		this.pushing.add(file.path);
		this.lastError = "";
		this.emitStatus();

		const isBinary = this.isBinaryFile(file);
		let success = false;
		devLog().log(
			"push",
			`start ${isBinary ? "attachment" : "note"}: ${file.path} (active=${this.activePushCount})`,
		);
		rlog().info(
			"push",
			`Push start: ${file.path} | type=${isBinary ? "attachment" : "note"} | active=${this.activePushCount}`,
		);

		try {
			await this.paceRequest();
			const mtime = file.stat.mtime / 1000; // Obsidian uses ms, Engram uses seconds
			if (isBinary) {
				const buffer = await this.app.vault.readBinary(file);
				const base64 = arrayBufferToBase64(buffer);
				// Track attachments in syncState the same way notes are. Without
				// this, pushModifiedFiles sees every attachment as untracked and
				// re-pushes it on every fullSync (the "pushed N every Merge" loop).
				const hash = fnv1a(base64);
				const existing = this.syncState.get(normalizePath(file.path));
				if (!force && existing !== undefined && hash === existing.hash) {
					devLog().log("push", `skip (echo): ${file.path}`);
					rlog().info("push", `Echo skip (attachment): ${file.path} | hash=${hash}`);
					return false;
				}
				const mimeType = this.getMimeType(file);
				await this.api.pushAttachment(file.path, base64, mimeType, mtime);
				this.syncState.set(normalizePath(file.path), { hash });
			} else {
				const content = await this.app.vault.cachedRead(file);
				// Echo suppression — skip pushing if content matches what the
				// sync engine last wrote (pull/WebSocket). Prevents the pull→push loop
				// where vault.modify() triggers handleModify() for every pulled file.
				const hash = fnv1a(content);
				const existing = this.syncState.get(normalizePath(file.path));
				if (!force && existing !== undefined && hash === existing.hash) {
					devLog().log("push", `skip (echo): ${file.path}`);
					rlog().info("push", `Echo skip: ${file.path} | hash=${hash}`);
					return false;
				}
				const resp = await this.api.pushNote(file.path, content, mtime, existing?.version);

				// 409 = version conflict — server has a newer version
				if ("conflict" in resp) {
					const serverNote = resp.server_note;
					devLog().log(
						"push",
						`version conflict: ${file.path} (local=${existing?.version} server=${serverNote.version})`,
					);
					rlog().warn(
						"conflict",
						`Version conflict on push: ${file.path} | localVer=${existing?.version} | serverVer=${serverNote.version}`,
					);

					// Attempt 3-way auto-merge if we have a base
					const pushBase = this.baseStore?.get(normalizePath(file.path));
					if (pushBase) {
						const merge = threeWayMerge(pushBase.content, content, serverNote.content);
						if (merge.clean) {
							const mergeResp = await this.api.pushNote(
								file.path,
								merge.merged,
								mtime,
							);
							const localFile = this.app.vault.getFileByPath(file.path);
							if (localFile) {
								await this.modifyFile(localFile, merge.merged);
							}
							if (!("conflict" in mergeResp)) {
								const np = normalizePath(file.path);
								this.syncState.set(np, {
									hash: fnv1a(merge.merged),
									version: mergeResp.note.version,
									serverHash: mergeResp.note.content_hash,
								});
								if (mergeResp.note.version != null) {
									this.baseStore?.set(np, merge.merged, mergeResp.note.version);
								}
							}
							rlog().info(
								"conflict",
								`Auto-merged (push): ${file.path}` +
									` | baseLen=${pushBase.content.length} | localLen=${content.length}` +
									` | remoteLen=${serverNote.content.length} | mergedLen=${merge.merged.length}`,
							);
							return false;
						}
						rlog().info(
							"conflict",
							`Auto-merge failed (push): ${file.path}` +
								` | conflicts=${merge.conflicts.length}` +
								` | baseLen=${pushBase.content.length} | localLen=${content.length}` +
								` | remoteLen=${serverNote.content.length}`,
						);
					}

					// Fall back to interactive conflict resolution
					const resolution = await this.resolveConflict({
						path: file.path,
						localContent: content,
						localMtime: mtime,
						remoteContent: serverNote.content,
						remoteMtime: serverNote.mtime,
						baseContent: pushBase?.content,
						vaultName: this.app.vault.getName(),
					});
					if (resolution.choice === "keep-local") {
						// Re-push without version (unconditional overwrite)
						const forceResp = await this.api.pushNote(file.path, content, mtime);
						if (!("conflict" in forceResp)) {
							const np = normalizePath(file.path);
							this.syncState.set(np, {
								hash,
								version: forceResp.note.version,
								serverHash: forceResp.note.content_hash,
							});
							if (forceResp.note.version != null) {
								this.baseStore?.set(np, content, forceResp.note.version);
							}
						}
					} else if (resolution.choice === "keep-remote") {
						const localFile = this.app.vault.getFileByPath(file.path);
						if (localFile) {
							await this.modifyFile(localFile, serverNote.content);
							const np = normalizePath(file.path);
							this.syncState.set(np, {
								hash: fnv1a(serverNote.content),
								version: serverNote.version,
								serverHash: serverNote.content_hash,
							});
							this.baseStore?.set(np, serverNote.content, serverNote.version);
						}
					} else if (resolution.choice === "merge" && resolution.mergedContent != null) {
						const mergeResp = await this.api.pushNote(
							file.path,
							resolution.mergedContent,
							mtime,
						);
						const localFile = this.app.vault.getFileByPath(file.path);
						if (localFile) {
							await this.modifyFile(localFile, resolution.mergedContent);
						}
						if (!("conflict" in mergeResp)) {
							const np = normalizePath(file.path);
							this.syncState.set(np, {
								hash: fnv1a(resolution.mergedContent),
								version: mergeResp.note.version,
								serverHash: mergeResp.note.content_hash,
							});
							if (mergeResp.note.version != null) {
								this.baseStore?.set(
									np,
									resolution.mergedContent,
									mergeResp.note.version,
								);
							}
						}
					}
					// skip and keep-both handled by returning false / not pushing
					return false;
				}

				// Server may sanitize the path (strip chars illegal on mobile).
				// If so, rename the local file to match.
				const serverPath = resp.note.path;
				const serverVersion = resp.note.version;
				if (serverPath && serverPath !== file.path) {
					const localFile = this.app.vault.getFileByPath(file.path);
					if (localFile) {
						await this.app.vault.rename(localFile, serverPath);
						devLog().log(
							"push",
							`renamed: ${file.path} → ${serverPath} (server sanitized)`,
						);
						rlog().info(
							"push",
							`Renamed: ${file.path} → ${serverPath} (server sanitized)`,
						);
						new Notice(
							`Engram Sync: renamed "${file.path.split("/").pop()}" (unsupported characters)`,
						);
					}
					this.syncState.delete(normalizePath(file.path));
					this.syncState.set(normalizePath(serverPath), {
						hash,
						version: serverVersion,
						serverHash: resp.note.content_hash,
					});
					this.baseStore?.delete(normalizePath(file.path));
					if (serverVersion != null) {
						this.baseStore?.set(normalizePath(serverPath), content, serverVersion);
					}
				} else {
					this.syncState.set(normalizePath(file.path), {
						hash,
						version: serverVersion,
						serverHash: resp.note.content_hash,
					});
					if (serverVersion != null) {
						this.baseStore?.set(normalizePath(file.path), content, serverVersion);
					}
				}
			}
			success = true;
			this.issues.clear(file.path);
			devLog().log("push", `ok: ${file.path}`);
			rlog().info("push", `Push ok: ${file.path} | type=${isBinary ? "attachment" : "note"}`);
			this.goOnline();
		} catch (e) {
			const msg = errMsg(e);
			const classified = categorizeError(e);
			// Plan-limit 402s (needs_pro, quota) are expected Free-tier outcomes,
			// not programming errors — don't pollute the dev console. Gate by
			// disposition so both informational reasons stay quiet; other
			// categories keep the error log for triage.
			if (issueDisposition(classified.category) !== "informational") {
				// biome-ignore lint/suspicious/noConsole: error boundary
				console.error(`Engram Sync: failed to push ${file.path}`, e);
			}
			const now = Date.now();
			this.issues.record({
				path: file.path,
				kind: isBinary ? "attachment" : "note",
				category: classified.category,
				status: classified.status,
				// Surface the backend's own message (e.g. "failed to upload to
				// storage backend") rather than the bare "Request failed, status N".
				message: classified.message,
				sizeBytes: classified.category === "too_large" ? file.stat.size : undefined,
				upgradeUrl: classified.upgradeUrl,
				firstFailedAt: now,
				lastFailedAt: now,
				attempts: 1,
			});
			const attempts = this.issues.get(file.path)?.attempts ?? 1;
			if (issueDisposition(classified.category) === "informational") {
				// Plan-limit skip (needs_pro, quota): tally as "skipped", not failed.
				// Drives the batched session toast (drained by pushAll /
				// pushModifiedFiles) and the progress "skipped" count.
				this.attachmentLimitedThisBatch += 1;
			} else {
				// Tally for the batched "N files failed to sync" Notice.
				this.failuresThisBatch += 1;
				this.firstFailureMessageThisBatch ??= classified.message;
			}
			devLog().log("error", `push failed: ${file.path} — ${msg} (${classified.category})`);
			rlog().error(
				"push",
				`Push failed: ${file.path} — ${msg} | category=${classified.category}`,
				e instanceof Error ? e.stack : undefined,
			);
			this.logEntry("push", file.path, "error", msg, classified.category);
			// Re-queue for retry only while it's worth it. Terminal failures (413,
			// 402) never retry; non-terminal failures retry until RETRY_CAP, then
			// park in the Sync Center — retrying a broken storage backend forever
			// just hammers it. Content-free entry; content re-read on flush.
			if (shouldRetryAfterFailure(classified, attempts)) {
				await this.enqueueChange({
					path: file.path,
					action: "upsert",
					kind: isBinary ? "attachment" : "note",
					mtime: file.stat.mtime / 1000,
					timestamp: Date.now(),
					vaultId: this.settings.vaultId ?? undefined,
				});
			}
			// Only true connection loss (no HTTP response) takes the plugin
			// offline — a per-file 5xx leaves the backend reachable.
			this.maybeGoOffline(e);
		} finally {
			this.pushing.delete(file.path);
			this.releasePushSlot();
			// Keep path suppressed for a cooldown period after push completes.
			// WebSocket events often arrive after the push finishes, and without this
			// the echo suppression in handleStreamEvent would miss them.
			this.markRecentlyPushed(file.path);
			this.emitStatus();
		}
		return success;
	}

	/** True iff the issue store already has a `needs_pro` entry for this path
	 *  (i.e. backend returned 402 attachments_disabled on a prior push). Used to
	 *  short-circuit re-push attempts without hitting the network — survives
	 *  plugin reloads because the issue store is persisted. */
	private hasNeedsProIssue(path: string): boolean {
		for (const issue of this.issues.all()) {
			if (issue.path === path && issue.category === "needs_pro") return true;
		}
		return false;
	}

	/** Plan-limit pre-check for an attachment, using last-known PlanState. Returns
	 *  a category to skip under (mirroring the backend's 413/402 outcomes), or null
	 *  to proceed with the upload. The backend remains the authoritative fallback
	 *  when local plan state is stale (null → we defer to the server). */
	private preGateAttachment(
		file: TFile,
	): { category: SyncIssueCategory; message: string; upgradeUrl?: string } | null {
		const plan = this.planState;
		if (!plan) return null; // unknown limits → let the backend decide
		if (plan.maxFileBytes > 0 && file.stat.size > plan.maxFileBytes) {
			return {
				category: "too_large",
				message: `File exceeds the ${plan.maxFileBytes}-byte limit`,
			};
		}
		if (plan.attachmentsTextOnly && !isTextAttachment(file.extension)) {
			return {
				category: "needs_pro",
				message: "Free syncs notes only — images & PDFs need a paid plan.",
			};
		}
		return null;
	}

	/** Drain the batch failure tally for an aggregated, deduped Notice. Returns
	 *  the count of generic failures since the last drain plus the first server
	 *  message seen, and resets the tally. Callers (main.ts) fire one Notice. */
	drainFailureSummary(): { count: number; firstMessage?: string } {
		const count = this.failuresThisBatch;
		const firstMessage = this.firstFailureMessageThisBatch;
		this.failuresThisBatch = 0;
		this.firstFailureMessageThisBatch = undefined;
		return { count, firstMessage };
	}

	/** Emit a single aggregated, deduped Notice covering all generic push
	 *  failures this batch — "N file(s) failed to sync — open Sync Center" with
	 *  the first server message. Replaces silent per-file console errors with one
	 *  actionable signal. Called once at the end of pushModifiedFiles / pushAll. */
	private flushFailureSummaryToast(): void {
		const { count, firstMessage } = this.drainFailureSummary();
		if (count <= 0) return;
		const noun = count === 1 ? "file" : "files";
		const detail = firstMessage ? ` (${firstMessage})` : "";
		new Notice(`Engram: ${count} ${noun} failed to sync${detail} — open Sync Center`, 10_000);
		rlog().warn("push", `${count} ${noun} failed to sync${detail}`);
	}

	/** Emit a single batched toast covering all attachments skipped this batch
	 *  with `needs_pro`. Called once at the end of pushModifiedFiles / pushAll.
	 *  The toast fires at most once per session (subsequent batches stay
	 *  silent) so the user isn't repeatedly nagged on every sync interval.
	 *  Spec §4.6 — Free tier batched skip handling. */
	private flushAttachmentLimitedToast(): void {
		const count = this.attachmentLimitedThisBatch;
		this.attachmentLimitedThisBatch = 0;
		if (count <= 0) return;
		if (this.attachmentLimitToastShown) return;
		this.attachmentLimitToastShown = true;
		const noun = count === 1 ? "attachment" : "attachments";
		new Notice(`Engram: ${count} ${noun} skipped — upgrade to sync images & PDFs.`, 10_000);
		rlog().info(
			"push",
			`Skipped ${count} ${noun} (attachments_disabled) — batched toast emitted`,
		);
	}

	/** Test hook: how many attachments were marked needs_pro since the last
	 *  flush. Drained when the toast fires. */
	getAttachmentLimitedCount(): number {
		return this.attachmentLimitedThisBatch;
	}

	/** Test hook: whether the session has already shown the batched toast. */
	hasShownAttachmentLimitToast(): boolean {
		return this.attachmentLimitToastShown;
	}

	// --- Plan state ---

	/** Store new plan state; on a capability gain (upgrade unlocks non-text
	 *  attachments), re-attempt the attachments parked as informational
	 *  plan-skips. Persists via onPlanStatePersist so a reload keeps the state. */
	applyPlanState(next: PlanState): void {
		const gained = attachmentCapabilityGained(this.planState, next);
		this.planState = next;
		this.onPlanStatePersist?.(next);
		if (gained) {
			devLog().log("push", "plan capability gained — re-syncing skipped attachments");
			rlog().info("push", "Plan capability gained — re-syncing skipped attachments");
			void this.resyncSkippedAttachments();
		}
	}

	/** Seed plan state from persisted settings on load WITHOUT triggering a
	 *  re-sync. A normal reload must not be read as an upgrade: applyPlanState
	 *  would see prev=null and treat any non-text-only plan as a fresh capability
	 *  gain, spuriously re-pushing every parked attachment on every launch. */
	hydratePlanState(p: PlanState): void {
		this.planState = p;
	}

	/** The current plan state (test/UI hook). */
	getPlanState(): PlanState | null {
		return this.planState;
	}

	/** Re-push every file currently parked as an informational plan-skip
	 *  (needs_pro / quota). Force-pushes AND bypasses the needs_pro short-circuit
	 *  so the upload is actually re-attempted; the normal push success path
	 *  clears the issue. Wired to the channel's upgrade event and the Sync Center
	 *  "Sync these now" button. */
	async resyncSkippedAttachments(): Promise<void> {
		const skipped = this.issues
			.all()
			.filter((i) => issueDisposition(i.category) === "informational");
		if (skipped.length === 0) return;
		for (const issue of skipped) {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(issue.path));
			if (file instanceof TFile) {
				await this.pushFile(file, /* force */ true, /* bypassPlanSkip */ true);
			}
		}
		new Notice(`Engram: plan upgraded — syncing ${skipped.length} attachment(s)…`, 6_000);
	}

	/** Suppress WebSocket echoes for a path for ECHO_COOLDOWN_MS after push. */
	private markRecentlyPushed(path: string): void {
		const existing = this.recentlyPushed.get(path);
		if (existing) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.recentlyPushed.delete(path);
		}, ECHO_COOLDOWN_MS);
		this.recentlyPushed.set(path, timer);
	}

	/** Check if a path was recently pushed (for echo suppression). */
	isRecentlyPushed(path: string): boolean {
		return this.recentlyPushed.has(path);
	}

	// --- Pull: Engram → local vault ---

	/** Pull remote changes and apply to vault. */
	/** Page through GET /notes/changes until has_more=false (protocol rev).
	 *  Pre-rev backends return no has_more — the loop exits after one page,
	 *  preserving legacy behavior. fields:"meta" requests hash-only pages. */
	private async fetchAllNoteChanges(
		since: string,
		fields?: "meta",
	): Promise<{ changes: NoteChange[]; server_time: string }> {
		const all: NoteChange[] = [];
		let cursor: string | undefined;
		let serverTime = "";
		// Loop ceiling is corruption protection (cursor not advancing), not a
		// real limit: 10k pages × 500 = 5M notes.
		for (let page = 0; page < 10_000; page++) {
			const resp = await this.api.getChanges(since, { limit: 500, cursor, fields });
			all.push(...resp.changes);
			serverTime = resp.server_time;
			if (!resp.has_more || !resp.next_cursor) break;
			cursor = resp.next_cursor;
		}
		return { changes: all, server_time: serverTime };
	}

	/** True when a meta change can't be hash-skipped (body would be fetched). */
	private changeNeedsBody(change: NoteChange): boolean {
		if (change.content_hash === undefined) return true;
		const normalized = normalizePath(change.path);
		const stored = this.syncState.get(normalized);
		const exists = this.app.vault.getFileByPath(normalized) !== null;
		return !(exists && stored?.serverHash === change.content_hash);
	}

	/** Resolve a (possibly meta-only) change to one that carries content.
	 *  Returns null when the change needs no work: the server hash matches the
	 *  stored serverHash AND the local file still exists — only the version is
	 *  advanced so the next push doesn't 409. */
	private async resolveChangeBody(
		change: NoteChange,
		opts: { skipUnchanged: boolean } = { skipUnchanged: true },
	): Promise<NoteChange | null> {
		if (change.deleted) return change;

		const normalized = normalizePath(change.path);

		if (opts.skipUnchanged && change.content_hash !== undefined) {
			const stored = this.syncState.get(normalized);
			const exists = this.app.vault.getFileByPath(normalized) !== null;
			if (exists && stored?.serverHash === change.content_hash) {
				this.syncState.set(normalized, {
					...stored,
					version: change.version ?? stored.version,
				});
				devLog().log("pull", `skip (hash match): ${change.path}`);
				return null;
			}
		}

		if (change.content !== undefined) return change;

		const note = await this.api.getNote(change.path);
		return {
			...change,
			content: note.content,
			content_hash: note.content_hash ?? change.content_hash,
			version: note.version ?? change.version,
		};
	}

	async pull(): Promise<number> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "pull short-circuited — gate closed");
			return 0;
		}
		if (this.pulling) return 0;
		const isFirstSync = !this.lastSync;
		if (isFirstSync) {
			// First sync — use epoch
			this.lastSync = "1970-01-01T00:00:00Z";
		}

		this.pulling = true;
		this.lastError = "";
		this.emitStatus();
		devLog().log("pull", `start since=${this.lastSync}`);
		rlog().info("pull", `Pull started since=${this.lastSync}`);
		try {
			// Fetch note and attachment changes in parallel. Incremental pulls
			// use hash-only pages (fields=meta) — bodies are fetched selectively
			// for hashes we don't already hold. First syncs pull full-content
			// pages: every body is needed, and per-note GETs would turn a
			// 1k-note cold pull into 1k requests (rate-limit suicide).
			const fields = isFirstSync ? undefined : ("meta" as const);
			const [noteResp, attachResp] = await Promise.all([
				this.fetchAllNoteChanges(this.lastSync, fields),
				this.api.getAttachmentChanges(this.lastSync),
			]);

			// Escape hatch: when an incremental delta needs MANY bodies (another
			// device bulk-pushed), refetch full-content pages once instead of
			// issuing one GET per note.
			let noteChanges = noteResp.changes;
			if (fields === "meta") {
				const needBodies = noteChanges.filter(
					(c) => !c.deleted && c.content === undefined && this.changeNeedsBody(c),
				).length;
				if (needBodies > 50) {
					devLog().log(
						"pull",
						`meta delta needs ${needBodies} bodies — refetching full pages`,
					);
					noteChanges = (await this.fetchAllNoteChanges(this.lastSync)).changes;
				}
			}
			devLog().log(
				"pull",
				`fetched ${noteResp.changes.length} notes, ${attachResp.changes.length} attachments`,
			);
			rlog().info(
				"pull",
				`Fetched ${noteResp.changes.length} notes, ${attachResp.changes.length} attachments`,
			);
			let applied = 0;
			let skipped = 0;
			let oldestFailedUpdatedAt: string | null = null;

			for (const change of noteChanges) {
				let resolved: NoteChange | null = null;
				try {
					resolved = await this.resolveChangeBody(change);
				} catch (e) {
					// Body-fetch failure is transient (network/5xx) — pin
					// lastSync at this change so the next pull re-serves it;
					// advancing past it would drop the change forever.
					skipped++;
					if (
						oldestFailedUpdatedAt === null ||
						change.updated_at < oldestFailedUpdatedAt
					) {
						oldestFailedUpdatedAt = change.updated_at;
					}
					const msg = errMsg(e);
					devLog().log("error", `body fetch failed: ${change.path} — ${msg}`);
					rlog().error(
						"pull",
						`Body fetch failed (will retry next pull): ${change.path} — ${msg}`,
						e instanceof Error ? e.stack : undefined,
					);
					continue;
				}
				try {
					if (resolved && (await this.applyChange(resolved))) applied++;
				} catch (e) {
					// Local apply failure (e.g. illegal filename) is permanent —
					// don't pin lastSync, or one bad file re-serves the whole
					// window every poll. Legacy skip semantics.
					skipped++;
					const msg = errMsg(e);
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error(`Engram Sync: skipping note ${change.path}: ${msg}`);
					devLog().log("error", `apply skipped: ${change.path} — ${msg}`);
					rlog().error(
						"pull",
						`Skipped note: ${change.path} — ${msg}`,
						e instanceof Error ? e.stack : undefined,
					);
				}
			}

			for (const change of attachResp.changes) {
				try {
					if (await this.applyAttachmentChange(change)) applied++;
				} catch (e) {
					skipped++;
					const msg = errMsg(e);
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error(`Engram Sync: skipping attachment ${change.path}: ${msg}`);
					devLog().log("error", `apply skipped: ${change.path} — ${msg}`);
					rlog().error(
						"pull",
						`Skipped attachment: ${change.path} — ${msg}`,
						e instanceof Error ? e.stack : undefined,
					);
				}
			}

			// Pull explicit empty-folder markers and materialize on disk. Runs
			// after note/attachment apply so empty-folder ensures don't race
			// with note creates that may also produce the same folder. Failures
			// don't abort the pull — folder sync is eventually consistent.
			await this.syncExplicitFolders();

			// Use the later server_time — but never advance past the oldest
			// failed change (the inclusive since filter re-serves it next pull).
			const serverTime =
				noteResp.server_time > attachResp.server_time
					? noteResp.server_time
					: attachResp.server_time;
			this.lastSync =
				oldestFailedUpdatedAt !== null && oldestFailedUpdatedAt < serverTime
					? oldestFailedUpdatedAt
					: serverTime;
			await this.saveData({ lastSync: this.lastSync });

			devLog().log(
				"pull",
				`done — applied ${applied}, skipped ${skipped}, lastSync=${this.lastSync}`,
			);
			rlog().info("pull", `Pull done — applied ${applied}, skipped ${skipped}`);
			return applied;
		} catch (e) {
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: pull failed", e);
			devLog().log("error", `pull failed: ${errMsg(e)}`);
			rlog().error(
				"pull",
				`Pull failed: ${errMsg(e)}`,
				e instanceof Error ? e.stack : undefined,
			);
			this.lastError = e instanceof Error ? `Pull failed: ${e.message}` : "Pull failed";
			return 0;
		} finally {
			this.pulling = false;
			this.emitStatus();
			await this.flushPostPullPushes();
		}
	}

	/** Push any files that were modified during pull. Echo suppression will
	 *  naturally skip sync-engine writes; only real user edits get pushed. */
	private async flushPostPullPushes(): Promise<void> {
		if (this.pendingPostPullPushes.size === 0) return;
		const paths = [...this.pendingPostPullPushes];
		this.pendingPostPullPushes.clear();
		devLog().log("push", `flushing ${paths.length} post-pull pushes`);
		rlog().info("push", `Post-pull flush: ${paths.length} files`);
		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			if (file) {
				await this.pushFile(file);
			}
		}
	}

	/** Force-pull every note + attachment from the server.
	 *
	 *  @param opts.deleteLocalExtras — if true, wipe local files that have no
	 *    remote counterpart before pulling.
	 */
	async pullAll(opts: { deleteLocalExtras?: boolean } = {}): Promise<number> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "pullAll short-circuited — gate closed");
			return 0;
		}
		return this._pullAll(opts.deleteLocalExtras ?? false);
	}

	private async _pullAll(wipe: boolean): Promise<number> {
		if (this.pulling) return 0;

		this.syncLog?.clear();
		this.pulling = true;
		this.lastError = "";
		this.emitStatus();

		if (wipe) {
			// Suppress delete sync — we're wiping locally, not deleting from server
			this.suppressDeletes = true;
			devLog().log("pull", "pullAll(deleteLocalExtras): deleting all local syncable files");
			rlog().info("pull", "pullAll(deleteLocalExtras) started — deleting local files");
			const files = this.app.vault.getFiles();
			const syncable = files.filter((f) => this.isSyncable(f) && !this.shouldIgnore(f.path));
			const wipeTotal = syncable.length;
			this.onSyncProgress?.({ phase: "deleting", current: 0, total: wipeTotal, failed: 0 });
			let wipeFailed = 0;
			for (let i = 0; i < syncable.length; i++) {
				const file = syncable[i]!;
				try {
					await this.app.fileManager.trashFile(file);
					this.logEntry("delete", file.path, "ok", undefined, "wipe");
				} catch (e) {
					wipeFailed++;
					const msg = errMsg(e);
					this.logEntry("delete", file.path, "error", msg);
				}
				this.onSyncProgress?.({
					phase: "deleting",
					current: i + 1,
					total: wipeTotal,
					failed: wipeFailed,
					currentPath: file.path,
				});
				// Yield to UI thread periodically so progress modal can repaint
				if ((i + 1) % 20 === 0) {
					await new Promise((resolve) => window.setTimeout(resolve, 0));
				}
			}
			// Reset sync state — everything will be re-synced from server
			this.syncState.clear();
			this.lastSync = "";
			await this.saveData({ lastSync: "" });
			devLog().log(
				"pull",
				`pullAll(deleteLocalExtras): deleted ${syncable.length} local files, sync state reset`,
			);
			rlog().info(
				"pull",
				`pullAll(deleteLocalExtras) deleted ${syncable.length} local files`,
			);
			// NOTE: suppressDeletes stays true until the entire pull completes.
			// Obsidian's delete events fire asynchronously — resetting here would
			// allow queued events to leak through and soft-delete server data.
		}

		devLog().log(
			"pull",
			`${wipe ? "pullAll(deleteLocalExtras)" : "pullAll"}: fetching everything from server`,
		);
		rlog().info(
			"pull",
			`${wipe ? "pullAll(deleteLocalExtras)" : "pullAll"} started — fetching everything from epoch`,
		);
		try {
			const epoch = "1970-01-01T00:00:00Z";
			// Full-content pages: a force pull needs (nearly) every body, so
			// per-note GETs would multiply requests by the vault size.
			const [noteResp, attachResp] = await Promise.all([
				this.fetchAllNoteChanges(epoch),
				this.api.getAttachmentChanges(epoch),
			]);
			devLog().log(
				"pull",
				`pullAll: fetched ${noteResp.changes.length} notes, ${attachResp.changes.length} attachments`,
			);
			rlog().info(
				"pull",
				`PullAll fetched ${noteResp.changes.length} notes, ${attachResp.changes.length} attachments`,
			);

			// Pre-filter: skip notes whose local content already matches server.
			// Skip filtering after a wipe — nothing local to compare against, and
			// Obsidian's file cache may still return stale data for trashed files.
			let noteChanges: typeof noteResp.changes;
			let attachChanges: typeof attachResp.changes;

			if (wipe) {
				noteChanges = noteResp.changes;
				attachChanges = attachResp.changes;
			} else {
				noteChanges = [];
				for (const change of noteResp.changes) {
					if (change.deleted || this.shouldIgnore(change.path)) {
						noteChanges.push(change);
						continue;
					}
					const normalized = normalizePath(change.path);
					const existing = this.app.vault.getFileByPath(normalized);
					if (existing) {
						const localContent = await this.app.vault.cachedRead(existing);
						const stored = this.syncState.get(normalized);
						const localUnchanged =
							stored !== undefined && stored.hash === fnv1a(localContent);
						// Protocol rev: meta pages carry content_hash, not content.
						// (server hash unchanged, local unchanged) proves there is no
						// work without fetching the body.
						if (
							change.content_hash !== undefined &&
							stored?.serverHash === change.content_hash &&
							localUnchanged
						) {
							this.syncState.set(normalized, {
								...stored,
								version: change.version ?? stored.version,
							});
							continue;
						}
						// Legacy backend: full content present — compare directly.
						if (change.content !== undefined && localContent === change.content) {
							this.syncState.set(normalized, {
								hash: fnv1a(localContent),
								version: change.version,
								serverHash: change.content_hash,
							});
							if (change.version != null) {
								this.baseStore?.set(normalized, change.content, change.version);
							}
							continue;
						}
					}
					noteChanges.push(change);
				}

				attachChanges = attachResp.changes.filter((change) => {
					if (change.deleted) return true;
					return !this.app.vault.getFileByPath(normalizePath(change.path));
				});
			}

			let applied = 0;
			let failed = 0;
			const noteCount = noteChanges.length;
			const attachCount = attachChanges.length;
			const total = noteCount + attachCount;

			devLog().log(
				"pull",
				`pullAll: server returned ${noteResp.changes.length} notes, ${attachResp.changes.length} attachments`,
			);
			devLog().log(
				"pull",
				`pullAll: after filter: ${noteCount} notes, ${attachCount} attachments to apply (wipe=${wipe})`,
			);

			this.onSyncProgress?.({ phase: "pulling", current: 0, total, failed: 0 });

			// Pull notes in batches of 10 for parallelism
			for (let i = 0; i < noteChanges.length; i += 10) {
				const batch = noteChanges.slice(i, i + 10);
				const lastPath = batch[batch.length - 1]!.path;
				const results = await Promise.all(
					batch.map(async (change) => {
						try {
							const resolved = await this.resolveChangeBody(change, {
								skipUnchanged: false,
							});
							const ok = resolved ? await this.applyChange(resolved, true) : false;
							if (ok) {
								this.logEntry("pull", change.path, "ok");
							} else {
								this.logEntry(
									"skip",
									change.path,
									"skipped",
									undefined,
									"unchanged",
								);
							}
							return ok ? ("ok" as const) : ("skip" as const);
						} catch (e) {
							const msg = errMsg(e);
							rlog().error("pull", `Skipped note: ${change.path} — ${msg}`);
							this.logEntry("pull", change.path, "error", msg);
							return "error" as const;
						}
					}),
				);
				for (const r of results) {
					if (r === "ok") applied++;
					else if (r === "error") failed++;
				}
				this.onSyncProgress?.({
					phase: "pulling",
					current: Math.min(i + batch.length, noteChanges.length),
					total,
					failed,
					currentPath: lastPath,
				});
			}

			// Pull attachments in batches of 5 (larger files)
			for (let i = 0; i < attachChanges.length; i += 5) {
				const batch = attachChanges.slice(i, i + 5);
				const lastPath = batch[batch.length - 1]!.path;
				const results = await Promise.all(
					batch.map(async (change) => {
						try {
							const ok = await this.applyAttachmentChange(change);
							if (ok) {
								this.logEntry("pull", change.path, "ok");
							} else {
								this.logEntry(
									"skip",
									change.path,
									"skipped",
									undefined,
									"unchanged",
								);
							}
							return ok ? ("ok" as const) : ("skip" as const);
						} catch (e) {
							const msg = errMsg(e);
							rlog().error("pull", `Skipped attachment: ${change.path} — ${msg}`);
							this.logEntry("pull", change.path, "error", msg);
							return "error" as const;
						}
					}),
				);
				for (const r of results) {
					if (r === "ok") applied++;
					else if (r === "error") failed++;
				}
				this.onSyncProgress?.({
					phase: "pulling",
					current: noteCount + Math.min(i + batch.length, attachChanges.length),
					total,
					failed,
					currentPath: lastPath,
				});
			}

			this.onSyncProgress?.({ phase: "complete", current: total, total, failed });

			// Update lastSync to server time
			const serverTime =
				noteResp.server_time > attachResp.server_time
					? noteResp.server_time
					: attachResp.server_time;
			this.lastSync = serverTime;
			await this.saveData({ lastSync: this.lastSync });

			devLog().log(
				"pull",
				`pullAll: done — applied=${applied}, failed=${failed}, total=${total}, lastSync=${this.lastSync}`,
			);
			rlog().info("pull", `PullAll done — applied=${applied}, failed=${failed}`);
			return applied;
		} catch (e) {
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: pullAll failed", e);
			devLog().log("error", `pullAll failed: ${errMsg(e)}`);
			rlog().error(
				"pull",
				`PullAll failed: ${errMsg(e)}`,
				e instanceof Error ? e.stack : undefined,
			);
			this.lastError =
				e instanceof Error ? `Pull all failed: ${e.message}` : "Pull all failed";
			return 0;
		} finally {
			this.pulling = false;
			this.suppressDeletes = false;
			this.emitStatus();
			await this.flushPostPullPushes();
		}
	}

	/** Handle a WebSocket stream event (upsert or delete). */
	async handleStreamEvent(event: NoteStreamEvent): Promise<void> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "handleStreamEvent short-circuited — gate closed");
			return;
		}
		if (this.shouldIgnore(event.path)) return;
		devLog().log("ws", `${event.event_type} ${event.kind ?? "note"}: ${event.path}`);
		rlog().info("ws", `Event: ${event.event_type} ${event.kind ?? "note"}: ${event.path}`);

		// Echo suppression — skip events for notes we're currently pushing
		// or have recently finished pushing (WebSocket events arrive after push completes)
		if (this.pushing.has(event.path)) {
			rlog().info("ws", `Echo skip (pushing): ${event.path}`);
			return;
		}
		if (this.recentlyPushed.has(event.path)) {
			rlog().info("ws", `Echo skip (recently pushed): ${event.path}`);
			return;
		}

		const isAttachment = event.kind === "attachment";

		// Protocol rev — hash-compare dedupe: if the event's content_hash
		// matches the server hash we already hold for this path, the local
		// copy is current; skip without touching the vault or the network.
		if (event.event_type === "upsert" && !isAttachment && event.content_hash !== undefined) {
			const stored = this.syncState.get(normalizePath(event.path));
			if (stored?.serverHash === event.content_hash) {
				if (event.version != null && event.version !== stored.version) {
					this.syncState.set(normalizePath(event.path), {
						...stored,
						version: event.version,
					});
				}
				rlog().info("ws", `Hash skip: ${event.path}`);
				return;
			}
		}

		if (event.event_type === "delete") {
			const normalized = normalizePath(event.path);
			const existing = this.app.vault.getFileByPath(normalized);
			if (existing) {
				await this.app.fileManager.trashFile(existing);
				await this.removeEmptyFolders(normalized);
			}
			return;
		}

		if (event.event_type === "upsert") {
			try {
				if (isAttachment) {
					const attachment = await this.api.getAttachment(event.path);
					await this.applyAttachmentChange(
						{
							path: attachment.path,
							mime_type: attachment.mime_type,
							size_bytes: attachment.size_bytes,
							mtime: attachment.mtime,
							updated_at: attachment.updated_at,
							deleted: false,
						},
						attachment.content_base64,
					);
				} else if (event.content !== undefined) {
					// Use inline content from the broadcast — no extra HTTP
					// roundtrip. (Dual-field transition: backends send content
					// for one more release; afterwards only content_hash and the
					// fetch branch below applies.)
					await this.applyChange({
						path: event.path,
						title: event.title ?? "",
						content: event.content,
						content_hash: event.content_hash,
						folder: event.folder ?? "",
						tags: event.tags ?? [],
						mtime: event.mtime ?? Date.now(),
						updated_at: event.updated_at ?? new Date().toISOString(),
						deleted: false,
						version: event.version,
					});
				} else {
					// Hash-only broadcast (or folder rename): fetch the body.
					const note = await this.api.getNote(event.path);
					await this.applyChange({
						path: note.path,
						title: note.title,
						content: note.content,
						content_hash: note.content_hash ?? event.content_hash,
						folder: note.folder,
						tags: note.tags,
						mtime: note.mtime,
						updated_at: note.updated_at,
						deleted: false,
						version: note.version ?? event.version,
					});
				}
			} catch (e) {
				// biome-ignore lint/suspicious/noConsole: error boundary
				console.error(`Engram Sync: failed to apply WebSocket event ${event.path}`, e);
			}
		}
	}

	/** Apply a single remote change to the vault, with conflict detection.
	 *  Returns true when a file was actually created, modified, or trashed.
	 *  When forceOverwrite is true, skip conflict detection and always apply. */
	async applyChange(change: NoteChange, forceOverwrite = false): Promise<boolean> {
		if (this.shouldIgnore(change.path)) {
			devLog().log("pull", `applyChange SKIP (ignored): ${change.path}`);
			return false;
		}

		const normalized = normalizePath(change.path);

		if (change.deleted) {
			devLog().log("pull", `applyChange DELETE: ${change.path}`);

			// Delete local file if it exists
			const existing = this.app.vault.getFileByPath(normalized);
			if (existing) {
				// Resurrection guard: if the local file has unsynced edits, the
				// user has modified it since we last wrote a syncState entry —
				// either they recreated the path after another device deleted it,
				// or they edited a still-live file that another device has now
				// tombstoned. Either way, honouring the tombstone here would
				// destroy user work. Skip the delete and push the local file so
				// the server records the resurrection over its own tombstone.
				//
				// Hash-based check (not mtime): mtime tolerance is unreliable on
				// retest-fast paths where the local mtime is only ms ahead of the
				// tombstone's recorded mtime. Comparing localHash to syncedHash
				// captures user intent directly — "does what's on disk differ from
				// what we last synced?"
				const localContent = await this.app.vault.cachedRead(existing);
				const localHash = fnv1a(localContent);
				const lastSynced = this.syncState.get(normalized);
				const hasUnsyncedEdits = !lastSynced || lastSynced.hash !== localHash;
				if (hasUnsyncedEdits) {
					rlog().info(
						"pull",
						`Tombstone skipped (resurrection): ${change.path}` +
							` | localHash=${localHash}` +
							` | syncedHash=${lastSynced?.hash ?? "none"}` +
							` | localLen=${localContent.length}`,
					);
					devLog().log(
						"pull",
						`applyChange DELETE skipped (resurrection): ${change.path}` +
							` (localHash=${localHash} !== syncedHash=${lastSynced?.hash ?? "none"})`,
					);
					try {
						await this.pushFile(existing, true);
					} catch (e) {
						rlog().error(
							"pull",
							`Resurrection push failed: ${change.path} | err=${errMsg(e)}`,
						);
					}
					return false;
				}
				await this.app.fileManager.trashFile(existing);
				await this.removeEmptyFolders(normalized);
				this.syncState.delete(normalized);
				this.baseStore?.delete(normalized);
				rlog().info("pull", `Deleted: ${change.path}`);
				return true;
			}
			return false;
		}

		// Meta-only changes must be resolved to a body before apply — reaching
		// here without content is a caller bug, not a recoverable state.
		const content = change.content;
		if (content === undefined) {
			throw new Error(`applyChange: missing content for ${change.path}`);
		}

		// Create or update the file
		const existing = this.app.vault.getFileByPath(normalized);
		if (existing) {
			// Conflict detection — content-hash based.
			// Mtime is unreliable because Obsidian sets it to "now" on every
			// vault.modify(), so we track hashes of content we last wrote.
			const localContent = await this.app.vault.cachedRead(existing);
			const localHash = fnv1a(localContent);
			const lastSynced = this.syncState.get(normalized);
			const lastSyncedHash = lastSynced?.hash;

			// Local was modified by the user if its content hash differs from
			// what we last wrote during sync (or if we never wrote it).
			let localModified: boolean;
			if (lastSyncedHash !== undefined) {
				localModified = localHash !== lastSyncedHash;
			} else {
				// No sync hash — first sync for this file. Use a staleness
				// heuristic: if the local mtime is well before the remote mtime,
				// the user almost certainly didn't edit locally — the file is
				// just stale and the remote is newer.
				const localMtimeS = existing.stat.mtime / 1000;
				const stale = change.mtime - localMtimeS > STALE_THRESHOLD_S;
				localModified = stale ? false : localContent !== content;
			}

			if (!forceOverwrite && localModified && localContent !== content) {
				// Both sides differ — real conflict
				const localMtime = existing.stat.mtime / 1000;

				devLog().log(
					"pull",
					`conflict: ${change.path} (localHash=${localHash} syncedHash=${lastSyncedHash})`,
				);
				const firstSync = lastSyncedHash === undefined;
				rlog().warn(
					"conflict",
					`Detected: ${change.path} | firstSync=${firstSync}` +
						` | localHash=${localHash} | syncedHash=${lastSyncedHash ?? "none"}` +
						` | localMtime=${new Date(localMtime * 1000).toISOString()}` +
						` | remoteMtime=${new Date(change.mtime * 1000).toISOString()}` +
						` | localLen=${localContent.length} | remoteLen=${content.length}`,
				);

				// Attempt 3-way auto-merge if we have a base
				const pullBase = this.baseStore?.get(normalized);
				if (pullBase) {
					const merge = threeWayMerge(pullBase.content, localContent, content);
					if (merge.clean) {
						await this.modifyFile(existing, merge.merged);
						this.syncState.set(normalized, {
							hash: fnv1a(merge.merged),
							version: change.version,
						});
						if (change.version != null) {
							this.baseStore?.set(normalized, merge.merged, change.version);
						}
						// Push merged result to server (force=true to bypass echo suppression,
						// since syncState.hash was just updated to match merged content)
						try {
							await this.pushFile(existing, true);
						} catch (e) {
							rlog().error(
								"conflict",
								`Auto-merge push failed: ${change.path} | err=${errMsg(e)}`,
							);
						}
						rlog().info(
							"conflict",
							`Auto-merged (pull): ${change.path}` +
								` | baseLen=${pullBase.content.length} | localLen=${localContent.length}` +
								` | remoteLen=${content.length} | mergedLen=${merge.merged.length}`,
						);
						return true;
					}
					rlog().info(
						"conflict",
						`Auto-merge failed (pull): ${change.path}` +
							` | conflicts=${merge.conflicts.length}` +
							` | baseLen=${pullBase.content.length} | localLen=${localContent.length}` +
							` | remoteLen=${content.length}`,
					);
				}

				// Fall back to interactive conflict resolution
				const resolution = await this.resolveConflict({
					path: change.path,
					localContent,
					localMtime,
					remoteContent: content,
					remoteMtime: change.mtime,
					baseContent: pullBase?.content,
					vaultName: this.app.vault.getName(),
				});

				if (resolution.choice === "skip") {
					rlog().info("conflict", `Resolved: ${change.path} → skip`);
					return false;
				}
				if (resolution.choice === "keep-local") {
					// Push local version to server. pushFile records the fresh
					// syncState (hash/version/serverHash) from the response — do
					// NOT overwrite it with the stale pre-conflict version here.
					try {
						await this.pushFile(existing);
						rlog().info(
							"conflict",
							`Resolved: ${change.path} → keep-local | pushOk=true`,
						);
					} catch (e) {
						rlog().error(
							"conflict",
							`Resolved: ${change.path} → keep-local | pushOk=false | err=${errMsg(e)}`,
							e instanceof Error ? e.stack : undefined,
						);
					}
					return false;
				}
				if (resolution.choice === "keep-both") {
					// Save remote as a conflict copy, keep local as-is
					const date = new Date().toISOString().slice(0, 10);
					const baseName = normalized.replace(/\.md$/, "");
					const conflictPath = `${baseName} (conflict ${date}).md`;
					try {
						await this.createFileWithFolders(conflictPath, content);
						this.syncState.set(normalizePath(conflictPath), {
							hash: fnv1a(content),
							version: change.version,
						});
						if (change.version != null) {
							this.baseStore?.set(
								normalizePath(conflictPath),
								content,
								change.version,
							);
						}
						rlog().info(
							"conflict",
							`Resolved: ${change.path} → keep-both | copyPath=${conflictPath}`,
						);
					} catch (e) {
						rlog().error(
							"conflict",
							`Resolved: ${change.path} → keep-both | copyFailed=true | err=${errMsg(e)}`,
							e instanceof Error ? e.stack : undefined,
						);
					}
					return true;
				}
				if (resolution.choice === "merge" && resolution.mergedContent != null) {
					// Apply user-merged content locally and push to server
					try {
						await this.modifyFile(existing, resolution.mergedContent);
						this.syncState.set(normalized, {
							hash: fnv1a(resolution.mergedContent),
							version: change.version,
						});
						if (change.version != null) {
							this.baseStore?.set(
								normalized,
								resolution.mergedContent,
								change.version,
							);
						}
						await this.pushFile(existing, true);
						rlog().info(
							"conflict",
							`Resolved: ${change.path} → merge | mergedLen=${resolution.mergedContent.length} | pushOk=true`,
						);
					} catch (e) {
						rlog().error(
							"conflict",
							`Resolved: ${change.path} → merge | pushOk=false | err=${errMsg(e)}`,
							e instanceof Error ? e.stack : undefined,
						);
					}
					return true;
				}
				// "keep-remote" falls through to overwrite below
				rlog().info("conflict", `Resolved: ${change.path} → keep-remote`);
			} else if (localContent === content) {
				// Content identical — nothing to do
				devLog().log("pull", `applyChange SKIP (identical): ${change.path}`);
				this.syncState.set(normalized, {
					hash: localHash,
					version: change.version,
					serverHash: change.content_hash,
				});
				if (change.version != null) {
					this.baseStore?.set(normalized, content, change.version);
				}
				rlog().info("pull", `Unchanged: ${change.path}`);
				return false;
			}

			// Apply remote change (no conflict, or keep-remote chosen)
			devLog().log("pull", `applyChange OVERWRITE: ${change.path} (len=${content.length})`);
			await this.modifyFile(existing, content);
			this.syncState.set(normalized, {
				hash: fnv1a(content),
				version: change.version,
				serverHash: change.content_hash,
			});
			if (change.version != null) {
				this.baseStore?.set(normalized, content, change.version);
			}
			rlog().info(
				"pull",
				`Applied: ${change.path} | localLen=${localContent.length} | remoteLen=${content.length}`,
			);
			return true;
		}
		// New file — create it
		devLog().log("pull", `applyChange CREATE: ${normalized} (len=${content.length})`);
		try {
			await this.createFileWithFolders(normalized, content);
		} catch (createErr) {
			rlog().error(
				"pull",
				`applyChange CREATE FAILED: ${normalized}`,
				createErr instanceof Error ? createErr.stack : undefined,
			);
			throw createErr;
		}
		this.syncState.set(normalized, {
			hash: fnv1a(content),
			version: change.version,
			serverHash: change.content_hash,
		});
		if (change.version != null) {
			this.baseStore?.set(normalized, content, change.version);
		}
		rlog().info("pull", `Created: ${change.path} | len=${content.length}`);
		return true;
	}

	/** Apply a remote attachment change to the vault.
	 *  If contentBase64 is provided (from WebSocket), use it directly. Otherwise fetch it.
	 *  Returns true when a file was actually created, modified, or trashed. */
	async applyAttachmentChange(
		change: AttachmentChange,
		contentBase64?: string,
	): Promise<boolean> {
		if (this.shouldIgnore(change.path)) return false;

		const normalized = normalizePath(change.path);

		if (change.deleted) {
			const existing = this.app.vault.getFileByPath(normalized);
			if (existing) {
				await this.app.fileManager.trashFile(existing);
				await this.removeEmptyFolders(normalized);
				this.syncState.delete(normalized);
				rlog().info("pull", `Attachment deleted: ${change.path}`);
				return true;
			}
			return false;
		}

		// Fetch content if not provided
		const resolvedBase64 =
			contentBase64 ?? (await this.api.getAttachment(change.path)).content_base64;
		const buffer = base64ToArrayBuffer(resolvedBase64);
		const existing = this.app.vault.getFileByPath(normalized);
		// Track the synced bytes so a later push echo-suppresses instead of
		// re-uploading this attachment (keyed identically to the push side).
		const hash = fnv1a(resolvedBase64);

		if (existing) {
			// Skip if content is identical — prevents modify event and push-back loop
			if (existing.stat.size === buffer.byteLength) {
				const localBuffer = await this.app.vault.readBinary(existing);
				if (this.arrayBuffersEqual(localBuffer, buffer)) {
					this.syncState.set(normalized, { hash });
					rlog().info(
						"pull",
						`Attachment unchanged: ${change.path} | bytes=${buffer.byteLength}`,
					);
					return false;
				}
			}
			await this.app.vault.modifyBinary(existing, buffer);
			this.syncState.set(normalized, { hash });
			rlog().info("pull", `Attachment applied: ${change.path} | bytes=${buffer.byteLength}`);
			return true;
		}
		await this.createBinaryFileWithFolders(normalized, buffer);
		this.syncState.set(normalized, { hash });
		rlog().info("pull", `Attachment created: ${change.path} | bytes=${buffer.byteLength}`);
		return true;
	}

	/** Resolve a conflict via callback or auto-resolve as keep-remote. */
	private async resolveConflict(info: ConflictInfo): Promise<ConflictResolution> {
		// Auto mode: create conflict copy file instead of blocking modal
		if (this.settings.conflictResolution === "auto") {
			const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15); // YYYYMMDDTHHmmss
			const normalized = normalizePath(info.path);
			const baseName = normalized.replace(/\.md$/, "");
			const conflictPath = `${baseName} (conflict ${ts}).md`;
			try {
				await this.createFileWithFolders(conflictPath, info.remoteContent);
				this.syncState.set(normalizePath(conflictPath), {
					hash: fnv1a(info.remoteContent),
					version: undefined,
				});
				rlog().info(
					"conflict",
					`Auto-resolved: ${info.path} → conflict file ${conflictPath}` +
						` | localLen=${info.localContent.length} | remoteLen=${info.remoteContent.length}` +
						` | hasBase=${info.baseContent != null}`,
				);
				new Notice(
					`Engram Sync: conflict — saved copy as "${conflictPath.split("/").pop()}"`,
					8000,
				);
			} catch (e) {
				rlog().error(
					"conflict",
					`Failed to create conflict file: ${conflictPath} | err=${errMsg(e)}`,
				);
			}
			// Keep local as-is, remote saved as conflict copy
			return { choice: "keep-local" };
		}

		if (this.onConflict) {
			return this.onConflict(info);
		}
		// No handler — default to keep-remote (legacy behavior)
		rlog().warn(
			"conflict",
			`Auto-resolved: ${info.path} → keep-remote (no handler) | localLen=${info.localContent.length} | remoteLen=${info.remoteContent.length}`,
		);
		return { choice: "keep-remote" };
	}

	/** Create a text file, ensuring parent folders exist. */
	/** Modify a file using vault.process() when available (scroll-safe),
	 *  falling back to vault.modify() for older Obsidian versions. */
	private async modifyFile(file: TFile, content: string): Promise<void> {
		if (this.app.vault.process) {
			// vault.process() does an atomic read-modify-write that updates
			// the editor in-place without resetting scroll position.
			await this.app.vault.process(file, () => content);
		} else {
			await this.app.vault.modify(file, content);
		}
	}

	private async createFileWithFolders(normalized: string, content: string): Promise<void> {
		const folder = normalized.includes("/")
			? normalized.substring(0, normalized.lastIndexOf("/"))
			: "";
		if (folder) {
			await this.ensureFolder(folder);
		}
		await this.app.vault.create(normalized, content);
	}

	/** Create a binary file, ensuring parent folders exist. */
	private async createBinaryFileWithFolders(
		normalized: string,
		data: ArrayBuffer,
	): Promise<void> {
		const folder = normalized.includes("/")
			? normalized.substring(0, normalized.lastIndexOf("/"))
			: "";
		if (folder) {
			await this.ensureFolder(folder);
		}
		await this.app.vault.createBinary(normalized, data);
	}

	/** Recursively create folder if it doesn't exist. */
	private async ensureFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing) return;

		// Ensure parent first
		if (path.includes("/")) {
			const parent = path.substring(0, path.lastIndexOf("/"));
			if (parent) await this.ensureFolder(parent);
		}

		await this.app.vault.createFolder(path);
	}

	/** Pull the server's explicit empty-folder markers, persist them, and
	 *  materialize each on disk. Skips ignored paths (so we never recreate
	 *  .obsidian/, .trash/, .git/, or user-ignored folders). Failures are
	 *  warn-logged and swallowed — folder sync is best-effort, doesn't fail
	 *  the broader pull. */
	private async syncExplicitFolders(): Promise<void> {
		if (!this.explicitFolders) return;
		let names: string[];
		try {
			names = await this.api.listExplicitFolders();
		} catch (e) {
			devLog().log("pull", `listExplicitFolders failed: ${errMsg(e)}`);
			rlog().warn("pull", `listExplicitFolders failed: ${errMsg(e)}`);
			return;
		}

		await this.explicitFolders.replaceAll(names);

		for (const name of names) {
			if (this.shouldIgnore(name)) continue;
			try {
				await this.ensureFolder(name);
			} catch (e) {
				devLog().log("pull", `ensureFolder(${name}) failed: ${errMsg(e)}`);
			}
		}
	}

	/** Remove empty parent folders after a file deletion, walking up the tree.
	 *  Stops on any folder marked explicit (kind='folder' on the server) — the
	 *  user-intended empty stays. */
	private async removeEmptyFolders(filePath: string): Promise<void> {
		let folder = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";

		while (folder) {
			const existing = this.app.vault.getAbstractFileByPath(folder);
			if (!(existing instanceof TFolder)) break;
			if (existing.children.length > 0) break;

			// User has marked this folder as intentionally empty (created in the
			// web app or via Obsidian's New folder). Don't strip it; the marker
			// would just come back on the next pull.
			if (this.explicitFolders?.has(folder)) break;

			await this.app.fileManager.trashFile(existing);

			// Walk up to parent
			folder = folder.includes("/") ? folder.substring(0, folder.lastIndexOf("/")) : "";
		}
	}

	// --- Full sync (startup) ---

	/** Full bidirectional sync: pull remote changes, then push local changes. */
	async fullSync(): Promise<{ pulled: number; pushed: number }> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "fullSync short-circuited — gate closed");
			return { pulled: 0, pushed: 0 };
		}
		devLog().log("lifecycle", "fullSync start");
		rlog().info("lifecycle", "FullSync started");
		// Verify auth before syncing to give a clear error on bad API key
		const { ok, error } = await this.api.ping();
		if (!ok) {
			this.lastError = error ?? "Connection failed";
			this.emitStatus();
			devLog().log("error", `fullSync auth failed: ${this.lastError}`);
			rlog().error("lifecycle", `Auth failed: ${this.lastError}`);
			throw new Error(this.lastError);
		}

		// Configure request pacer from server-reported rate limit
		await this.configureRateLimit();

		// Drop stale per-vault bookkeeping if the active vault changed since
		// syncState was recorded (must run before prePullSync is snapshotted).
		await this.invalidateIfVaultChanged();

		// Snapshot lastSync before pull — pull updates it to server_time,
		// which would cause pushModifiedFiles to miss files modified between
		// the old and new lastSync values.
		const prePullSync = this.lastSync;

		const pulled = await this.pull();
		const pushed = await this.pushModifiedFiles(prePullSync);

		// Close out the progress UI (mirrors pushAll's terminal "complete").
		this.onSyncProgress?.({ phase: "complete", current: pushed, total: pushed, failed: 0 });

		// Persist syncState updated during push (pull already saved its own)
		if (pushed > 0) {
			await this.saveData({ lastSync: this.lastSync });
		}

		devLog().log("lifecycle", `fullSync done — pulled=${pulled} pushed=${pushed}`);
		rlog().info("lifecycle", `FullSync done — pulled=${pulled} pushed=${pushed}`);
		return { pulled, pushed };
	}

	/** Push all files that have been modified since last sync, plus any
	 *  syncable file that the engine has never seen (no syncState entry).
	 *  The untracked branch covers the first-sync case and the post
	 *  vault-change case where we cleared sync state — neither would
	 *  otherwise touch the push path because lastSync is empty and the
	 *  mtime comparison short-circuits. */
	/** Sticky "server has no POST /notes/batch" flag — set on the first
	 *  404/405 so later bulk syncs skip the probe entirely. */
	private batchPushUnsupported = false;

	/** Bulk-push note files via POST /notes/batch in chunks of 100.
	 *
	 *  Returns null when the server lacks the endpoint (pre-rev backend) —
	 *  the caller falls back to per-file pushes. Per-result handling:
	 *  ok → record state (incl. server-sanitized renames); conflict → re-route
	 *  through pushFile so the existing 3-way merge / interactive flow stays
	 *  the single conflict path; error → record an issue. A transport error
	 *  mid-bulk enqueues the remaining files and goes offline, mirroring the
	 *  single-push error path. */
	private async pushNotesViaBatch(
		files: TFile[],
		force: boolean,
		onProgress?: (done: number, failed: number) => void,
	): Promise<{ pushed: number; failed: number } | null> {
		if (this.batchPushUnsupported) return null;

		// Notes above the single-note size cap go through pushFile so the
		// server's 413 produces the proper too_large Sync Center issue
		// (terminal, with sizeBytes) instead of an opaque batch error — and
		// so one huge note can't blow the request-body limit for 99 others.
		const MAX_BATCH_NOTE_BYTES = 10 * 1024 * 1024;
		// The server's Plug.Parsers cap is 11MB per request body — flush a
		// chunk before the accumulated content would approach it. Margin
		// covers JSON envelope + multibyte expansion.
		const BATCH_PAYLOAD_BUDGET = 6_000_000;
		const BATCH_MAX_NOTES = 100;

		let pushed = 0;
		let failed = 0;
		let done = 0;

		type Entry = { file: TFile; content: string; hash: number; version?: number };
		let chunk: Entry[] = [];
		let chunkBytes = 0;
		const oversized: TFile[] = [];

		// Sends the accumulated chunk. Returns "ok" | "unsupported" | "transport".
		const flushChunk = async (): Promise<"ok" | "unsupported" | "transport"> => {
			if (chunk.length === 0) return "ok";
			const entries = chunk;
			chunk = [];
			chunkBytes = 0;

			for (const e of entries) this.pushing.add(e.file.path);
			try {
				await this.paceRequest();
				const resp = await this.api.pushNotesBatch(
					entries.map((e) => ({
						path: e.file.path,
						content: e.content,
						mtime: e.file.stat.mtime / 1000,
						version: e.version,
					})),
				);
				const byPath = new Map(resp.results.map((r) => [r.path, r]));

				for (const e of entries) {
					const r = byPath.get(e.file.path);
					done++;
					if (!r) {
						failed++;
						this.logEntry("push", e.file.path, "error", "missing batch result");
						continue;
					}
					if (r.status === "ok") {
						await this.recordBatchPushOk(e.file, e.content, e.hash, r);
						pushed++;
						this.logEntry("push", e.file.path, "ok");
					} else if (r.status === "conflict") {
						// Hand the file to the single-note flow, which owns 3-way
						// merge + interactive resolution. It re-pushes with the
						// stored version, gets the same 409, and resolves.
						this.pushing.delete(e.file.path);
						const ok = await this.pushFile(e.file, true);
						if (ok) pushed++;
					} else {
						failed++;
						const msg = JSON.stringify(r.errors ?? "batch error");
						this.issues.record({
							path: e.file.path,
							kind: "note",
							category: "other",
							message: msg,
							firstFailedAt: Date.now(),
							lastFailedAt: Date.now(),
							attempts: 1,
						});
						this.logEntry("push", e.file.path, "error", msg);
					}
				}
				this.goOnline();
				return "ok";
			} catch (err) {
				const status = (err as { status?: number }).status;
				if (status === 404 || status === 405) {
					// Pre-rev backend — remember and let the caller fall back.
					this.batchPushUnsupported = true;
					rlog().info("push", "Batch endpoint unsupported — falling back to per-note");
					return "unsupported";
				}
				// Transport/server failure: queue this chunk for retry,
				// mirroring the single-push offline path. The caller queues
				// whatever hasn't been read yet.
				rlog().error(
					"push",
					`Batch push failed (${errMsg(err)}) — queueing ${entries.length} files`,
				);
				for (const e of entries) {
					failed++;
					done++;
					await this.enqueueChange({
						path: e.file.path,
						action: "upsert",
						kind: "note",
						mtime: e.file.stat.mtime / 1000,
						timestamp: Date.now(),
						vaultId: this.settings.vaultId ?? undefined,
					});
				}
				// A whole-batch failure with no HTTP response = connection loss.
				// A batch 5xx is a server error, not a disconnect — stay online.
				this.maybeGoOffline(err);
				return "transport";
			} finally {
				for (const e of entries) {
					this.pushing.delete(e.file.path);
					this.markRecentlyPushed(e.file.path);
				}
			}
		};

		for (let i = 0; i < files.length; i++) {
			const file = files[i]!;
			if (file.stat.size > MAX_BATCH_NOTE_BYTES) {
				oversized.push(file);
				continue;
			}
			const content = await this.app.vault.cachedRead(file);
			const hash = fnv1a(content);
			const existing = this.syncState.get(normalizePath(file.path));
			if (!force && existing !== undefined && hash === existing.hash) {
				done++;
				this.logEntry("skip", file.path, "skipped", undefined, "unchanged");
				continue;
			}

			if (
				chunk.length >= BATCH_MAX_NOTES ||
				(chunk.length > 0 && chunkBytes + content.length > BATCH_PAYLOAD_BUDGET)
			) {
				const outcome = await flushChunk();
				if (outcome === "unsupported") return null;
				if (outcome === "transport") {
					// Queue everything not yet attempted (incl. this file).
					for (const rest of [file, ...files.slice(i + 1), ...oversized]) {
						failed++;
						await this.enqueueChange({
							path: rest.path,
							action: "upsert",
							kind: "note",
							mtime: rest.stat.mtime / 1000,
							timestamp: Date.now(),
							vaultId: this.settings.vaultId ?? undefined,
						});
					}
					onProgress?.(done, failed);
					return { pushed, failed };
				}
				onProgress?.(done, failed);
			}

			chunk.push({ file, content, hash, version: existing?.version });
			chunkBytes += content.length;
		}

		const outcome = await flushChunk();
		if (outcome === "unsupported") return null;
		if (outcome === "transport") {
			for (const rest of oversized) {
				failed++;
				await this.enqueueChange({
					path: rest.path,
					action: "upsert",
					kind: "note",
					mtime: rest.stat.mtime / 1000,
					timestamp: Date.now(),
					vaultId: this.settings.vaultId ?? undefined,
				});
			}
			onProgress?.(done, failed);
			return { pushed, failed };
		}
		onProgress?.(done, failed);

		// Oversized notes: single-note path → server 413 → proper terminal
		// too_large issue with sizeBytes.
		for (const file of oversized) {
			try {
				const ok = await this.pushFile(file, force);
				done++;
				if (ok) {
					pushed++;
					this.logEntry("push", file.path, "ok");
				}
			} catch (e) {
				done++;
				failed++;
				this.logEntry("push", file.path, "error", errMsg(e));
			}
			onProgress?.(done, failed);
		}

		return { pushed, failed };
	}

	/** Record a successful batch-push result: sync state, base store, issue
	 *  clearing, and the server-sanitized-path rename (mirrors pushFile). */
	private async recordBatchPushOk(
		file: TFile,
		content: string,
		hash: number,
		result: BatchUpsertResult,
	): Promise<void> {
		const serverPath =
			result.server_path && result.server_path !== file.path ? result.server_path : undefined;

		if (serverPath) {
			const localFile = this.app.vault.getFileByPath(file.path);
			if (localFile) {
				await this.app.vault.rename(localFile, serverPath);
				rlog().info("push", `Renamed: ${file.path} → ${serverPath} (server sanitized)`);
				new Notice(
					`Engram Sync: renamed "${file.path.split("/").pop()}" (unsupported characters)`,
				);
			}
			this.syncState.delete(normalizePath(file.path));
			this.baseStore?.delete(normalizePath(file.path));
			const np = normalizePath(serverPath);
			this.syncState.set(np, {
				hash,
				version: result.version,
				serverHash: result.content_hash,
			});
			if (result.version != null) {
				this.baseStore?.set(np, content, result.version);
			}
		} else {
			const np = normalizePath(file.path);
			this.syncState.set(np, {
				hash,
				version: result.version,
				serverHash: result.content_hash,
			});
			if (result.version != null) {
				this.baseStore?.set(np, content, result.version);
			}
		}
		this.issues.clear(file.path);
	}

	private async pushModifiedFiles(sinceTimestamp?: string): Promise<number> {
		// Use ?? not || so an empty-string prePullSync (first connect, never
		// synced) is preserved and maps to epoch below — || would discard "" and
		// fall back to this.lastSync, which pull() just advanced to server_time,
		// gating every tracked file behind `mtime > now` and skipping them all.
		const since = sinceTimestamp ?? this.lastSync;
		const sinceMs = since ? new Date(since).getTime() : 0;
		const files = this.app.vault.getFiles();
		let pushed = 0;

		// Batch in groups of 10
		const toSync = files.filter((f: TFile) => {
			if (!this.isSyncable(f) || this.shouldIgnore(f.path)) return false;
			if (!this.syncState.has(f.path)) return true;
			return f.stat.mtime > sinceMs;
		});
		devLog().log("push", `pushModifiedFiles: ${toSync.length} files modified since ${since}`);
		rlog().info("push", `PushModified: ${toSync.length} files modified since ${since}`);

		// Drive the progress UI the same way pushAll does, so the Merge path
		// shows progress too (the engine emits nothing otherwise).
		const total = toSync.length;
		if (total > 0) {
			this.onSyncProgress?.({ phase: "pushing", current: 0, total, failed: 0 });
		}

		// Protocol rev: notes via the batch endpoint (echo suppression inside),
		// attachments via the per-file path; pre-rev backends fall back wholesale.
		const noteFiles = toSync.filter((f: TFile) => !this.isBinaryFile(f));
		const attachFiles = toSync.filter((f: TFile) => this.isBinaryFile(f));

		const batchOutcome = await this.pushNotesViaBatch(noteFiles, false, (done, failedSoFar) => {
			this.onSyncProgress?.({
				phase: "pushing",
				current: Math.min(done, total),
				total,
				failed: failedSoFar,
			});
		});

		let perFile: TFile[];
		let doneOffset = 0;
		if (batchOutcome) {
			pushed += batchOutcome.pushed;
			doneOffset = noteFiles.length;
			perFile = attachFiles;
		} else {
			perFile = toSync;
		}

		for (let i = 0; i < perFile.length; i += 10) {
			const batch = perFile.slice(i, i + 10);
			const results = await Promise.all(batch.map((f: TFile) => this.pushFile(f)));
			pushed += results.filter(Boolean).length;
			this.onSyncProgress?.({
				phase: "pushing",
				current: Math.min(doneOffset + i + batch.length, total),
				total,
				failed: 0,
			});
		}

		this.flushAttachmentLimitedToast();
		this.flushFailureSummaryToast();
		return pushed;
	}

	/** Compute what a sync would do without executing it (dry-run preview).
	 *
	 *  mode:
	 *  - "full"     — bidirectional: compute toPush, toPull, conflicts, deletions
	 *  - "push-all" — push only: compute toPush, skip toPull
	 *  - "pull-all" — pull only: compute toPull, skip toPush
	 */
	async computeSyncPlan(mode: "push-all" | "pull-all" | "full"): Promise<SyncPlan> {
		const epoch = "1970-01-01T00:00:00Z";

		// Authoritative server inventory for "is this path on the server?" comparisons.
		// In incremental "full" mode the changes-since-lastSync delta is NOT a valid
		// inventory — long-synced files don't appear in the delta and were falsely
		// flagged for push. Prefer /sync/manifest for inventory; fall back to a full
		// changes-since-epoch query when the server doesn't expose the manifest.
		let manifestNotePaths: Set<string> | null = null;
		let manifestAttachPaths: Set<string> | null = null;
		let manifestNoteCount: number | null = null;
		let manifestAttachCount: number | null = null;

		if (mode === "full" && this.lastSync) {
			const manifest = await this.api.getManifest();
			if (manifest) {
				manifestNotePaths = new Set(manifest.notes.map((n) => n.path));
				manifestAttachPaths = new Set(manifest.attachments.map((a) => a.path));
				manifestNoteCount = manifest.notes.length;
				manifestAttachCount = manifest.attachments.length;
			}
		}

		// Delta query: changes-since-lastSync for content/pull/conflict computation.
		// When manifest is unavailable (older self-host backend) AND we're in
		// incremental mode, widen the query to since=epoch so the delta also serves
		// as a (slower) inventory. This trades a one-off slow query for correctness.
		const needsDeltaAsInventory =
			mode === "full" && this.lastSync !== "" && manifestNotePaths === null;
		const since = mode !== "full" || needsDeltaAsInventory ? epoch : this.lastSync || epoch;

		const [noteResp, attachResp] = await Promise.all([
			this.fetchAllNoteChanges(since),
			this.api.getAttachmentChanges(since),
		]);

		// Build lookup sets from server state
		const serverNotes = new Map<string, { deleted: boolean }>();
		for (const c of noteResp.changes) {
			serverNotes.set(c.path, { deleted: c.deleted });
		}

		const serverAttachments = new Map<string, { deleted: boolean }>();
		for (const c of attachResp.changes) {
			serverAttachments.set(c.path, { deleted: c.deleted });
		}

		// `serverHasNote/serverHasAttach` returns the authoritative answer:
		// manifest when present, else the (epoch-widened) delta as fallback.
		const serverHasNote = (path: string) =>
			manifestNotePaths ? manifestNotePaths.has(path) : serverNotes.has(path);
		const serverHasAttach = (path: string) =>
			manifestAttachPaths ? manifestAttachPaths.has(path) : serverAttachments.has(path);

		// Enumerate local files
		const allFiles = this.app.vault.getFiles();
		const syncable = allFiles.filter((f) => this.isSyncable(f) && !this.shouldIgnore(f.path));

		const localNotes: string[] = [];
		const localAttachments: string[] = [];
		for (const f of syncable) {
			if (this.isBinaryFile(f)) {
				localAttachments.push(f.path);
			} else {
				localNotes.push(f.path);
			}
		}

		const localNoteSet = new Set(localNotes);
		const localAttachSet = new Set(localAttachments);

		// Categorise server note changes
		const toPullNotes: string[] = [];
		const conflictNotes: string[] = [];
		const toDeleteLocal: string[] = [];

		for (const [path, { deleted }] of serverNotes) {
			if (deleted) {
				// Server deleted — mark for local deletion if present
				if (localNoteSet.has(path)) {
					toDeleteLocal.push(path);
				}
				continue;
			}
			if (localNoteSet.has(path)) {
				// Both sides have it — compare content to see if pull is needed
				const file = this.app.vault.getFileByPath(path);
				if (file) {
					const content = await this.app.vault.cachedRead(file);
					const localHash = fnv1a(content);

					// Check if server content actually differs from local
					const serverChange = noteResp.changes.find((c) => c.path === path);
					const serverHash =
						serverChange?.content !== undefined
							? fnv1a(serverChange.content)
							: undefined;

					if (serverHash !== undefined && localHash === serverHash) {
						// Content identical — nothing to do, skip entirely
						continue;
					}

					const synced = this.syncState.get(path);
					if (synced?.hash !== undefined && localHash !== synced.hash) {
						// Local changed since last sync AND server changed — conflict
						conflictNotes.push(path);
					} else {
						// Local unchanged or never synced — server has new content
						toPullNotes.push(path);
					}
				} else {
					toPullNotes.push(path);
				}
			} else {
				// Only on server — need to pull
				toPullNotes.push(path);
			}
		}

		// Categorise server attachment changes
		const toPullAttachments: string[] = [];
		const toDeleteLocalAttach: string[] = [];

		for (const [path, { deleted }] of serverAttachments) {
			if (deleted) {
				if (localAttachSet.has(path)) {
					toDeleteLocalAttach.push(path);
				}
				continue;
			}
			if (!localAttachSet.has(path)) {
				toPullAttachments.push(path);
			}
		}

		// Files only local → need to push (not on server at all).
		// Then for files that ARE on the server but absent from the delta,
		// compare current local hash against the last-synced hash so a
		// locally-edited note shows up as toPush. Skip paths the delta
		// already owns (pull/conflict branches handle those) to avoid
		// double-counting. A missing syncState entry is treated as clean —
		// a true content cross-check needs a plugin-computable server hash
		// (separate backend work).
		const toPushNotes: string[] = [];
		for (const path of localNotes) {
			if (!serverHasNote(path)) {
				toPushNotes.push(path);
				continue;
			}
			if (serverNotes.has(path)) continue;
			const file = this.app.vault.getFileByPath(path);
			if (!file) continue;
			const content = await this.app.vault.cachedRead(file);
			const localHash = fnv1a(content);
			const synced = this.syncState.get(path);
			if (synced?.hash !== undefined && synced.hash !== localHash) {
				toPushNotes.push(path);
			}
		}

		const toPushAttachments: string[] = [];
		for (const path of localAttachments) {
			if (!serverHasAttach(path)) {
				toPushAttachments.push(path);
			}
		}

		const localFolderCount = countFolders([...localNotes, ...localAttachments]);
		const serverPaths = manifestNotePaths
			? [...manifestNotePaths, ...(manifestAttachPaths ?? new Set<string>())]
			: [
					...[...serverNotes.entries()].filter(([, v]) => !v.deleted).map(([k]) => k),
					...[...serverAttachments.entries()]
						.filter(([, v]) => !v.deleted)
						.map(([k]) => k),
				];
		const serverFolderCount = countFolders(serverPaths);

		return {
			vaultName: this.app.vault.getName(),
			serverNoteCount:
				manifestNoteCount ?? [...serverNotes.values()].filter((v) => !v.deleted).length,
			serverAttachmentCount:
				manifestAttachCount ??
				[...serverAttachments.values()].filter((v) => !v.deleted).length,
			serverFolderCount,
			localNoteCount: localNotes.length,
			localAttachmentCount: localAttachments.length,
			localFolderCount,
			localPaths: [...localNotes, ...localAttachments],
			serverPaths,
			toPush: {
				notes: mode === "pull-all" ? [] : toPushNotes,
				attachments: mode === "pull-all" ? [] : toPushAttachments,
			},
			toPull: {
				notes: mode === "push-all" ? [] : toPullNotes,
				attachments: mode === "push-all" ? [] : toPullAttachments,
			},
			conflicts: mode === "push-all" || mode === "pull-all" ? [] : conflictNotes,
			toDeleteLocal: [...toDeleteLocal, ...toDeleteLocalAttach],
			toDeleteRemote: [], // computed during execution (local deletes since last sync)
		};
	}

	/** Push every local syncable file to the server.
	 *
	 *  @param opts.deleteRemoteExtras — if true, also delete any remote note or
	 *    attachment that has no local counterpart. Used by the "Push all + delete
	 *    remote extras" sync direction. Defaults to false (preserves existing
	 *    behavior for callers that haven't migrated).
	 */
	async pushAll(opts: { deleteRemoteExtras?: boolean } = {}): Promise<number> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "pushAll short-circuited — gate closed");
			return 0;
		}
		this.syncLog?.clear();

		// Verify auth before pushing to give a clear error on bad API key
		const { ok, error } = await this.api.ping();
		if (!ok) {
			this.lastError = error ?? "Connection failed";
			this.emitStatus();
			throw new Error(this.lastError);
		}

		// Drop stale per-vault bookkeeping if the active vault changed.
		await this.invalidateIfVaultChanged();

		const files = this.app.vault.getFiles();
		const toSync = files.filter((f: TFile) => this.isSyncable(f) && !this.shouldIgnore(f.path));

		let pushed = 0;
		let failed = 0;
		const total = toSync.length;

		devLog().log("push", `pushAll: ${total} files`);
		rlog().info("push", `PushAll started — ${total} files`);

		this.onSyncProgress?.({ phase: "pushing", current: 0, total, failed: 0 });

		// Protocol rev: notes go through POST /notes/batch (100 per request);
		// attachments keep the per-file path. Pre-rev backends (or a sticky
		// 404) fall back to per-file pushes for everything.
		const noteFiles = toSync.filter((f: TFile) => !this.isBinaryFile(f));
		const attachFiles = toSync.filter((f: TFile) => this.isBinaryFile(f));

		const batchOutcome = await this.pushNotesViaBatch(noteFiles, true, (done, failedSoFar) => {
			this.onSyncProgress?.({
				phase: "pushing",
				current: done,
				total,
				failed: failedSoFar,
			});
		});

		let perFile: TFile[];
		let doneOffset = 0;
		if (batchOutcome) {
			pushed += batchOutcome.pushed;
			failed += batchOutcome.failed;
			doneOffset = noteFiles.length;
			perFile = attachFiles;
		} else {
			perFile = toSync;
		}

		for (let i = 0; i < perFile.length; i += 10) {
			const batch = perFile.slice(i, i + 10);
			const results = await Promise.all(
				batch.map(async (f: TFile) => {
					try {
						const ok = await this.pushFile(f, true);
						if (ok) {
							this.logEntry("push", f.path, "ok");
						} else {
							this.logEntry("skip", f.path, "skipped", undefined, "unchanged");
						}
						return ok;
					} catch (e) {
						failed++;
						const msg = errMsg(e);
						this.logEntry("push", f.path, "error", msg);
						return false;
					}
				}),
			);
			pushed += results.filter(Boolean).length;
			this.onSyncProgress?.({
				phase: "pushing",
				current: doneOffset + i + batch.length,
				total,
				failed,
				currentPath: batch[batch.length - 1]!.path,
			});
		}

		this.onSyncProgress?.({ phase: "complete", current: total, total, failed });

		this.flushAttachmentLimitedToast();
		this.flushFailureSummaryToast();

		const skipped = total - pushed - failed;
		devLog().log(
			"push",
			`pushAll done — pushed=${pushed}, skipped=${skipped}, failed=${failed}`,
		);
		rlog().info(
			"push",
			`PushAll done — pushed=${pushed}, skipped=${skipped}, failed=${failed}`,
		);

		// Post-push reconciliation
		const reconcileResult = await this.reconcile();
		if (reconcileResult) {
			const { missing, diverged } = reconcileResult;
			const toFix = [...missing, ...diverged];
			if (toFix.length > 0) {
				devLog().log("reconcile", `fixing ${toFix.length} files after pushAll`);
				rlog().warn(
					"reconcile",
					`Fixing ${toFix.length} files after pushAll (${missing.length} missing, ${diverged.length} diverged)`,
				);
				for (const path of toFix) {
					const file = this.app.vault.getFileByPath(normalizePath(path));
					if (file) {
						await this.pushFile(file, true);
					}
				}
			}
		}

		// Persist all hashes accumulated during pushAll + reconcile
		await this.saveData({ lastSync: this.lastSync });

		if (opts.deleteRemoteExtras) {
			await this.deleteRemoteExtras();
		}

		return pushed;
	}

	/** Known limitation: `pushAll(opts={deleteRemoteExtras:true})` triggers TWO
	 *  `/sync/manifest` fetches in sequence — one inside `reconcile()`, one here.
	 *  Any note a different client creates between those two reads will be in
	 *  this method's "remote-only" set and get deleted. The window is small
	 *  (sub-second) and the user's intent is explicitly destructive, but it's
	 *  worth refactoring later to share the manifest snapshot if the race
	 *  surfaces. Tracked in: code review for commit dcb74e2. */
	private async deleteRemoteExtras(): Promise<void> {
		const manifest = await this.api.getManifest();
		if (!manifest) {
			rlog().warn("push", "deleteRemoteExtras skipped — backend has no /sync/manifest");
			return;
		}
		const localFiles = this.app.vault.getFiles();
		const localPaths = new Set(
			localFiles
				.filter((f) => this.isSyncable(f) && !this.shouldIgnore(f.path))
				.map((f) => f.path),
		);

		const remoteOnlyNotes = manifest.notes.map((n) => n.path).filter((p) => !localPaths.has(p));
		const remoteOnlyAttachments = manifest.attachments
			.map((a) => a.path)
			.filter((p) => !localPaths.has(p));

		rlog().info(
			"push",
			`deleteRemoteExtras — ${remoteOnlyNotes.length} notes, ${remoteOnlyAttachments.length} attachments`,
		);

		for (const path of remoteOnlyNotes) {
			try {
				await this.api.deleteNote(path);
				this.logEntry("delete", path, "ok", undefined, "remote-extras");
			} catch (e) {
				this.logEntry("delete", path, "error", errMsg(e));
			}
		}
		for (const path of remoteOnlyAttachments) {
			try {
				await this.api.deleteAttachment(path);
				this.logEntry("delete", path, "ok", undefined, "remote-extras");
			} catch (e) {
				this.logEntry("delete", path, "error", errMsg(e));
			}
		}
	}

	/** Reconcile local vault against server manifest.
	 *  Returns null if server doesn't support the manifest endpoint.
	 *
	 *  The manifest's content_hash is an opaque server-side HMAC — it can
	 *  NEVER be computed locally (the old implementation compared an MD5 of
	 *  local content against it, which could not match). Divergence is
	 *  instead detected from two locally-knowable facts:
	 *    - local edits: fnv1a(local) differs from the stored synced hash
	 *    - server drift: the manifest hash differs from the stored serverHash
	 *      (only meaningful when a serverHash was recorded — pre-rev sync
	 *      state stays quiet rather than re-pushing the whole vault). */
	async reconcile(): Promise<ReconcileResult | null> {
		devLog().log("reconcile", "start");
		rlog().info("reconcile", "Reconcile started");
		const manifest = await this.api.getManifest();
		if (!manifest) {
			devLog().log("reconcile", "server does not support manifest — skipping");
			rlog().info("reconcile", "Server does not support manifest — skipping");
			return null;
		}

		const serverNotes = new Map(manifest.notes.map((n) => [n.path, n.content_hash]));
		const missing: string[] = [];
		const diverged: string[] = [];

		// Check local files against server manifest
		const files = this.app.vault.getFiles();
		const syncable = files.filter(
			(f: TFile) => this.isSyncable(f) && !this.isBinaryFile(f) && !this.shouldIgnore(f.path),
		);

		for (const file of syncable) {
			const serverHash = serverNotes.get(file.path);
			if (!serverHash) {
				missing.push(file.path);
			} else {
				serverNotes.delete(file.path);
				const stored = this.syncState.get(normalizePath(file.path));
				const content = await this.app.vault.cachedRead(file);
				const locallyModified = stored === undefined || stored.hash !== fnv1a(content);
				const serverDrifted =
					stored?.serverHash !== undefined && stored.serverHash !== serverHash;
				if (locallyModified || serverDrifted) {
					diverged.push(file.path);
				}
			}
		}

		// Remaining server entries are files not in the local vault
		const extraOnServer = [...serverNotes.keys()];

		devLog().log(
			"reconcile",
			`done — missing=${missing.length} diverged=${diverged.length} extraOnServer=${extraOnServer.length}`,
		);
		rlog().info(
			"reconcile",
			`Reconcile done — missing=${missing.length} diverged=${diverged.length} extraOnServer=${extraOnServer.length}`,
		);
		return { missing, diverged, extraOnServer };
	}

	// --- Offline queue ---

	/** Queue a change for retry and go offline. */
	private async enqueueChange(entry: QueueEntry): Promise<void> {
		await this.queue.enqueue(entry);
		// Enqueuing a retry does NOT by itself mean we're disconnected — a single
		// file's server-side error (e.g. a storage 502) leaves the backend
		// perfectly reachable. The offline transition is decided separately via
		// maybeGoOffline(), only on true connection loss.
		this.emitStatus();
	}

	/** Flip to offline ONLY when the failure indicates true connection loss
	 *  (no HTTP response). A per-file HTTP status error is that file's problem,
	 *  surfaced in the Sync Center — it must not report the whole plugin as
	 *  disconnected. */
	private maybeGoOffline(cause: unknown): void {
		if (shouldGoOffline(cause)) this.goOffline();
	}

	/** Transition to offline mode and start health checking. */
	private goOffline(): void {
		if (this.offline) return;
		this.offline = true;
		this.lastError = "";
		devLog().log("lifecycle", `went offline — queue=${this.queue.size}`);
		rlog().warn("lifecycle", `Went offline — queue=${this.queue.size}`);
		this.emitStatus();
		this.startHealthCheck();
	}

	/** Transition back to online mode. */
	private goOnline(): void {
		if (!this.offline) return;
		this.offline = false;
		this.lastError = "";
		this.stopHealthCheck();
		devLog().log("lifecycle", `went online — flushing queue (${this.queue.size} entries)`);
		rlog().info("lifecycle", `Went online — flushing queue (${this.queue.size} entries)`);
		this.emitStatus();
		// Flush the queue now that we're online
		this.flushQueue().catch((e) => {
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: queue flush failed", e);
		});
	}

	/** Start health checks while offline, with exponential backoff (5s → 10s →
	 *  … capped at 60s) so a long outage doesn't hammer the server every 30s.
	 *  The backoff resets when we reconnect (stopHealthCheck). */
	private startHealthCheck(): void {
		if (this.healthCheckTimer) return;
		const tick = () => {
			this.healthCheckTimer = window.setTimeout(() => {
				void (async () => {
					try {
						if (await this.api.health()) {
							this.goOnline();
							return;
						}
					} catch {
						// Still offline
					}
					this.healthCheckFailures++;
					tick();
				})();
			}, healthCheckDelay(this.healthCheckFailures));
		};
		tick();
	}

	/** Stop health checks and reset the backoff. */
	private stopHealthCheck(): void {
		if (this.healthCheckTimer) {
			window.clearTimeout(this.healthCheckTimer);
			this.healthCheckTimer = null;
		}
		this.healthCheckFailures = 0;
	}

	/** Flush queued changes oldest-first. Stops on first failure. */
	/** Retry every transient (auto-retryable) failure now — including ones
	 *  already parked past RETRY_CAP — by re-enqueuing a content-free entry and
	 *  flushing. Actionable failures (too_large, needs_pro, auth, conflict) are
	 *  left alone; retrying can't fix them. Wired to "Retry all now". */
	async retryFailedNow(): Promise<number> {
		for (const issue of this.issues.all()) {
			if (issueDisposition(issue.category) !== "transient") continue;
			const file = this.app.vault.getFileByPath(normalizePath(issue.path));
			if (!file) {
				// File no longer exists locally — the failure is moot.
				this.issues.clear(issue.path);
				continue;
			}
			await this.queue.enqueue({
				path: issue.path,
				action: "upsert",
				kind: issue.kind,
				mtime: file.stat.mtime / 1000,
				timestamp: Date.now(),
				vaultId: this.settings.vaultId ?? undefined,
			});
		}
		return this.flushQueue();
	}

	async flushQueue(): Promise<number> {
		const entries = this.queue.all();
		if (entries.length === 0) return 0;
		devLog().log("queue", `flush start — ${entries.length} entries`);
		rlog().info("queue", `Queue flush start — ${entries.length} entries`);

		let flushed = 0;
		for (const entry of entries) {
			try {
				await this.paceRequest();
				if (entry.action === "delete") {
					try {
						if (entry.kind === "attachment") {
							await this.api.deleteAttachment(entry.path);
						} else {
							await this.api.deleteNote(entry.path);
						}
					} catch (e) {
						// 404 means already deleted — dequeue and continue
						if (!isHttpStatus(e, 404)) throw e;
					}
				} else if (entry.kind === "attachment") {
					// Legacy entries may have content inline; new entries are content-free
					let base64 = entry.contentBase64;
					let mimeType = entry.mimeType;
					let mtime = entry.mtime;
					if (!base64) {
						const file = this.app.vault.getFileByPath(entry.path);
						if (!file) {
							await this.queue.dequeue(
								entry.path,
								this.settings.vaultId ?? undefined,
							);
							this.issues.clear(entry.path);
							flushed++;
							continue;
						}
						const buffer = await this.app.vault.readBinary(file);
						base64 = arrayBufferToBase64(buffer);
						mimeType = this.getMimeType(file);
						mtime = file.stat.mtime / 1000;
					}
					await this.api.pushAttachment(entry.path, base64, mimeType!, mtime!);
				} else {
					// Note upsert — legacy entries have content; new entries are content-free
					let content = entry.content;
					let mtime = entry.mtime;
					if (content === undefined) {
						const file = this.app.vault.getFileByPath(entry.path);
						if (!file) {
							await this.queue.dequeue(
								entry.path,
								this.settings.vaultId ?? undefined,
							);
							this.issues.clear(entry.path);
							flushed++;
							continue;
						}
						content = await this.app.vault.cachedRead(file);
						mtime = file.stat.mtime / 1000;
					}
					const resp = await this.api.pushNote(entry.path, content, mtime!);
					// Record fresh sync state — without this the replayed push
					// leaves a stale version (next push 409s avoidably) and no
					// serverHash (hash-skip dedupe misses the echo).
					if (!("conflict" in resp) && content !== undefined) {
						const np = normalizePath(entry.path);
						this.syncState.set(np, {
							hash: fnv1a(content),
							version: resp.note.version,
							serverHash: resp.note.content_hash,
						});
						if (resp.note.version != null) {
							this.baseStore?.set(np, content, resp.note.version);
						}
					}
				}
				await this.queue.dequeue(entry.path, this.settings.vaultId ?? undefined);
				this.issues.clear(entry.path);
				flushed++;
			} catch (e) {
				// Stop this flush pass on the first failure. Only flip offline if
				// it's a real connection loss — a server error on one entry must
				// not report the whole plugin as disconnected.
				this.maybeGoOffline(e);
				break;
			}
		}

		devLog().log(
			"queue",
			`flush done — ${flushed}/${entries.length} flushed, ${this.queue.size} remaining`,
		);
		rlog().info(
			"queue",
			`Queue flush done — ${flushed}/${entries.length} flushed, ${this.queue.size} remaining`,
		);
		this.emitStatus();
		return flushed;
	}

	/** Fast byte-level comparison of two ArrayBuffers. */
	private arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
		if (a.byteLength !== b.byteLength) return false;
		const va = new Uint8Array(a);
		const vb = new Uint8Array(b);
		for (let i = 0; i < va.length; i++) {
			if (va[i] !== vb[i]) return false;
		}
		return true;
	}

	/** Cancel all pending debounce, cooldown, and health check timers. */
	destroy(): void {
		for (const timer of this.debounceTimers.values()) {
			window.clearTimeout(timer);
		}
		this.debounceTimers.clear();
		for (const timer of this.recentlyPushed.values()) {
			window.clearTimeout(timer);
		}
		this.recentlyPushed.clear();
		this.pendingPostPullPushes.clear();
		this.stopHealthCheck();
		this.queue.destroy();
	}
}
