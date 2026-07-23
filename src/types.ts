import type { PlanState } from "./plan-state";

/** Plugin settings stored in data.json */
export interface EngramSyncSettings {
	/** Engram base URL (e.g. "http://10.0.20.214:8000") */
	apiUrl: string;
	/** Bearer token for Engram (e.g. "engram_abc123...") */
	apiKey: string;
	/** Glob patterns to ignore (one per line). Defaults: .obsidian/, .trash/, .git/ */
	ignorePatterns: string;
	/** Debounce delay in ms for modify events */
	debounceMs: number;
	/** Preferred conflict diff view: unified or side-by-side */
	conflictViewMode: "unified" | "side-by-side";
	/** Single diagnostics switch. When on: ship sync/error events AND verbose
	 *  vault/editor/WS activity to the server, AND attach distributed-tracing
	 *  headers to requests. Metadata only, never note content. Default OFF.
	 *  Collapses the former remoteLoggingEnabled / diagnosticMode / tracingEnabled
	 *  trio (migrated in settings-migrate.ts). */
	diagnosticsEnabled: boolean;
	/** How to handle conflicts that can't be auto-merged.
	 *  "auto" creates a conflict copy file (non-blocking).
	 *  "modal" shows the interactive diff modal. */
	conflictResolution: "auto" | "modal";
	/** Server-assigned vault ID. Populated after registration. Null until first sync. */
	vaultId: string | null;
	/** Server-side name for the selected vault, mirrored from the registration
	 *  response or the vault picker. Used as the cloud-side label in the sync
	 *  preview modal. Optional for migration — older saves predate this field. */
	remoteVaultName?: string;
	/** Stable client-generated vault identifier (SHA-256 of vault absolute path).
	 *  Generated once on first load, persisted forever. Used for idempotent registration. */
	clientId: string;
	/** OAuth refresh token (device flow). When set, OAuth takes precedence over apiKey. */
	refreshToken?: string;
	/** Cached OAuth access token, persisted so a reload within its lifetime can
	 *  reuse it instead of refreshing (which would consume the single-use
	 *  refresh token on every restart). */
	accessToken?: string;
	/** Epoch ms when the cached access token expires. */
	accessTokenExpiresAt?: number;
	/** The vaultId the cached access token was minted for. Binds the token to
	 *  its session: if the active vault changes (account swap) without the token
	 *  being refreshed, the stale token must NOT be reused — it belongs to the
	 *  old user and would 404 against the new vault. */
	accessTokenVaultId?: string | null;
	/** Email of the OAuth-authenticated user (for display). */
	userEmail?: string;
	/** Active auth method. */
	authMethod?: "oauth" | "api_key" | null;
	/** Last-known plan/limit state pushed by the backend over the WebSocket.
	 *  Null until the first plan event is received (or older backend). */
	planState?: PlanState | null;
	/** Default mode for the search panel's toggle. */
	searchDefaultMode: SearchMode;
	/** True once the first-run waitlist popup has been shown (submitted OR
	 *  dismissed). Set once, never re-shown. */
	waitlistPromptSeen?: boolean;
}

/** Which search backend the panel uses. */
export type SearchMode = "semantic" | "keyword" | "hybrid";

/** A normalized, note-level search result shared across all modes. */
export interface UnifiedSearchResult {
	source_path: string;
	title?: string;
	/** Snippet text shown in the result list / preview. */
	text: string;
	/** Heading trail (semantic / hybrid-semantic side only). */
	heading_path?: string;
	score: number;
	/** How this note matched: semantic vector, keyword/lexical, or both (hybrid). */
	matchType?: "semantic" | "keyword" | "both";
}

export const DEFAULT_SETTINGS: EngramSyncSettings = {
	apiUrl: "",
	apiKey: "",
	ignorePatterns: "",
	debounceMs: 2000,
	conflictViewMode: "unified",
	diagnosticsEnabled: false,
	conflictResolution: "auto",
	vaultId: null,
	clientId: "",
	planState: null,
	searchDefaultMode: "hybrid",
	waitlistPromptSeen: false,
};

/** Structured reason a note's frontmatter failed to parse cleanly. Mirrors the
 *  backend `parse_reason` shape (snake_case on the wire). `snippet` is already
 *  capped <=200 chars server-side. */
