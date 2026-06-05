/**
 * Engram HTTP client.
 *
 * Uses Obsidian's requestUrl() which bypasses CORS and works on mobile.
 */
import { type RequestUrlResponse, requestUrl } from "obsidian";
import type { AuthProvider } from "./auth";
import { type PreflightResult, interpretHealthProbe } from "./auth-state";
import { rlog } from "./remote-log";
import type {
	AttachmentChangesResponse,
	AttachmentDetail,
	AttachmentResponse,
	ChangesResponse,
	DeleteResponse,
	ManifestResponse,
	NoteDetail,
	NoteResponse,
	SearchResponse,
	VaultInfo,
	VaultRegistrationResponse,
	VersionConflictResponse,
} from "./types";

export class EngramApi {
	private vaultId: string | null = null;
	private authProvider: AuthProvider | null = null;

	constructor(
		private baseUrl: string,
		private apiKey: string,
	) {
		this.baseUrl = EngramApi.normalizeBaseUrl(baseUrl);
	}

	setVaultId(id: string | null): void {
		this.vaultId = id;
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
	): Promise<RequestUrlResponse> {
		try {
			return await this.sendRequest(method, path, body);
		} catch (e) {
			// On 401, the cached access token may be stale (e.g. server-side TTL
			// shorter than the expires_in we trusted). Invalidate and retry once
			// with a freshly-refreshed token. Static-key providers have no
			// recovery path, so retry only when invalidateAccessToken is supported.
			const status = (e as { status?: number }).status;
			if (status === 401 && this.authProvider?.invalidateAccessToken) {
				this.authProvider.invalidateAccessToken();
				return this.sendRequest(method, path, body);
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
	): Promise<RequestUrlResponse> {
		const token = await this.getAuthToken();
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
		};
		if (this.vaultId) {
			headers["X-Vault-ID"] = this.vaultId;
		}
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		return requestUrl({
			url: `${this.baseUrl}${path}`,
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
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
	async getMe(): Promise<{ id: number; email: string }> {
		const resp = await this.request("GET", "/me");
		return (resp.json as { user: { id: number; email: string } }).user;
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
	 *  returns 409 with the current server state if the version doesn't match. */
	async pushNote(
		path: string,
		content: string,
		mtime: number,
		version?: number,
	): Promise<NoteResponse | VersionConflictResponse> {
		const body: Record<string, unknown> = { path, content, mtime };
		if (version !== undefined) body.version = version;
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

	/** Get changes since a timestamp. */
	async getChanges(since: string): Promise<ChangesResponse> {
		const encoded = encodeURIComponent(since);
		const resp = await this.request("GET", `/notes/changes?since=${encoded}`);
		return resp.json as ChangesResponse;
	}

	/** Get full note by path. */
	async getNote(path: string): Promise<NoteDetail> {
		const encoded = encodeURIComponent(path);
		const resp = await this.request("GET", `/notes/${encoded}`);
		return resp.json as NoteDetail;
	}

	/** Delete a note. */
	async deleteNote(path: string): Promise<DeleteResponse> {
		const encoded = encodeURIComponent(path);
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
		const encoded = encodeURIComponent(path);
		const resp = await this.request("GET", `/attachments/${encoded}`);
		return resp.json as AttachmentDetail;
	}

	/** Delete an attachment. */
	async deleteAttachment(path: string): Promise<DeleteResponse> {
		const encoded = encodeURIComponent(path);
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

	/** Query the server's rate limit. Returns 0 for unlimited. */
	async getRateLimit(): Promise<number> {
		try {
			const resp = await this.request("GET", "/rate-limit");
			return (resp.json as { requests_per_minute: number }).requests_per_minute;
		} catch {
			// Server doesn't support this endpoint — assume unlimited
			return 0;
		}
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
