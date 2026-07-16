/**
 * Sync engine — handles push/pull logic, debouncing, and ignore patterns.
 */
import { type App, Notice, type TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { type EngramApi, arrayBufferToBase64, base64ToArrayBuffer } from "./api";
import type { BaseStore } from "./base-store";
import { fromB64, toB64 } from "./crdt/channel";
import type { CrdtManager } from "./crdt/manager";
import type { NoteIdMap } from "./crdt/note-id-map";
import { uuid7 } from "./crdt/uuid7";
import { MAX_CURSOR_UUID, encodeCursor } from "./cursor";
import { devLog } from "./dev-log";
import { errMsg } from "./error-util";
import type { ExplicitFolders } from "./explicit-folders";
import { IgnoredFiles } from "./ignored-files";
import {
	IssueStore,
	categorizeError,
	healthCheckDelay,
	issueDisposition,
	parseStatusToIssue,
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
	ManifestResponse,
	NoteChange,
	NoteStreamEvent,
	ParseReason,
	QueueEntry,
	ReconcileResult,
	SyncChange,
	SyncChangesResponse,
	SyncIssueCategory,
	SyncLogEntry,
	SyncPlan,
	SyncProgress,
	SyncStatus,
} from "./types";

/**
 * Pure routing helper: for a markdown note, apply the disk content into the
 * CRDT doc (no full-document POST); for binary files, return false so the
 * caller falls through to the existing attachment push path.
 */
/** Notes larger than this are NOT routed through CRDT — see routeModify. The
 *  channel base64-encodes each update (~+33%), so the cap stays well under
 *  Bandit's 8 MB WebSocket fragmented-message limit even after encoding. Large
 *  notes still sync via the legacy push path (server-gated at 10 MB / 413). */
export const MAX_CRDT_NOTE_BYTES = 4 * 1024 * 1024;

/** True when `content` is too large to enter the Yjs doc: seeding it would
 *  produce a base64 `crdt_msg` past Bandit's 8 MB WebSocket frame limit → 1009,
 *  killing the socket (and re-crashing on every reconnect). Every CRDT seed
 *  path MUST gate on this — a caller that forgets recreates that crash loop.
 *  Measures UTF-8 bytes (not code units) so multi-byte content can't slip past.
 *  `maxBytes <= 0` disables the cap. */
export function exceedsCrdtNoteLimit(content: string, maxBytes: number): boolean {
	return maxBytes > 0 && new TextEncoder().encode(content).length > maxBytes;
}

export async function routeModify(
	file: { isMarkdown: boolean; noteId: string; readContent: () => Promise<string> },
	crdt: {
		applyLocalEdit: (
			noteId: string,
			content: string,
			hasLca?: boolean,
			reread?: () => Promise<string>,
		) => Promise<string | null>;
	},
	maxBytes: number,
): Promise<string | null> {
	if (!file.isMarkdown) return null;
	const content = await file.readContent();
	// Oversized notes must NOT enter the Yjs doc. The channel transmits each
	// update as a base64 crdt_msg (~+33%), so a multi-MB note becomes a
	// WebSocket frame past Bandit's 8 MB fragmented-message limit, which closes
	// the socket (1009) and — because the bloated doc persists in IndexedDB —
	// re-crashes on every reconnect, killing all sync for the vault. Fall through
	// to the legacy push path, which the server gates with a 413.
	if (exceedsCrdtNoteLimit(content, maxBytes)) {
		return null;
	}
	// readContent doubles as the stale-snapshot reread: when a remote update
	// merges between this read and the diff, the manager re-reads instead of
	// diffing a snapshot that would delete the remote ops (e2e test_83). The
	// wrapper re-enforces the size cap on every reread — the file can grow
	// past MAX_CRDT_NOTE_BYTES between the check above and the manager's
	// re-read (review sync.ts:2099); the throw makes the manager report
	// NOT-consumed so the legacy path (413-gated server-side) owns the edit.
	const cappedReread = async (): Promise<string> => {
		const fresh = await file.readContent();
		if (exceedsCrdtNoteLimit(fresh, maxBytes)) {
			throw new Error("reread exceeds MAX_CRDT_NOTE_BYTES");
		}
		return fresh;
	};
	// Returns the exact content the manager consumed (which the caller stamps
	// as its echo baseline), or null when declined/not consumed — the legacy
	// push path then owns the write convergently (backend PR #846).
	return await crdt.applyLocalEdit(file.noteId, content, undefined, cappedReread);
}

/** At startup, the on-disk file may have changed while the app was closed
 *  (external editor, another sync app, OS). For a synced note this is NOT a
 *  3-way merge: diff the disk content into the Y.Doc as a local edit. The CRDT
 *  converges it with any remote history once the handshake runs. The conflict
 *  modal is only a last resort if the doc itself cannot be opened/decoded.
 *
 *  The try/catch is split into two distinct error categories:
 *  - `getText` (decode) failure → `onCorruption` — the Y.Doc state is unreadable
 *    and the user must intervene via the conflict modal.
 *  - `applyLocalEdit` (write) failure → swallowed — a transient storage write error
 *    must not masquerade as CRDT corruption and trigger the conflict modal. The CRDT
 *    handshake will converge the state once connectivity is restored. */
export async function reconcileColdStart(
	// `path` is retained purely for log messages (a note_id is meaningless to a
	// human reading the console); every CRDT call below routes on `noteId`.
	// `reread` is the live disk read forwarded to the manager's stale-snapshot
	// guard: startup is the LONGEST entry-await window in the codebase
	// (IndexedDB whenSynced replay), and a frozen diskContent diffed after a
	// concurrent remote merge would delete the remote ops (review sync.ts:153,
	// same class as the pushFile/test_83 fix).
	file: { path: string; noteId: string; diskContent: string; reread?: () => Promise<string> },
	crdt: {
		// Returns the consumed content (or null when declined) but the value is
		// intentionally ignored here — a DECLINED write (handshake gate) is
		// treated identically to a successful write: the legacy fullSync /
		// pushModifiedFiles path owns those files until their STEP2 handshake
		// completes.
		applyLocalEdit: (
			noteId: string,
			content: string,
			hasLca?: boolean,
			reread?: () => Promise<string>,
		) => Promise<string | null | boolean | undefined>;
		getText: (noteId: string) => Promise<string>;
		projectedText: (noteId: string) => Promise<string>;
		enroll?: (noteId: string) => void;
	},
	onCorruption: () => void,
	maxBytes: number = MAX_CRDT_NOTE_BYTES,
): Promise<void> {
	// Same cap as routeModify: an oversized note must NEVER enter the Yjs doc.
	// Seeding it here produces a base64 crdt_msg past Bandit's 8 MB frame limit
	// → 1009 → and because cold-start reconcile re-runs on every reconnect, a
	// permanent crash loop that kills all sync for the vault. Leave it to the
	// legacy push path (server-gated at 10 MB / 413). Default-capped so a future
	// caller cannot reintroduce this by forgetting to pass the limit.
	if (exceedsCrdtNoteLimit(file.diskContent, maxBytes)) {
		return;
	}
	let current: string;
	try {
		current = await crdt.projectedText(file.noteId);
	} catch {
		onCorruption(); // surface the existing ConflictModal only on decode failure
		return;
	}
	if (current === file.diskContent) return; // already in sync
	try {
		// Positional-args pattern: only pass the trailing reread when the caller
		// supplied one — an explicit trailing `undefined` changes
		// Function.arguments.length, which existing tests pin exactly.
		if (file.reread) {
			await crdt.applyLocalEdit(file.noteId, file.diskContent, undefined, file.reread);
		} else {
			await crdt.applyLocalEdit(file.noteId, file.diskContent);
		}
	} catch (e) {
		// Storage write failure: do not masquerade as corruption. The CRDT
		// handshake will converge the state once connectivity is restored.
		rlog().warn("crdt", `reconcileColdStart: write failed for ${file.path}: ${errMsg(e)}`);
	}
	// A drifted note must always get a handshake: when the doc is history-less
	// and the adopt-first seed gate skipped inside applyLocalEdit (IDB-evicted
	// doc whose disk content matches the last-synced hash), the note converges
	// ONLY via STEP1/STEP2 — without enrolling here it would silently sit out
	// live sync until the user opens it. Enrollment is idempotent (once per
	// session), so seeding paths pay nothing extra.
	crdt.enroll?.(file.noteId);
}

/** Check if an error is an HTTP response with the given status code.
 *  Obsidian's requestUrl() throws objects with a `status` property on non-2xx. */
function isHttpStatus(e: unknown, status: number): boolean {
	return typeof e === "object" && e !== null && (e as { status?: number }).status === status;
}

/** Thrown when the backend returns 410 HISTORY_EXPIRED — the cursor is below
 *  the retention floor (post-compaction). The caller drops the cursor and
 *  re-bootstraps. Dormant until backend PR D turns on compaction. */
export class HistoryExpiredError extends Error {
	constructor() {
		super("history_expired");
		this.name = "HistoryExpiredError";
	}
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

/** How long (ms) after wipeRemote deletes a path to suppress the server's
 *  fanout echo of that delete. Much longer than ECHO_COOLDOWN_MS: a large
 *  vault's wipe + re-upload runs for minutes and echoes queue behind it, and
 *  against pre-#970 backends (no device_id on broadcasts) this TTL is the
 *  ONLY thing standing between a late echo and trashFile. Cheap to hold long:
 *  deletes attributed to a FOREIGN device bypass the suppression entirely, so
 *  on #970 backends a long TTL cannot swallow another device's real delete. */
const WIPE_ECHO_COOLDOWN_MS = 10 * 60_000;

/** Debounce window for the ok->degraded transition Notice: aggregates a
 *  burst of newly-degraded notes (e.g. a batch push) into one Notice. */
const DEGRADED_NOTICE_DEBOUNCE_MS = 1500;
const DEGRADED_NOTICE_DURATION_MS = 10_000;

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
	/** Paths that newly degraded (ok/none -> frontmatter issue) since the last
	 *  flush, awaiting the debounced Notice below. */
	private pendingDegraded: Set<string> = new Set();
	private degradedNoticeTimer: number | null = null;
	private ignorePatterns: string[] = [];
	private pushing: Set<string> = new Set();
	private recentlyPushed: Map<string, number> = new Map();
	/** Paths whose remote copy THIS device just deleted via wipeRemote (the
	 *  replace-remote sync). The server fans our own deletes back with no
	 *  origin attribution; applying them trashed the entire local vault
	 *  mid-replace (2026-07-08 incident). Deletes are otherwise exempt from
	 *  echo suppression, so this set is the only thing standing between a
	 *  remote wipe and the local files it is about to re-upload. */
	private wipedRemote: Map<string, number> = new Map();
	/** Paths whose local trash APPLIED a remote change (WS delete, pull
	 *  tombstone, relocation/orphan cleanup). The vault 'delete' event that
	 *  trash fires must not push a DELETE back to the server: the server
	 *  already knows, and the path-keyed CAS-less delete would kill a note
	 *  recreated at the same path in between (wipe→re-push, delete→recreate).
	 *  Found by test_86's settle assert: B's echo-push landed after A's
	 *  replace-remote re-upload and tombstoned the fresh note. */
	private remotelyDeleted: Map<string, number> = new Map();
	/** Paths just written to disk by flushFromCrdt (remote CRDT update → disk).
	 *  Distinct from recentlyPushed (WS echo suppression after a push): only the
	 *  CRDT disk-write echo must be swallowed by handleModify. Folding this into
	 *  recentlyPushed would make handleModify drop REAL user edits within the
	 *  post-push cooldown — silently losing edits and breaking conflict detection. */
	private recentlyFlushed: Map<string, number> = new Map();
	private pulling = false;
	/** A pull() requested while one was already in flight. Set by the re-entry
	 *  guard, drained in pull()'s finally to run exactly one follow-up pull.
	 *  Without this, a reconnect catch-up that lands mid-pull is lost (#646). */
	private pullPending = false;
	private lastSync = "";
	/** Opaque cursor marking the plugin's durably-applied position in the
	 *  backend's ordered sync feed. SEPARATE from `lastSync` (which is kept
	 *  untouched for rollback). `null` = no cursor yet (genesis pull). Persisted
	 *  under the `syncCursor` key via the saveData callback; written/read by the
	 *  cursor-pull flow in later B2 tasks. */
	private syncCursor: string | null = null;
	private lastError = "";
	private offline = false;
	private healthCheckTimer: number | null = null;
	/** Consecutive failed health probes — drives exponential backoff. */
	private healthCheckFailures = 0;
	/** In-flight queue flush, for single-flight coalescing (see flushQueue). */
	private flushInFlight: Promise<number> | null = null;
	private ready = false;
	/** When true, all sync actions (file events, stream events, bulk methods)
	 *  short-circuit to a no-op. Controlled by the plugin layer based on
	 *  whether the user has accepted a sync direction in SyncPreviewModal for
	 *  the current auth+vault fingerprint. */
	private syncBlocked = false;
	private activePushCount = 0;
	private maxConcurrentPushes = 5;
	private pushWaiters: (() => void)[] = [];
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

	/** This user's server content_hash for EMPTY content, learned from the
	 *  first fetch that proves a hash maps to "" (the hash is a per-user HMAC —
	 *  underivable client-side but deterministic). Lets the ingress guard trust
	 *  inline-empty bodies carrying this exact hash instead of re-fetching
	 *  every genuinely empty note. Session-scoped; a stale value after a DEK
	 *  rotation or account swap stops matching and falls back to the GET. */
	private emptyContentHash: string | null = null;

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

	/** Optional CRDT manager — when set, markdown saves route through it instead
	 *  of the full-document pushNote POST. dbPrefix must equal the active vaultId
	 *  for IndexedDB namespacing; the CRDT doc itself is keyed by the note's bare
	 *  note_id, matching the backend's note_id lookup. */
	private crdt: CrdtManager | null = null;

	setCrdtManager(mgr: CrdtManager | null): void {
		this.crdt = mgr;
	}

	/** This install's opaque device id (main.ts mints + persists it; the API
	 *  client sends it as X-Device-Id on every REST call). The server stamps
	 *  it into `note_changed` delete broadcasts (#970) so we can drop our own
	 *  fanout echoes — the generic class fix behind the wipeRemote path
	 *  marking below. Null in tests/older callers: the drop is then skipped. */
	private deviceId: string | null = null;

	setDeviceId(id: string | null): void {
		this.deviceId = id;
	}

	/** Detaches every live editor binding (CrdtLiveViews.detachAll, wired by
	 *  main.ts). wipeRemote destroys Y.Docs whose files stay on disk and may
	 *  be OPEN — unlike the WS-delete path, no trashFile closes the view, so
	 *  a still-attached binding would write keystrokes into a destroyed doc
	 *  (the never-span-a-load class, crdt-editor-bind-race-pollution.md).
	 *  Bindings re-establish via the normal refresh events; meanwhile edits
	 *  flow through handleModify as plain pushes. */
	private crdtEditorDetach: (() => void) | null = null;

	setCrdtEditorDetach(fn: (() => void) | null): void {
		this.crdtEditorDetach = fn;
	}

	/** Rebinds the live editor showing `path` off its current (now orphaned)
	 *  Y.Doc onto the note's freshly-resolved id (CrdtLiveViews.rebindPath,
	 *  wired by main.ts). Used after a genesis ADOPT remaps path -> serverId
	 *  under a live editor: the path is unchanged so refresh()'s bindTo
	 *  short-circuits. Null in tests/headless — the adopt transfer branch is
	 *  then skipped (no live editor to preserve) and the disk-seed path runs. */
	private crdtEditorRebind: ((path: string) => void) | null = null;

	setCrdtEditorRebind(fn: ((path: string) => void) | null): void {
		this.crdtEditorRebind = fn;
	}

	/** Path -> note_id sidecar (Task 4, `src/crdt/note-id-map.ts`). Owned by
	 *  main.ts (persisted in data.json); wired here so pushFile can mint/send
	 *  client_id for new notes, the pull path can learn ids, and handleRename
	 *  can keep the mapping stable across a move (Task 5). Null in tests/older
	 *  callers that never wire it — id-minting and pull-learning are then
	 *  simply skipped (pre-existing legacy path-keyed behavior). */
	private noteIdMap: NoteIdMap | null = null;

	setNoteIdMap(map: NoteIdMap | null): void {
		this.noteIdMap = map;
	}

	/** Populate `noteIdMap` authoritatively from the server manifest's
	 *  `{ id, path }` for every note, WITHOUT a full content pull (manifest is
	 *  id+path+hash only, ~µs/row server-side).
	 *
	 *  This is the fix for inbound CRDT updates stranding with "no known path"
	 *  after the id-keying cutover: live pull of an existing note is CRDT-only
	 *  and `onFlushToDisk` resolves the disk path via `noteIdMap.pathForId`. The
	 *  map was only ever rebuilt during a no-cursor `bootstrap()`, so a device
	 *  whose sync cursor is already set (every normal reconnect) never repaired
	 *  a stale map — `pathForId` returned null and every inbound frame was
	 *  dropped until a manual full sync. Reconciling from the manifest on connect
	 *  keeps the map authoritative so live pull just works.
	 *
	 *  Idempotent; `NoteIdMap.set` overwrites a stale/locally-minted id for a
	 *  path (the manifest is the source of truth). Returns mappings applied. */
	/** Server-authoritative path -> owning note_id snapshot, refreshed by
	 *  reconcileNoteIdMapFromManifest or (re)fetched on demand by
	 *  manifestOwnerOf. Used to verify the local map before DESTRUCTIVE ops
	 *  (moveIfIdRelocated's trash) — the local map itself can be cross-wired,
	 *  so it cannot vouch for itself. */
	private manifestPathOwners: Map<string, string> | null = null;

	/** Epoch ms of the last manifest fetch ATTEMPT (success or failure). A
	 *  destructive verdict is only trusted from a snapshot younger than the
	 *  TTL: a stale snapshot returns a false "absent" for any note created
	 *  after it was taken, which would green-light trashing that note. The
	 *  attempt stamp also negative-caches failures so a manifest-less backend
	 *  doesn't get a fetch per relocation event. */
	private manifestOwnersFetchedAt = 0;
	private static readonly MANIFEST_OWNERS_TTL_MS = 30_000;

	/** Paths whose id-keyed-move trash was REFUSED (ownership unknowable or
	 *  cross-wired). If such a path is genuinely a renamed-away old copy, the
	 *  refusal leaves a duplicate file no id references — nothing else would
	 *  ever clean it. Swept by the next reconcile against a fresh manifest:
	 *  absent from the manifest + unclaimed by the local map -> trash then. */
	private pendingOrphanSweep = new Set<string>();

	/** Who does the server say owns `path` (normalized)? Returns the owning id,
	 *  null when a FRESH manifest confirms the path is absent, or undefined
	 *  when ownership is unknowable (no manifest endpoint / fetch failed) —
	 *  callers must treat undefined as "not safe to destroy". Refreshes the
	 *  snapshot when older than the TTL; trash decisions are rare (renames),
	 *  so the refresh cost lands only on that cold path. */
	private async manifestOwnerOf(path: string): Promise<string | null | undefined> {
		const age = Date.now() - this.manifestOwnersFetchedAt;
		const fresh = this.manifestOwnersFetchedAt > 0 && age <= SyncEngine.MANIFEST_OWNERS_TTL_MS;
		if (!fresh) {
			this.manifestOwnersFetchedAt = Date.now();
			// A failed/absent refresh leaves NO trustworthy snapshot: keeping a
			// stale one would let its false "absent" answers authorize a wrong
			// trash. Refusing (undefined) is always recoverable; a trash is not.
			this.manifestPathOwners = null;
			try {
				const manifest = await this.api.getManifest();
				if (manifest) this.cacheManifestOwners(manifest);
			} catch {
				// negative-cached by the attempt stamp above
			}
		}
		if (!this.manifestPathOwners) return undefined;
		return this.manifestPathOwners.get(path) ?? null;
	}

	private cacheManifestOwners(manifest: ManifestResponse): void {
		this.manifestPathOwners = new Map(
			manifest.notes.filter((n) => n.id).map((n) => [normalizePath(n.path), n.id as string]),
		);
		this.manifestOwnersFetchedAt = Date.now();
	}

	/** Trash files whose refused id-keyed-move turned out to be a genuine
	 *  rename after all: the path is absent from the (fresh) manifest and no
	 *  local id claims it — a duplicate old copy nothing else will clean. */
	private async sweepPendingOrphans(): Promise<void> {
		for (const p of [...this.pendingOrphanSweep]) {
			this.pendingOrphanSweep.delete(p);
			if (this.manifestPathOwners?.has(p)) continue; // live server-side note
			if (this.noteIdMap?.get(p)) continue; // locally claimed again
			const file = this.app.vault.getFileByPath(p);
			if (!file) continue;
			this.syncState.delete(p);
			this.baseStore?.delete(p);
			await this.trashRemotelyDeleted(file);
			rlog().info("pull", `Orphan sweep: trashed renamed-away duplicate ${p}`);
		}
	}

	async reconcileNoteIdMapFromManifest(): Promise<number> {
		if (!this.noteIdMap) return 0;
		const manifest = await this.api.getManifest();
		if (!manifest) return 0; // pre-B1 backend: no manifest endpoint, nothing to reconcile
		this.cacheManifestOwners(manifest); // keep the destructive-op guard's snapshot fresh
		let applied = 0;
		// Every path the server currently holds a note at. Lets us tell a
		// CROSS-WIRE from an IN-FLIGHT RENAME below.
		const manifestPaths = new Set(manifest.notes.map((n) => n.path));
		for (const note of manifest.notes) {
			if (!note.id) continue; // pre-T3.6 backend omitted id — cannot map it
			const localPath = this.noteIdMap.pathForId(note.id);
			if (localPath === note.path) continue; // already correct — nothing to do
			if (localPath !== null && !manifestPaths.has(localPath)) {
				// The id maps to a path the server does NOT list. That's an
				// in-flight rename (or a local-only note) whose new path this
				// manifest snapshot hasn't caught up to — the local mapping is
				// newer. Re-setting the stale manifest path would clobber the
				// reverse index and resurrect the old path (test_10 regression).
				continue;
			}
			// Otherwise the manifest wins. Either the id is unknown locally
			// (drifted/empty map, or a wrong id minted by getOrMint), OR it is
			// cross-wired onto another note's real path (localPath is itself a
			// manifest path, owned by a different id). Both are data-loss vectors:
			// a stale/cross-wired pathForId sends inbound CRDT content to the wrong
			// file. Rebind to the authoritative path (set() evicts the stale
			// forward + reverse entries so the map stays a clean bijection).
			this.noteIdMap.set(note.path, note.id);
			applied++;
		}
		if (applied > 0) {
			await this.saveData({ noteIds: this.noteIdMap.toJSON() });
		}
		// The manifest in hand is as fresh as it gets — resolve any trashes the
		// destructive-op guard deferred while ownership was unknowable.
		await this.sweepPendingOrphans();
		return applied;
	}

	/** Coalesced LIVE id-map reconcile. Called when a crdt_doc_ready announce
	 *  names a note_id the map cannot resolve — the create-race signature:
	 *  another writer (MCP/web) owns the note under an id this device never
	 *  learned, so every announce/frame for it is undeliverable. Today's only
	 *  other heal is the cold-start reconcile, which leaves the note deaf for
	 *  the whole session. Runs the full manifest reconcile (already the
	 *  authoritative {id,path} source; per-id fetch not worth a new endpoint),
	 *  single-flight with one trailing rerun so an announce burst costs at most
	 *  two manifest fetches. */
	ensureNoteIdMapped(noteId: string): void {
		if (!this.noteIdMap || !noteId) return;
		// Intrinsic gate check (not caller-dependent): the reconcile this
		// triggers ends with sweepPendingOrphans, which can trashFile — never
		// run that while the sync gate is closed. Callers may also gate for
		// their own reasons, but safety must not depend on them remembering.
		if (this.syncBlocked) return;
		if (this.noteIdMap.pathForId(noteId) !== null) return; // already mapped
		if (this.idMapReconcileInflight) {
			this.idMapReconcileQueued = true;
			return;
		}
		this.idMapReconcileInflight = (async () => {
			try {
				do {
					this.idMapReconcileQueued = false;
					await this.reconcileNoteIdMapFromManifest();
				} while (this.idMapReconcileQueued);
			} catch (e) {
				rlog().warn(
					"sync",
					`live id-map reconcile failed: ${e instanceof Error ? e.message : String(e)}`,
				);
			} finally {
				this.idMapReconcileInflight = null;
			}
		})();
	}

	private idMapReconcileInflight: Promise<void> | null = null;
	private idMapReconcileQueued = false;

	/** note_ids the SERVER is known to already have a note row for — learned
	 *  either from a `/sync/changes` pull (applySyncChange) or confirmed by a
	 *  successful REST push response. The backend's CRDT channel now requires
	 *  the note to pre-exist (note_in_vault?) and silently drops a crdt_msg for
	 *  an unknown note_id — it can no longer bootstrap a note row from a bare
	 *  wire doc_id (no path on the frame). So a note's FIRST push must go via
	 *  REST (which creates the row and adopts the client-minted id); only once
	 *  confirmed here may subsequent edits route through CRDT. Keyed by note_id
	 *  (not path) so a delete+recreate at the same path — which mints a fresh
	 *  id — starts unconfirmed again rather than inheriting the old note's
	 *  confirmed status. Pruned when the note's server row is deleted
	 *  (handleRename tombstones the old path): the invariant is "the server has
	 *  a LIVE row for this id", and a tombstoned id no longer does — so the
	 *  next push (the rename's new-path push, same id) must go REST-first to
	 *  move/resurrect the row, not CRDT (which the channel drops for a note the
	 *  server sees as absent). Routing it CRDT would silently strand the rename. */
	private confirmedNoteIds: Set<string> = new Set();

	/** Per-note re-handshake attempt tracking for the live-bound catch-up path,
	 *  keyed by note_id. `hash` is the server content_hash being retried; a new
	 *  hash starts a fresh episode. Purely diagnostic now (the logged attempt
	 *  number): convergence comes from the deterministic REST delta pull, and a
	 *  failed pull retries at the 5-min poll cadence — no give-up, no storm. */
	private crdtRehandshakeAttempts: Map<string, { hash: string; attempts: number }> = new Map();

	private isNoteConfirmed(noteId: string | null): boolean {
		return noteId !== null && this.confirmedNoteIds.has(noteId);
	}

	// Single source of truth for "this note converges via CRDT ops, not the
	// whole-doc push". Previously duplicated inline in pushFile and
	// pushNotesViaBatch; both now call this.
	//
	private isCrdtManaged(path: string, noteId: string | null): boolean {
		// isCrdtManaged = isCrdtManagedOffline + the live-channel term, so the
		// shared clauses live in one place and can't drift between the two.
		return this.isCrdtManagedOffline(path, noteId) && (this.crdtLive?.() ?? true);
	}

	// Same predicate as isCrdtManaged, minus the live-channel term: true when a
	// note WOULD converge via CRDT ops if the crdt: channel were joined right
	// now (Task 5, single authority). CRDT is UNCONDITIONAL for a confirmed
	// note — a cold edit (note edited while its dedicated room is closed) MUST
	// stay on CRDT so it merges with concurrent remote edits; routing it to
	// legacy whole-doc REST would be last-write-wins → lost merges (#230).
	// Enrollment (STEP1) is only the down-sync pull, never required to SEND: an
	// idle note ships its edit channel-up or as a crdt-tagged durable /updates
	// entry (runFlushQueue's noteId-keyed branch). pushFile/pushNotesViaBatch
	// use this to keep a channel-down note off the legacy base_hash push; the
	// crdt-live check is applied separately by the caller to pick channel-op vs
	// durable-REST transport.
	private isCrdtManagedOffline(_path: string, noteId: string | null): boolean {
		return !!this.crdt && !!noteId && this.isNoteConfirmed(noteId);
	}

	private confirmNoteId(noteId: string | null | undefined): void {
		if (noteId) this.confirmedNoteIds.add(noteId);
	}

	/** A6 (issue #201): a fresh note's pre-push STEP1 is dropped server-side
	 *  (no row yet → note_not_found) and the once-per-session enrollment guard
	 *  never re-fires it, leaving the note deaf to live sync until a later
	 *  catch-up (~30s observed live). Called with the id the create-push
	 *  response confirmed, BEFORE confirmNoteId: if the id was not yet
	 *  confirmed this is the create — re-fire the handshake now that the row
	 *  exists. Md + size gated exactly like the pre-push enroll (an oversized
	 *  doc must never enroll — 8 MB WS frame limit). */
	private refireEnrollmentOnFirstConfirm(
		noteId: string | null | undefined,
		path: string,
		content: string,
	): void {
		if (!noteId || !this.crdtEnrollment) return;
		if (this.isNoteConfirmed(noteId)) return; // not a create — already live
		if (!path.endsWith(".md")) return;
		if (new TextEncoder().encode(content).length > MAX_CRDT_NOTE_BYTES) return;
		// Vault-channel fan-out: a cold (not-open-in-editor) send stays room-free —
		// its edits ship over /updates and it RECEIVES future updates over the
		// note_yjs_update broadcast, no room needed. Enroll (STEP1) only for a
		// live-bound note, matching the pull/stream gates. The note's server row is
		// already created by the REST push above, so an idle note is not stranded.
		if (!this.isLiveBound(normalizePath(path))) return;
		this.crdtEnrollment.reset(noteId);
		this.crdtEnrollment.enroll(noteId);
	}

	/** Drop a note_id's confirmed status when its server row is deleted, so a
	 *  subsequent push of the same id (a rename's new-path push) takes the
	 *  REST-first path that recreates/moves the row rather than routing to a
	 *  CRDT room the server no longer has. */
	private unconfirmNoteId(noteId: string | null | undefined): void {
		if (noteId) this.confirmedNoteIds.delete(noteId);
	}

	/** Forget all confirmed-note-id status. Called on a WebSocket (re)connect:
	 *  a reconnect is a point where server-known state may have diverged from
	 *  this in-memory cache (another device deleted/renamed a note, or the
	 *  backing store was reset out from under us — the e2e harness resets the
	 *  DB between reruns while the plugin instance lives on). A STALE confirmed
	 *  entry is the dangerous direction: it routes a note's first write to CRDT,
	 *  which the server silently DROPS for a note it has no row for (no path on
	 *  the wire to bootstrap from), losing the write. Clearing biases every
	 *  note's next write back to the durable REST path, which re-creates the row
	 *  and re-confirms the id; the catch-up pull re-confirms whatever actually
	 *  changed. Cost is at most one extra REST push per note after a reconnect. */
	clearConfirmedNoteIds(): void {
		this.confirmedNoteIds.clear();
	}

	/** Optional CRDT enrollment tracker. When set, a pull that surfaces a
	 *  CRDT-managed markdown note we don't have locally enrolls it (sends a
	 *  sync-step-1) so the body is pulled over the y-protocols handshake — the
	 *  level-triggered discovery path that backstops the edge-triggered
	 *  crdt_doc_ready announce.
	 *
	 *  Both `enroll` and `reset` are exposed: `enroll` kicks off the STEP1
	 *  handshake; `reset` (Task 5) clears the once-per-session enroll guard so a
	 *  note recreated at the same path re-runs the full handshake rather than
	 *  silently reusing the stale enrolled state from before the delete/rename. */
	private crdtEnrollment: { enroll(path: string): void; reset(path: string): void } | null = null;

	setCrdtEnrollment(
		enrollment: { enroll(path: string): void; reset(path: string): void } | null,
	): void {
		this.crdtEnrollment = enrollment;
	}

	/** Socket-native new-note genesis (Plan B1, Task 3). When wired, a brand-new
	 *  markdown note's FIRST push creates its server row over the CRDT channel
	 *  (`crdt_create`) instead of a REST `pushNote`. Resolves to the server's
	 *  AUTHORITATIVE doc_id: on ADOPT (the path is already owned by a live note
	 *  under a different id) the returned id differs from the one sent, and
	 *  pushFile remaps the local note to it so subsequent `crdt_msg` edits address
	 *  the row that exists — keeping the local mint would orphan the note (content
	 *  loss). Rejects on delete-wins / rate-limit / bad-path; the caller logs and
	 *  falls through to the REST create (still functional in this additive phase,
	 *  removed in Plan B2). Unset → genesis stays on the REST-first path. */
	private crdtCreate: ((docId: string, path: string) => Promise<string>) | null = null;

	setCrdtCreate(fn: ((docId: string, path: string) => Promise<string>) | null): void {
		this.crdtCreate = fn;
	}

	/** Socket-native note delete (Plan B1, Task 4). When wired, a local
	 *  user-initiated delete of a note with a resolved note_id sends
	 *  `crdt_delete` instead of a REST `deleteNote`. Returns false when the
	 *  crdt topic isn't joined (offline) — the caller then falls through to
	 *  the REST delete, which carries the durable offline enqueue/retry net.
	 *  Unset, or no resolved id → falls through to the still-functional REST
	 *  delete (removed in Plan B2). Never fires for a delete APPLIED locally
	 *  because it arrived FROM the server — handleDelete's remote-echo
	 *  early-return returns before this is ever reached. */
	private crdtDelete: ((docId: string) => boolean) | null = null;

	setCrdtDelete(fn: ((docId: string) => boolean) | null): void {
		this.crdtDelete = fn;
	}

	/** Optional level-triggered check: is the `crdt:` topic JOINED right now?
	 *  The `crdt` manager latch above is edge-triggered (set on join via
	 *  onCrdtJoined, cleared on disconnect), so it can go STALE — set, but the
	 *  channel dead-but-set after an auth swap. pushFile consults this before
	 *  claiming a CRDT push succeeded, so a stale latch falls back to the durable
	 *  REST path instead of dropping the Y.Doc update into a channel the server no
	 *  longer routes by join_ref (#915). Unset → treated as live (backward
	 *  compatible with callers/tests that never wire it). */
	private crdtLive: (() => boolean) | null = null;

	setCrdtLiveCheck(fn: (() => boolean) | null): void {
		this.crdtLive = fn;
	}

	/** True when a path currently has a live editor binding (an open, bound
	 *  CodeMirror editor). While that holds, the editor binding is the sole CRDT
	 *  writer for the note (Relay's "editor owns the file while open"): the disk
	 *  path must NOT also feed disk content into the Y.Text, or Obsidian's ~2s
	 *  autosave re-diffs the whole file into the doc every cycle and fights the
	 *  binding. Set from the plugin layer; defaults to "never bound" so non-CRDT
	 *  and headless contexts behave exactly as before. */
	private isLiveBound: (path: string) => boolean = () => false;

	setLiveBoundCheck(fn: (path: string) => boolean): void {
		this.isLiveBound = fn;
	}

	/** Adopt-first seed gate input (CrdtManager.isUnchangedSynced): true when
	 *  `content` hashes to exactly what this engine last synced for `path` —
	 *  i.e. the server already holds this content, so a history-less Y.Doc must
	 *  adopt the server lineage instead of re-encoding it (backend #846
	 *  lineage doubling). Unknown paths return false (authored notes seed). */
	isUnchangedSynced(path: string, content: string): boolean {
		const state = this.syncState.get(normalizePath(path));
		return state !== undefined && state.hash === fnv1a(content);
	}

	/** True only when this path has a recorded CRDT baseline that disagrees
	 *  with disk — a real external-edit-while-closed that must be captured into
	 *  CRDT. No baseline (fresh note → the bounded REST fullSync uploads it and
	 *  the backend bind/3 seeds CRDT from content) or in-sync => false, so
	 *  cold-start does NOT open a Y.Doc per note (the reconnect-storm amplifier).
	 *  Inverse of isUnchangedSynced except it also requires a baseline to exist. */
	needsColdReconcile(path: string, content: string): boolean {
		const state = this.syncState.get(normalizePath(path));
		return state !== undefined && state.hash !== fnv1a(content);
	}

	/** Write a remote-merged CRDT result to disk.
	 *  Marks the path recentlyFlushed first so the resulting vault.modify/create
	 *  event is suppressed by the recentlyFlushed guard in handleModify (the
	 *  'create' handler routes through handleModify too).
	 *  Safe to call from main.ts — does not expose the private markRecentlyFlushed.
	 *  Requires the sync gate to be open — returns early when blocked so inbound
	 *  CRDT frames cannot overwrite local files before the user picks a direction. */
	async flushFromCrdt(path: string, content: string): Promise<boolean> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", `flushFromCrdt short-circuited — gate closed: ${path}`);
			return true;
		}
		const normalized = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalized);
		// Idempotency: skip the write when the file already holds exactly this
		// content. An identical re-push re-flushes the same CRDT body; rewriting it
		// needlessly bumps mtime and emits a modify echo, which reads as a spurious
		// local change (e2e test_78 hash-only). No write → nothing to echo-suppress,
		// so we also skip markRecentlyFlushed.
		if (file instanceof TFile && (await this.app.vault.cachedRead(file)) === content) {
			// Disk already holds this content, but the baseline may still be
			// missing (an earlier flush created the file before this fix). Record
			// it so a later server tombstone isn't misread as a resurrection.
			this.recordCrdtBaseline(normalized, content);
			return true;
		}
		this.markRecentlyFlushed(normalized);
		try {
			if (file instanceof TFile) {
				await this.app.vault.modify(file, content);
			} else {
				// Discovery: CRDT delivered the body for a note this device has never
				// had on disk (it lived only in the Yjs doc). Create it — without this
				// flushFromCrdt returned early and the note stayed permanently invisible
				// on this device even though its content was in the local CRDT doc.
				await this.createFileWithFolders(normalized, content);
			}
			// CRDT delivery IS a sync: record the last-synced baseline so the REST
			// reconcile path treats this note as server-known. Without it a
			// CRDT-delivered note has syncedHash=none, and a legitimate server
			// delete (folder-rename cleanup) trips the resurrection guard, which
			// re-pushes the old path and resurrects it forever (e2e test_34/78).
			this.recordCrdtBaseline(normalized, content);
			return true;
		} catch (e) {
			// Return false (do NOT swallow silently): the remote-apply path's
			// onFlushToDisk wrapper turns this into a rejection so applyRemoteUpdate
			// rejects and crdtHead stays unadvanced (#235). recordCrdtBaseline is
			// intentionally NOT reached here — a failed write must not mark the note
			// synced. Best-effort callers (pull/materialize) ignore the return and
			// keep today's log-and-continue behavior.
			rlog().error("crdt", `flushFromCrdt: write failed for ${path}: ${errMsg(e)}`);
			return false;
		}
	}

	/** Seed the last-synced baseline from freshly-delivered CRDT content. Merges
	 *  onto any existing entry so a prior REST sync's version/serverHash survive;
	 *  only the content hash is refreshed to what we just wrote to disk. */
	private recordCrdtBaseline(normalized: string, content: string): void {
		const prev = this.syncState.get(normalized);
		this.syncState.set(normalized, { ...prev, hash: fnv1a(content) });
	}

	/** Capture an un-pushed on-disk edit into the Y.Doc BEFORE a fanned-out or
	 *  cold-received remote update flushes to disk, so CRDT MERGES the local
	 *  drift instead of the remote projection overwriting it (BUG 2: a
	 *  NOT-live-bound note's external edit lives only on disk until its debounce
	 *  fires pushFile; a remote apply landing in that window would clobber it).
	 *  Only acts on a note whose disk content diverges from its recorded baseline
	 *  (needsColdReconcile) — an in-sync note, or one with no baseline, has
	 *  nothing local to preserve. Reuses applyLocalEdit (frontmatter split +
	 *  minimal diff), mirroring reconcileColdStart; oversized notes are left to
	 *  the legacy path (never seeded — 8 MB WS frame limit).
	 *
	 *  PRECONDITION (history-FULL docs only): the callers
	 *  (`applyPushedNoteUpdate`/`coldReceive`) invoke this ONLY when the note's
	 *  Y.Doc already carries the baseline lineage (`crdt.hasHistory` true). A
	 *  history-LESS doc is routed to `adoptHistoryLessNote` instead — seeding disk
	 *  into an empty doc here would mint a FRESH lineage that unions with the
	 *  server lineage and DOUBLES the baseline (#234). On a history-full doc the
	 *  seed is a clean minimal diff onto the existing baseline, so the subsequent
	 *  `applyRemoteUpdate` CRDT-merges both edits without doubling.
	 *
	 *  Best-effort: never throws into the apply path. The caller has already
	 *  established !isLiveBound. */
	private async captureDiskDriftBeforeRemote(path: string, noteId: string): Promise<void> {
		if (!this.crdt) return;
		const normalized = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalized);
		if (!(file instanceof TFile)) return;
		let disk: string;
		try {
			disk = await this.app.vault.cachedRead(file);
		} catch {
			return; // unreadable — let the remote apply proceed rather than block sync
		}
		if (exceedsCrdtNoteLimit(disk, MAX_CRDT_NOTE_BYTES)) return;
		if (!this.needsColdReconcile(normalized, disk)) return; // in-sync / no baseline
		try {
			// Live reread: `disk` is a frozen snapshot and the manager's entry
			// await can span a concurrent remote merge — same stale-snapshot
			// revert class as pushFile/test_83 (review sync.ts:153 altitude).
			await this.crdt.applyLocalEdit(noteId, disk, undefined, () =>
				this.app.vault.cachedRead(file),
			);
			// The seeded drift ships live via manager.onUpdate -> sendCrdt ONLY
			// when the crdt topic is joined. In the reconnect window where the sync
			// topic delivered THIS fan-out but the crdt topic has not re-joined yet
			// (`!crdtLive()`), that update is dropped — and once the caller's
			// flushFromCrdt advances the baseline to the merged disk content, the
			// debounced pushFile echo-skips, stranding the drift until the note's
			// next edit. Durably queue it (noteId-keyed, dedup) so the next flush
			// ships the merged Y.Doc state regardless. Mirrors pushFile's own
			// channel-down handling; `file` is a TFile past the guard above.
			if (!(this.crdtLive?.() ?? true)) {
				await this.enqueueCrdtEdit(file, noteId);
				void this.flushQueue();
			}
		} catch (e) {
			rlog().warn(
				"crdt",
				`captureDiskDriftBeforeRemote: seed failed for ${path}: ${errMsg(e)}`,
			);
		}
	}

	/** Adopt a not-live-bound CRDT note whose local Y.Doc has NO history yet
	 *  (#234). A feed-synced note (content delivered via the cursor feed, its
	 *  IndexedDB store never populated) has an empty Y.Doc. Two coupled failures
	 *  arise if we treat it like a history-full note:
	 *   - DOUBLING: `captureDiskDriftBeforeRemote` → `applyLocalEdit(disk)` seeds
	 *     the whole disk as a FRESH lineage; the subsequent server-lineage merge
	 *     unions two independent insertions of the baseline → baseline doubles.
	 *   - INCOMPLETENESS: the fanned-out/cold delta is one INCREMENTAL update; a
	 *     delta applied to an empty doc has no causal base, so its ops buffer and
	 *     the note never reconstructs.
	 *  Both are avoided by fetching FULL server state (since="" → full) and
	 *  adopting it, so the doc becomes history-full on the server's own lineage;
	 *  any un-pushed disk drift is then reconciled against it (no seed, no
	 *  double). Returns the adopted server head, or null on failure (caller leaves
	 *  crdtHead unadvanced + retries next poll/push). Best-effort: isolates its
	 *  own failure, never throws. */
	private async adoptHistoryLessNote(path: string, noteId: string): Promise<string | null> {
		if (!this.crdt) return null;
		const normalized = normalizePath(path);

		// 1. Capture disk + the drift flag BEFORE the adopt-flush overwrites disk
		//    and its recorded baseline (needsColdReconcile compares to syncState).
		const file = this.app.vault.getAbstractFileByPath(normalized);
		let disk: string | null = null;
		if (file instanceof TFile) {
			try {
				disk = await this.app.vault.cachedRead(file);
			} catch {
				disk = null; // unreadable — proceed with a plain adopt, no drift merge
			}
		}
		const hasDrift =
			disk !== null &&
			!exceedsCrdtNoteLimit(disk, MAX_CRDT_NOTE_BYTES) &&
			this.needsColdReconcile(normalized, disk);

		// 2. Keep-both (drift + NO LCA): the adopt-flush in step 3 overwrites the
		//    original's disk with server content, after which `disk` survives ONLY
		//    in memory. Preserve it to its conflict copy FIRST; if that write fails
		//    for real, ABORT without adopting so the original disk keeps the local
		//    edit and the caller retries next poll (crdtHead unadvanced) — instead
		//    of clobbering disk and then losing the sole in-memory copy. The LCA
		//    branch stays post-adopt (step 4): its merged content is made durable in
		//    the CRDT before flushing, so a flush failure self-heals. The LCA/no-LCA
		//    split needs only the BaseStore, not the adopted server text.
		const lca = hasDrift && disk !== null ? this.baseStore?.get(normalized) : undefined;
		let keepBothCopied = false;
		if (hasDrift && disk !== null && !lca) {
			try {
				const copy = await this.writeDriftConflictCopy(normalized, disk);
				keepBothCopied = true;
				rlog().info(
					"conflict",
					`history-less drift → keep-both | original=${normalized} copy=${copy}`,
				);
			} catch (e) {
				rlog().error(
					"conflict",
					`history-less keep-both copy failed for ${normalized}: ${errMsg(e)}. Aborting adopt to retain the local edit for retry`,
				);
				return null;
			}
		}

		// 3. Fetch + adopt the FULL server state. Reconstructs the note on the
		//    server lineage; the doc is history-full afterward. The echo-guarded
		//    flush writes server content to disk (clobbers drift — captured above).
		let head: string;
		try {
			// Take the state vector BEFORE adopting (doc still empty → SV encodes
			// "I have nothing", so the server returns FULL state). An empty `since`
			// string is rejected by the backend's plausible_state_vector? guard
			// (400) — mirror coldReceive and send the real (empty-doc) SV instead.
			const since = toB64(await this.crdt.encodeStateVector(noteId));
			const full = await this.api.getUpdates(noteId, since);
			head = full.head;
			await this.crdt.applyRemoteUpdate(noteId, full.update);
		} catch (e) {
			rlog().warn(
				"crdt",
				`adoptHistoryLessNote: full-state adopt failed for ${path}: ${errMsg(e)}`,
			);
			return null;
		}

		// 4. Reconcile any un-pushed disk drift against the adopted server lineage.
		//    The no-LCA keep-both copy is already written durably in step 2, so skip
		//    it here (don't write it twice); only the LCA 3-way merge remains.
		if (hasDrift && disk !== null && !keepBothCopied) {
			await this.reconcileDriftOntoServer(normalized, noteId, disk);
		}
		return head;
	}

	/** Reconcile an un-pushed disk edit (`localDisk`) against a note whose Y.Doc
	 *  now holds the adopted SERVER lineage (`adoptHistoryLessNote` step 3). The
	 *  doc == server content at entry; disk was just overwritten with server
	 *  content by the adopt-flush, but `localDisk` holds the pre-adopt disk.
	 *   - LCA available (BaseStore has the last-synced base): a real 3-way merge
	 *     preserves both sides. Diff the merged text onto the server lineage via
	 *     `applyLocalEdit` (doc is history-full → diffIntoYText, NO seed → NO
	 *     double), then flush the merged result and push it (the local update
	 *     emitted by applyLocalEdit).
	 *   - No LCA, or the 3-way merge conflicts: keep BOTH, never lose or double.
	 *     The original note converges to SERVER (doc == disk == server already);
	 *     the local version is preserved as a separate conflict-copy note. This is
	 *     the CRDT-consistent shape of the legacy keep-both (server→original,
	 *     local→copy), so the Y.Doc and disk never disagree.
	 *  Best-effort: isolates its own failure, never throws. */
	private async reconcileDriftOntoServer(
		normalized: string,
		noteId: string,
		localDisk: string,
	): Promise<void> {
		if (!this.crdt) return;
		let serverText: string;
		try {
			serverText = await this.crdt.projectedText(noteId);
		} catch (e) {
			rlog().warn(
				"crdt",
				`reconcileDriftOntoServer: projectedText failed for ${normalized}: ${errMsg(e)}`,
			);
			return;
		}
		if (serverText === localDisk) return; // no real divergence

		const base = this.baseStore?.get(normalized);
		if (base) {
			const merge = threeWayMerge(base.content, localDisk, serverText);
			if (merge.clean) {
				try {
					// Doc is history-full → applyLocalEdit diffs (no seed, no double).
					// No reread on purpose: `merge.merged` is COMPUTED (non-disk)
					// content — a disk reread here would be wrong by construction
					// (frozen semantics per the applyLocalEdit contract).
					await this.crdt.applyLocalEdit(noteId, merge.merged);
					await this.flushFromCrdt(normalized, await this.crdt.projectedText(noteId));
					this.baseStore?.set(normalized, merge.merged, base.version);
					rlog().info(
						"conflict",
						`history-less drift 3-way merged | path=${normalized}` +
							` | baseLen=${base.content.length} localLen=${localDisk.length}` +
							` remoteLen=${serverText.length} mergedLen=${merge.merged.length}`,
					);
				} catch (e) {
					rlog().error(
						"conflict",
						`history-less 3-way merge apply failed for ${normalized}: ${errMsg(e)}`,
					);
				}
				return;
			}
		}

		// No LCA / conflicted → keep both. Original stays on server (already
		// flushed); local drift is preserved as its own conflict-copy note.
		// (The no-LCA case writes this copy pre-adopt in adoptHistoryLessNote; this
		// path only runs for a conflicted 3-way merge, where the LCA existed.)
		try {
			const conflictPath = await this.writeDriftConflictCopy(normalized, localDisk);
			rlog().info(
				"conflict",
				`history-less drift → keep-both | original=${normalized} copy=${conflictPath}`,
			);
		} catch (e) {
			rlog().error(
				"conflict",
				`history-less keep-both copy failed for ${normalized}: ${errMsg(e)}`,
			);
		}
	}

	/** Write `localDisk` to a dated `<name> (conflict <date>).md` copy beside
	 *  `normalized` and record its baseline so it isn't re-pushed as drift.
	 *  Throws on a GENUINE write failure — `createFileWithFolders` degrades a
	 *  benign "already exists" race to a modify with the same content, so only
	 *  real errors (disk full, permission, illegal path) propagate. Returns the
	 *  conflict path written. */
	private async writeDriftConflictCopy(normalized: string, localDisk: string): Promise<string> {
		const date = new Date().toISOString().slice(0, 10);
		const conflictPath = `${normalized.replace(/\.md$/, "")} (conflict ${date}).md`;
		await this.createFileWithFolders(conflictPath, localDisk);
		this.syncState.set(normalizePath(conflictPath), { hash: fnv1a(localDisk) });
		return conflictPath;
	}

	/** Materialize an EMPTY note whose emptiness the server has just confirmed.
	 *
	 *  A non-empty note materializes through the normal update→`flushFromCrdt`
	 *  path: our discovery STEP1 elicits a STEP2 carrying the body, applying it
	 *  fires a doc-update event, and that writes the file. An EMPTY note has no
	 *  body — its STEP2 integrates zero ops, so no doc-update event fires and no
	 *  flush creates the file.
	 *
	 *  This is called from `CrdtChannel.onEmptyStep2`, i.e. only after an inbound
	 *  STEP2 has left the doc empty — the authoritative "genuinely empty" signal.
	 *  So there is no timer and no guessing: create the file from the doc's
	 *  current text (empty) if it is still absent. Keying off the STEP2 (not a
	 *  wall-clock window) is what closes the #547 race where a slow content STEP2
	 *  let a premature empty file land on disk under load. Gated to `.md`
	 *  (mirrors the CRDT-markdown-only rule).
	 *
	 *  `noteId` reads the CRDT doc (id-keyed); `path` is used only for disk
	 *  I/O and log messages — passing `path` to `crdt.projectedText` would open
	 *  a stray path-keyed doc/IndexedDB store instead of the real note. */
	async materializeEmptyDiscovered(path: string, noteId: string): Promise<void> {
		if (this.syncBlocked) {
			devLog().log(
				"sync-blocked",
				`materializeEmptyDiscovered short-circuited — gate closed: ${path}`,
			);
			return;
		}
		if (!path.endsWith(".md")) return;
		const normalized = normalizePath(path);
		// Already on disk — a content STEP2 created it, or the user already has it.
		if (this.app.vault.getAbstractFileByPath(normalized)) return;

		// An empty STEP2 is USUALLY the server's authoritative "genuinely empty"
		// reply. Under load it can instead mean "content is in REST/DB but the
		// note's CRDT room hasn't been seeded yet" — the author pushed via REST
		// before its Y.Doc update reached the server. Materializing empty then
		// races the real body and strands a permanently-empty file on this device
		// (e2e test_38/test_43). Disambiguate against REST: if the server note has
		// content, this empty STEP2 is stale — write the REST body, not an empty
		// file. Proper fix is server-side (seed the Y.Doc from REST on first room
		// open); this is the client-side race-closer.
		try {
			const note = await this.api.getNote(path);
			if (note.content && note.content.length > 0) {
				await this.flushFromCrdt(path, note.content);
				return;
			}
		} catch (e) {
			// REST unreachable, or a genuine 404 for a note not on the server yet.
			// Fall through to the empty-materialize below — a genuinely empty note
			// must still appear on disk even when this cross-check can't run.
			rlog().warn(
				"crdt",
				`materializeEmptyDiscovered: getNote failed for ${path}, materializing empty: ${errMsg(e)}`,
			);
		}

		const text = this.crdt ? await this.crdt.projectedText(noteId) : "";
		await this.flushFromCrdt(path, text);
	}

	/** Materialize a note at a NEW path after an id-keyed relocation
	 *  (`moveIfIdRelocated`) when this device's CRDT handshake for `noteId`
	 *  already completed earlier THIS session (e2e test_10, #189).
	 *
	 *  A rename changes no doc content, so it never produces a Y.Doc update —
	 *  `onFlushToDisk` never fires for it — and `crdtEnrollment.enroll()` is a
	 *  documented per-session no-op once a note_id is already enrolled (true
	 *  here: this device received the note live, at its old path, earlier this
	 *  session). With neither trigger left, the file at the new path is never
	 *  written: the event is received but never materialized. This closes that
	 *  gap by flushing the CRDT doc's already-known content directly.
	 *
	 *  Gated on `crdt.isSynced(noteId)` — NOT on "already enrolled". `enroll()`
	 *  marks a note_id enrolled synchronously, before its STEP2 handshake
	 *  resolves, so an "already enrolled" check would race a note's genuine
	 *  FIRST enrollment and could flush empty/partial content (the #547 class
	 *  of premature-empty-file bug). `isSynced` only turns true once a STEP2
	 *  has actually landed, so the content read here is trustworthy. No-ops
	 *  when the handshake hasn't completed yet (the ordinary STEP1/STEP2 path
	 *  still owns materializing it) or the file already exists at `path`. */
	private async materializeRelocated(path: string, noteId: string): Promise<void> {
		if (!this.crdt || !path.endsWith(".md")) return;
		// Defensive `typeof` (not `?.`) — CrdtManager always has isSynced, but many
		// existing unit tests wire a partial `{ applyLocalEdit } as any` stand-in
		// that doesn't, and a missing method must read as "not synced" rather than
		// throw.
		if (typeof this.crdt.isSynced !== "function" || !this.crdt.isSynced(noteId)) return;
		if (this.app.vault.getAbstractFileByPath(normalizePath(path))) return;
		const text = await this.crdt.projectedText(noteId);
		// Identity re-check at WRITE time (issue #210, e2e test_34): this call is
		// unawaited and races the pull's id-keyed move. A stale old-path upsert
		// captures (path, noteId) while old is still canonical; the relocation
		// can land any time up to here — including DURING the projectedText
		// await (it suspends on IDB load), which is why the check sits after it,
		// immediately before the write (flushFromCrdt has no identity guard and
		// fails open). Writing a relocated path re-creates the tombstoned file,
		// and its modify event re-pushes it under a FRESH mint (the old-path
		// map entry moved away), resurrecting the path server-side. Defends the
		// MOVE case only: a tombstone delete clears the byId entry entirely
		// (canonical === null), where the doc teardown's isSynced gate above is
		// the backstop.
		const canonical = this.noteIdMap?.pathForId(noteId) ?? null;
		if (canonical !== null && normalizePath(canonical) !== normalizePath(path)) {
			rlog().info(
				"ws",
				`Stale materialize skipped for ${noteId}: canonical=${canonical} captured=${path}`,
			);
			return;
		}
		await this.flushFromCrdt(path, text);
	}

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

	/** Plan-gated attachment skips drained by the most recent push flush, kept
	 *  so the terminal "complete" progress event can report a `skipped` count
	 *  even after `flushAttachmentLimitedToast()` has reset the live tally.
	 *  Disjoint from the `failed` counter (real failures) by construction —
	 *  informational outcomes increment `attachmentLimitedThisBatch`, genuine
	 *  failures increment `failuresThisBatch` / the local `failed`. */
	private lastBatchSkipped = 0;

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
		private saveData: (data: {
			lastSync?: string;
			syncCursor?: string | null;
			// Signals the engine mutated the shared noteIdMap and it should be
			// persisted. main.ts's savePluginData writes the map instance directly
			// (same object), so the callback need not read this — it just triggers
			// the wholesale save.
			noteIds?: Record<string, string>;
		}) => Promise<void>,
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
		// One-shot capability probe: latch ops off before the first edit if this
		// is a pre-Phase-1 backend, so we stay on the legacy whole-doc path
		// instead of 404ing on the first CRDT flush.
		void this.probeCrdtOps();
	}

	/** One-shot capability probe: a pre-Phase-1 backend 404s /vault/heads, so we
	 *  latch ops off before the first edit and stay on the legacy whole-doc path. */
	async probeCrdtOps(): Promise<void> {
		if (!this.settings.enableCrdt) return;
		try {
			await this.api.getVaultHeads();
			// Conclusive: the route answered, ops are supported.
			this.crdtOpsProbed = true;
		} catch (e) {
			const status = (e as { status?: number })?.status;
			// Only a definitive 404/405 conclusively proves the route is absent.
			// Any other failure (5xx, or a status-less network error) is
			// INCONCLUSIVE: leaving crdtOpsProbed=false keeps ops unavailable this
			// session so channel-down edits take the legacy whole-doc path. Marking
			// probed here would make a later /updates 404 (against a route-less
			// backend) look like "note gone" in runFlushQueue and silently drop the
			// edit.
			if (status === 404 || status === 405) {
				this.markCrdtOpsUnsupported(status);
				this.crdtOpsProbed = true;
			}
		}
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

	getSyncCursor(): string | null {
		return this.syncCursor;
	}

	setSyncCursor(cursor: string | null): void {
		this.syncCursor = cursor && cursor.length > 0 ? cursor : null;
	}

	/** Wipe ALL per-vault sync + identity state. Both vault-change paths
	 *  (explicit picker `resetForVaultChange`, backstop
	 *  `invalidateIfVaultChanged`) call this — keeping them in lockstep is the
	 *  point; a wipe that exists on only one path re-opens #200. */
	private async wipePerVaultState(): Promise<void> {
		this.syncState.clear();
		this.lastSync = "";
		// The cursor marks a position in the OLD vault's ordered feed — drop it so
		// the next sync re-bootstraps against the new vault (else a genesis pull
		// would resume from a foreign vault's seq).
		this.syncCursor = null;
		// The note-id map and confirmed set are per-vault identity state.
		// Carrying them across vaults keys CRDT frames/rooms by another
		// vault's note ids — the cross-vault flavor of the 2026-07-07
		// cross-wire class (plugin #200). Wipe both; ids re-learn via the
		// manifest reconcile + push adoption. clear() mutates in place: the
		// instance is shared with main.ts + live views.
		this.noteIdMap?.clear();
		this.clearConfirmedNoteIds();
		// note_ids are only unique WITHIN a vault (final review MINOR-6) — a
		// relocation timestamp recorded for an id under the OLD vault must not
		// survive to stale-gate an unrelated note that happens to reuse the same
		// id in the new vault. Living here (not just resetForVaultChange) keeps
		// BOTH vault-change paths in lockstep, per this method's contract.
		this.lastRelocationTs.clear();
		await this.saveData({ lastSync: "", syncCursor: null });
	}

	/** Reset all per-vault sync bookkeeping. Used when the user switches the
	 *  active server vault inside the SyncPreviewModal so the next sync starts
	 *  from a clean slate (lastSync empty, no stale per-file hashes). */
	async resetForVaultChange(): Promise<void> {
		this.syncStateVaultId = this.settings.vaultId ?? null;
		await this.wipePerVaultState();
		devLog().log(
			"lifecycle",
			"resetForVaultChange: lastSync + syncState + cursor + ids cleared",
		);
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
		this.syncStateVaultId = current;
		await this.wipePerVaultState();
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

	private getCrdtHead(path: string): string | undefined {
		return this.syncState.get(normalizePath(path))?.crdtHead;
	}

	private setCrdtHead(path: string, head: string): void {
		const key = normalizePath(path);
		const existing = this.syncState.get(key);
		this.syncState.set(key, { ...(existing ?? { hash: 0 }), crdtHead: head });
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
			this.schedulePostPullDrain();
			return;
		}
		// Suppress echoes from flushFromCrdt (remote CRDT update → disk write).
		// Must NOT key off recentlyPushed: that set is also populated after every
		// legacy push, so checking it here would drop real user edits made within
		// the post-push cooldown (e.g. a conflicting local edit), defeating
		// conflict detection on the next pull.
		//
		// For CRDT-managed markdown this time-window guard is BOTH unnecessary and
		// harmful: the echo of a flush is naturally a no-op (routeModify →
		// applyLocalEdit re-applies identical content, diffIntoYText yields zero
		// ops, nothing is re-transmitted), while a REAL edit made within the window
		// — e.g. editing a note the moment after it was discovered/flushed — would
		// be wrongly dropped here and never reach the CRDT path. So only apply the
		// guard off the CRDT path (legacy writes, attachments).
		const crdtManaged = !!this.crdt && this.isMarkdown(file);
		if (!crdtManaged && this.recentlyFlushed.has(file.path)) {
			rlog().info("sync", `Modify echo skip (recently flushed from CRDT): ${file.path}`);
			return;
		}

		// Editor-owns-the-file gate (Relay's active-vs-idle model): if the note has
		// a live editor binding, that binding already streamed this edit into the
		// Y.Text per keystroke. Obsidian's autosave disk write is just local
		// persistence; re-feeding it through routeModify -> applyLocalEdit would
		// diff the whole file back into the doc every ~2s and churn it (the
		// delete/insert flicker). Skip the disk-driven CRDT route while bound. The
		// disk path still serves closed notes, reading-view-only notes, and
		// external edits (none of which are live-bound).
		if (crdtManaged && this.isLiveBound(file.path)) {
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

		// Resolve the note_id BEFORE clearing the map (removeDoc/reset below need
		// it to tear down the right CRDT doc, keyed by id not path).
		const crdtNoteId = !isBinary ? (this.noteIdMap?.get(file.path) ?? null) : null;

		// Clear the file's note_id mapping — the vault file is genuinely gone,
		// so a note later recreated at this path must mint a fresh id rather
		// than resurrecting the deleted note's (Task 5). Attachments have no
		// entries in this map (path -> note_id only), so gated on !isBinary.
		if (!isBinary) {
			this.noteIdMap?.delete(file.path);
		}

		// Drop the deleted path's sync-state entry (notes AND attachments): its
		// recorded content hash is now stale, and left behind it echo-suppresses
		// a later create at the same path whose content hashes the same, so the
		// recreated file's push is skipped and it never reaches the server.
		this.syncState.delete(normalizePath(file.path));

		// This trash APPLIED a remote change (trashRemotelyDeleted marked it):
		// the server already knows. Never push the DELETE back — path-keyed and
		// CAS-less, it lands after the origin device recreates the path
		// (replace-remote wipe→re-push, delete→recreate) and tombstones the
		// FRESH note. Local bookkeeping above still ran; mirror the CRDT
		// teardown the push path would have done and stop.
		if (this.remotelyDeleted.has(file.path)) {
			this.remotelyDeleted.delete(file.path);
			rlog().info("vault", `Delete echo skip (remote-applied): ${file.path}`);
			if (file.path.endsWith(".md") && crdtNoteId) {
				await this.crdt?.removeDoc(crdtNoteId);
				this.crdtEnrollment?.reset(crdtNoteId);
			}
			return;
		}

		try {
			if (isBinary) {
				await this.api.deleteAttachment(file.path); // attachments stay REST
			} else if (this.crdtDelete && crdtNoteId) {
				const sent = this.crdtDelete(crdtNoteId);
				// Topic not joined (offline) — fall through to REST, which throws
				// offline and lands in the catch below's enqueue/retry net.
				if (!sent) await this.api.deleteNote(file.path);
			} else {
				await this.api.deleteNote(file.path); // fallback — removed in Plan B2
			}
			this.goOnline();
			// Tear down the CRDT doc so a note recreated at the same path starts
			// fresh — no ghost lineage that would resurrect stale content (P1-3).
			// Gate on .md (not !isBinary) so .canvas files never hit removeDoc:
			// canvas files are syncable text but not CRDT-managed. Also gate on a
			// known id — nothing to tear down if this note never had a CRDT room.
			if (file.path.endsWith(".md") && crdtNoteId) {
				await this.crdt?.removeDoc(crdtNoteId);
				this.crdtEnrollment?.reset(crdtNoteId);
			}
		} catch (e) {
			// 404 means already deleted — treat as success; still tear down CRDT.
			if (isHttpStatus(e, 404)) {
				this.goOnline();
				if (file.path.endsWith(".md") && crdtNoteId) {
					await this.crdt?.removeDoc(crdtNoteId);
					this.crdtEnrollment?.reset(crdtNoteId);
				}
				return;
			}
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: failed to delete %s", file.path, e);
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

		// Keep the note_id mapping stable across the rename (Task 5) — the id
		// itself never changes on a rename, only the path key it's filed under.
		// A no-op if oldPath has no entry (attachments, or a note never pushed).
		if (!isBinary) {
			this.noteIdMap?.rename(oldPath, file.path);
		}

		// Delete old path if it wasn't ignored
		if (!this.shouldIgnore(oldPath)) {
			try {
				if (isBinary) {
					await this.api.deleteAttachment(oldPath);
				} else {
					await this.api.deleteNote(oldPath);
				}
				this.goOnline();
				// Task 6 (note_id-keyed CRDT): a rename must NOT tear down the CRDT
				// doc. Its key is now the note's stable note_id (unchanged by a
				// rename — only the path above it moves, via noteIdMap.rename), so
				// the same doc/IndexedDB entry keeps serving the note at its new
				// path with its live history intact. Closing it here (the old
				// path-keyed behavior) would destroy that history on every rename —
				// the exact bug this rework exists to fix.
			} catch (e) {
				// 404 means already deleted — treat as success.
				if (isHttpStatus(e, 404)) {
					this.goOnline();
				} else {
					// biome-ignore lint/suspicious/noConsole: error boundary
					console.error("Engram Sync: failed to delete old path %s", oldPath, e);
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
			// Drop the OLD path's sync-state entry: no note lives there anymore, so
			// its recorded content hash is stale. Left behind, it echo-suppresses a
			// later create at the old path whose content happens to hash the same
			// (rename a note away, then make a new note with identical content at
			// the old path — the new note's push is skipped and it never syncs).
			// The new-path push below re-establishes sync-state under file.path.
			this.syncState.delete(normalizePath(oldPath));
			// deleteNote above tombstoned the old path's row, so the note_id is no
			// longer server-live. Un-confirm it so the pushFile below takes the
			// REST-first path (which moves/resurrects the row at the new path,
			// keyed by the stable id) instead of the CRDT path — the server drops
			// crdt frames for a note it sees as absent, silently losing the rename.
			this.unconfirmNoteId(this.noteIdMap?.get(file.path) ?? null);
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

	/** First-sync seeding: POST an explicit marker for every local folder whose
	 *  entire subtree holds NO syncable file. The server derives a folder only
	 *  from notes pushed into it, so a truly-empty folder — or one containing
	 *  only non-syncable types (.txt, .excalidraw, …) — would otherwise never
	 *  appear in the web UI after a first sync. Folders with a syncable note
	 *  anywhere beneath them are skipped: they surface via that note, and the
	 *  web app synthesizes their ancestors. Best-effort — a per-folder server
	 *  error is warn-logged and seeding continues (matches handleFolderCreate). */
	async seedEmptyFolders(): Promise<void> {
		if (!this.explicitFolders) return;

		const loaded = this.app.vault.getAllLoadedFiles?.() ?? [];
		for (const f of loaded) {
			if (!(f instanceof TFolder)) continue;
			const path = normalizePath(f.path);
			if (!path || path === "/") continue; // vault root
			if (this.shouldIgnore(path)) continue;
			if (this.explicitFolders.has(path)) continue; // already tracked
			if (this.subtreeHasSyncableFile(f)) continue; // appears via its notes

			try {
				await this.api.createFolder(path);
				await this.explicitFolders.add(path);
			} catch (e) {
				devLog().log("push", `seedEmptyFolders("${path}") failed: ${errMsg(e)}`);
				rlog().warn("push", `seedEmptyFolders("${path}") failed: ${errMsg(e)}`);
			}
		}
	}

	/** True if any descendant file (at any depth) is syncable and not ignored. */
	private subtreeHasSyncableFile(folder: TFolder): boolean {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				if (this.subtreeHasSyncableFile(child)) return true;
			} else if (
				child instanceof TFile &&
				this.isSyncable(child) &&
				!this.shouldIgnore(child.path)
			) {
				return true;
			}
		}
		return false;
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

		// Persistence shortcut: if this attachment was already parked under an
		// informational plan-skip (Free-tier 402 attachments-disabled, or a
		// storage-quota 402, on a previous push), skip it without re-hitting the
		// backend. The issue stays in the Sync Center until the user upgrades or
		// dismisses it. This is what makes the batched toast quiet on the next
		// sync — there's nothing left to fail, so the count is 0.
		if (!bypassPlanSkip && this.isBinaryFile(file) && this.hasInformationalIssue(file.path)) {
			devLog().log("push", `skip (plan-informational): ${file.path}`);
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
				} else {
					this.failuresThisBatch += 1;
					this.firstFailureMessageThisBatch ??= gate.message;
				}
				devLog().log("push", `skip (pre-gate ${gate.category}): ${file.path}`);
				return false;
			}
		}

		await this.acquirePushSlot();
		// Snapshot the path for the lifetime of this push. TFile.path is LIVE —
		// a user rename landing while the request is in flight mutates it, and
		// every identity decision below (pushing-set hygiene, the wire path, the
		// server-sanitized-rename check) must be made against the path we
		// actually pushed, not wherever the file lives by reply time (#245).
		const pushedPath = file.path;
		this.pushing.add(pushedPath);
		this.lastError = "";
		this.emitStatus();

		const isBinary = this.isBinaryFile(file);
		let success = false;
		// Set in the note branch below so recordParseStatus can run AFTER the
		// shared issues.clear(file.path) — resp (and thus parse_status) is only
		// in scope inside that branch, but the clear is shared with attachments.
		let pushedNoteParse:
			| { path: string; parseStatus?: "ok" | "degraded"; parseReason?: ParseReason | null }
			| undefined;
		devLog().log(
			"push",
			`start ${isBinary ? "attachment" : "note"}: ${file.path} (active=${this.activePushCount})`,
		);
		rlog().info(
			"push",
			`Push start: ${file.path} | type=${isBinary ? "attachment" : "note"} | active=${this.activePushCount}`,
		);

		try {
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

				// Echo suppression — skip pushing if content matches what the sync
				// engine last wrote (pull/WebSocket/flushFromCrdt). Must run BEFORE
				// the CRDT routing branch below, not just the legacy REST path: a
				// disk write this engine itself just made (e.g. materializeRelocated
				// discovering a note and calling flushFromCrdt, which records this
				// exact hash via recordCrdtBaseline) fires vault's create/modify
				// event same as a real edit. Routing that echo into
				// routeModify/applyLocalEdit unconditionally diffs "content" against
				// the Y.Doc's CURRENT state — if the Y.Doc has meanwhile advanced
				// (e.g. a concurrent remote update just landed in the room), the
				// diff is a genuine-looking but stale delta that DELETES the
				// just-arrived remote content, not a harmless no-op (e2e test_37
				// content-loss: first append vanishes). Hoisting this hash check
				// above the CRDT branch closes that hole for both paths.
				const hash = fnv1a(content);
				const existing = this.syncState.get(normalizePath(file.path));
				if (!force && existing !== undefined && hash === existing.hash) {
					devLog().log("push", `skip (echo): ${file.path}`);
					rlog().info("push", `Echo skip: ${file.path} | hash=${hash}`);
					return false;
				}

				// note_id-keyed CRDT rework (Task 5): resolve (or mint) this note's
				// stable id BEFORE routing, so both the CRDT path (Task 6) and the
				// REST fallback below can key/send by it. A brand-new note has no
				// entry yet — mint a UUIDv7 and remember it immediately so a retry
				// or a concurrent push for the same path reuses the same id rather
				// than minting a second one.
				let noteId = this.noteIdMap?.get(file.path) ?? null;
				if (!noteId && this.noteIdMap) {
					// MINT REFUSAL (issue #972, e2e test_34) — see shouldDeferMint.
					// Skip the push: the relocation/pull owns this path's fate.
					if (this.shouldDeferMint(file.path)) {
						rlog().info(
							"push",
							`Mint refused (engine-flushed file, id relocated away): ${file.path}`,
						);
						return false;
					}
					noteId = uuid7();
					this.noteIdMap.set(file.path, noteId);
				}

				// Routing observability: which inputs decide CRDT-vs-REST for this
				// markdown save. A brand-new note MUST be REST (confirmed=false); a
				// stale confirmed=true here routes a never-server-known note to CRDT,
				// which the backend silently drops. Surfaced so the delivery oracle
				// can attribute a "not on server" failure to the routing decision.
				if (file.extension === "md") {
					rlog().info(
						"push",
						`route: ${file.path} crdt=${!!this.crdt} confirmed=${noteId ? this.isNoteConfirmed(noteId) : false} live=${this.crdtLive?.() ?? true} id=${noteId ?? "none"}`,
					);
				}

				// CRDT path: route markdown saves through CrdtManager when wired,
				// a note_id is known (#915-style gate: no id, no CRDT room to key
				// the frame by — REST fallback owns it), the note is CONFIRMED
				// server-known. The confirmed check exists because the backend's
				// CRDT channel requires the note row to already exist (note_in_vault?)
				// and silently DROPS a crdt_msg for an unknown note_id — it can no
				// longer bootstrap a note from a bare wire doc_id (no path on the
				// frame). A brand-new / never-synced note must therefore take the
				// REST path below first (which creates the row and adopts the
				// client-minted id, confirming it on success); only then do its
				// edits route through CRDT. diffIntoYText produces minimal ops.
				//
				// Transport (Task 5, single authority): once the edit is consumed
				// into the Y.Doc, a LIVE crdt: channel already carries it (the Y.Doc
				// update listener forwards the diff via CrdtChannel, keyed by
				// noteId) — no full-document POST, no version field, no base_hash.
				// When the channel is NOT joined (crdtLive() false — a stale manager
				// latch, e.g. dead-but-set after an auth swap, or a genuine
				// disconnect) but the backend supports CRDT ops
				// (crdtOpsAvailable()), the edit is still durable in the local
				// Y.Doc — persist a durable crdt-tagged queue entry (delivered by
				// runFlushQueue's noteId-keyed /updates branch) instead of falling
				// through to the whole-doc base_hash push (#203, e2e test_83/test_85).
				// Only when ops are unsupported (pre-Phase-1 backend) does a down
				// channel fall through to the legacy REST path, exactly as before
				// this feature.
				//
				// `crdtLive` here is a PRE-AWAIT snapshot, used ONLY to decide
				// whether this branch is even entered (below). It can go stale
				// during the awaited `routeModify` seed if the channel drops
				// mid-seed — see the post-await `crdtLiveNow` re-check (Task 5)
				// that actually decides live-vs-durable-queue.
				const crdtLive = this.crdtLive?.() ?? true;
				if (
					this.crdt &&
					noteId &&
					this.isCrdtManagedOffline(file.path, noteId) &&
					(crdtLive || this.crdtOpsAvailable())
				) {
					const consumed = await routeModify(
						{
							isMarkdown: file.extension === "md",
							noteId,
							// A LIVE read, not the frozen `content` above: routeModify
							// forwards this as the manager's stale-snapshot reread, and a
							// frozen closure would defeat that guard (e2e test_83).
							readContent: () => this.app.vault.cachedRead(file),
						},
						this.crdt,
						MAX_CRDT_NOTE_BYTES,
					);
					if (consumed !== null) {
						// Record the transmitted content's hash as the echo-hash baseline
						// (final review IMPORTANT-4). Without this, the hoisted echo-hash
						// gate above keeps comparing against the last-FLUSHED baseline
						// (discovery/pull) instead of the last-TRANSMITTED content: an
						// edit followed by an undo back to that stale baseline hash-
						// matches and is echo-skipped, so the revert never reaches the
						// Y.Doc. Merges onto any existing entry (mirrors recordCrdtBaseline)
						// so version/serverHash survive. Hash what the manager actually
						// CONSUMED, not this function's pre-guard disk read — with a
						// live reread those differ whenever a remote merge landed
						// mid-guard, and stamping the stale hash would echo-skip a later
						// revert back to that exact content (review sync.ts:2113).
						this.syncState.set(normalizePath(file.path), {
							...existing,
							hash: fnv1a(consumed),
						});
						// Register the doc with the server even when applyLocalEdit produced
						// NO Yjs update — a brand-new EMPTY note seeds "" into Y.Text, which
						// is a no-op, so nothing is transmitted and the note would never reach
						// the server. enroll() fires startSync's STEP1 handshake so the client
						// re-syncs any Yjs history it's missing. Idempotent per session, so a
						// note already enrolled via active-leaf-change is unaffected.
						// Vault-channel fan-out: enroll (STEP1) only for a live-bound note.
						// An idle note's send already shipped over the channel/updates above,
						// and it RECEIVES future updates over the note_yjs_update broadcast —
						// no room needed. A brand-new empty note's row is created by the REST
						// push path, so skipping STEP1 here does not strand it.
						if (this.isLiveBound(normalizePath(file.path))) {
							this.crdtEnrollment?.enroll(noteId);
						}
						success = true;
						// Task 5 (TOCTOU fix): re-check liveness AFTER the awaited seed
						// above. The channel can drop DURING routeModify — a stale
						// pre-await `crdtLive` snapshot would leave the edit on a dead
						// socket believing the live channel already carried it, when it
						// never did.
						const crdtLiveNow = this.crdtLive?.() ?? true;
						if (!crdtLiveNow) {
							// Channel down (or dropped mid-seed), ops available: the edit
							// is already durable in the local Y.Doc (IndexedDB-persisted).
							// Persist a content-free crdt-tagged queue entry — durable
							// across plugin unload and retried by runFlushQueue until
							// delivered — instead of the retired in-memory-only debounce
							// timer, which lost the edit on unload and never retried a
							// failed flush.
							await this.enqueueCrdtEdit(file, noteId);
							// Deliver now if REST is reachable; durable + retried
							// otherwise (queue survives unload, next flush picks it up).
							void this.flushQueue();
							devLog().log(
								"push",
								`crdt edit queued durably (channel down): ${file.path}`,
							);
							rlog().info(
								"push",
								`CRDT edit queued durably (channel down): ${file.path}`,
							);
							return true;
						}
						devLog().log("push", `crdt ok: ${file.path}`);
						rlog().info("push", `CRDT push ok: ${file.path}`);
						return true;
					}
					// DECLINED (handshake gate): applyLocalEdit returned false because
					// the doc is empty and the STEP2 has not yet arrived this session.
					// The legacy push path below owns this write convergently (backend
					// PR #846 merges legacy REST pushes into the server CRDT doc). We
					// still enroll the markdown note so the STEP1 handshake kicks off —
					// once STEP2 arrives, markSynced fires and future edits route through
					// CRDT normally. Guard: enroll is md-gated (checked here, since
					// CrdtEnrollment itself no longer knows the path) + idempotent per
					// session.
					//
					// Oversized notes must NOT be enrolled: enrolling elicits a STEP2
					// that encodes the full doc history (~+33% base64), which for a note
					// at or above MAX_CRDT_NOTE_BYTES can exceed Bandit's 8 MB WebSocket
					// frame limit (1009 close) and — because the bloated doc persists in
					// IndexedDB — re-crashes on every reconnect, killing all vault sync.
					// Vault-channel fan-out: enroll (STEP1) only for a live-bound note —
					// the legacy REST push above already delivered the body server-side; an
					// idle note receives future updates over the note_yjs_update broadcast,
					// no room needed. Oversized notes never enroll (8 MB WS frame limit).
					if (
						file.extension === "md" &&
						new TextEncoder().encode(content).length <= MAX_CRDT_NOTE_BYTES &&
						this.isLiveBound(normalizePath(file.path))
					) {
						this.crdtEnrollment?.enroll(noteId);
					}
				}

				// Socket-native genesis (Plan B1, Task 3): a brand-new / never-synced
				// markdown note's FIRST write creates its server row over the CRDT
				// channel instead of a REST pushNote. Gated to the genesis case only —
				// a CONFIRMED note's edits already took the CRDT-op branch above (or its
				// declined/oversized fall-through), and this branch must not intercept
				// them. Requires the channel joined (crdt_create is a socket request)
				// and the body within the CRDT transport cap (an oversized note stays
				// on REST — routeModify would decline the seed anyway). crdt_create
				// returns the server's AUTHORITATIVE id; on ADOPT (path already owned by
				// a live note under a different id) it differs from our mint, so we
				// remap before seeding/enrolling — addressing the row that exists rather
				// than orphaning the note's content. On rejection (delete-wins,
				// rate-limit, bad path) we log and fall through to the REST create,
				// which still works in this additive phase (removed in Plan B2).
				if (
					this.crdtCreate &&
					this.crdt &&
					noteId &&
					file.extension === "md" &&
					!this.isNoteConfirmed(noteId) &&
					(this.crdtLive?.() ?? true) &&
					new TextEncoder().encode(content).length <= MAX_CRDT_NOTE_BYTES
				) {
					try {
						// Only the crdtCreate call itself is covered by this catch — once
						// it RESOLVES, the server row exists (possibly under a remapped
						// serverId) and a throw from anything below must NOT fall through
						// to the REST cascade: that would create a duplicate/misrouted row
						// under the stale mint against a path the server already owns. The
						// inner try/catch handles that post-create case locally.
						const serverId = await this.crdtCreate(noteId, pushedPath);
						let effectiveId = noteId;
						try {
							// On ADOPT (serverId !== noteId) the path is already owned by a
							// live note under another id; remap so our body/edits address
							// that existing row. No Y.Doc was seeded under our local mint by
							// this genesis path (routeModify runs only AFTER, below, keyed
							// by effectiveId), so there is nothing to re-key — we simply
							// seed under the server id from the start.
							let consumed: string | null;
							if (
								serverId &&
								serverId !== noteId &&
								this.crdtEditorRebind &&
								this.isLiveBound(normalizePath(pushedPath))
							) {
								// ADOPT under a LIVE editor. The editor is bound to the MINT
								// doc, so ySync has propagated the user's live keystrokes
								// (including any typed during the crdt_create round-trip, and
								// any not yet flushed to disk) into the mint Y.Text — disk
								// (cachedRead) can lag them. Seed the serverId doc from the
								// mint's projected content via applyLocalEdit (DEFAULT origin,
								// so the update FORWARDS to the server — applyRemoteUpdate's
								// REMOTE_ORIGIN would keep the edits client-only and they'd
								// still be lost server-side). THEN rebind the editor off the
								// orphaned mint onto serverId: because serverId already holds
								// the content, bindTo's reconcile is a no-op (no visible
								// buffer change) and future keystrokes flow to serverId. THEN
								// retire the mint doc. Skips the disk-seed routeModify below:
								// re-diffing the (staler) disk snapshot into serverId would
								// clobber the just-transferred in-flight chars.
								// ponytail: two-lineage doubling is possible in a TRUE
								// content collision (local new-note text vs the server row's
								// pre-existing independent Y history) — accepted as
								// visible/recoverable over silent loss; the warn below makes
								// it diagnosable. TODO: full adopt-collision conflict
								// semantics is a focused follow-up.
								this.noteIdMap?.set(normalizePath(pushedPath), serverId);
								effectiveId = serverId;
								const mintText = await this.crdt.projectedText(noteId);
								const serverHadContent =
									typeof this.crdt.hasHistory === "function" &&
									(await this.crdt.hasHistory(serverId));
								consumed = await this.crdt.applyLocalEdit(serverId, mintText);
								if (mintText.length > 0 && serverHadContent) {
									rlog().warn(
										"crdt",
										`crdt_create ADOPT: transferred non-empty buffer into a non-empty server doc (possible two-lineage merge): ${pushedPath} ${noteId} -> ${serverId}`,
									);
								}
								rlog().info(
									"crdt",
									`crdt_create ADOPT: remapped + rebound live editor ${pushedPath} ${noteId} -> ${serverId}`,
								);
								// Keystroke-leak window: keystrokes landing in the mint doc
								// between the projectedText read above and this synchronous
								// detach are dropped by removeDoc. Microtask-scale; accepted.
								this.crdtEditorRebind(pushedPath);
								await this.crdt.removeDoc(noteId);
								this.crdtEnrollment?.reset(noteId);
							} else {
								if (serverId && serverId !== noteId) {
									this.noteIdMap?.set(normalizePath(pushedPath), serverId);
									rlog().info(
										"crdt",
										`crdt_create ADOPT: remapped ${pushedPath} ${noteId} -> ${serverId}`,
									);
									effectiveId = serverId;
								}
								// Seed the body under the effective id: the Y.Doc update
								// listener forwards it over the channel (crdt_msg). A LIVE
								// reread, not the frozen `content`, backs the manager's
								// stale-snapshot guard.
								consumed = await routeModify(
									{
										isMarkdown: true,
										noteId: effectiveId,
										readContent: () => this.app.vault.cachedRead(file),
									},
									this.crdt,
									MAX_CRDT_NOTE_BYTES,
								);
							}
							this.confirmNoteId(effectiveId);
							if (consumed !== null) {
								// Echo baseline from what the manager CONSUMED (mirrors the
								// CRDT-op branch above) so a later revert isn't hash-skipped.
								this.syncState.set(normalizePath(pushedPath), {
									...existing,
									hash: fnv1a(consumed),
								});
							} else {
								// ponytail: near-unreachable — a fresh in-cap note seedOnce's
								// its body (non-null). If a live remote storm made the seed
								// decline, the row exists + id is confirmed but no baseline is
								// recorded, so the next edit re-pushes over the CRDT-op branch
								// and delivers the body. Upgrade path: retry the seed here.
								rlog().warn(
									"crdt",
									`crdt_create ok but body seed declined (will deliver on next edit): ${pushedPath}`,
								);
							}
							// Vault-channel fan-out: enroll (STEP1) only for a live-bound note,
							// matching the CRDT-op branch. An idle note's seed already shipped
							// over the channel and it receives future updates over broadcast.
							if (this.isLiveBound(normalizePath(pushedPath))) {
								this.crdtEnrollment?.enroll(effectiveId);
							}
							devLog().log(
								"push",
								`crdt_create ok: ${pushedPath} (id=${effectiveId})`,
							);
							rlog().info(
								"push",
								`CRDT create ok: ${pushedPath} | id=${effectiveId}`,
							);
							return true;
						} catch (seedErr) {
							// crdtCreate already RESOLVED — the row exists server-side
							// (possibly under the remapped effectiveId). Unlike the
							// crdtCreate-rejection case below, we must NOT fall through to
							// the REST cascade: that would create a second row under the
							// stale mint id against a path the server already owns. Treat
							// this like the seed-declined (null) branch above: the row
							// exists, confirm it and return true — the body self-heals on
							// the next edit's CRDT-op push.
							rlog().warn(
								"crdt",
								`crdt_create ok but post-create step threw (row exists, self-heals on next edit): ${pushedPath} | ${String(seedErr)}`,
							);
							this.confirmNoteId(effectiveId);
							return true;
						}
					} catch (err) {
						// Boundary fallback, NOT error-swallowing: crdtCreate itself
						// REJECTED, so the row was never created over CRDT — the REST
						// create below still delivers the note. Do not rethrow — control
						// must reach the pushNote cascade.
						rlog().warn(
							"crdt",
							`crdt_create failed, falling back to REST create: ${pushedPath} | ${String(err)}`,
						);
					}
				}

				// (Echo suppression ran ABOVE the CRDT branch — `hash`/`existing`
				// are already in scope; see the hoisted gate, e2e test_37.)
				// Only pass trailing positional args when actually known — an explicit
				// trailing `undefined` still changes Function.arguments.length, which
				// several existing tests pin exactly via toHaveBeenCalledWith.
				// base_hash = the server content_hash we last synced (CAS against the
				// v0.5.642 gate); only the INITIAL push declares it — the conflict-flow
				// re-pushes below are deliberate overwrites and send none.
				const baseHash = existing?.serverHash;
				const resp =
					baseHash !== undefined
						? await this.api.pushNote(
								pushedPath,
								content,
								mtime,
								existing?.version,
								noteId ?? undefined,
								baseHash,
							)
						: noteId
							? await this.api.pushNote(
									pushedPath,
									content,
									mtime,
									existing?.version,
									noteId,
								)
							: await this.api.pushNote(
									pushedPath,
									content,
									mtime,
									existing?.version,
								);

				// 409 = version conflict — server has a newer version
				if ("conflict" in resp) {
					// Delete-wins: the server refused this create because the path was
					// deleted on another device within the window (identical content —
					// a stale re-push of the note we still hold). Converge by trashing
					// our local copy instead of re-pushing (which would resurrect it).
					// trashRemotelyDeleted marks the path so the trash's own delete
					// event doesn't echo-push.
					if (resp.reason === "recently_deleted") {
						rlog().info(
							"push",
							`recently_deleted — trashing local ${file.path} to honor remote delete`,
						);
						await this.trashRemotelyDeleted(file);
						return true;
					}

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
								this.noteIdMap?.set(np, mergeResp.note.id);
								this.confirmNoteId(mergeResp.note.id);
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
							this.noteIdMap?.set(np, forceResp.note.id);
							this.confirmNoteId(forceResp.note.id);
							this.recordParseStatus(
								forceResp.note.path ?? file.path,
								"note",
								forceResp.note.parse_status,
								forceResp.note.parse_reason,
							);
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
							this.noteIdMap?.set(np, serverNote.id);
							this.confirmNoteId(serverNote.id);
							this.recordParseStatus(
								serverNote.path,
								"note",
								serverNote.parse_status,
								serverNote.parse_reason,
							);
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
							this.noteIdMap?.set(np, mergeResp.note.id);
							this.confirmNoteId(mergeResp.note.id);
							this.recordParseStatus(
								mergeResp.note.path ?? file.path,
								"note",
								mergeResp.note.parse_status,
								mergeResp.note.parse_reason,
							);
						}
					}
					// skip and keep-both handled by returning false / not pushing
					return false;
				}

				// Server may sanitize the path (strip chars illegal on mobile).
				// If so, rename the local file to match.
				const serverPath = resp.note.path;
				const serverVersion = resp.note.version;
				if (file.path !== pushedPath) {
					// The file was renamed locally while this push was in flight.
					// The reply describes the OLD location: treating the path
					// mismatch as server sanitization would rename the file BACK
					// and silently lose the user's rename (#245, run 29392015897).
					// Record nothing under either path — handleRename already
					// tombstoned the old path and owns pushing the new one.
					devLog().log(
						"push",
						`sanitize-rename skipped: file moved during push (${pushedPath} → ${file.path})`,
					);
					rlog().info(
						"push",
						`Sanitize-rename skipped: file moved during push (${pushedPath} → ${file.path})`,
					);
				} else if (serverPath && serverPath !== pushedPath) {
					const localFile = this.app.vault.getFileByPath(pushedPath);
					if (localFile) {
						await this.app.vault.rename(localFile, serverPath);
						devLog().log(
							"push",
							`renamed: ${pushedPath} → ${serverPath} (server sanitized)`,
						);
						rlog().info(
							"push",
							`Renamed: ${pushedPath} → ${serverPath} (server sanitized)`,
						);
						new Notice(
							`Engram Sync: renamed "${pushedPath.split("/").pop()}" (unsupported characters)`,
						);
					}
					this.syncState.delete(normalizePath(pushedPath));
					this.syncState.set(normalizePath(serverPath), {
						hash,
						version: serverVersion,
						serverHash: resp.note.content_hash,
					});
					this.baseStore?.delete(normalizePath(pushedPath));
					if (serverVersion != null) {
						this.baseStore?.set(normalizePath(serverPath), content, serverVersion);
					}
					// Learn/confirm the id at its final (sanitized) path — the server
					// is authoritative even when client_id was sent.
					this.noteIdMap?.delete(normalizePath(pushedPath));
					this.noteIdMap?.set(normalizePath(serverPath), resp.note.id);
					this.refireEnrollmentOnFirstConfirm(resp.note.id, serverPath, content);
					this.confirmNoteId(resp.note.id);
				} else {
					this.syncState.set(normalizePath(file.path), {
						hash,
						version: serverVersion,
						serverHash: resp.note.content_hash,
					});
					if (serverVersion != null) {
						this.baseStore?.set(normalizePath(file.path), content, serverVersion);
					}
					this.noteIdMap?.set(normalizePath(file.path), resp.note.id);
					this.refireEnrollmentOnFirstConfirm(resp.note.id, file.path, content);
					this.confirmNoteId(resp.note.id);
				}
				if (file.path === pushedPath) {
					pushedNoteParse = {
						path: resp.note.path ?? pushedPath,
						parseStatus: resp.note.parse_status,
						parseReason: resp.note.parse_reason,
					};
				}
			}
			success = true;
			this.issues.clear(file.path);
			if (pushedNoteParse) {
				this.recordParseStatus(
					pushedNoteParse.path,
					"note",
					pushedNoteParse.parseStatus,
					pushedNoteParse.parseReason,
				);
			}
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
				console.error("Engram Sync: failed to push %s", file.path, e);
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
			// Delete the SNAPSHOT, not the live path — if the file moved during
			// the push, deleting file.path would leave the old path stuck in the
			// pushing set forever (blocking future pushes + WS echo handling).
			this.pushing.delete(pushedPath);
			this.releasePushSlot();
			// Keep path suppressed for a cooldown period after push completes.
			// WebSocket events often arrive after the push finishes, and without this
			// the echo suppression in handleStreamEvent would miss them.
			//
			// Gated on `success`: only a push that actually transmitted content (a
			// real POST or a CRDT emit) may open this window. The various no-op
			// exits (echo hash-skip for notes/attachments, failed pushes caught
			// above) leave `success` false — nothing reached the server, so there is
			// no self-echo to suppress. Opening the window on those no-ops used to
			// let it swallow a legitimately-arriving second remote update within the
			// cooldown (Engram#944).
			// Snapshot path, not file.path: the self-echo arrives under the path we
			// SENT. After a mid-flight rename, marking the live path would leave the
			// old path's echo unsuppressed (recreating the renamed-away file) and
			// wrongly swallow a genuine remote update to the new path (Engram#944
			// class). Mirrors the batch path, which marks e.pushedPath.
			if (success) this.markRecentlyPushed(pushedPath);
			this.emitStatus();
		}
		return success;
	}

	/** True iff the issue store already has a parked *informational* entry for this
	 *  path (e.g. backend returned 402 attachments_disabled or 402 storage-quota on a
	 *  prior push). Used to short-circuit re-push attempts without hitting the
	 *  network — survives plugin reloads because the issue store is persisted. */
	private hasInformationalIssue(path: string): boolean {
		for (const issue of this.issues.all()) {
			if (issue.path === path && issueDisposition(issue.category) === "informational")
				return true;
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
		// Stash for the terminal progress event's `skipped` tally — survives the
		// reset above (which the once-per-session toast guard below relies on).
		this.lastBatchSkipped = count;
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

	/** Mark `path` in a TTL map, resetting any pending expiry. Shared body of
	 *  the three echo-suppression marks below; destroy() sweeps the same maps. */
	private markWithTtl(map: Map<string, number>, path: string, ms: number): void {
		const existing = map.get(path);
		if (existing) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			map.delete(path);
		}, ms);
		map.set(path, timer);
	}

	/** Trash a file whose deletion was decided REMOTELY (WS delete event, pull
	 *  tombstone, relocation/orphan/bootstrap cleanup). Marks the path first so
	 *  the vault 'delete' event this trash fires skips the server push in
	 *  handleDelete — every sync-applied deletion must route through here, or
	 *  its echo-push can tombstone a note recreated at the path since. */
	private async trashRemotelyDeleted(file: TAbstractFile): Promise<void> {
		this.markWithTtl(this.remotelyDeleted, file.path, ECHO_COOLDOWN_MS);
		await this.app.fileManager.trashFile(file);
	}

	/** Suppress WebSocket echoes for a path for ECHO_COOLDOWN_MS after push. */
	private markRecentlyPushed(path: string): void {
		this.markWithTtl(this.recentlyPushed, path, ECHO_COOLDOWN_MS);
	}

	/** Check if a path was recently pushed (for echo suppression). */
	isRecentlyPushed(path: string): boolean {
		return this.recentlyPushed.has(path);
	}

	/** Suppress the stream echo of a wipeRemote delete for this path. Marked
	 *  BEFORE the REST delete is issued — the fanout can arrive faster than
	 *  the HTTP response. Kept on error too: a client-side timeout can mask a
	 *  delete that actually landed, and the TTL bounds the false-positive. */
	private markWipedRemote(path: string): void {
		this.markWithTtl(this.wipedRemote, path, WIPE_ECHO_COOLDOWN_MS);
	}

	/** Suppress the handleModify echo of a flushFromCrdt disk write for
	 *  ECHO_COOLDOWN_MS. Separate from recentlyPushed so a post-push cooldown
	 *  never swallows a genuine local edit. */
	private markRecentlyFlushed(path: string): void {
		this.markWithTtl(this.recentlyFlushed, path, ECHO_COOLDOWN_MS);
	}

	/** MINT REFUSAL (backend #972, PRs #216/#217) — the single decision both
	 *  mint seams route through: pushFile and pushNotesViaBatch's flushChunk
	 *  must honor identical ownership invariants
	 *  (docs/context/crdt-batch-push-duplication.md). A mint means "brand-new,
	 *  never-synced local note". A file this engine itself recently flushed to
	 *  disk (flushFromCrdt → recentlyFlushed) can never be that — the engine
	 *  only writes server-known content. If its id binding is gone, a
	 *  concurrent relocation/tombstone evicted it (moveIfIdRelocated re-keys
	 *  the map + drops the syncState baseline BEFORE trashing the old file,
	 *  and the push runs inside that window). Minting here REST-creates the
	 *  renamed-away old path server-side under a fresh id — a live row no
	 *  tombstone will ever remove; every device then re-materializes it
	 *  forever. Defer instead: skip the push (not fail) — the relocation/pull
	 *  owns the path's fate, and the next reconcile/fullSync retries once it
	 *  lands.
	 *  ponytail: recentlyFlushed's 5s cooldown is the guard's window — a push
	 *  delayed past it escapes; debounce is 500ms, fine. */
	private shouldDeferMint(path: string): boolean {
		return (
			!!this.noteIdMap &&
			!this.noteIdMap.get(path) &&
			this.recentlyFlushed.has(normalizePath(path))
		);
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

	/** Free `noteId`'s Y.Doc after a remote update has been applied and its head
	 *  durably recorded (P3, plugin #232-series). Idle notes are not
	 *  channel-enrolled under the fan-out model (P2 removed lazyEnrollment) —
	 *  a doc opened just to apply a cold/pushed convergence delta is transient,
	 *  so leaving it resident forever is unbounded memory growth. `closeDoc`
	 *  does not `clearData()`, so the IndexedDB store persists; the next apply
	 *  re-opens via `CrdtManager.entry()`, which awaits `whenSynced` and
	 *  rehydrates the full prior state before merging the next delta — no data
	 *  loss. Re-checks `isLiveBound` AFTER the caller's awaits: the user may
	 *  have opened the note in the editor while the apply was in flight, in
	 *  which case that room now owns the doc's lifecycle and it must stay
	 *  resident. */
	private hibernateIfIdle(path: string, noteId: string): void {
		if (!this.crdt) return;
		if (this.isLiveBound(normalizePath(path))) return;
		// Best-effort memory reclamation: a failure to free the doc must not throw
		// into the never-throw convergence loop nor downgrade an already-recorded
		// head. The doc simply stays resident (bounded; retried next hibernate).
		try {
			this.crdt.closeDoc(noteId);
		} catch (e) {
			devLog().log("crdt", `hibernateIfIdle: closeDoc ${noteId} failed — ${errMsg(e)}`);
		}
	}

	/** Shared per-note convergence apply used by BOTH coldReceive (REST
	 *  getUpdates) and catchupViaSocket (crdt_catchup_delta). The ONLY difference
	 *  between the callers is how the delta bytes are obtained — injected as
	 *  `fetchDelta`. ALL guards live here so the socket path inherits them:
	 *  confirmed/live-bound/cost gates, the history-less adopt branch (#234),
	 *  disk-drift capture (BUG 2 / #3), the pending-gap heal, head advance, and
	 *  hibernate. Isolated: logs its own per-note failure and never throws.
	 *  Returns "converged" only when the head was advanced for delivered data;
	 *  "skipped" for a gate short-circuit; "failed" for a caught error / stalled
	 *  adopt. */
	private async convergeNoteFromDelta(
		path: string,
		noteId: string,
		serverHead: string,
		fetchDelta: (
			noteId: string,
			sinceB64: string,
		) => Promise<{ update: Uint8Array; head: string }>,
	): Promise<"converged" | "skipped" | "failed"> {
		if (!this.crdt) return "skipped";
		if (!this.isNoteConfirmed(noteId)) return "skipped";
		if (this.isLiveBound(normalizePath(path))) return "skipped"; // live channel owns it
		if (this.getCrdtHead(path) === serverHead) return "skipped"; // cost gate: unchanged
		try {
			// A history-LESS doc (feed-synced, never in IDB) doubles on a disk-drift
			// seed and can't reconstruct from a delta — adopt full server state +
			// reconcile drift instead (#234). Default to history-full when the
			// manager lacks hasHistory (partial test doubles) → pre-#234 behavior.
			const historyFull =
				typeof this.crdt.hasHistory === "function"
					? await this.crdt.hasHistory(noteId)
					: true;
			if (!historyFull) {
				const adopted = await this.adoptHistoryLessNote(path, noteId);
				if (adopted === null) return "failed"; // adopt stalled — retry next poll
				this.setCrdtHead(path, adopted);
				this.hibernateIfIdle(path, noteId);
				return "converged";
			}
			// Merge any un-pushed disk drift into the Y.Doc first, so the fetched
			// remote delta merges with it instead of overwriting it (BUG 2 / #3).
			// Seeding before encodeStateVector keeps `since` consistent with the
			// now-updated local state.
			await this.captureDiskDriftBeforeRemote(path, noteId);
			// Manager is keyed by noteId (docId identity) — pass noteId, NOT path.
			const since = toB64(await this.crdt.encodeStateVector(noteId));
			const { update, head } = await fetchDelta(noteId, since);
			await this.crdt.applyRemoteUpdate(noteId, update);
			// Gap heal (parity with applyPushedNoteUpdate): if the applied delta
			// references state this device missed while off the channel, Yjs PENDS
			// it — the doc has NOT reached `head`. Advancing crdtHead anyway would
			// make the cost gate skip the note forever. Re-fetch from our REAL state
			// vector and advance only to a head the doc actually reached.
			const gapped =
				typeof this.crdt.hasPendingGap === "function" &&
				(await this.crdt.hasPendingGap(noteId));
			if (gapped) {
				const since2 = toB64(await this.crdt.encodeStateVector(noteId));
				const { update: full, head: fullHead } = await fetchDelta(noteId, since2);
				await this.crdt.applyRemoteUpdate(noteId, full);
				if (!(await this.crdt.hasPendingGap(noteId))) this.setCrdtHead(path, fullHead);
			} else {
				this.setCrdtHead(path, head); // crdtHead persists under the vault path
			}
			// Idle notes are not channel-enrolled under the fan-out model (P2
			// removed lazyEnrollment) — this doc was opened just for this
			// convergence, so free it now that the head is durably recorded. A note
			// that became live-bound during the awaits above stays resident
			// (hibernateIfIdle re-checks).
			this.hibernateIfIdle(path, noteId);
			return "converged";
		} catch (e) {
			// Isolated: log, leave crdtHead unadvanced, retry next poll.
			devLog().log("crdt", `convergeNoteFromDelta: ${path} failed — ${errMsg(e)}`);
			rlog().warn("crdt", `converge failed for ${path}: ${errMsg(e)}`);
			return "failed";
		}
	}

	/** Background convergence for COLD (confirmed, not live-bound) CRDT notes.
	 *  Diffs the server head-index against the persisted per-note crdtHead and,
	 *  for advanced notes, pulls the Yjs delta and applies it (echo-guarded disk
	 *  flush via applyRemoteUpdate). Best-effort: inert on pre-Phase-1 backends,
	 *  isolates per-note failures, and never throws. Returns notes converged. */
	async coldReceive(): Promise<number> {
		if (!this.settings.enableCrdt || !this.crdt || !this.crdtOpsAvailable()) return 0;
		let heads: Record<string, string>;
		try {
			({ heads } = await this.api.getVaultHeads());
		} catch (e) {
			devLog().log("crdt", `coldReceive: getVaultHeads failed — ${errMsg(e)}`);
			return 0;
		}
		let converged = 0;
		for (const [noteId, serverHead] of Object.entries(heads)) {
			const path = this.noteIdMap?.pathForId(noteId) ?? null;
			if (!path) continue; // not locally known — first-discovery is pull()'s job
			const outcome = await this.convergeNoteFromDelta(
				path,
				noteId,
				serverHead,
				(id, since) => this.api.getUpdates(id, since),
			);
			if (outcome === "converged") converged++;
		}
		if (converged > 0) {
			devLog().log("crdt", `coldReceive: converged ${converged} cold note(s)`);
			this.emitStatus();
		}
		return converged;
	}

	/** Socket-native vault catch-up (Plan B1, Task 5): fetch server heads over
	 *  `crdt_catchup_heads`, and for each note whose stored crdtHead differs,
	 *  pull the missing delta from the client's state vector over
	 *  `crdt_catchup_delta` and apply it. Socket twin of `coldReceive` — same
	 *  cost-gate (converged notes never open a doc) and same isolation (a
	 *  per-note failure is logged and skipped, never thrown into the caller, so
	 *  one bad note can't stall the vault). Unset deps / no crdt manager ->
	 *  no-op. */
	private crdtCatchupHeads: (() => Promise<{ heads: Record<string, string> }>) | null = null;
	private crdtCatchupDelta:
		| ((docId: string, sv: string) => Promise<{ doc_id: string; b64: string; head: string }>)
		| null = null;

	setCrdtCatchup(
		heads: () => Promise<{ heads: Record<string, string> }>,
		delta: (
			docId: string,
			sv: string,
		) => Promise<{ doc_id: string; b64: string; head: string }>,
	): void {
		this.crdtCatchupHeads = heads;
		this.crdtCatchupDelta = delta;
	}

	async catchupViaSocket(): Promise<void> {
		if (!this.crdtCatchupHeads || !this.crdtCatchupDelta || !this.crdt) return;
		let heads: Record<string, string>;
		try {
			({ heads } = await this.crdtCatchupHeads());
		} catch (e) {
			// Whole-vault heads fetch failed (socket drop, etc). Match coldReceive:
			// log and return so the method honors its never-throw-into-caller contract.
			rlog().warn("crdt", `socket catchup: heads fetch failed — ${errMsg(e)}`);
			return;
		}
		for (const [noteId, serverHead] of Object.entries(heads)) {
			const path = this.noteIdMap?.pathForId(noteId);
			if (!path) continue; // not locally known — first-discovery is pull()'s job
			// Same guarded per-note apply as coldReceive — only the delta fetcher
			// differs (crdt_catchup_delta over the socket vs REST getUpdates). This
			// is how the socket path inherits the confirmed/live-bound gates, the
			// history-less adopt (#234), disk-drift capture (#3), and the gap heal.
			await this.convergeNoteFromDelta(path, noteId, serverHead, (id, sv) =>
				this.crdtCatchupDelta!(id, sv).then((x) => ({
					update: fromB64(x.b64),
					head: x.head,
				})),
			);
		}
	}

	/** Apply a Yjs update fanned out over the vault channel (`note_yjs_update`)
	 *  to an IDLE note — one with no dedicated CRDT room open right now. Mirrors
	 *  coldReceive's per-note apply, minus the REST getUpdates fetch (the update
	 *  bytes arrive directly in the event, not fetched separately). Skips a note
	 *  the live editor's own room owns (isLiveBound) — that room already applies
	 *  its own crdt_msg frames, so this would be a harmless-but-wasteful double
	 *  apply; skipping it matches Relay's `if (isActive) return`. Skips a note
	 *  not yet confirmed (no server row known) or one this device hasn't mapped
	 *  to a path (first-discovery is pull()'s job, same as coldReceive). Frees
	 *  the doc after a successful apply (hibernateIfIdle) — same reasoning as
	 *  coldReceive. Best-effort: isolates its own failure, never throws. */
	async applyPushedNoteUpdate(noteId: string, update: Uint8Array, head: string): Promise<void> {
		if (!this.crdt) return;
		const path = this.noteIdMap?.pathForId(noteId) ?? null;
		if (!path) return; // not locally known — first-discovery is pull()'s job
		// A fan-out for a mapped note is the server pushing that note's bytes —
		// authoritative proof it has a row. So confirm it here rather than dropping
		// it. Without this, a reconnect (clearConfirmedNoteIds un-confirms every
		// note for write-routing safety) opens a window where fanned-out appends are
		// silently skipped until a slow re-confirmation — the >30s missed-open case
		// (test_web_edit_reaches_obsidian_that_missed_room_open).
		this.confirmNoteId(noteId);
		if (this.isLiveBound(normalizePath(path))) {
			// The live room owns open notes — but say so. Silent discards made the
			// 2026-07-14 deaf-note incident invisible: every fan-out frame for the
			// stuck note was dropped here with no trace. info-level: stored in the
			// client_logs table (queryable per device), not shipped to Loki.
			rlog().info("crdt", `fan-out skip (live-bound, room owns it): ${path}`);
			return;
		}
		try {
			// A history-LESS doc (feed-synced, never in IDB) must NOT seed disk drift
			// (doubles the baseline) nor apply the bare delta (incomplete). Adopt full
			// server state + reconcile drift instead (#234). Default to history-full
			// when the manager lacks hasHistory (partial test doubles) so the existing
			// mock-based tests keep the pre-#234 behavior.
			const historyFull =
				typeof this.crdt.hasHistory === "function"
					? await this.crdt.hasHistory(noteId)
					: true;
			if (historyFull) {
				// Merge any un-pushed disk drift into the Y.Doc first, so this remote
				// apply merges with it instead of overwriting it (BUG 2).
				await this.captureDiskDriftBeforeRemote(path, noteId);
				await this.crdt.applyRemoteUpdate(noteId, update);
				// Gap heal: if the applied delta references state this device missed
				// while offline (another device edited the note while this one was off
				// the channel), Yjs PENDS it — the doc has NOT reached `head`.
				// Advancing crdtHead to `head` anyway would make coldReceive's cost
				// gate (getCrdtHead === serverHead → skip) skip the note, so the gap
				// would never heal (the note converges only much later via an unrelated
				// full pull — the >30s missed-open reconnect case). Pull the full delta
				// since our REAL state vector to fill the gap now, and advance crdtHead
				// only to a head the doc has actually reached.
				const hadGap =
					typeof this.crdt.hasPendingGap === "function" &&
					(await this.crdt.hasPendingGap(noteId));
				if (hadGap) {
					const since = toB64(await this.crdt.encodeStateVector(noteId));
					const { update: full, head: fullHead } = await this.api.getUpdates(
						noteId,
						since,
					);
					await this.crdt.applyRemoteUpdate(noteId, full);
					// Still gapped after the full pull → leave crdtHead unadvanced so
					// coldReceive retries; else record the head we converged to.
					if (!(await this.crdt.hasPendingGap(noteId))) {
						this.setCrdtHead(path, fullHead);
					}
				} else {
					this.setCrdtHead(path, head); // crdtHead persists under the vault path
				}
			} else {
				const adopted = await this.adoptHistoryLessNote(path, noteId);
				if (adopted === null) return; // adopt failed — leave head unadvanced, retry
				this.setCrdtHead(path, adopted);
			}
			this.hibernateIfIdle(path, noteId);
		} catch (e) {
			// Isolated: log, leave crdtHead unadvanced — the next coldReceive poll
			// (or a subsequent push) will retry convergence. Not freed: a failed
			// apply is left for retry, not hibernated.
			devLog().log("crdt", `applyPushedNoteUpdate: ${path} failed — ${errMsg(e)}`);
			rlog().warn("crdt", `Vault-channel update apply failed for ${path}: ${errMsg(e)}`);
		}
	}

	/** Deterministic catch-up for a diverged LIVE-BOUND note: pull the delta
	 *  since our real state vector over REST and apply it to the live Y.Doc —
	 *  the editor binding paints it, no disk write. Returns true only when the
	 *  doc verifiably reached server state (applied, no pending gap), so the
	 *  caller records convergence for delivered data ONLY. Best-effort:
	 *  isolates its own failure, never throws. */
	private async restConvergeLiveBound(path: string, noteId: string): Promise<boolean> {
		if (!this.crdt) return false;
		try {
			const since = toB64(await this.crdt.encodeStateVector(noteId));
			const { update, head } = await this.api.getUpdates(noteId, since);
			await this.crdt.applyRemoteUpdate(noteId, update);
			const gapped =
				typeof this.crdt.hasPendingGap === "function" &&
				(await this.crdt.hasPendingGap(noteId));
			if (gapped) {
				rlog().warn(
					"crdt",
					`REST converge: pending gap remains for ${path} — retrying next poll`,
				);
				return false;
			}
			this.setCrdtHead(path, head);
			rlog().info("crdt", `REST converge: live-bound ${path} caught up to head=${head}`);
			return true;
		} catch (e) {
			rlog().warn("crdt", `REST converge failed for ${path}: ${errMsg(e)}`);
			return false;
		}
	}

	/** Cheap mid-session divergence heal for the just-opened note (rework #6 —
	 *  restores the coverage the removed `verifyConvergenceOnOpen` had, a note
	 *  that missed a live announce/STEP2 during a fan-out storm, WITHOUT its
	 *  per-open synchronous manifest-hash check + forced re-handshake, the
	 *  #203 false-fire that caused the open-path lag). Fire-and-forget from
	 *  file-open: a single note, one delta-since-our-real-state-vector via the
	 *  existing guarded `restConvergeLiveBound` — empty (near-no-op) when
	 *  already converged. Live-bound-only first cut (design decision iii): a
	 *  just-opened note is live-bound after CrdtLiveViews.refresh(), so this
	 *  covers the real case without a vault-wide heads fetch on every open; an
	 *  idle note is still covered by reconnect catch-up (#5). Never throws. */
	async healNoteOnOpen(path: string): Promise<void> {
		if (!this.settings.enableCrdt || !this.crdt || !this.crdtOpsAvailable()) return;
		const normalized = normalizePath(path);
		const noteId = this.noteIdMap?.get(normalized) ?? null;
		if (!noteId || !this.isNoteConfirmed(noteId)) return;
		if (!this.isLiveBound(normalized)) return; // idle notes heal on reconnect (#5)
		try {
			await this.restConvergeLiveBound(normalized, noteId);
		} catch (e) {
			rlog().warn("crdt", `healNoteOnOpen ${path}: ${errMsg(e)}`);
		}
	}

	/** Pull remote changes and apply to the vault via the ordered cursor feed.
	 *
	 *  No persisted cursor → a manifest-authoritative bootstrap (reconcile local
	 *  files against the server, then a genesis cursor pull delivers content).
	 *  A persisted cursor → resume the ordered feed from that position. A 410
	 *  (history compacted past our cursor; PR D) surfaces as HistoryExpiredError
	 *  → drop the cursor and re-bootstrap.
	 *
	 *  NOTE: `lastSync` is intentionally left untouched here. It is no longer the
	 *  pull watermark (the cursor is), but `fullSync` still snapshots it as the
	 *  pre-pull push boundary and it's retained for rollback to the legacy feed.
	 *
	 *  Explicit empty-folder markers ride a SEPARATE endpoint (not the cursor
	 *  feed), so `syncExplicitFolders()` is still called post-apply — it both
	 *  materializes server-marked empty folders and hydrates the
	 *  `explicitFolders` set that `removeEmptyFolders` consults to avoid trashing
	 *  folders intentionally kept empty on another device. Best-effort/non-fatal. */
	async pull(emitProgress = false): Promise<number> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "pull short-circuited — gate closed");
			return 0;
		}
		// Re-entry: a pull is already running. Record the request and bail —
		// the finally below re-runs one pull once the current one settles, so a
		// reconnect catch-up that lands mid-pull isn't dropped (#646). Returns 0
		// immediately; callers (e.g. onStatusChange) don't await the result.
		if (this.pulling) {
			this.pullPending = true;
			return 0;
		}
		this.pulling = true;
		this.lastError = "";
		this.emitStatus();
		rlog().info("pull", `Pull started cursor=${this.getSyncCursor() ?? "(bootstrap)"}`);
		try {
			// Self-heal a vault swap (e.g. OAuth re-login) BEFORE reading the
			// cursor: the cursor is per-vault, and a stale cursor from the prior
			// vault would query the new vault for seq > <foreign seq> and silently
			// return nothing (the reconnect-catch-up bug). invalidateIfVaultChanged
			// clears syncState + the cursor on a vault change so we re-bootstrap.
			// pull() is the only sync entry the reconnect catch-up uses, so the
			// check must live here (not just in fullSync/pullAll).
			//
			// GATED so it only runs when it would actually act — a genuine vault
			// mismatch with a cursor to invalidate. When the vault is unchanged
			// (the common case, incl. offline-queue recovery) this is skipped
			// entirely, so it adds no async tick / timing perturbation to the
			// hot recovery path.
			if (
				this.getSyncCursor() !== null &&
				this.syncStateVaultId !== null &&
				this.settings.vaultId != null &&
				this.syncStateVaultId !== this.settings.vaultId
			) {
				await this.invalidateIfVaultChanged();
			}

			let applied: number;
			if (!this.getSyncCursor()) {
				applied = await this.bootstrap(emitProgress);
			} else {
				try {
					applied = await this.pullViaCursor(
						this.getSyncCursor() ?? undefined,
						emitProgress,
					);
				} catch (e) {
					if (e instanceof HistoryExpiredError) {
						rlog().warn("pull", "HISTORY_EXPIRED — re-bootstrapping");
						this.setSyncCursor(null);
						await this.saveData({ syncCursor: null });
						applied = await this.bootstrap(emitProgress);
					} else {
						throw e;
					}
				}
			}

			// Empty-folder markers are not in the cursor feed — sync them via their
			// own endpoint. Non-fatal: a folder-sync failure must not fail the pull.
			try {
				await this.syncExplicitFolders();
			} catch (e) {
				rlog().error(
					"pull",
					`Explicit-folder sync failed (non-fatal): ${errMsg(e)}`,
					e instanceof Error ? e.stack : undefined,
				);
			}

			// Phase 3a: piggyback cold-receive on the completed pull so closed
			// CRDT notes converge in the background. Best-effort — a failure here
			// must never fail the pull.
			await this.coldReceive().catch((e) => {
				devLog().log("crdt", `coldReceive threw (ignored) — ${errMsg(e)}`);
			});

			return applied;
		} catch (e) {
			// biome-ignore lint/suspicious/noConsole: error boundary
			console.error("Engram Sync: pull failed", e);
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
			// Drain a request that arrived mid-pull. One follow-up covers any
			// number of coalesced requests; if that rerun itself races another
			// pull(), the flag is set again and we loop once more — bounded,
			// since it only re-runs when a request actually landed.
			if (this.pullPending) {
				this.pullPending = false;
				void this.pull();
			}
		}
	}

	/** Ceiling on how long an edit may sit in pendingPostPullPushes while a
	 *  pull runs (issue #244): a long post-swap pull chain — or a pull wedged
	 *  on a half-open connection — kept `pulling` true for 60s+, and deferred
	 *  edits never pushed, so sync looked dead. Instance field so tests can
	 *  shrink it. */
	postPullMaxDeferMs = 5_000;
	private postPullDrainTimer: number | null = null;

	/** Arm a one-shot bounded drain for the deferral above. Draining early is
	 *  safe: pushFile's echo-hash gate filters sync-write echoes either way —
	 *  the deferral only saves redundant echo traffic, it is not a correctness
	 *  gate. The normal end-of-pull drain clears this timer. */
	private schedulePostPullDrain(): void {
		if (this.postPullDrainTimer !== null) return;
		this.postPullDrainTimer = window.setTimeout(() => {
			this.postPullDrainTimer = null;
			void this.flushPostPullPushes();
		}, this.postPullMaxDeferMs);
	}

	/** Push any files that were modified during pull. Echo suppression will
	 *  naturally skip sync-engine writes; only real user edits get pushed. */
	private async flushPostPullPushes(): Promise<void> {
		if (this.postPullDrainTimer !== null) {
			window.clearTimeout(this.postPullDrainTimer);
			this.postPullDrainTimer = null;
		}
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
					await this.trashRemotelyDeleted(file);
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
					current: applied,
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
					current: applied,
					total,
					failed,
					currentPath: lastPath,
				});
			}

			this.onSyncProgress?.({ phase: "complete", current: applied, total, failed });

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

		const isAttachment = event.kind === "attachment";

		// Never trust inline-EMPTY content when a content_hash is present (e2e
		// test_34 "received=yes materialized=no"): the folder-rename cascade
		// broadcasts meta-projected rows whose nil content the backend fabricates
		// as "" while content_hash carries the REAL body hash. Taking "" as
		// authoritative materializes a 0-byte file whose CAS seed (hash("") +
		// real serverHash) then reads "converged" to every backstop, so the empty
		// file sticks forever. Strip the inline body here so EVERY consumer below
		// (CRDT first-delivery and the legacy inline-apply) falls through to its
		// fetch branch and writes verified bytes. A genuinely empty note costs
		// one GET — once, per session: content_hash is a per-user HMAC we cannot
		// derive, but it IS deterministic, so after one fetch proves a hash maps
		// to "" (emptyContentHash), inline "" beside that exact hash is
		// trustworthy and skips the roundtrip. A stale learned value (DEK
		// rotation, account swap) simply stops matching and falls back to the
		// GET — the failure direction is a wasted fetch, never a 0-byte write.
		if (
			event.event_type === "upsert" &&
			event.content === "" &&
			event.content_hash &&
			event.content_hash !== this.emptyContentHash
		) {
			rlog().info("ws", `Inline-empty body distrusted, will fetch: ${event.path}`);
			event.content = undefined;
		}

		// Id-keyed relocation must run BEFORE echo suppression: an echo-skipped
		// upsert at the NEW path would otherwise leave this device's CRDT room
		// bound to the OLD path, which then perpetually resurrects it (e2e
		// test_10). moveIfIdRelocated is idempotent — it no-ops unless the id
		// already maps to a different local path. Gated on a known id
		// (attachments aren't keyed).
		if (event.event_type === "upsert" && !isAttachment && event.id) {
			// eventTs must be on the SAME clock base as the pull path's relocationTs
			// (Date.parse(c.updated_at), server clock) — NOT event.timestamp, which
			// is Date.now() at client receipt (channel.ts). Cross-base comparison
			// fails open: client-receipt time is almost always newer than a past
			// server updated_at, so a stale backward WS relocation would win over
			// (and then block the corrective re-pull from) a just-applied forward
			// one. NaN (missing/malformed updated_at) becomes undefined, same as
			// the pull path, which disables the staleness guard rather than
			// comparing garbage.
			const wsRelocationTs = Date.parse(event.updated_at ?? "");
			await this.moveIfIdRelocated(
				event.id,
				event.path,
				Number.isNaN(wsRelocationTs) ? undefined : wsRelocationTs,
			);
		}

		// Echo suppression — skip UPSERT events for notes we're currently pushing
		// or have recently finished pushing (the server broadcasts our own push
		// back to us). DELETE is exempt: a delete is never an echo of a content
		// push, and suppressing it lets a renamed-away old path linger forever
		// when the receiver resurrected it into the push set (id-keyed rename —
		// its CRDT room is still bound to the old path, so channel traffic
		// re-pushes it). A redundant delete just no-ops in the delete branch below.
		if (event.event_type !== "delete") {
			if (this.pushing.has(event.path)) {
				rlog().info("ws", `Echo skip (pushing): ${event.path}`);
				return;
			}
			if (this.recentlyPushed.has(event.path)) {
				rlog().info("ws", `Echo skip (recently pushed): ${event.path}`);
				return;
			}
		}

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
			// Origin-attributed self-echo (#970): the server stamps the REST
			// caller's X-Device-Id into delete broadcasts. A delete WE caused
			// must never be re-applied to our own vault. Upserts keep their
			// existing suppression (pushing/recentlyPushed/hash-skip) — their
			// echoes also drive id-relocation, so they are not dropped here.
			if (this.deviceId && event.device_id === this.deviceId) {
				rlog().info("ws", `Echo skip (own device): ${event.path}`);
				return;
			}
			// Self-echo of a replace-remote wipe: WE deleted this path on the
			// server moments ago (wipeRemote) and are about to re-upload it.
			// The general delete-exemption from echo suppression must not let
			// our own wipe come back and trash the vault (2026-07-08 incident).
			// Kept alongside the device_id drop above — pre-#970 backends
			// (self-host updates on its own cadence) send no device_id.
			// A delete ATTRIBUTED to another device is provably not our echo:
			// it bypasses the wipe guard, or B's real concurrent delete would
			// be swallowed for the whole TTL and resurrected by our re-push.
			const foreignAttributed = !!event.device_id && event.device_id !== this.deviceId;
			if (this.wipedRemote.has(normalized) && !foreignAttributed) {
				rlog().info("ws", `Echo skip (wipe-remote): ${event.path}`);
				return;
			}
			const existing = this.app.vault.getFileByPath(normalized);
			if (existing) {
				// A WS delete is unordered and can be a STALE echo — e.g. of our own
				// delete→recreate at the same path (the recreate re-established a live
				// note here). If this path canonically holds a CONFIRMED note we own,
				// trashing now could destroy the recreated file, and the delete is
				// ambiguous (stale echo vs. a real remote delete). Defer to the
				// seq-ordered pull, which reconciles delete-vs-recreate correctly.
				// A renamed-away old path is handled either way (test_10): once
				// moveIfIdRelocated has run it is non-canonical (its id resolves to the
				// new path) and is trashed here; if the delete arrives FIRST it is still
				// canonical and defers, and the pull's moveIfIdRelocated trashes it — no
				// duplicate leaks in either ordering.
				const ownedId = this.noteIdMap?.get(normalized) ?? null;
				if (
					ownedId &&
					this.isNoteConfirmed(ownedId) &&
					this.noteIdMap?.pathForId(ownedId) === normalized
				) {
					rlog().info("ws", `Delete deferred to pull (live note at path): ${event.path}`);
					void this.pull();
					return;
				}
				await this.trashRemotelyDeleted(existing);
				await this.removeEmptyFolders(normalized);
				this.syncState.delete(normalized);
				this.baseStore?.delete(normalized);
			}
			// Tear down the CRDT doc for md paths regardless of whether the file
			// existed locally. The ghost lineage in IDB/memory must be cleared so a
			// note recreated at the same path starts fresh (P1-3). Non-md paths are
			// never CRDT-managed — skip them to avoid spurious removeDoc overhead.
			// Keyed by note_id now — resolve + clear the mapping before tearing down
			// (nothing to tear down if this device never learned an id for it).
			if (normalized.endsWith(".md")) {
				const crdtNoteId = this.noteIdMap?.get(normalized) ?? null;
				this.noteIdMap?.delete(normalized);
				if (crdtNoteId) {
					await this.crdt?.removeDoc(crdtNoteId);
					this.crdtEnrollment?.reset(crdtNoteId);
				}
			}
			return;
		}

		if (event.event_type === "upsert") {
			// Id-keyed relocation already ran above (hoisted before echo
			// suppression so an echo-skipped rename still relocates the room).
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
				} else if (
					this.crdt &&
					event.path.endsWith(".md") &&
					(event.id ?? this.noteIdMap?.get(event.path))
				) {
					// C1: CRDT owns markdown content for this session — the crdt: topic
					// delivers updates via CrdtChannel/flushFromCrdt. The legacy
					// note_changed/upsert path must not double-write the body or run
					// threeWayMerge/ConflictModal, which would create a feedback loop
					// (disk write re-enters handleModify → applyLocalEdit).
					// Vault-channel fan-out: an IDLE note received here converges
					// room-free over the note_yjs_update broadcast
					// (applyPushedNoteUpdate) or the pull backstop — enrolling a room
					// for it would defeat the fan-out isolation and re-open the connect
					// storm (a room per note that ever received a live edit). Enroll
					// ONLY when the note is live-bound (open in the editor), matching the
					// pull-path discovery gate (isLiveBound) at applyChange below.
					// Rooms are keyed by note_id, so resolve it: prefer the id the
					// server's broadcast now carries (a device that has NEVER seen this
					// note learns it here), else the locally-known sidecar mapping. Learn
					// + confirm it so subsequent local edits route through CRDT. If
					// NEITHER source yields an id we don't reach this branch — control
					// falls through to the legacy apply below, which materializes the
					// note directly (pre-id-keying behavior; without this fallback a
					// never-seen note is received but silently never written to disk).
					const noteId = (event.id ?? this.noteIdMap?.get(event.path)) as string;
					// STALE-PATH GUARD (round 2, e2e test_34 mechanism): moveIfIdRelocated
					// above already decided whether `event.path` is this id's current
					// canonical path (it declines a stale/out-of-order relocation — see
					// its own staleness gate). If the map now disagrees with this event's
					// path, learning it here would silently undo that decision: it would
					// re-key the map BACKWARD to the stale path (a bijection `set()`
					// evicts the correct, just-established mapping) and materialize a
					// stale-path file the relocation guard just decided not to touch.
					// Skip path-learning/materialize entirely for a stale event; the
					// canonical mapping (and file) already in place stands.
					const canonicalPath = this.noteIdMap?.pathForId(noteId) ?? null;
					if (
						canonicalPath !== null &&
						normalizePath(canonicalPath) !== normalizePath(event.path)
					) {
						rlog().info(
							"ws",
							`Stale-path upsert ignored for ${noteId}: canonical=${canonicalPath} event=${event.path}`,
						);
					} else {
						this.noteIdMap?.set(event.path, noteId);
						this.confirmNoteId(noteId);
						if (this.isLiveBound(normalizePath(event.path))) {
							this.crdtEnrollment?.enroll(noteId);
						}
						// SEED the CAS base from the event when none exists — the CRDT
						// delivery that writes the body never advances serverHash (issue
						// #203), so a device whose only knowledge of this note came
						// through here had NO base for its later REST-fallback push
						// (channel down = the missed-delivery scenario) and silently
						// overwrote server content it never saw (e2e test_83).
						// Seed-only, never advance: serverHash means "server content this
						// device actually CONVERGED to" everywhere it is read (hash-skip,
						// resolveChangeBody). Stamping the
						// announced hash over a real converged base would mark the note
						// converged before the body lands — a missed room delivery then
						// sticks silently, with every recovery path defeated. A stale
						// seeded base errs toward a false 409/conflict copy, the safe
						// direction. Gate on "no base yet", not file existence: the room
						// delivery can race the file onto disk before this event runs.
						const np = normalizePath(event.path);
						// Captured BEFORE the CAS-seed below (which creates an entry):
						// undefined means this device has NO prior record of the note
						// (a genuine first delivery, not a converged/raced one).
						const priorState = this.syncState.get(np);
						if (event.content_hash !== undefined) {
							if (priorState?.serverHash === undefined) {
								this.syncState.set(np, {
									hash: priorState?.hash ?? fnv1a(""),
									version: event.version ?? priorState?.version,
									serverHash: event.content_hash,
								});
							}
						}
						rlog().info(
							"ws",
							`CRDT-managed: skipping legacy body apply for ${event.path}`,
						);
						// First-delivery materialization (idle, room-free): a never-seen note
						// (no prior syncState, no local file) that is idle is NOT enrolled here
						// (fan-out isolation), so it can never join a room. Its live note_yjs_update
						// fan-out is fire-and-forget and is MISSED if this device was offline when it
						// fired (a note created before we connected). materializeRelocated below needs
						// a SYNCED doc so it bails, leaving only the pull-discovery backstop, which
						// serializes behind slow conflict resolution (9s+ observed) and loses the
						// delivery-timing race (e2e test_27, and the broader created-before-connect
						// class). Materialize now from AUTHORITATIVE content, like the pre-fan-out
						// legacy apply did: inline body if the broadcast carries it, else one getNote
						// fetch (serialize_note is hash-only in prod). This is real server content, not
						// an unsynced empty projection, so it sidesteps the #547 premature-empty class.
						// flushFromCrdt's markRecentlyFlushed suppresses the echo and records the CRDT
						// baseline; CRDT still owns subsequent live edits. A note with a prior baseline
						// is left to its convergence path, a live-bound one to its editor/room, and a
						// synced doc (the rename case) to materializeRelocated below.
						const synced =
							typeof this.crdt.isSynced === "function" && this.crdt.isSynced(noteId);
						if (
							priorState === undefined &&
							!synced &&
							!this.isLiveBound(np) &&
							!this.app.vault.getAbstractFileByPath(np)
						) {
							let body = event.content;
							if (body === undefined) {
								body = (await this.api.getNote(event.path)).content;
								// Learned empty-hash (see the ingress guard): one fetch
								// proving this user's hash-of-"" retires the GET for
								// every later inline-empty upsert with the same hash.
								if (body === "" && event.content_hash) {
									this.emptyContentHash = event.content_hash;
								}
							}
							await this.flushFromCrdt(np, body);
						}
						// #189: a rename carries no content change, so it never produces a
						// Y.Doc update — onFlushToDisk never fires for it — and enroll()
						// above is a per-session no-op for an id this device already
						// enrolled (e.g. it received the old path live before the rename).
						// Left alone, the file is never written: received=yes,
						// materialized=no. materializeRelocated closes that gap directly.
						void this.materializeRelocated(event.path, noteId);
					}
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
				console.error("Engram Sync: failed to apply WebSocket event %s", event.path, e);
			}
		}
	}

	/** Id-keyed move: if `id` is already mapped to a DIFFERENT local path than
	 *  `newPath`, the server moved one row (a rename resurrects the same note_id
	 *  at a new path). Neither delivery channel is guaranteed to carry a delete
	 *  for the old path — the seq-ordered pull feed collapses the move into a
	 *  single upsert, and a realtime delete broadcast can be missed/reordered —
	 *  so relocate the old file ourselves or it lingers as a duplicate.
	 *
	 *  Re-keys the map (id stable, path moves) BEFORE trashing the old file, so
	 *  the vault delete event handleDelete fires resolves get(priorPath) to null:
	 *  it tears down NOTHING (crdtNoteId null), leaving the CRDT room for `id`
	 *  intact — only the path moved, not the id/room (mirrors handleRename's
	 *  "a rename must not tear down the CRDT doc"). No-ops when the id is unknown
	 *  or already at newPath, so callers can invoke it unconditionally.
	 *
	 *  Materializes the new path directly from the OLD file's on-disk content
	 *  (round 2, e2e test_10 mechanism a): a rename carries no content change,
	 *  so relying solely on the CRDT handshake (`materializeRelocated`'s
	 *  `isSynced` gate) to backfill the new path races a fresh-boot receiver
	 *  whose STEP2 hasn't landed yet this session — the gate declines and
	 *  nothing ever retries (received=yes, materialized=no). The old file's
	 *  bytes are already real, trustworthy content (this device had it on disk
	 *  before the rename); read + flush them to the new path here, independent
	 *  of CRDT session state. No-ops (falls through to the isSynced-gated
	 *  backstop) when there is no old file locally to read from.
	 *
	 *  STALE-EVENT GUARD (round 2, e2e test_34 mechanism, live-repro'd
	 *  2026-07-08): the WS channel is explicitly unordered (see class doc), so
	 *  a duplicate/reordered upsert can carry an id's PRIOR path after this
	 *  device already applied a more current relocation for that id this
	 *  session. Without a staleness check, the precondition above ("mapped to
	 *  a DIFFERENT path than event.path") is satisfied in EITHER direction —
	 *  the stale event reads as a second, backward relocation: re-keys the map
	 *  back, trashes the just-materialized new-path file, and (via the
	 *  disk-content fix above) recreates the old path from it. Observed live:
	 *  the old path was perpetually resurrected every few seconds. `eventTs`
	 *  (the WS broadcast's `updated_at`, or the pull feed's `updated_at` —
	 *  both server clock, normalized to epoch ms via Date.parse) is tracked
	 *  per note_id; an event no NEWER than the last one already applied for
	 *  this id is ignored outright — `<=`, not strict `<`:
	 *  the pull feed's `updated_at` is only seconds-precision on the wire, so
	 *  two genuinely different relocations for the same id within one second
	 *  can tie exactly. A tie can't be proven newer, so it must not win. */
	private lastRelocationTs = new Map<string, number>();

	private async moveIfIdRelocated(id: string, newPath: string, eventTs?: number): Promise<void> {
		const priorPath = this.noteIdMap?.pathForId(id) ?? null;
		if (!priorPath || normalizePath(priorPath) === normalizePath(newPath)) return;
		if (eventTs !== undefined) {
			const lastTs = this.lastRelocationTs.get(id);
			if (lastTs !== undefined && eventTs <= lastTs) {
				rlog().info(
					"pull",
					`Id-keyed move IGNORED (stale event ts=${eventTs} <= last-applied ts=${lastTs}): ` +
						`${id} -> ${newPath}`,
				);
				return;
			}
			this.lastRelocationTs.set(id, eventTs);
		}
		// DESTRUCTIVE-OP GUARD (2026-07-07 cross-file data-loss incident): the
		// local map can be CROSS-WIRED — `id` pointing at a path that really
		// belongs to a DIFFERENT live note. Trusting it here trashed an unrelated
		// file. Verify against the server manifest before anything irreversible:
		//  - priorPath owned by ANOTHER id  -> cross-wire. Rebind `id` to its real
		//    path and leave the stranger's file/caches alone.
		//  - ownership unknowable (no manifest / fetch failed) -> rebind the map
		//    but SKIP the trash: a lingering duplicate is recoverable, a wrong
		//    trash is not. The next reconcile/pull converges it.
		//  - priorPath absent, or owned by this same id (stale snapshot mid-
		//    rename) -> genuine relocation, proceed as before.
		const owner = await this.manifestOwnerOf(normalizePath(priorPath));
		if (owner !== null && owner !== id) {
			rlog().warn(
				"pull",
				`Id-keyed move REFUSED (${owner === undefined ? "ownership unknown" : "cross-wire"}): ` +
					`${priorPath} not confirmed as ${id}'s old path — rebinding to ${newPath}, no trash`,
			);
			// set() keeps the map a bijection: it evicts priorPath->id without
			// touching priorPath's file, syncState, or baseStore (they belong to
			// whatever note actually lives there).
			this.noteIdMap?.set(newPath, id);
			// If this refusal was wrong (it WAS a genuine rename), the old file
			// is now a duplicate no id references — queue it for the orphan
			// sweep, which re-judges against a fresh manifest on reconcile.
			this.pendingOrphanSweep.add(normalizePath(priorPath));
			return;
		}
		this.noteIdMap?.rename(priorPath, newPath);
		// Drop the old path's stale caches so a later create there isn't
		// echo-suppressed and no diverged base survives the move.
		this.syncState.delete(normalizePath(priorPath));
		this.baseStore?.delete(normalizePath(priorPath));
		// normalizePath for the vault lookup (map keys arrive normalized from the
		// server feed, but a non-normalized key would silently miss the trash and
		// leave the duplicate this fix exists to remove). rename() above keeps the
		// RAW priorPath — it must match the byPath key exactly to re-key the id.
		const oldFile = this.app.vault.getFileByPath(normalizePath(priorPath));
		if (oldFile) {
			// MID-FLIGHT VANISH GUARD (round 4, e2e test_10 CI run 28915097812):
			// the old file can be trashed CONCURRENTLY while this function is
			// suspended on the manifest await above — the rename's own delete
			// tombstone, deferred to a pull, races these file ops. A rejection
			// here must not escape: handleStreamEvent's hoisted call is outside
			// its try/catch, so an escape kills the ENTIRE upsert — no relocation,
			// no CRDT-branch materialize, no file, silently (received=yes
			// materialized=no). Degrade instead: a failed trash means the
			// tombstone already removed the file (the outcome the trash wanted) —
			// still flush the content we read; a failed read means no local
			// content — fall through to the caller's isSynced-gated
			// materializeRelocated backstop.
			try {
				// Read before trashing — the content must be captured while the
				// file still exists at its old location.
				const content = await this.app.vault.cachedRead(oldFile);
				try {
					await this.trashRemotelyDeleted(oldFile);
				} catch {
					// Already gone — the concurrent tombstone won the race.
				}
				// CREATE-ONLY GUARD (final review CRITICAL-1): the cachedRead/
				// trashFile awaits above are a suspend window. flushFromCrdt's
				// modify-if-exists semantics would overwrite content a CONCURRENT
				// doc-triggered flush already wrote to newPath during that window
				// with these old-file bytes, which are never newer. Re-check right
				// before flushing — mirrors materializeRelocated's own exists check.
				if (this.app.vault.getAbstractFileByPath(normalizePath(newPath))) {
					rlog().info(
						"pull",
						`Id-keyed move: skipping stale disk flush for ${newPath} — already exists (a concurrent flush won the race)`,
					);
				} else {
					await this.flushFromCrdt(newPath, content);
				}
				rlog().info("pull", `Id-keyed move: ${priorPath} -> ${newPath} (id=${id})`);
			} catch (e) {
				rlog().warn(
					"pull",
					`Id-keyed move file ops failed (old file vanished mid-flight?): ${priorPath} -> ${newPath} — ${errMsg(e)}`,
				);
				// No disk content to flush here, and the caller's isSynced-gated
				// materializeRelocated backstop may ALSO decline (fresh-boot
				// receiver, STEP2 not landed yet) — leaving the note invisible on
				// this device until the next scheduled poll, up to 5 minutes
				// (final review MINOR-7). Kick an immediate pull so that window
				// is one pull instead.
				void this.pull();
			}
		}
	}

	/** Apply one merged cursor-feed entry by dispatching to the existing note /
	 *  attachment apply primitives. The feed's `type`/`seq`/`id` are stripped;
	 *  applyChange / applyAttachmentChange own tombstone, merge, and skip logic. */
	async applySyncChange(c: SyncChange): Promise<boolean> {
		if (c.type === "attachment") {
			const ac: AttachmentChange = {
				path: c.path,
				mime_type: c.mime_type,
				size_bytes: c.size_bytes,
				mtime: c.mtime,
				updated_at: c.updated_at,
				deleted: c.deleted,
			};
			return this.applyAttachmentChange(ac);
		}
		// Folder-marker rows leak into the /sync/changes feed with a null path
		// (markers carry no path_ciphertext server-side). They are unappliable
		// client-side and previously THREW inside applyChange's shouldIgnore
		// (`null.startsWith`), landing an rlog error ("Skipped note null") on
		// every pull. Skip them quietly.
		if (!c.path) return false;
		// note_id-keyed CRDT rework (Task 5): learn this note's stable id from the
		// merged feed (the only pull path whose entries carry `id` — the legacy
		// GET /notes/changes NoteChange shape does not). A tombstone clears the
		// mapping instead of recording it: a note later recreated at the same
		// path is a NEW note server-side and must mint a fresh id, not resurrect
		// the deleted one's — mirrors the CRDT doc teardown-on-delete rationale
		// elsewhere in this file (no ghost lineage across a delete).
		if (c.deleted) {
			this.noteIdMap?.delete(c.path);
		} else {
			// Id-keyed move: the server sends a note's stable id at a NEW path, but
			// this device still holds that id at a DIFFERENT local path. A rename
			// moves one row server-side (delete old + resurrect at new, same id), so
			// the seq-ordered /sync/changes feed carries only the upsert at the new
			// path — never a separate delete for the old one. Relocate the old file
			// so it isn't orphaned as a duplicate (e2e test_10). See moveIfIdRelocated.
			// eventTs (final review IMPORTANT-2): without this, a pull-applied
			// relocation never recorded lastRelocationTs for the id, so a LATER
			// stale/reordered WS broadcast carrying the pre-rename path found no
			// timestamp to compare against and relocated backward (cross-channel
			// ping-pong). c.updated_at is an ISO-8601 string (seconds precision on
			// the wire); normalize to the same epoch-ms basis moveIfIdRelocated's
			// WS callers already use (event.timestamp, epoch ms) via Date.parse.
			// An unparseable value degrades to "no timestamp" (undefined) rather
			// than NaN, which would poison every future comparison for this id
			// (NaN is never < anything, so the guard would silently stop
			// protecting it for the rest of the session).
			const relocationTs = Date.parse(c.updated_at);
			await this.moveIfIdRelocated(
				c.id,
				c.path,
				Number.isNaN(relocationTs) ? undefined : relocationTs,
			);
			this.noteIdMap?.set(c.path, c.id);
			// Learned from the server's own feed — it unquestionably has a note
			// row for this id, so future edits may route through CRDT (see
			// confirmedNoteIds doc comment). A tombstone deliberately does NOT
			// un-confirm: the id itself is retired (a recreate mints a fresh one),
			// so there's nothing to revoke.
			this.confirmNoteId(c.id);
			// A note degraded on ANOTHER device surfaces here too: the feed carries
			// parse_status/parse_reason on the raw SyncNoteChange, but the NoteChange
			// mapping below deliberately drops them (that shape is also fed by the
			// legacy GET /notes/changes, which never had these fields). Read them off
			// `c` before the mapping erases them. Deleted entries skip this (a
			// tombstone has no parse status). Ignored paths skip it too: applyChange
			// below drops them, so a Sync Center card for an ignored note would be
			// misleading (review minor #5).
			if (!this.shouldIgnore(c.path)) {
				this.recordParseStatus(c.path, "note", c.parse_status, c.parse_reason);
			}
		}
		const nc: NoteChange = {
			path: c.path,
			title: c.title,
			content: c.content,
			content_hash: c.content_hash,
			folder: c.folder,
			tags: c.tags,
			mtime: c.mtime,
			updated_at: c.updated_at,
			deleted: c.deleted,
			version: c.version,
		};
		return this.applyChange(nc);
	}

	/** No-cursor bootstrap: manifest-authoritative §F reconcile of LOCAL files
	 *  (delete server-deleted, push offline-created — disambiguated by the
	 *  syncState baseline), then a genesis cursor pull delivers/refreshes content
	 *  (3-way merging diverged files via applyChange). Returns count applied. */
	private async bootstrap(emitProgress = false): Promise<number> {
		rlog().info("pull", "Bootstrap — manifest reconcile + genesis cursor pull");
		const manifest = await this.api.getManifest();

		// No manifest endpoint (pre-B1 backend) → just genesis-pull; nothing to reconcile.
		if (!manifest) return this.pullViaCursor(undefined, emitProgress);

		const serverPaths = new Set<string>([
			...manifest.notes.map((n) => normalizePath(n.path)),
			...manifest.attachments.map((a) => normalizePath(a.path)),
		]);

		// §F structural pass over local syncable files.
		const toPush: TFile[] = [];
		for (const file of this.app.vault.getFiles()) {
			if (!this.isSyncable(file) || this.shouldIgnore(file.path)) continue;
			const np = normalizePath(file.path);
			if (serverPaths.has(np)) continue; // in manifest → content handled by the pull below

			if (this.syncState.has(np)) {
				// In baseline but gone from the server → server-deleted while away.
				// Trash locally so the post-pull push step can't resurrect it. A
				// trash failure (locked file / OS error) must NOT abort the whole
				// bootstrap, and must NOT drop the baseline entry — leaving it as
				// "in baseline" keeps it classified as server-deleted on the next
				// run (clearing it would reclassify the file as offline-created and
				// resurrect it on the next push). Log + carry on.
				try {
					await this.trashRemotelyDeleted(file);
					this.syncState.delete(np);
					this.baseStore?.delete(np);
					rlog().info("pull", `Bootstrap: server-deleted → trashed ${file.path}`);
				} catch (e) {
					rlog().error(
						"pull",
						`Bootstrap trash failed (retried next run): ${file.path} — ${errMsg(e)}`,
						e instanceof Error ? e.stack : undefined,
					);
				}
			} else {
				// Never synced → created locally offline → push after content reconcile.
				toPush.push(file);
			}
		}

		// Content delivery: genesis pull (full content + tombstones, ordered).
		// The manifest gives us a real up-front total for the progress bar (a
		// genesis pull, unlike an incremental delta, knows its own size).
		const knownTotal = manifest.notes.length + manifest.attachments.length;
		const applied = await this.pullViaCursor(undefined, emitProgress, knownTotal);

		// §E: an empty vault's genesis pull delivers no entries, so the cursor is
		// still null. Seed it from the manifest's change_seq so the NEXT pull
		// resumes incrementally (seq > change_seq) instead of re-bootstrapping —
		// critical for the reconnect catch-up, which must have a position to
		// resume from after a vault swap clears the cursor.
		if (this.getSyncCursor() === null && typeof manifest.change_seq === "number") {
			this.setSyncCursor(encodeCursor(manifest.change_seq, MAX_CURSOR_UUID));
			await this.saveData({ syncCursor: this.getSyncCursor() });
		}

		// Push offline-created files now that deletes are reconciled.
		for (const file of toPush) {
			try {
				await this.pushFile(file, true);
			} catch (e) {
				rlog().error(
					"pull",
					`Bootstrap push failed: ${file.path} — ${errMsg(e)}`,
					e instanceof Error ? e.stack : undefined,
				);
			}
		}

		// Seed markers for folders the server can't derive (empty, or holding only
		// non-syncable files). getFiles() above never sees folders, so without this
		// a pre-existing vault's empty folders never reach the server. Best-effort.
		await this.seedEmptyFolders();

		return applied;
	}

	/** Drain the ordered cursor feed from `startCursor` (undefined = genesis pull,
	 *  server returns from seq 0). Applies each entry, persists the cursor after
	 *  every page (at-least-once; applies are idempotent), returns count applied.
	 *  Throws HistoryExpiredError on 410. */
	private async pullViaCursor(
		startCursor: string | undefined,
		emitProgress = false,
		knownTotal?: number,
	): Promise<number> {
		let cursor = startCursor;
		let applied = 0;

		for (let page = 0; page < 100_000; page++) {
			let resp: SyncChangesResponse;
			try {
				resp = await this.api.getSyncChanges(cursor, 500);
			} catch (e) {
				if ((e as { status?: number }).status === 410) throw new HistoryExpiredError();
				throw e;
			}

			for (const c of resp.changes) {
				try {
					if (await this.applySyncChange(c)) applied++;
				} catch (e) {
					// Permanent local apply failure (e.g. illegal filename): log + skip,
					// matching legacy pull semantics — one bad entry must not wedge the feed.
					const msg = errMsg(e);
					rlog().error(
						"pull",
						`Skipped ${c.type} ${c.path} — ${msg}`,
						e instanceof Error ? e.stack : undefined,
					);
				}
			}

			// Advance the persisted cursor to this page's tip. Mid-stream the server
			// hands back an opaque next_cursor; on the final page it's null, so encode
			// the head from the last entry (keeps the watermark moving for PR D GC).
			const last = resp.changes[resp.changes.length - 1];
			if (resp.next_cursor) {
				this.setSyncCursor(resp.next_cursor);
			} else if (last) {
				this.setSyncCursor(encodeCursor(last.seq, last.id));
			}
			await this.saveData({ syncCursor: this.getSyncCursor() });

			// Foreground (manual) sync only: report real downloads-so-far so the
			// modal's Download row climbs instead of sitting frozen until done.
			// `total` is only read by the settings bar (the modal keeps the plan
			// total). Bootstrap passes a real manifest count; an incremental delta
			// has no honest total, so emit 0 — the settings bar renders that as
			// indeterminate (activity count, empty bar) rather than the old
			// total==current which fabricated a permanent 100% bar.
			if (emitProgress) {
				this.onSyncProgress?.({
					phase: "pulling",
					current: applied,
					total: knownTotal ?? 0,
					failed: 0,
				});
			}

			if (!resp.has_more || !resp.next_cursor) break;
			cursor = resp.next_cursor;
		}

		return applied;
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
				await this.trashRemotelyDeleted(existing);
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

		// Anti-stale guard (review 2026-07-15, data-loss race): a push landing
		// DURING a pull — the bounded post-pull drain, or a debounced edit —
		// bumps syncState past entries this pull fetched BEFORE that push.
		// Applying such an entry would blind-overwrite the just-pushed edit
		// (local == baseline, so no conflict fires). Server versions are
		// monotonic per note: an entry at or below the version we already
		// synced carries nothing new. Gated on the file existing locally so a
		// stale syncState row (crash, manual delete) can never mask a real
		// re-materialization; forceOverwrite (explicit keep-remote) bypasses.
		if (!forceOverwrite && change.version !== undefined) {
			const known = this.syncState.get(normalized)?.version;
			if (
				known !== undefined &&
				known >= change.version &&
				this.app.vault.getFileByPath(normalized)
			) {
				rlog().info(
					"pull",
					`applyChange skip (stale v${change.version} <= synced v${known}): ${change.path}`,
				);
				return false;
			}
		}

		// C1: CRDT-managed markdown — the crdt: topic owns the body. Skip the
		// legacy disk-write, threeWayMerge, and ConflictModal for markdown notes
		// when CRDT is active. This prevents the dual-write hazard where a
		// note_changed broadcast and the crdt: update both try to write the same
		// file. Deletes (handled above) and attachments (routed via
		// applyAttachmentChange) are unaffected. One exception: when LOCAL and
		// REMOTE both diverged from the last-synced state (a real conflict),
		// the block falls through to the legacy conflict flow below instead of
		// silently backfilling over the local edit.
		let crdtConflictFallthrough = false;
		if (this.crdt && normalized.endsWith(".md")) {
			// Enroll by note_id (Task 6). This is populated for the merged-feed
			// caller (applySyncChange learns `id` right before calling applyChange)
			// but may be unknown for the legacy /notes/changes path (no `id` field
			// on NoteChange) — skip enrolling gracefully in that case; the body is
			// still materialized below directly from the pulled content.
			const noteId = this.noteIdMap?.get(normalized) ?? null;
			// Discovery: a CRDT-managed note we don't have on disk yet. Enroll it
			// (sync-step-1) so the body arrives over the CRDT handshake — the server
			// seeds the room from notes.content when it has no CRDT state. We never
			// legacy-write here (CRDT owns the body), so without enrolling a brand-new
			// note would be invisible on this device (the announce is edge-triggered
			// and can be missed if we weren't subscribed when the other device opened
			// the room). An already-local note is left to its existing CRDT routing.
			if (!this.app.vault.getFileByPath(normalized)) {
				// Enroll (STEP1) ONLY when the note is live-bound (open in the
				// editor). An idle discovered note gets its body room-free via the
				// flushFromCrdt below (the /changes payload already carries it), so
				// skipping STEP1 keeps a large vault from opening a room per note on
				// connect (the enrollment storm). Send stays intact — an idle CRDT
				// note ships local edits without enrollment.
				if (noteId && this.isLiveBound(normalized)) this.crdtEnrollment?.enroll(noteId);
				rlog().info("pull", `CRDT discovery: enrolling new note ${change.path}`);
				// The /changes payload already carries the authoritative body, so
				// materialize it now — awaited within this pull, so a caller that
				// pulls-then-checks (e.g. triggerFullSync) sees the file immediately.
				//
				// Previously only EMPTY notes were written here and non-empty ones were
				// deferred to the CRDT seed-from-REST handshake. But that handshake can
				// silently never complete under load (a lost STEP1/STEP2, or a room the
				// server never seeded), stranding the note invisible forever — the
				// renamed-note-at-a-new-path case (e2e test_10/test_34) is exactly a
				// discovery, and deferring left the new path missing on B. We already
				// hold the body here, so write it. CRDT stays the single writer for LIVE
				// edits; its later STEP2 (identical content) is a harmless idempotent
				// re-flush suppressed by markRecentlyFlushed.
				await this.flushFromCrdt(normalized, content);
			} else {
				// The note exists locally and CRDT owns its body for LIVE edits — but
				// this pull entry is the authoritative safety net. The old behavior
				// (enroll and return, never comparing) meant a missed crdt_doc_ready
				// announce was missed FOREVER: enrollment is once-per-session, so
				// nothing ever backfilled the content (2026-07-07: "Obsidian never
				// got any updates"). When the hashes prove we are behind, write the
				// body we are already holding; markRecentlyFlushed suppresses the
				// echo and the converged serverHash keeps dedupe quiet. The later
				// idempotent STEP2 re-flush is suppressed by the same window.
				// A cold (not live-bound) note stays room-free — we do not eagerly
				// STEP1 every CRDT note in the vault on connect (the enrollment
				// storm). Divergence is still handled below: a clean local file
				// backfills via REST (flushFromCrdt), a live-bound one re-handshakes.
				if (noteId && this.isLiveBound(normalized)) this.crdtEnrollment?.enroll(noteId);
				const stored = this.syncState.get(normalized);
				if (change.content_hash && stored?.serverHash !== change.content_hash) {
					if (this.isLiveBound(normalized)) {
						// An open, bound editor is the sole CRDT writer for the note —
						// writing disk under it would fight the binding. Two recovery
						// legs, both through the Y.Doc (the binding paints the editor):
						//   1. reset+enroll re-fires STEP1 so the room subscription is
						//      re-registered for FUTURE live updates;
						//   2. a REST delta pull converges the doc NOW, deterministically.
						// Leg 2 replaced the bounded give-up that recorded convergence
						// after 3 failed re-handshakes WITHOUT the data ever arriving —
						// that stopped the 2026-07-09 re-handshake storm by trading it
						// for a silent data hole: a live-bound note whose room broadcast
						// was lost went permanently deaf (2026-07-14 incident). REST
						// converge terminates the loop by actually delivering the ops,
						// so no give-up is needed; a REST failure retries at the poll
						// cadence (5 min per note — bounded, not a storm).
						const key = noteId ?? normalized;
						const prevAttempt = this.crdtRehandshakeAttempts.get(key);
						const attempts =
							prevAttempt?.hash === change.content_hash
								? prevAttempt.attempts + 1
								: 1;
						rlog().warn(
							"pull",
							`CRDT catch-up: diverged + live-bound, re-handshake + REST converge (attempt ${attempts}) ${change.path}`,
						);
						if (noteId && this.crdtEnrollment) {
							this.crdtEnrollment.reset(noteId);
							this.crdtEnrollment.enroll(noteId);
						}
						const converged = noteId
							? await this.restConvergeLiveBound(normalized, noteId)
							: false;
						if (converged) {
							this.crdtRehandshakeAttempts.delete(key);
							// We did NOT write disk (the editor owns the body), so record
							// the REAL local content hash — NOT a 0 sentinel, which a later
							// cold-note check would misread as a local divergence and
							// spuriously route to the conflict flow.
							const boundFile = this.app.vault.getFileByPath(normalized);
							const localHash =
								stored?.hash ??
								(boundFile ? fnv1a(await this.app.vault.cachedRead(boundFile)) : 0);
							// Spread the existing entry: restConvergeLiveBound just recorded
							// crdtHead into it, and a bare replacement would wipe that head,
							// defeating coldReceive's cost gate (getCrdtHead === serverHead).
							this.syncState.set(normalized, {
								...(this.syncState.get(normalized) ?? {}),
								hash: localHash,
								serverHash: change.content_hash,
								version: change.version,
							});
						} else {
							// Keep serverHash UNrecorded so the next poll retries — never
							// record convergence for data that has not arrived.
							this.crdtRehandshakeAttempts.set(key, {
								hash: change.content_hash,
								attempts,
							});
						}
					} else {
						// Backfill is ONLY a catch-up for a CLEAN local file. If the
						// LOCAL content also moved off the last-synced hash, both
						// sides diverged — that is a conflict, and overwriting here
						// silently destroys the local edit with the conflict flow
						// never consulted (e2e test_14 skip regression, 2026-07-08).
						// Route it to the legacy conflict machinery below (3-way
						// merge → resolveConflict → skip/keep-local/keep-both/merge),
						// which every non-CRDT note already uses.
						const localFile = this.app.vault.getFileByPath(normalized);
						const localNow = localFile
							? await this.app.vault.cachedRead(localFile)
							: null;
						const localDiverged =
							localNow !== null &&
							stored?.hash !== undefined &&
							fnv1a(localNow) !== stored.hash &&
							localNow !== content;
						if (localDiverged) {
							rlog().warn(
								"pull",
								`CRDT catch-up: local+remote both diverged, routing to conflict flow ${change.path}`,
							);
							crdtConflictFallthrough = true;
						} else {
							rlog().warn(
								"pull",
								`CRDT catch-up: pull backfilling diverged note ${change.path}`,
							);
							await this.flushFromCrdt(normalized, content);
							this.syncState.set(normalized, {
								hash: fnv1a(content),
								version: change.version,
								serverHash: change.content_hash,
							});
						}
					}
				} else {
					rlog().info("pull", `CRDT-managed: re-enroll for catch-up ${change.path}`);
				}
			}
			if (!crdtConflictFallthrough) return false;
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
				await this.trashRemotelyDeleted(existing);
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
		try {
			await this.app.vault.create(normalized, content);
		} catch (e) {
			// A concurrent materialization path (pull vs WS delivery) can create
			// this file between the caller's existence check and our create —
			// vault.create then rejects "File already exists." (e2e round 5,
			// run 28919928915 catch-up bursts). The body landing on disk is the
			// goal, so degrade to modify with the same content; rethrow the rest.
			const raced = this.app.vault.getAbstractFileByPath(normalized);
			if (raced instanceof TFile) {
				await this.modifyFile(raced, content);
				return;
			}
			throw e;
		}
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

		try {
			await this.app.vault.createFolder(path);
		} catch (e) {
			// Check-then-create races a concurrent materialization of a sibling
			// note into the same new folder: N notes delivered in a burst each
			// ensureFolder the same path and the losers reject "Folder already
			// exists." (e2e test_34, run 28919928915 — the dropped note then
			// missed the 30s delivery window). Losing the race means the folder
			// IS there — the outcome we wanted — so swallow ONLY that case.
			if (this.app.vault.getAbstractFileByPath(path)) return;
			if (/already exists/i.test(errMsg(e))) return;
			throw e;
		}
	}

	/** Live-sync entry for a server-side folder-marker change (folders.batch
	 *  channel event). Re-polls /folders/explicit and materializes new empty
	 *  folders immediately instead of waiting for the next pull. */
	async resyncFolders(): Promise<void> {
		if (this.syncBlocked) return;
		await this.syncExplicitFolders();
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

		// A folder we previously tracked that the server no longer lists was
		// deleted on another device (web). Trash it locally so the delete
		// propagates. Guarded — only an EMPTY folder still on disk (a note may
		// have since landed inside it) and never an ignored path
		// (.obsidian/, .trash/, …).
		const kept = new Set(names);
		const removed = this.explicitFolders
			.all()
			.filter((prev) => !kept.has(prev) && !this.shouldIgnore(prev));

		// Drop the tracked set to the server's list BEFORE trashing any folder.
		// trashFile dispatches Obsidian's vault "delete" event, which routes to
		// handleFolderDelete; if the folder were still tracked there it would echo
		// a real DELETE /folders back to the server (the folder-level twin of the
		// wipeRemote echo). Removing it from the set first makes
		// handleFolderDelete's membership guard suppress the echo — and covers the
		// "user deleted all folders → []" case without a special guard.
		await this.explicitFolders.replaceAll(names);

		for (const prev of removed) {
			const existing = this.app.vault.getAbstractFileByPath(prev);
			if (!(existing instanceof TFolder)) continue;
			if (existing.children.length > 0) continue;
			try {
				await this.app.fileManager.trashFile(existing);
			} catch (e) {
				devLog().log("pull", `trash removed folder(${prev}) failed: ${errMsg(e)}`);
			}
		}

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

		// Drop stale per-vault bookkeeping if the active vault changed since
		// syncState was recorded (must run before prePullSync is snapshotted).
		await this.invalidateIfVaultChanged();

		// Snapshot lastSync before pull — pull updates it to server_time,
		// which would cause pushModifiedFiles to miss files modified between
		// the old and new lastSync values.
		const prePullSync = this.lastSync;

		const pulled = await this.pull(true);
		const pushed = await this.pushModifiedFiles(prePullSync);

		// Close out the progress UI (mirrors pushAll's terminal "complete").
		// The recap's "N synced" reads `current`, so it must count BOTH legs —
		// a download-only sync (pushed=0) still synced `pulled` notes and must
		// not report "Nothing needed syncing". pushModifiedFiles already flushed
		// the plan-skip tally into lastBatchSkipped, so surface it here as
		// `skipped` (disjoint from failed — informational skips never increment
		// the failure counter).
		const synced = pulled + pushed;
		this.onSyncProgress?.({
			phase: "complete",
			current: synced,
			total: synced,
			failed: 0,
			skipped: this.lastBatchSkipped,
		});

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

	// Version gate: latched OFF the first time an /updates call 404/405s (a
	// pre-Phase-1 backend). While off, CRDT notes fall back to the whole-doc
	// base_hash push, exactly as before this feature. Mirrors batchPushUnsupported.
	private crdtOpsUnsupported = false;

	// Capability comes SOLELY from the probe (Phase 2b remediation): ops are
	// treated unavailable until getVaultHeads has actually confirmed them, so
	// a channel-down edit that races the probe takes the durable legacy path
	// instead of assuming ops work.
	private crdtOpsProbed = false;

	private crdtOpsAvailable(): boolean {
		return this.settings.enableCrdt === true && this.crdtOpsProbed && !this.crdtOpsUnsupported;
	}

	private markCrdtOpsUnsupported(status: number): void {
		if (status === 404 || status === 405) {
			this.crdtOpsUnsupported = true;
		}
	}

	/** Persist a content-free, crdt-tagged upsert to the durable queue. Both
	 *  channel-down seams (pushFile and pushNotesViaBatch) must produce an
	 *  IDENTICAL entry so runFlushQueue's noteId-keyed /updates branch delivers
	 *  them the same way — keep the two producers in lockstep here rather than
	 *  duplicating the object literal, so a new field can't be added to one seam
	 *  and forgotten on the other. */
	private async enqueueCrdtEdit(file: TFile, noteId: string): Promise<void> {
		await this.enqueueChange({
			path: file.path,
			action: "upsert",
			noteId,
			crdt: true,
			mtime: file.stat.mtime / 1000,
			timestamp: Date.now(),
			kind: "note",
			vaultId: this.settings.vaultId ?? undefined,
		});
	}

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
		onProgress?: (pushed: number, failed: number) => void,
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

		type Entry = { file: TFile; content: string; hash: number; version?: number };
		let chunk: Entry[] = [];
		let chunkBytes = 0;
		const oversized: TFile[] = [];

		// Sends the accumulated chunk. Returns "ok" | "unsupported" | "transport".
		const flushChunk = async (): Promise<"ok" | "unsupported" | "transport"> => {
			if (chunk.length === 0) return "ok";
			// Mint refusal (issue #217): same seam as pushFile's — an
			// engine-flushed path whose id was relocated away must not mint here
			// either. Drop it from the batch (skip, not fail); see shouldDeferMint.
			const entries: Entry[] = [];
			for (const e of chunk) {
				if (this.shouldDeferMint(normalizePath(e.file.path))) {
					rlog().info(
						"push",
						`Mint refused (engine-flushed file, id relocated away): ${e.file.path}`,
					);
					this.logEntry("skip", e.file.path, "skipped", undefined, "mint-deferred");
					continue;
				}
				entries.push(e);
			}
			chunk = [];
			chunkBytes = 0;
			if (entries.length === 0) return "ok";

			// Snapshot each entry's path for the lifetime of the request —
			// TFile.path is LIVE, so a rename landing mid-request would otherwise
			// desync result matching, the pushing set, and the sanitize check
			// against what was actually sent (#245).
			const sent = entries.map((e) => ({ ...e, pushedPath: e.file.path }));
			for (const e of sent) this.pushing.add(e.pushedPath);
			try {
				const resp = await this.api.pushNotesBatch(
					sent.map((e) => {
						// Mint-and-send the client id, mirroring pushFile: a clean create
						// keeps our uuidv7; a create-race is corrected when the response
						// echoes the winning id (recordBatchPushOk adopts it).
						const np = normalizePath(e.pushedPath);
						let noteId = this.noteIdMap?.get(np) ?? null;
						if (!noteId && this.noteIdMap) {
							noteId = uuid7();
							this.noteIdMap.set(np, noteId);
						}
						return {
							path: e.pushedPath,
							content: e.content,
							mtime: e.file.stat.mtime / 1000,
							version: e.version,
							...(noteId ? { id: noteId } : {}),
						};
					}),
				);
				const byPath = new Map(resp.results.map((r) => [r.path, r]));

				for (const e of sent) {
					const r = byPath.get(e.pushedPath);
					if (!r) {
						failed++;
						this.logEntry("push", e.pushedPath, "error", "missing batch result");
						continue;
					}
					if (r.status === "ok") {
						await this.recordBatchPushOk(e.file, e.content, e.hash, r, e.pushedPath);
						pushed++;
						this.logEntry("push", e.pushedPath, "ok");
					} else if (r.status === "conflict") {
						// Hand the file to the single-note flow, which owns 3-way
						// merge + interactive resolution. It re-pushes with the
						// stored version, gets the same 409, and resolves.
						this.pushing.delete(e.pushedPath);
						const ok = await this.pushFile(e.file, true);
						if (ok) pushed++;
					} else if (
						(r.errors as { reason?: string } | undefined)?.reason === "recently_deleted"
					) {
						// Delete-wins (batch path): server refused this create because the
						// path was deleted on another device within the window. Converge by
						// trashing our local copy instead of retrying — not a failure.
						rlog().info(
							"push",
							`recently_deleted — trashing local ${e.file.path} to honor remote delete`,
						);
						await this.trashRemotelyDeleted(e.file);
						this.logEntry(
							"push",
							e.file.path,
							"skipped",
							"recently_deleted — honored remote delete",
						);
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
				for (const e of sent) {
					this.pushing.delete(e.pushedPath);
					this.markRecentlyPushed(e.pushedPath);
				}
			}
		};

		for (let i = 0; i < files.length; i++) {
			const file = files[i]!;
			// CRDT owns the body of a confirmed, live note: the socket delivers its
			// edits (pushFile routes such notes through CRDT and never REST, even
			// under force). Re-POSTing the full body here duplicates the content —
			// the server re-seeds it into the live CRDT room, so the just-typed line
			// reappears. Mirror pushFile's CRDT gate (and the pull-side C1 guard).
			// An unconfirmed note (e.g. after a reconnect clears confirmations, or a
			// never-synced note) still falls through to REST so the row is (re)created
			// and its id re-verified — the durable fallback stays intact.
			//
			// Size gate: CRDT declines notes over MAX_CRDT_NOTE_BYTES (routeModify
			// returns false → pushFile REST-pushes them), so an oversized note is NOT
			// CRDT-owned and must reach REST here too — both its recovery push and the
			// >10 MB → 413 too_large path below. stat.size is the on-disk UTF-8 byte
			// count, the same measure routeModify caps on.
			const noteId = this.noteIdMap?.get(file.path) ?? null;
			if (file.stat.size <= MAX_CRDT_NOTE_BYTES && this.isCrdtManaged(file.path, noteId)) {
				this.logEntry("skip", file.path, "skipped", undefined, "crdt-owned");
				continue;
			}
			// Task 5: a cold-but-managed note (channel down, so isCrdtManaged above
			// is false) still owes its body to CRDT ops when the backend supports
			// them — batch-pushing its full content here would duplicate the write
			// the durable REST /updates flush is about to make. Unlike pushFile,
			// this loop never touched the Y.Doc for this file, so it must SEED it
			// first (mirrors pushFile's routeModify call) — skipping straight to a
			// scheduled/queued flush without seeding was the batch-unseeded
			// data-loss finding: the flush would have delivered stale/empty
			// content. The queue entry is durable, NOT delivered — never counted
			// toward `pushed`, and logged as queued rather than a completed skip.
			if (
				file.stat.size <= MAX_CRDT_NOTE_BYTES &&
				noteId &&
				this.crdt &&
				this.crdtOpsAvailable() &&
				this.isCrdtManagedOffline(file.path, noteId)
			) {
				const consumed = await routeModify(
					{
						isMarkdown: file.extension === "md",
						noteId,
						// Live read (see pushFile): frozen content would defeat the
						// manager's stale-snapshot reread guard.
						readContent: () => this.app.vault.cachedRead(file),
					},
					this.crdt,
					MAX_CRDT_NOTE_BYTES,
				);
				// Only queue CRDT delivery when routeModify actually seeded the
				// Y.Doc. A declined seed (e.g. a non-markdown .canvas note, or an
				// empty doc awaiting STEP2) left the Y.Doc empty — enqueuing a
				// crdt entry anyway would POST an EMPTY update and skip the REST
				// push, silently losing the edit. On decline, fall through to the
				// normal batch push below (mirrors pushFile's consumed check).
				// `!== null`: "" is a legitimately consumed empty note.
				if (consumed !== null) {
					await this.enqueueCrdtEdit(file, noteId);
					this.logEntry("skip", file.path, "skipped", undefined, "crdt-offline-queued");
					continue;
				}
			}
			if (file.stat.size > MAX_BATCH_NOTE_BYTES) {
				oversized.push(file);
				continue;
			}
			const content = await this.app.vault.cachedRead(file);
			const hash = fnv1a(content);
			const existing = this.syncState.get(normalizePath(file.path));
			if (!force && existing !== undefined && hash === existing.hash) {
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
					onProgress?.(pushed, failed);
					return { pushed, failed };
				}
				onProgress?.(pushed, failed);
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
			onProgress?.(pushed, failed);
			return { pushed, failed };
		}
		onProgress?.(pushed, failed);

		// Oversized notes: single-note path → server 413 → proper terminal
		// too_large issue with sizeBytes.
		for (const file of oversized) {
			try {
				const ok = await this.pushFile(file, force);
				if (ok) {
					pushed++;
					this.logEntry("push", file.path, "ok");
				}
			} catch (e) {
				failed++;
				this.logEntry("push", file.path, "error", errMsg(e));
			}
			onProgress?.(pushed, failed);
		}

		// Deliver any channel-down CRDT entries the loop just enqueued (Task 5).
		// Mirrors pushFile's `void this.flushQueue()` right after its own
		// enqueueChange — without this, a durably-queued entry sat undelivered
		// until an unrelated trigger (manual "Retry Failed", or a later
		// single-file edit) drained the queue. Single call after the loop, not
		// per-note: flushQueue is single-flight (flushInFlight guard), so one
		// call drains everything and a redundant call is a no-op.
		void this.flushQueue();

		return { pushed, failed };
	}

	/** Record a successful batch-push result: sync state, base store, issue
	 *  clearing, and the server-sanitized-path rename (mirrors pushFile). */
	private async recordBatchPushOk(
		file: TFile,
		content: string,
		hash: number,
		result: BatchUpsertResult,
		pushedPath: string,
	): Promise<void> {
		if (file.path !== pushedPath) {
			// The file was renamed locally while the batch was in flight; the
			// result describes the OLD location. Renaming back or recording state
			// under either path would revert/poison the user's rename (#245) —
			// handleRename already owns the new path.
			rlog().info(
				"push",
				`Sanitize-rename skipped: file moved during batch push (${pushedPath} → ${file.path})`,
			);
			return;
		}
		const serverPath =
			result.server_path && result.server_path !== pushedPath
				? result.server_path
				: undefined;

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
		// Adopt the authoritative id. The server echoes the winner even when a
		// create-race means it differs from our mint (2026-07-07 incident: the
		// batch path never adopted, so the CRDT receive path stayed keyed to a
		// dead local id — announces for the real id were ignored until a
		// cold-start reconcile). Mirrors pushFile's post-response adoption;
		// set() evicts the stale mint (bijection), confirm unlocks CRDT routing.
		if (result.id) {
			// On a server rename, evict the OLD path first (mirror pushFile's
			// sanitized-rename branch): when result.id also differs from the
			// pre-request mint (create-race + sanitize together), set() alone
			// leaves the dead mint dangling on the renamed-away path
			// (#197 retro-review).
			if (serverPath) this.noteIdMap?.delete(normalizePath(file.path));
			const np = normalizePath(serverPath ?? file.path);
			this.noteIdMap?.set(np, result.id);
			this.confirmNoteId(result.id);
		}
		this.issues.clear(file.path);
		this.recordParseStatus(
			result.server_path ?? file.path,
			"note",
			result.parse_status,
			result.parse_reason,
		);
	}

	/** Record or clear a note's frontmatter parse issue from a backend
	 *  parse_status/parse_reason. Called on every push success + feed apply. When
	 *  the note parses cleanly we clear ONLY a prior frontmatter issue for the path
	 *  (a real error issue recorded elsewhere must survive). Fires a debounced
	 *  Notice ONLY on the ok->degraded transition into the "frontmatter"
	 *  category (a note that newly degrades with a user-fixable frontmatter
	 *  problem), so a steady-state degraded vault stays quiet, a re-recorded
	 *  already-degraded note does not re-notify, and a generic "other"
	 *  category failure (e.g. note_processing_failed) never enters the
	 *  Notice path at all. */
	recordParseStatus(
		path: string,
		kind: "note" | "attachment",
		parseStatus: "ok" | "degraded" | undefined,
		parseReason: ParseReason | null | undefined,
	): void {
		const mapped = parseStatusToIssue(parseStatus, parseReason);
		if (!mapped) {
			const existing = this.issues.get(path);
			if (existing && (existing.category === "frontmatter" || existing.parseReason)) {
				this.issues.clear(path);
			}
			return;
		}
		const wasDegraded = this.issues.get(path)?.category === "frontmatter";
		const now = Date.now();
		this.issues.record({
			path,
			kind,
			category: mapped.category,
			message: mapped.message,
			parseReason: mapped.parseReason,
			firstFailedAt: now,
			lastFailedAt: now,
			attempts: 1,
		});
		if (!wasDegraded && mapped.category === "frontmatter") {
			this.pendingDegraded.add(path);
			if (this.degradedNoticeTimer) window.clearTimeout(this.degradedNoticeTimer);
			this.degradedNoticeTimer = window.setTimeout(
				() => this.flushDegradedNotice(),
				DEGRADED_NOTICE_DEBOUNCE_MS,
			);
		}
	}

	/** Flush the pending degraded-transition burst into a single Notice.
	 *  Single note: names the file with an "Open note" link. Multiple: a
	 *  count pointing at Sync Center. Mirrors the clickable-Notice pattern in
	 *  limit-toast.ts. */
	private flushDegradedNotice(): void {
		this.degradedNoticeTimer = null;
		const paths = [...this.pendingDegraded];
		this.pendingDegraded.clear();
		if (paths.length === 0) return;
		if (paths.length === 1) {
			const [path] = paths as [string];
			const notice = new Notice(
				`Engram: frontmatter problem in "${path.split("/").pop()}"`,
				DEGRADED_NOTICE_DURATION_MS,
			);
			const noticeEl = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
			const link = noticeEl?.createEl("a", { text: "Open note" });
			link?.addEventListener("click", () => void this.app.workspace.openLinkText(path, ""));
		} else {
			new Notice(
				`Engram: ${paths.length} notes have frontmatter problems. Open Sync Center to fix.`,
				DEGRADED_NOTICE_DURATION_MS,
			);
		}
	}

	/** Single source of truth for the "pushing" progress event. Both push paths
	 *  (pushModifiedFiles and pushAll) emit the identical shape; routing them
	 *  through one helper stops the two from drifting when the reporting changes. */
	private emitPushing(
		current: number,
		total: number,
		failed: number,
		currentPath?: string,
	): void {
		this.onSyncProgress?.({ phase: "pushing", current, total, failed, currentPath });
	}

	/** Push files modified since `sinceTimestamp` (default: `lastSync`) — both
	 *  genuinely-modified tracked files and never-before-synced local-only
	 *  notes (always included regardless of mtime). A brand-new note's first
	 *  push routes through pushFile's socket-native genesis (crdt_create) when
	 *  wired. Public: also called directly by the connect path (onLayoutReady,
	 *  Plan B1 Task 6), which no longer runs fullSync's REST pull leg but still
	 *  needs this push leg to create/upload local-only notes on (re)connect. */
	async pushModifiedFiles(sinceTimestamp?: string): Promise<number> {
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
			this.emitPushing(0, total, 0);
		}

		// Protocol rev: notes via the batch endpoint (echo suppression inside),
		// attachments via the per-file path; pre-rev backends fall back wholesale.
		const noteFiles = toSync.filter((f: TFile) => !this.isBinaryFile(f));
		const attachFiles = toSync.filter((f: TFile) => this.isBinaryFile(f));

		const batchOutcome = await this.pushNotesViaBatch(
			noteFiles,
			false,
			(pushedSoFar, failedSoFar) => {
				this.emitPushing(pushedSoFar, total, failedSoFar);
			},
		);

		let perFile: TFile[];
		if (batchOutcome) {
			pushed += batchOutcome.pushed;
			perFile = attachFiles;
		} else {
			perFile = toSync;
		}

		for (let i = 0; i < perFile.length; i += 10) {
			const batch = perFile.slice(i, i + 10);
			const results = await Promise.all(batch.map((f: TFile) => this.pushFile(f)));
			pushed += results.filter(Boolean).length;
			this.emitPushing(pushed, total, 0);
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
	 *  @param opts.replaceRemote — if true, delete EVERY remote note and
	 *    attachment first, then upload all local files, so the server ends up an
	 *    exact mirror of the local vault. Used by the "Delete all on remote, then
	 *    upload local files" sync direction. This literally wipes the server
	 *    before re-uploading (shared files are deleted then recreated); the user
	 *    confirms via the type-delete gate. Defaults to false (plain push that
	 *    leaves remote-only files untouched).
	 */
	/** Snapshot the syncable local paths right now. Callers capture this BEFORE
	 *  markSyncGateAccepted opens the gate, then pass it to pushAll({replaceRemote})
	 *  so the wipe uses local-truth-at-sync-start and a gate-open live delivery
	 *  can't shield a remote extra from the wipe (test_86). */
	snapshotLocalPaths(): Set<string> {
		return new Set(
			this.app.vault
				.getFiles()
				.filter((f: TFile) => this.isSyncable(f) && !this.shouldIgnore(f.path))
				.map((f: TFile) => normalizePath(f.path)),
		);
	}

	async pushAll(
		opts: { replaceRemote?: boolean; localSnapshot?: Set<string> } = {},
	): Promise<number> {
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

		// Replace mode: wipe the entire remote BEFORE uploading so the server
		// ends up an exact mirror of local. Runs first so the "Delete all on
		// remote, then upload local files" label is literally true.
		if (opts.replaceRemote) {
			await this.wipeRemote(opts.localSnapshot);
		}

		const files = this.app.vault.getFiles();
		let toSync = files.filter((f: TFile) => this.isSyncable(f) && !this.shouldIgnore(f.path));
		// When a pre-gate snapshot is supplied (replace-remote), upload ONLY files
		// that existed before markSyncGateAccepted opened the gate. A note the
		// gate-open race delivered into the vault is a REMOTE note wipeRemote just
		// deleted — re-pushing it here would resurrect it (test_86) or 404 via the
		// delete-wins guard. Scoping both wipe and push to the snapshot makes the
		// op exactly "remote := local-at-sync-start".
		if (opts.localSnapshot) {
			const snap = opts.localSnapshot;
			toSync = toSync.filter((f: TFile) => snap.has(normalizePath(f.path)));
		}

		let pushed = 0;
		let failed = 0;
		const total = toSync.length;

		devLog().log("push", `pushAll: ${total} files`);
		rlog().info("push", `PushAll started — ${total} files`);

		this.emitPushing(0, total, 0);

		// Protocol rev: notes go through POST /notes/batch (100 per request);
		// attachments keep the per-file path. Pre-rev backends (or a sticky
		// 404) fall back to per-file pushes for everything.
		const noteFiles = toSync.filter((f: TFile) => !this.isBinaryFile(f));
		const attachFiles = toSync.filter((f: TFile) => this.isBinaryFile(f));

		const batchOutcome = await this.pushNotesViaBatch(
			noteFiles,
			true,
			(pushedSoFar, failedSoFar) => {
				this.emitPushing(pushedSoFar, total, failedSoFar);
			},
		);

		let perFile: TFile[];
		if (batchOutcome) {
			pushed += batchOutcome.pushed;
			failed += batchOutcome.failed;
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
			this.emitPushing(pushed, total, failed, batch[batch.length - 1]!.path);
		}

		// Flush first so the terminal "complete" can report the plan-skipped
		// tally (flush stashes it into lastBatchSkipped before resetting the
		// live counter). skipped and failed are disjoint — plan-skips never hit
		// the `failed` counter (pushFile returns false for them, no failed++).
		this.flushAttachmentLimitedToast();
		this.flushFailureSummaryToast();

		this.onSyncProgress?.({
			phase: "complete",
			current: pushed,
			total,
			failed,
			skipped: this.lastBatchSkipped,
		});

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
				// Same snapshot fence as the main push loop: when replace-remote
				// supplied a pre-gate snapshot, reconcile must not re-push a path
				// outside it. reconcile re-enumerates getFiles(), so a gate-open
				// race note wiped by wipeRemote would otherwise be classified
				// "missing" and resurrected here (delete-wins only masks it).
				const snap = opts.localSnapshot;
				for (const path of toFix) {
					if (snap && !snap.has(normalizePath(path))) {
						continue;
					}
					const file = this.app.vault.getFileByPath(normalizePath(path));
					if (file) {
						await this.pushFile(file, true);
					}
				}
			}
		}

		// Persist all hashes accumulated during pushAll + reconcile
		await this.saveData({ lastSync: this.lastSync });

		return pushed;
	}

	/** Delete EVERY remote note and attachment (the whole server vault), emitting
	 *  a `deleting` progress phase. Used by `pushAll({replaceRemote:true})` before
	 *  it re-uploads all local files, so the server ends up an exact mirror of
	 *  local. This is intentionally a full wipe (shared files are deleted then
	 *  recreated by the subsequent upload); the user confirms via the type-delete
	 *  gate. Failures on individual deletes are logged, not thrown, so the
	 *  re-upload still runs. */
	private async wipeRemote(localSnapshot?: Set<string>): Promise<void> {
		const manifest = await this.api.getManifest();
		if (!manifest) {
			rlog().warn("push", "wipeRemote skipped — backend has no /sync/manifest");
			return;
		}

		// Only wipe true remote EXTRAS — notes/attachments absent from the local
		// vault. A file that exists locally is about to be re-uploaded; deleting
		// it first tombstones its path, and the backend delete-wins guard then
		// refuses the same-path re-push as `recently_deleted` (permanent 404 —
		// the e2e test_86 regression). Leaving it lets the follow-up force-push
		// update it in place (id retained → CRDT room preserved, no tombstone).
		//
		// Prefer a caller-supplied PRE-GATE snapshot of local paths. push-all-
		// delete-remote runs markSyncGateAccepted() before this wipe, which opens
		// the gate and lets a queued live WS event inject a server-only note into
		// the vault BEFORE getFiles() reads it here — that note would then look
		// "local" and dodge the wipe (test_86 gate-open race: server proof showed
		// the extra's only DELETE arrived ~30s late). The snapshot is local truth
		// as of sync start, so a race-injected note is still wiped and genuinely-
		// local files are still kept.
		const localPaths =
			localSnapshot ??
			new Set(
				this.app.vault
					.getFiles()
					.filter((f) => this.isSyncable(f) && !this.shouldIgnore(f.path))
					.map((f) => normalizePath(f.path)),
			);
		const notePaths = manifest.notes
			.map((n) => n.path)
			.filter((p) => !localPaths.has(normalizePath(p)));
		const attachmentPaths = manifest.attachments
			.map((a) => a.path)
			.filter((p) => !localPaths.has(normalizePath(p)));
		const total = notePaths.length + attachmentPaths.length;

		rlog().info(
			"push",
			`wipeRemote — deleting ${notePaths.length} notes, ${attachmentPaths.length} attachments`,
		);

		let done = 0;
		this.onSyncProgress?.({ phase: "deleting", current: 0, total, failed: 0 });

		// Detach every live editor binding BEFORE any Y.Doc teardown below.
		// The wiped files stay on disk (nothing trashes them, so no view ever
		// closes) and a binding spanning removeDoc would write into a
		// destroyed doc. Rebind happens via the normal refresh events.
		this.crdtEditorDetach?.();

		for (const path of notePaths) {
			const normalized = normalizePath(path);
			// Mark BEFORE the delete — the fanout echo can beat the response.
			this.markWipedRemote(normalized);
			// Forget the note's server bindings UNCONDITIONALLY, not just on
			// REST success: a client-side timeout can mask a delete that landed
			// server-side, and retained bindings would crdt-skip/hash-skip the
			// re-push while the tombstone pull trashes the local file. If the
			// delete truly failed, the note is still live on the server and the
			// path-keyed re-push upserts it — convergent either way. A retained
			// serverHash would hash-skip every "unchanged" note (silent remote
			// loss) and a retained note_id points at a tombstone (dead CRDT
			// room, note_not_found join spam). The noteIdMap clear covers ALL
			// manifest notes (.canvas included); Y.Doc teardown is md-only,
			// same as the stream delete branch.
			this.syncState.delete(normalized);
			this.baseStore?.delete(normalized);
			const noteId = this.noteIdMap?.get(normalized) ?? null;
			this.noteIdMap?.delete(normalized);
			if (noteId && normalized.endsWith(".md")) {
				await this.crdt?.removeDoc(noteId);
				this.crdtEnrollment?.reset(noteId);
			}
			try {
				await this.api.deleteNote(path);
				this.logEntry("delete", path, "ok", undefined, "wipe-remote");
			} catch (e) {
				this.logEntry("delete", path, "error", errMsg(e));
			}
			done++;
			this.onSyncProgress?.({
				phase: "deleting",
				current: done,
				total,
				failed: 0,
				currentPath: path,
			});
		}
		for (const path of attachmentPaths) {
			const normalized = normalizePath(path);
			this.markWipedRemote(normalized);
			this.syncState.delete(normalized);
			try {
				await this.api.deleteAttachment(path);
				this.logEntry("delete", path, "ok", undefined, "wipe-remote");
			} catch (e) {
				this.logEntry("delete", path, "error", errMsg(e));
			}
			done++;
			this.onSyncProgress?.({
				phase: "deleting",
				current: done,
				total,
				failed: 0,
				currentPath: path,
			});
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

	/** Record a terminal (non-retryable) flush failure in the Sync Center and
	 *  dequeue the entry so it doesn't retry forever. Shared verbatim by both
	 *  runFlushQueue terminal paths (the crdt /updates branch and the legacy
	 *  note/attachment catch) so a change to how terminal failures surface can't
	 *  drift between them. */
	private async recordTerminalIssue(
		entry: QueueEntry,
		classified: ReturnType<typeof categorizeError>,
	): Promise<void> {
		const now = Date.now();
		this.issues.record({
			path: entry.path,
			kind: entry.kind ?? "note",
			category: classified.category,
			status: classified.status,
			message: classified.message,
			upgradeUrl: classified.upgradeUrl,
			firstFailedAt: now,
			lastFailedAt: now,
			attempts: 1,
		});
		if (issueDisposition(classified.category) === "informational") {
			this.attachmentLimitedThisBatch += 1;
		} else {
			this.failuresThisBatch += 1;
			this.firstFailureMessageThisBatch ??= classified.message;
		}
		await this.queue.dequeue(entry.path, entry.vaultId ?? this.settings.vaultId ?? undefined);
	}

	/** Decide the fate of a queue entry whose flush just failed, and act on it.
	 *  Both runFlushQueue failure paths route here so they can't drift. Terminal
	 *  errors (413, auth, plan-limit) park immediately; transient errors (network,
	 *  5xx) bump a PERSISTED attempt count and park only once they exhaust
	 *  RETRY_CAP — previously both paths hardcoded attempts=1, so a persistently-
	 *  failing entry retried forever and never surfaced as parked. Returns "retry"
	 *  (re-queued with the bumped count; caller stops this flush pass) or "parked"
	 *  (issue recorded + dequeued; caller keeps flushing the rest). */
	private async handleFlushFailure(entry: QueueEntry, e: unknown): Promise<"parked" | "retry"> {
		const classified = categorizeError(e);
		const attempts = (entry.attempts ?? 0) + 1;
		if (shouldRetryAfterFailure(classified, attempts)) {
			// Transient and under the cap: persist the bumped count (survives
			// reload) and stop this pass. Deliberately records NO issue — a
			// transient blip stays silent until it exhausts its retries.
			await this.queue.enqueue({ ...entry, attempts });
			this.maybeGoOffline(e);
			return "retry";
		}
		// Terminal, or transient past RETRY_CAP. A crdt entry's content lives in
		// the durable Y.Doc (keyed by noteId, not in this content-free entry), so
		// re-enroll it to re-drive delivery over the CRDT channel — the edit is
		// never lost even though REST couldn't carry it (e.g. a 413 too-large
		// /updates that the channel handshake can still merge). Then record a Sync
		// Center issue + dequeue so it stops looping.
		if (entry.crdt && entry.noteId) this.crdtEnrollment?.enroll(entry.noteId);
		await this.recordTerminalIssue(entry, classified);
		return "parked";
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
	 *  flushing. Non-transient failures — actionable (too_large, auth, conflict)
	 *  and informational (needs_pro, quota) — are left alone; retrying can't fix
	 *  them. Wired to "Retry all now". */
	async retryFailedNow(): Promise<number> {
		for (const issue of this.issues.all()) {
			if (issueDisposition(issue.category, issue.parseReason) !== "transient") continue;
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

	/** Single-flight wrapper around the queue drain. `goOnline()` fires a flush
	 *  fire-and-forget while other callers (post-pull catch-up, retryFailedNow,
	 *  and the e2e `restore_online` helper) may also await one. Two passes over
	 *  the same queue snapshot race: they double-push the same entries (each
	 *  duplicate collides on the server's note-path index) and, when a push
	 *  errors, one pass trips `maybeGoOffline()` + `break` mid-drain — so the
	 *  queue oscillates and never empties (root cause of the test_24
	 *  offline-replay flake). Coalesce to a single in-flight drain; concurrent
	 *  callers join it instead of competing. Mirrors the "coalesce concurrent
	 *  pulls" fix (#119). */
	flushQueue(): Promise<number> {
		if (this.flushInFlight) return this.flushInFlight;
		const pending = this.drainUntilStable().finally(() => {
			this.flushInFlight = null;
		});
		this.flushInFlight = pending;
		return pending;
	}

	/** Drain in re-snapshotting passes until the queue is empty or a pass makes
	 *  no progress / goes offline. Because callers coalesce onto one in-flight
	 *  flush, an entry enqueued WHILE a flush runs (e.g. retryFailedNow queues
	 *  then calls flushQueue, or a file edit lands mid-drain) would otherwise sit
	 *  stranded until the next unrelated trigger — its snapshot predates the
	 *  entry. Re-looping lets the active drain pick it up. */
	private async drainUntilStable(): Promise<number> {
		let total = 0;
		while (this.queue.size > 0) {
			const flushed = await this.runFlushQueue();
			total += flushed;
			// Stop on no progress (queue empty or all remaining entries failing)
			// or once a push tripped maybeGoOffline — don't hammer the server.
			if (flushed === 0 || this.offline) break;
		}
		return total;
	}

	private async runFlushQueue(): Promise<number> {
		const entries = this.queue.all();
		if (entries.length === 0) return 0;
		devLog().log("queue", `flush start — ${entries.length} entries`);
		rlog().info("queue", `Queue flush start — ${entries.length} entries`);

		let flushed = 0;
		for (const entry of entries) {
			// Sync gate closed (signed out / onboarding not accepted): stop pushing.
			// Checked per-entry so a drain already in flight when the gate closes
			// (e.g. sign-out mid-drain) halts instead of finishing the snapshot with
			// a now-empty bearer — the exact 401 spam this gate prevents. Remaining
			// entries stay queued and drain when the gate reopens (re-auth →
			// applySyncGate → fullSync → pushModifiedFiles → flushQueue).
			if (this.syncBlocked) break;
			try {
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
								entry.vaultId ?? this.settings.vaultId ?? undefined,
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
					// Durable CRDT delivery: a channel-down CRDT edit persisted a
					// crdt-tagged entry. Deliver via noteId-keyed /updates ops when
					// available — the Y.Doc is durable in IndexedDB so re-encoding on
					// retry is lossless. MUST encode by noteId, never by path (the
					// manager keys docs by noteId).
					if (entry.crdt && entry.noteId && this.crdt && this.crdtOpsAvailable()) {
						try {
							const update = await this.crdt.encodeStateAsUpdate(entry.noteId);
							await this.api.postUpdate(entry.noteId, update);
							await this.queue.dequeue(
								entry.path,
								entry.vaultId ?? this.settings.vaultId ?? undefined,
							);
							this.issues.clear(entry.path);
							flushed++;
						} catch (e) {
							if (isHttpStatus(e, 404) || isHttpStatus(e, 410)) {
								// Per-note: the note is gone server-side. Drop the entry
								// — this is NOT a capability signal (capability comes
								// only from the getVaultHeads probe).
								await this.queue.dequeue(
									entry.path,
									entry.vaultId ?? this.settings.vaultId ?? undefined,
								);
								this.issues.clear(entry.path);
								flushed++;
							} else if ((await this.handleFlushFailure(entry, e)) === "retry") {
								// Transient, under RETRY_CAP: re-queued with a bumped count;
								// parked (issue + dequeue) once retries exhaust. Stop this pass.
								break;
							}
						}
						continue;
					}

					if (entry.crdt && !this.crdtOpsAvailable()) {
						// Ops unavailable (old backend / probe latched off): fall
						// through to the legacy whole-doc push below. Clear the stale
						// serverHash first — prior CRDT-ops flushes advanced the
						// server body without recording a new serverHash, so the old
						// CAS base would 409. A no-base push overwrites deliberately.
						const key = normalizePath(entry.path);
						const existing = this.syncState.get(key);
						if (existing?.serverHash !== undefined) {
							this.syncState.set(key, { ...existing, serverHash: undefined });
						}
					}

					// Note upsert — legacy entries have content; new entries are content-free
					let content = entry.content;
					let mtime = entry.mtime;
					if (content === undefined) {
						const file = this.app.vault.getFileByPath(entry.path);
						if (!file) {
							// The file is gone (deleted, or renamed away during the offline
							// window). A crdt entry's edit still lives in the durable Y.Doc
							// (keyed by noteId, not this stale path), so re-enroll to deliver
							// it over the CRDT channel instead of silently dropping it; a
							// non-crdt entry has nothing left to send.
							if (entry.crdt && entry.noteId)
								this.crdtEnrollment?.enroll(entry.noteId);
							await this.queue.dequeue(
								entry.path,
								entry.vaultId ?? this.settings.vaultId ?? undefined,
							);
							this.issues.clear(entry.path);
							flushed++;
							continue;
						}
						content = await this.app.vault.cachedRead(file);
						mtime = file.stat.mtime / 1000;
					}
					// Mint-and-send the client id like a live push — and adopt the id
					// the server echoes back. The replay path never adopted, so a
					// create-race during the offline window left the CRDT receive
					// path keyed to a dead local id (2026-07-07 incident class).
					const replayNp = normalizePath(entry.path);
					let replayId = this.noteIdMap?.get(replayNp) ?? null;
					if (!replayId && this.noteIdMap) {
						replayId = uuid7();
						this.noteIdMap.set(replayNp, replayId);
					}
					// CAS base, mirroring pushFile: a queued edit may be STALE (the
					// server moved on during the offline window) — without base_hash
					// it sails past the v0.5.642 gate and overwrites content this
					// client never saw. Same 3-shape cascade as pushFile (several
					// tests pin pushNote's exact arguments.length).
					const replayState = this.syncState.get(replayNp);
					const replayBase = replayState?.serverHash;
					const resp =
						replayBase !== undefined
							? await this.api.pushNote(
									entry.path,
									content,
									mtime!,
									replayState?.version,
									replayId ?? undefined,
									replayBase,
								)
							: replayId
								? await this.api.pushNote(
										entry.path,
										content,
										mtime!,
										undefined,
										replayId,
									)
								: await this.api.pushNote(entry.path, content, mtime!);
					if ("conflict" in resp) {
						// Hand the conflict to the single-note flow, which owns 3-way
						// merge + resolution — previously a conflicting replay was
						// silently dequeued and the local edit vanished from the
						// pipeline with no conflict handling at all. pushFile re-reads
						// current disk content (fresher than the queued snapshot).
						const conflicted = this.app.vault.getFileByPath(entry.path);
						if (conflicted) await this.pushFile(conflicted, true);
					}
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
						if (resp.note.id) {
							this.noteIdMap?.set(np, resp.note.id);
							this.refireEnrollmentOnFirstConfirm(resp.note.id, entry.path, content);
							this.confirmNoteId(resp.note.id);
						}
					}
				}
				await this.queue.dequeue(
					entry.path,
					entry.vaultId ?? this.settings.vaultId ?? undefined,
				);
				this.issues.clear(entry.path);
				flushed++;
			} catch (e) {
				// Terminal or retries-exhausted parks (issue + dequeue) and keeps
				// flushing; a transient under RETRY_CAP re-queues and stops this pass.
				if ((await this.handleFlushFailure(entry, e)) === "retry") break;
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
		for (const timer of this.recentlyFlushed.values()) {
			window.clearTimeout(timer);
		}
		this.recentlyFlushed.clear();
		// NOTE: a reload mid-replace-remote starts the NEW engine with an empty
		// wipedRemote while old wipe echoes may still be in flight; on #970
		// backends the device_id drop still covers them, on older backends the
		// residual risk window is accepted (mid-wipe reloads are rare).
		for (const timer of this.wipedRemote.values()) {
			window.clearTimeout(timer);
		}
		this.wipedRemote.clear();
		for (const timer of this.remotelyDeleted.values()) {
			window.clearTimeout(timer);
		}
		this.remotelyDeleted.clear();
		this.pendingPostPullPushes.clear();
		if (this.postPullDrainTimer !== null) {
			window.clearTimeout(this.postPullDrainTimer);
			this.postPullDrainTimer = null;
		}
		if (this.degradedNoticeTimer) window.clearTimeout(this.degradedNoticeTimer);
		this.degradedNoticeTimer = null;
		this.pendingDegraded.clear();
		this.stopHealthCheck();
		this.queue.destroy();
	}
}
