/**
 * Engram HTTP client.
 *
 * Uses Obsidian's requestUrl() which bypasses CORS and works on mobile.
 */
import { type RequestUrlResponse, requestUrl } from "obsidian";
import type { AuthProvider } from "./auth";
import { type PreflightResult, interpretHealthProbe } from "./auth-state";
import { LimitExceededError } from "./limit-error";
import { BeaconBuffer } from "./observability/beacon";
import { newTraceContext } from "./observability/traceGen";
import { rlog } from "./remote-log";
import type {
	AttachmentChangesResponse,
	AttachmentDetail,
	AttachmentResponse,
	BatchUpsertResponse,
	ChangesResponse,
	DeleteResponse,
	ManifestResponse,
	NoteDetail,
	NoteResponse,
	SearchResponse,
	SyncChangesResponse,
	VaultInfo,
	VaultRegistrationResponse,
	VersionConflictResponse,
} from "./types";

export class EngramApi {
	private vaultId: string | null = null;
	private deviceId: string | null = null;
	private authProvider: AuthProvider | null = null;
	// Dark-launch gate for distributed tracing. Disabled cost must stay a
	// single boolean check, see sendRequest.
	private tracingEnabled = false;
	// Cached from the most recent sendRequest call so the beacon transport
	// thunk (invoked later, on the buffer's own flush timer) can post with a
	// still-valid token without re-awaiting the auth provider.
	private lastToken = "";
	/** Coalescing beacon buffer for `obsidian.push` spans. Transport thunk
	 *  returns null (drop, no network) whenever tracing is disabled. */
	readonly beacon: BeaconBuffer;

	constructor(
		private baseUrl: string,
		private apiKey: string,
	) {
		this.baseUrl = EngramApi.normalizeBaseUrl(baseUrl);
		this.beacon = new BeaconBuffer(() => {
			if (!this.tracingEnabled) return null;
			return {
				baseUrl: this.baseUrl,
				token: this.lastToken,
				vaultId: this.getActiveVaultId() ?? "",
				deviceId: this.deviceId ?? "",
			};
		});
	}

	/** Enable/disable trace header injection + the obsidian.push beacon. When
	 *  false, sendRequest does no id generation, no timing capture, no header,
	 *  and enqueues nothing: cost is exactly one boolean check. */
	setTracingEnabled(enabled: boolean): void {
		this.tracingEnabled = enabled;
	}

	setVaultId(id: string | null): void {
		this.vaultId = id;
	}

	/** Set the per-install device id sent as X-Device-Id on cursor pulls. */
	setDeviceId(id: string | null): void {
		this.deviceId = id && id.length > 0 ? id : null;
	}

	setAuthProvider(provider: AuthProvider | null): void {
		this.authProvider = provider;
	}

	getActiveVaultId(): string | null {
		if (this.authProvider) {
			return this.authProvider.getVaultId();
		}
		return this.vaultId;
	}

	private async getAuthToken(): Promise<string> {
		if (this.authProvider) {
			return this.authProvider.getToken();
		}
		return this.apiKey;
	}

	/** Strip trailing slashes and append /api if not already present. */
	private static normalizeBaseUrl(url: string): string {
		const base = url.replace(/\/+$/, "");
		return base.endsWith("/api") ? base : `${base}/api`;
	}

	/** Probe an arbitrary candidate URL's `/api/health` WITHOUT committing it as
	 *  the active backend. Used by the self-hosted settings preflight so the user
	 *  gets background confirmation a URL points at a real Engram server before
	 *  they commit to it. No auth — `/health` is public. */
	static async probeHealth(rawUrl: string): Promise<PreflightResult> {
		const base = EngramApi.normalizeBaseUrl(rawUrl);
		try {
			const resp = await requestUrl({ url: `${base}/health`, method: "GET", throw: false });
			let body: unknown = null;
			try {
				body = resp.json;
			} catch {
				body = null;
			}
			return interpretHealthProbe(resp.status, body);
		} catch {
			return { kind: "unreachable" };
		}
	}