export interface ParseReasonDetail {
	key: string | null;
	line: number | null;
	snippet: string;
}
export interface ParseReason {
	code: "frontmatter_invalid_yaml" | "frontmatter_unparseable_key" | "note_processing_failed";
	message: string;
	detail: ParseReasonDetail | null;
}

/** A note as returned by POST /notes */
export interface NoteResponse {
	note: {
		id: string;
		user_id: string;
		path: string;
		title: string;
		folder: string;
		tags: string[];
		mtime: number;
		created_at: string;
		updated_at: string;
		version?: number;
		/** Opaque server-side content hash (HMAC) — store per path, never compute locally. */
		content_hash?: string;
		parse_status?: "ok" | "degraded";
		parse_reason?: ParseReason | null;
	};
	chunks_indexed: number;
}

/** A change entry from GET /notes/changes.
 *  `content` is absent on `fields=meta` pages (protocol rev) — callers must
 *  resolve the body before applying a non-deleted change. `content_hash` is
 *  the server's opaque hash; compare it to the stored per-path serverHash. */
export interface NoteChange {
	path: string;
	title: string;
	content?: string;
	content_hash?: string;
	folder: string;
	tags: string[];
	mtime: number;
	updated_at: string;
	deleted: boolean;
	version?: number;
	/** Vault-global change seq of the source row (present on replayed/enumerated
	 *  feed rows via applyOp; absent on shapes that predate the seq feed). Feeds
	 *  the per-path stale-row fence in applyChange. */
	seq?: number;
}

/** Response from GET /notes/changes */
export interface ChangesResponse {
	changes: NoteChange[];
	server_time: string;
	/** Protocol rev pagination — absent on pre-rev backends. */
	has_more?: boolean;
	next_cursor?: string | null;
}

/** A note entry from the MERGED ordered feed GET /sync/changes (PR B2).
 *  `content` is absent on meta-only pages; `content_hash` is the server's
 *  opaque hash. `seq` is the per-vault monotonic change sequence. */
export interface SyncNoteChange {
	type: "note";
	id: string;
	seq: number;
	path: string;
	title: string;
	content?: string;
	content_hash?: string;
	folder: string;
	tags: string[];
	mtime: number;
	updated_at: string;
	deleted: boolean;
	version?: number;
	parse_status?: "ok" | "degraded";
	parse_reason?: ParseReason | null;
}

/** The single markdown-sync op shape (Phase C). BOTH the live fan-out and the
 *  catch-up replay produce this; `applyOp` is the sole apply path for it.
 *  `kind` replaces the wire `deleted` flag. `seq` is the per-vault monotonic
 *  sequence (absent on live ops until Phase D wires it through). Attachments are
 *  NOT ops — they stay on the content-addressed binary channel. */
export interface SyncOp {
	kind: "upsert" | "delete";
	id: string;
	path: string;
	seq?: number;
	title: string;
	content?: string;
	content_hash?: string;
	folder: string;
	tags: string[];
	mtime: number;
	updated_at: string;
	version?: number;
	parse_status?: "ok" | "degraded";
	parse_reason?: ParseReason | null;
}

/** An attachment entry from GET /sync/changes — metadata only, no bytes. */
export interface SyncAttachmentChange {
	type: "attachment";
	id: string;
	seq: number;
	path: string;
	mime_type: string;
	size_bytes: number;
	mtime: number;
	updated_at: string;
	deleted: boolean;
	version?: number;
}

/** A single entry in the merged ordered feed — note or attachment, tagged. */
export type SyncChange = SyncNoteChange | SyncAttachmentChange;

/** Response from DELETE /notes/{path} */
export interface DeleteResponse {
	deleted: boolean;
	path: string;
}