	updateConfig(baseUrl: string, apiKey: string): void {
		this.baseUrl = EngramApi.normalizeBaseUrl(baseUrl);
		this.apiKey = apiKey;
	}

	private async request(
		method: string,
		path: string,
		body?: unknown,
		extraHeaders?: Record<string, string>,
	): Promise<RequestUrlResponse> {
		try {
			return await this.sendRequest(method, path, body, extraHeaders);
		} catch (e) {
			const status = (e as { status?: number }).status;
			// 402 = tier limit exceeded. Convert to a typed error carrying the
			// structured body (reason / limit_key / limit / current / upgrade_url)
			// so callers can route on reason (toast handler, Sync Center) without
			// re-parsing JSON. Placed BEFORE the 401 retry and generic-throw paths
			// so 402 always gets the rich error — see spec §4.6.
			if (status === 402) {
				throw parseLimitExceededError(e);
			}
			// On 401, the cached access token may be stale (e.g. server-side TTL
			// shorter than the expires_in we trusted). Invalidate and retry once
			// with a freshly-refreshed token. Static-key providers have no
			// recovery path, so retry only when invalidateAccessToken is supported.
			if (status === 401 && this.authProvider?.invalidateAccessToken) {
				this.authProvider.invalidateAccessToken();
				return this.sendRequest(method, path, body, extraHeaders);
			}
			// Log every non-2xx with method/status/vault so failures are legible
			// (a 404 here meaning "token's user doesn't own this vault" is easy
			// to misread as a missing note otherwise). Token itself is never logged.
			rlog().warn(
				"api",
				`${method} ${path} failed — status=${status ?? "none"} vault=${this.vaultId ?? "none"}`,
			);
			throw e;
		}
	}