/** A note change event from the WebSocket stream */
export interface NoteStreamEvent {
	event_type: "upsert" | "delete";
	path: string;
	timestamp: number;
	kind?: "note" | "attachment";
	/** Opaque device identity of the REST caller that caused this change
	 *  (server-stamped from the X-Device-Id header, #970). Lets a device drop
	 *  its own fanout echo — REST changes have no socket to exclude
	 *  server-side, which is how the 2026-07-08 replace-remote wipe applied
	 *  its own delete echoes locally. */
	device_id?: string;
	/** The note's stable note_id, carried by the server's `note_changed` /
	 *  `notes.batch` upsert broadcasts. Since CRDT rooms are keyed by note_id
	 *  (not path), a device that has never seen this note needs the id from the
	 *  broadcast itself to enroll in its room — without it, it can neither join
	 *  the room nor (under the C1 skip) apply the body, and the change is
	 *  received but never materialized. */
	id?: string;
	/** Inline note data — present when the server includes content in the broadcast.
	 *  Dual-field transition: protocol-rev backends send BOTH content and
	 *  content_hash for one release, then drop content. */
	content?: string;
	content_hash?: string;
	title?: string;
	folder?: string;
	tags?: string[];
	mtime?: number;
	updated_at?: string;
	version?: number;
}

/** A queued change waiting to be pushed when connectivity returns. */
export interface QueueEntry {
	path: string;
	action: "upsert" | "delete";
	/** Note content (only for text upserts). */
	content?: string;
	/** Base64 content (only for attachment upserts). */
	contentBase64?: string;
	/** MIME type (only for attachment upserts). */
	mimeType?: string;
	/** File mtime in seconds (only for upserts). */
	mtime?: number;
	/** When this entry was queued (epoch ms). */
	timestamp: number;
	/** Whether this is a note or attachment. */
	kind?: "note" | "attachment";
	/** Vault ID for dedup isolation. */
	vaultId?: string;
	/** Set on a channel-down CRDT edit: deliver via /updates ops (encode the
	 *  note's Y.Doc by noteId), falling back to the legacy push only when ops
	 *  are unavailable. */
	noteId?: string;
	crdt?: boolean;
	/** Transient-failure retry count, persisted so a permanently-failing entry
	 *  is parked after RETRY_CAP attempts instead of retrying forever across
	 *  reloads. Absent = never failed. */
	attempts?: number;
}

/** Request body for POST /search */
export interface SearchRequest {
	query: string;
	limit?: number;
	tags?: string[];
	folder?: string;
}

/** A single search result from Engram's `POST /api/search`.
 *  The grouped/web-card response uses `path` + `snippet`; older/raw-chunk
 *  responses use `source_path` + `text`. The plugin tolerates both. */
export interface SearchResult {
	/** Web-card shape (current backend). */
	path?: string;
	snippet?: string;
	/** Raw-chunk shape (older / api-contract.md). */
	text?: string;
	source_path?: string;
	title?: string;
	heading_path?: string;
	folder?: string;
	tags?: string[];
	wikilinks?: string[];
	score: number;
	vector_score?: number;
	rerank_score?: number;
	match_count?: number;
}

/** Response from POST /search */
export interface SearchResponse {
	query: string;
	results: SearchResult[];
}

/** Sync engine status for UI updates. */
export type SyncState = "idle" | "syncing" | "error" | "offline";

export interface SyncStatus {
	state: SyncState;
	/** Number of files waiting in debounce queue. */
	pending: number;
	/** Number of changes queued for retry (offline queue). */
	queued: number;
	/** Last sync ISO timestamp, or empty string if never synced. */
	lastSync: string;
	/** Error message when state is "error". */
	error?: string;
}

/** Info passed to conflict resolution UI. */
export interface ConflictInfo {
	path: string;
	localContent: string;
	localMtime: number;
	remoteContent: string;
	remoteMtime: number;
	/** Common ancestor content from last successful sync (for 3-way merge). */
	baseContent?: string;
	/** Vault name for display in conflict modal. */
	vaultName?: string;
}

/** User's choice for resolving a sync conflict. */
export type ConflictChoice = "keep-local" | "keep-remote" | "keep-both" | "merge" | "skip";

/** Result returned by the conflict resolution modal. */
export interface ConflictResolution {
	choice: ConflictChoice;
	/** Merged content when choice is "merge". */
	mergedContent?: string;
}