	private async sendRequest(
		method: string,
		path: string,
		body?: unknown,
		extraHeaders?: Record<string, string>,
	): Promise<RequestUrlResponse> {
		const token = await this.getAuthToken();
		this.lastToken = token;
		// Scope tracing to mutations only: GET requests are zero-cost (no tracing).
		// Gate BEFORE any tracing work: disabled or GET = one boolean check, nothing else.
		// No id generation, no header, no timing capture, no network.
		const traced = this.tracingEnabled && method.toUpperCase() !== "GET";
		const trace = traced ? newTraceContext() : null;
		const startUs = trace ? Date.now() * 1000 : 0;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			...(trace ? { traceparent: trace.traceparent } : {}),
			...extraHeaders,
		};
		// Use the *active* vault (OAuth provider's bound vault, or the raw field
		// for API-key auth) — NOT the raw this.vaultId. For OAuth installs the
		// field can be empty while the provider holds the real vault, which made
		// vault-scoped REST calls (notably /search) fall back to the user's
		// default vault server-side (VaultPlug defaults when X-Vault-ID is absent).
		const activeVaultId = this.getActiveVaultId();
		if (activeVaultId) {
			headers["X-Vault-ID"] = activeVaultId;
		}
		if (this.deviceId) {
			headers["X-Device-Id"] = this.deviceId;
		}
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		try {
			return await requestUrl({
				url: `${this.baseUrl}${path}`,
				method,
				headers,
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
		} finally {
			// Fire-and-forget: enqueue is O(1), touches no network on this path
			// (the buffer batches/flushes on its own timer), and never blocks or
			// fails the request above, including on the error path, so a failed
			// push still yields a trace.
			if (trace) {
				this.beacon.enqueue({
					trace_id: trace.traceId,
					parent_span_id: trace.spanId,
					name: "obsidian.push",
					start_us: startUs,
					end_us: Date.now() * 1000,
					attributes: {
						"engram.surface": "obsidian",
						"engram.event_type": method.toLowerCase(),
					},
				});
			}
		}
	}

	/** Health check — no auth required. */
	async health(): Promise<boolean> {
		try {
			const resp = await requestUrl({
				url: `${this.baseUrl}/health`,
				method: "GET",
			});
			return resp.status === 200;
		} catch {
			return false;
		}
	}

	/** Get the current authenticated user (id + email). Used to determine channel topic. */
	async getMe(): Promise<{ id: string; email: string }> {
		const resp = await this.request("GET", "/me");
		return (resp.json as { user: { id: string; email: string } }).user;
	}

	/** Register this vault with the backend. Returns existing vault if client_id matches.
	 *  Throws with status 402 if user has reached their vault limit (free tier). */
	async registerVault(name: string, clientId: string): Promise<VaultRegistrationResponse> {
		const resp = await this.request("POST", "/vaults/register", {
			name,
			client_id: clientId,
		});
		return resp.json as VaultRegistrationResponse;
	}

	/** Create a brand-new, distinct vault for the current user. Unlike
	 *  registerVault (idempotent by client_id), this always makes a new vault.
	 *  Throws with status 402 if the user has reached their vault limit, or 422
	 *  on validation errors. */
	async createVault(name: string): Promise<VaultInfo> {
		const resp = await this.request("POST", "/vaults", { name });
		return (resp.json as { vault: VaultInfo }).vault;
	}

	/** Submit a user-initiated issue report from this plugin surface. */
	async reportIssue(description: string, appVersion: string): Promise<void> {
		await this.request("POST", "/reports", {
			description,
			surface: "plugin",
			app_version: appVersion,
		});
	}

	/** Fetch all vaults accessible by the current user. Throws the underlying
	 *  request error (with `.status` for HTTP responses) so callers can render
	 *  401/timeout/5xx distinctly from "successful empty list". */
	async listVaults(): Promise<VaultInfo[]> {
		const resp = await this.request("GET", "/vaults");
		return (resp.json as { vaults: VaultInfo[] }).vaults;
	}

	/** Authenticated ping — verifies both connectivity and API key. */
	async ping(): Promise<{ ok: boolean; error?: string }> {
		try {
			await this.request("GET", "/folders");
			return { ok: true };
		} catch (e: unknown) {
			const status = (e as { status?: number }).status;
			if (status === 401 || status === 403) {
				return { ok: false, error: "Invalid API key" };
			}
			// Surface the real HTTP status (e.g. a 404 from a stale token at the
			// wrong vault) instead of a blanket "Connection failed" — the status
			// is the difference between "server down" and "auth/vault mismatch".
			if (typeof status === "number") {
				return { ok: false, error: `HTTP ${status} from /folders` };
			}
			return { ok: false, error: "Connection failed" };
		}
	}

	/** Push a note to Engram.
	 *  When version is provided, the server uses optimistic concurrency control:
	 *  returns 409 with the current server state if the version doesn't match.
	 *  `clientId` carries a plugin-minted note_id (UUIDv7) for a note whose id
	 *  isn't yet known server-side — sent as the body `id` field, which the
	 *  server adopts as the note's primary key on first create (note_id-keyed
	 *  CRDT rework, Task 5). Harmless to send for an existing note: the server
	 *  already has an id and ignores it. */
	async pushNote(
		path: string,
		content: string,
		mtime: number,
		version?: number,
		clientId?: string,
	): Promise<NoteResponse | VersionConflictResponse> {
		const body: Record<string, unknown> = { path, content, mtime };
		if (version !== undefined) body.version = version;
		if (clientId !== undefined) body.id = clientId;
		try {
			const resp = await this.request("POST", "/notes", body);
			return resp.json as NoteResponse;
		} catch (e) {
			if (typeof e === "object" && e !== null && (e as { status?: number }).status === 409) {
				const err = e as { json?: VersionConflictResponse; text?: string };
				if (err.json) return err.json;
				if (err.text) return JSON.parse(err.text) as VersionConflictResponse;
			}
			throw e;
		}
	}

	/** Get changes since a timestamp.
	 *  Protocol rev: pass limit/cursor to page through large vaults and
	 *  fields:"meta" to receive content_hash instead of content. Pre-rev
	 *  backends ignore the extra params and return the legacy full response. */
	async getChanges(
		since: string,
		opts?: { limit?: number; cursor?: string; fields?: "meta" },
	): Promise<ChangesResponse> {
		const params = new URLSearchParams({ since });
		if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
		if (opts?.cursor) params.set("cursor", opts.cursor);
		if (opts?.fields) params.set("fields", opts.fields);
		const resp = await this.request("GET", `/notes/changes?${params.toString()}`);
		return resp.json as ChangesResponse;
	}

	/** Pull the merged ordered feed (notes ∪ attachments interleaved by
	 *  (seq,id), tombstones included) from GET /sync/changes (PR B2). Pass the
	 *  opaque `cursor` from the prior page; omit it for a genesis pull. */
	async getSyncChanges(cursor?: string, limit?: number): Promise<SyncChangesResponse> {
		const params = new URLSearchParams();
		if (cursor) params.set("cursor", cursor);
		if (limit !== undefined) params.set("limit", String(limit));
		const qs = params.toString();
		const resp = await this.request("GET", `/sync/changes${qs ? `?${qs}` : ""}`);
		return resp.json as SyncChangesResponse;
	}

	/** Bulk-push up to 100 notes via POST /notes/batch (protocol rev).
	 *  Sends a fresh idempotency key per call — the server replays the cached
	 *  response on retry instead of re-executing the batch. Throws with
	 *  status 404/405 on pre-rev backends; callers fall back to per-note
	 *  pushes. */
	async pushNotesBatch(
		notes: Array<{ path: string; content: string; mtime: number; version?: number }>,
	): Promise<BatchUpsertResponse> {
		const resp = await this.request(
			"POST",
			"/notes/batch",
			{ notes },
			{ "X-Idempotency-Key": crypto.randomUUID() },
		);
		return resp.json as BatchUpsertResponse;
	}

	/** Get full note by path. */
	async getNote(path: string): Promise<NoteDetail> {
		const encoded = encodePath(path);
		const resp = await this.request("GET", `/notes/${encoded}`);
		return resp.json as NoteDetail;
	}

	/** Delete a note. */
	async deleteNote(path: string): Promise<DeleteResponse> {
		const encoded = encodePath(path);
		const resp = await this.request("DELETE", `/notes/${encoded}`);
		return resp.json as DeleteResponse;
	}

	// --- Attachment methods ---

	/** Push a binary attachment as base64. */
	async pushAttachment(
		path: string,
		contentBase64: string,
		mimeType: string,
		mtime: number,
	): Promise<AttachmentResponse> {
		const resp = await this.request("POST", "/attachments", {
			path,
			content_base64: contentBase64,
			mime_type: mimeType,
			mtime,
		});
		return resp.json as AttachmentResponse;
	}

	/** Get attachment content (base64). */
	async getAttachment(path: string): Promise<AttachmentDetail> {
		const encoded = encodePath(path);
		const resp = await this.request("GET", `/attachments/${encoded}`);
		return resp.json as AttachmentDetail;
	}

	/** Delete an attachment. */
	async deleteAttachment(path: string): Promise<DeleteResponse> {
		const encoded = encodePath(path);
		const resp = await this.request("DELETE", `/attachments/${encoded}`);
		return resp.json as DeleteResponse;
	}

	/** Semantic search across indexed notes. */
	async search(
		query: string,
		limit?: number,
		tags?: string[],
		folder?: string,
	): Promise<SearchResponse> {
		const body: { query: string; limit?: number; tags?: string[]; folder?: string } = { query };
		if (limit !== undefined) body.limit = limit;
		if (tags?.length) body.tags = tags;
		if (folder) body.folder = folder;
		const resp = await this.request("POST", "/search", body);
		return resp.json as SearchResponse;
	}

	/** Fetch sync manifest for reconciliation.
	 *  Returns null if the server doesn't support this endpoint (404). */
	async getManifest(): Promise<ManifestResponse | null> {
		try {
			const resp = await this.request("GET", "/sync/manifest");
			return resp.json as ManifestResponse;
		} catch (e) {
			if (typeof e === "object" && e !== null && (e as { status?: number }).status === 404) {
				return null;
			}
			throw e;
		}
	}

	/** Push batched log entries to the server for remote debugging. */
	async pushLogs(
		entries: {
			ts: string;
			level: string;
			category: string;
			message: string;
			stack?: string;
			plugin_version: string;
			platform: string;
		}[],
	): Promise<void> {
		await this.request("POST", "/logs", { logs: entries });
	}

	/** Get attachment changes since a timestamp. */
	async getAttachmentChanges(since: string): Promise<AttachmentChangesResponse> {
		const encoded = encodeURIComponent(since);
		const resp = await this.request("GET", `/attachments/changes?since=${encoded}`);
		return resp.json as AttachmentChangesResponse;
	}

	// --- Explicit folder markers (kind='folder' rows) ---

	/** Create an explicit empty folder marker. Server is idempotent — repeated
	 *  calls return 200 instead of 201 but the same shape. */
	async createFolder(folder: string): Promise<{ folder: { name: string; count: number } }> {
		const resp = await this.request("POST", "/folders", { folder });
		return resp.json as { folder: { name: string; count: number } };
	}

	/** Delete an explicit empty folder marker. Server always 204 — idempotent.
	 *  Slashes are preserved as path separators; each segment is URL-encoded so
	 *  spaces and other reserved characters survive routing. */
	async deleteFolder(path: string): Promise<void> {
		const segments = path.split("/").map(encodeURIComponent).join("/");
		await this.request("DELETE", `/folders/${segments}`);
	}

	/** Fetch the list of explicit folder marker names. Plugin-only endpoint
	 *  (the frontend lists folders through a different surface). */
	async listExplicitFolders(): Promise<string[]> {
		const resp = await this.request("GET", "/folders/explicit");
		const body = resp.json as { folders?: { name: string }[] };
		return (body.folders ?? []).map((f) => f.name);
	}
}

/** Build a LimitExceededError from an Obsidian requestUrl rejection at status
 *  402. The body may arrive as `.json` (parsed) or `.text` (raw) depending on
 *  platform; we try both, defaulting safe values when either is missing so the
 *  caller always gets a typed error rather than a confusing decode crash. */
function parseLimitExceededError(e: unknown): LimitExceededError {
	const err = e as { json?: unknown; text?: string };
	let body: Record<string, unknown> = {};
	if (err.json && typeof err.json === "object") {
		body = err.json as Record<string, unknown>;
	} else if (typeof err.text === "string") {
		try {
			const parsed: unknown = JSON.parse(err.text);
			if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
		} catch {
			// Malformed text — fall through with empty body; "unknown" reason
			// still routes to the generic toast.
		}
	}
	const pick = <T>(key: string): T | null => (body[key] !== undefined ? (body[key] as T) : null);
	return new LimitExceededError(
		typeof body.reason === "string" ? body.reason : "unknown",
		pick<string>("upgrade_url"),
		pick<string>("limit_key"),
		pick<number | boolean>("limit"),
		pick<number>("current"),
	);
}

/** Encode a vault path for use in a URL path segment list. Encodes each
 *  segment but preserves the "/" separators — Phoenix's Plug.Static rejects
 *  %2F-encoded slashes with a 400 (InvalidPathError) before routing/auth, so
 *  encodeURIComponent over the whole path breaks any file in a subfolder. */
function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

/** Convert an ArrayBuffer to a base64 string. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary);
}

/** Convert a base64 string to an ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}