/** Full note as returned by GET /notes/{path} */
export interface NoteDetail {
	path: string;
	title: string;
	content: string;
	/** Opaque server-side content hash (protocol rev). */
	content_hash?: string;
	folder: string;
	tags: string[];
	mtime: number;
	created_at: string;
	updated_at: string;
	version?: number;
	parse_status?: "ok" | "degraded";
	parse_reason?: ParseReason | null;
}

/** Attachment metadata as returned by POST /attachments */
export interface AttachmentResponse {
	attachment: {
		id: string;
		user_id: string;
		path: string;
		mime_type: string;
		size_bytes: number;
		mtime: number;
		created_at: string;
		updated_at: string;
	};
}

/** Full attachment as returned by GET /attachments/{path} */
export interface AttachmentDetail {
	id: string;
	path: string;
	content_base64: string;
	mime_type: string;
	size_bytes: number;
	mtime: number;
	created_at: string;
	updated_at: string;
}

/** A change entry from GET /attachments/changes */
export interface AttachmentChange {
	path: string;
	mime_type: string;
	size_bytes: number;
	mtime: number;
	updated_at: string;
	deleted: boolean;
}

/** Response from GET /attachments/changes */
export interface AttachmentChangesResponse {
	changes: AttachmentChange[];
	server_time: string;
}

/** A single entry in the sync manifest (path + content hash). */
export interface ManifestEntry {
	/** Stable server note_id (backend render_manifest projects it, T3.6+). The
	 *  authoritative id->path source the plugin reconciles noteIdMap from so
	 *  inbound CRDT frames (keyed by note_id) can resolve a disk path. Optional
	 *  to tolerate a pre-T3.6 self-host backend that omitted it. */
	id?: string;
	path: string;
	content_hash: string;
	version?: number;
	/** Vault-global change seq of the row's last write (Phase E1 #1065) — the
	 *  integer-diff validation hook. Optional: a pre-E1 backend omits it. */
	seq?: number;
	/** CRDT head fingerprint (notes only, Phase E1) — equality with the
	 *  locally-recorded crdtHead proves a live-bound doc converged without
	 *  content transfer. Optional: pre-E1 backend / attachment rows omit it. */
	crdt_head?: string;
}

/** Per-file sync metadata tracked by the plugin. */
export interface FileSyncState {
	/** FNV-1a 32-bit content hash of last synced content. */
	hash: number;
	/** Server version counter (monotonic, from backend). */
	version?: number;
	/** Last server content_hash seen for this path (opaque HMAC, from push
	 *  responses / changes pages / broadcasts). Never computed locally. */
	serverHash?: string;
	/** Last CRDT head marker (sha256(state_vector) url-b64) synced for this
	 *  path via cold-receive. Separate namespace from serverHash (which is the
	 *  /changes content_hash). Absent = never cold-synced. */
	crdtHead?: string;
	/** Per-path high-water mark of the vault-global change `seq` observed for
	 *  this path (live fan-out ops and replayed rows). Used ONLY to reject
	 *  OLDER rows for the same path in catch-up (a replayed/enumerated row at
	 *  or below this mark is history, not divergence — backfilling it reverts
	 *  newer live-applied content). Never advances the global replay cursor. */
	seq?: number;
}

/** A single entry in the sync log ring buffer. */
export interface SyncLogEntry {
	timestamp: Date;
	action: "push" | "pull" | "delete" | "conflict" | "skip" | "error";
	path: string;
	result: "ok" | "error" | "skipped";
	error?: string;
	details?: string;
}

export type SyncIssueCategory =
	| "too_large"
	| "auth"
	| "server"
	| "network"
	| "conflict"
	| "needs_pro"
	| "quota"
	| "frontmatter"
	| "other";

/** A file the sync engine could not push or pull. Persisted across reloads
 *  so the user has a stable list of "what's broken and why" instead of
 *  failures vanishing into the offline queue. */
export interface SyncIssue {
	path: string;
	kind: "note" | "attachment";
	category: SyncIssueCategory;
	/** HTTP status if the failure was an HTTP response. */
	status?: number;
	message: string;
	/** File size in bytes — set when category is "too_large". */
	sizeBytes?: number;
	/** Billing/upgrade URL — set when category is "needs_pro". */
	upgradeUrl?: string;
	/** Structured parse failure detail — set when category is "frontmatter". */
	parseReason?: ParseReason;
	firstFailedAt: number;
	lastFailedAt: number;
	attempts: number;
}

/** Vault information returned by GET /vaults */
export interface VaultInfo {
	id: string;
	name: string;
	slug: string;
	is_default: boolean;
	created_at: string;
}

export interface SyncPlan {
	vaultName: string;
	serverNoteCount: number;
	serverAttachmentCount: number;
	serverFolderCount: number;
	localNoteCount: number;
	localAttachmentCount: number;
	localFolderCount: number;
	/** Every syncable path that currently exists locally. Used by the deletion
	 *  preview tree to decide whether a folder is fully going away or just
	 *  losing some leaves. */
	localPaths: string[];
	/** Every path the server has in this vault. Same role as localPaths, for
	 *  the push-all-delete-remote preview. */
	serverPaths: string[];
	toPush: { notes: string[]; attachments: string[] };
	toPull: { notes: string[]; attachments: string[] };
	conflicts: string[];
	toDeleteLocal: string[];
	toDeleteRemote: string[];
}

export interface SyncProgress {
	phase: "deleting" | "pushing" | "pulling" | "attachments" | "complete";
	current: number;
	total: number;
	failed: number;
	/** Plan-gated / informational attachments that were skipped (not failures).
	 *  Counted separately from `failed` so the completion summary can show a
	 *  three-way ✓ synced · ⤳ skipped (plan) · ✕ failed tally. Optional —
	 *  non-complete phases and older callers omit it (treated as 0). */
	skipped?: number;
	/** Current file being processed (optional, for display). */
	currentPath?: string;
}

/** 409 conflict response from the server when expected_version mismatches. */
export interface VersionConflictResponse {
	conflict: true;
	/** Present when the 409 is a delete-wins refusal (backend: a create at a
	 *  path deleted within the window with identical content). No server_note
	 *  accompanies it — the client converges by trashing its local copy. */
	reason?: "recently_deleted";
	server_note: {
		id: string;
		path: string;
		title: string;
		content: string;
		content_hash?: string;
		folder: string;
		tags: string[];
		mtime: number;
		created_at: string;
		updated_at: string;
		version: number;
		parse_status?: "ok" | "degraded";
		parse_reason?: ParseReason | null;
	};
}

/** Response from GET /sync/manifest */
export interface ManifestResponse {
	notes: ManifestEntry[];
	attachments: ManifestEntry[];
	total_notes: number;
	total_attachments: number;
	/** Cursor-pull bootstrap watermark (backend PR B1) — the change seq the
	 *  manifest reflects, used to seed the cursor for the first delta pull. */
	change_seq?: number;
	/** Phase E1 (#1065): true when `?since_seq=` matched the server watermark —
	 *  nothing changed, and the notes/attachments body is OMITTED. */
	unchanged?: boolean;
}

/** Response from POST /api/vaults/register */
export interface VaultRegistrationResponse {
	id: string;
	name: string;
	slug: string;
	is_default: boolean;
}

/** Result of reconciliation — files that differ between local and server. */
export interface ReconcileResult {
	missing: string[];
	diverged: string[];
	extraOnServer: string[];
}

/** Why the SyncPreviewModal opened. Controls header copy.
 *  - "first-time": user has never accepted a sync gate before.
 *  - "vault-switch": gate fingerprint exists but doesn't match (vault/account changed).
 *  - "review": gate already accepted; user re-opened (Sync Center, status bar). */
export type SyncPreviewContext = "first-time" | "vault-switch" | "review";

/** User's chosen sync direction in the SyncPreviewModal.
 *  Drives dispatch in main.ts → runSyncFromChoice. */
export type SyncChoice =
	| "smart-merge"
	| "pull-all-delete-local"
	| "pull-all-keep-local"
	| "push-all-delete-remote"
	| "push-all-keep-remote"
	| "cancel"
	| "change-vault";

/** Subset of SyncChoice values that delete data on either side. Used by the
 *  modal to gate behind the typed-DELETE confirm view. */
export const DESTRUCTIVE_CHOICES = new Set<SyncChoice>([
	"pull-all-delete-local",
	"push-all-delete-remote",
]);
