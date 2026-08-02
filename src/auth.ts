import { errMsg, statusOf } from "./error-util";
import { rlog } from "./remote-log";
/**
 * Auth providers for Engram plugin — abstracts API key vs OAuth token management.
 * The rest of the plugin calls getToken() and doesn't know which method is active.
 */
import type { EngramSyncSettings } from "./types";

/** Decide whether a persisted access token may be seeded into a fresh OAuth
 *  provider. A cached token is only trustworthy if it was minted for the
 *  vault that's still active — an account swap changes vaultId but may leave
 *  the previous session's token behind, and reusing it sends an old-user JWT
 *  at the new vault (a 404, not a 401, so it's easy to misdiagnose). Returns a
 *  null token when the binding is missing or stale, forcing a refresh. */
export function seededAccessToken(settings: EngramSyncSettings): {
	token: string | null;
	expiresAt: number;
} {
	const bound =
		!!settings.accessToken &&
		settings.accessTokenVaultId != null &&
		settings.accessTokenVaultId === settings.vaultId;

	if (bound) {
		return {
			token: settings.accessToken ?? null,
			expiresAt: settings.accessTokenExpiresAt ?? 0,
		};
	}
	return { token: null, expiresAt: 0 };
}

export interface AuthProvider {
	getToken(): Promise<string>;
	getVaultId(): string | null;
	isAuthenticated(): boolean;
	signOut(): void;
	/**
	 * Drop any cached access token so the next getToken() forces a refresh.
	 * Optional — providers without a refreshable access token (e.g. static API keys)
	 * leave this undefined; callers should treat its absence as "no recovery possible".
	 */
	invalidateAccessToken?(): void;
}

export type RefreshFn = (refreshToken: string) => Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}>;

/** The token state persisted after each refresh so a reload can restore it. */
export interface PersistedTokens {
	refreshToken: string;
	accessToken: string;
	expiresAt: number;
}

/** Simple wrapper around a static API key. No refresh logic. */
export class ApiKeyAuth implements AuthProvider {
	private apiKey: string;
	private vaultId: string | null;

	constructor(apiKey: string, vaultId: string | null) {
		this.apiKey = apiKey;
		this.vaultId = vaultId;
	}

	async getToken(): Promise<string> {
		return this.apiKey;
	}

	getVaultId(): string | null {
		return this.vaultId;
	}

	isAuthenticated(): boolean {
		return this.apiKey.length > 0;
	}

	signOut(): void {
		this.apiKey = "";
		this.vaultId = null;
	}
}

/** OAuth token manager with automatic refresh and rotation. */
export class OAuthAuth implements AuthProvider {
	private refreshToken: string;
	private vaultId: string | null;
	private userEmail: string | null;
	private accessToken: string | null = null;
	private expiresAt = 0;
	private refreshFn: RefreshFn;
	// Persistence callback can return a Promise — doRefresh awaits it so the
	// rotated tokens are durable BEFORE the new access token is handed back to
	// the caller. Closes the 1.3.0 race where a plugin reload between the
	// in-memory rotation and a fire-and-forget disk write left the on-disk token
	// stale, forcing a manual re-login. Carries the access token + expiry too so
	// a reload within the access-token lifetime can skip the refresh entirely —
	// which avoids consuming the single-use refresh token on every restart.
	private onTokenRotated?: (tokens: PersistedTokens) => void | Promise<void>;
	private authenticated = true;
	private inflightRefresh: Promise<string> | null = null;
	// Invoked once when the refresh token is DEFINITIVELY rejected by the server
	// (revoked / rotated-away / expired → 400/401/403/404), as opposed to a
	// transient error (network / 5xx / 429). The host clears persisted auth and
	// prompts a re-link so a dead token can't be replayed forever.
	private readonly onAuthInvalidated?: () => void | Promise<void>;
	private authInvalidatedFired = false;

	/** Buffer in ms — refresh if token expires within this window. */
	private static EXPIRY_BUFFER_MS = 60_000;

	constructor(
		refreshToken: string,
		vaultId: string | null,
		userEmail: string | null,
		refreshFn: RefreshFn,
		onTokenRotated?: (tokens: PersistedTokens) => void | Promise<void>,
		initialAccessToken: string | null = null,
		initialExpiresAt = 0,
		onAuthInvalidated?: () => void | Promise<void>,
	) {
		this.refreshToken = refreshToken;
		this.vaultId = vaultId;
		this.userEmail = userEmail;
		this.refreshFn = refreshFn;
		this.onTokenRotated = onTokenRotated;
		this.accessToken = initialAccessToken;
		this.expiresAt = initialExpiresAt;
		this.onAuthInvalidated = onAuthInvalidated;
	}

	async getToken(): Promise<string> {
		if (this.accessToken && this.expiresAt > Date.now() + OAuthAuth.EXPIRY_BUFFER_MS) {
			return this.accessToken;
		}

		// Deduplicate concurrent refresh calls — all callers share one in-flight request
		if (this.inflightRefresh) {
			return this.inflightRefresh;
		}

		rlog().info(
			"auth",
			`OAuth.getToken — triggering refresh (refreshTokenLen=${this.refreshToken.length} hadAccessToken=${this.accessToken !== null} expiresInMs=${this.expiresAt - Date.now()})`,
		);

		this.inflightRefresh = this.doRefresh();
		try {
			return await this.inflightRefresh;
		} finally {
			this.inflightRefresh = null;
		}
	}

	private async doRefresh(): Promise<string> {
		// A cleared token (after a definitive rejection) can never succeed — fail
		// fast instead of replaying an empty/dead token against the server.
		if (!this.refreshToken) {
			this.authenticated = false;
			throw new Error("Not authenticated: refresh token cleared");
		}
		try {
			const result = await this.refreshFn(this.refreshToken);
			this.accessToken = result.access_token;
			this.refreshToken = result.refresh_token;
			this.expiresAt = Date.now() + result.expires_in * 1000;
			this.authenticated = true;
			// Await persistence so callers can't act on the new access token
			// before the rotated refresh token reaches disk.
			await this.onTokenRotated?.({
				refreshToken: result.refresh_token,
				accessToken: result.access_token,
				expiresAt: this.expiresAt,
			});
			rlog().info(
				"auth",
				`OAuth refresh ok — accessTokenLen=${result.access_token.length} expiresInS=${result.expires_in}`,
			);
			return this.accessToken;
		} catch (err) {
			this.authenticated = false;
			this.accessToken = null;
			this.expiresAt = 0;
			const status = statusOf(err);
			const definitive = status === 400 || status === 401 || status === 403 || status === 404;
			rlog().error(
				"auth",
				`OAuth refresh failed (status=${status ?? "n/a"} definitive=${definitive}): ${errMsg(err)}`,
				err instanceof Error ? err.stack : undefined,
			);
			if (definitive && !this.authInvalidatedFired) {
				// The refresh token itself is rejected (revoked / rotated-away /
				// expired) — it will never succeed again. Drop it so we stop
				// replaying a dead token, and signal the host to clear persisted
				// auth + prompt a re-link. Transient errors (network / 5xx / 429)
				// deliberately keep the token so a blip doesn't force a re-login.
				this.authInvalidatedFired = true;
				this.refreshToken = "";
				try {
					await this.onAuthInvalidated?.();
				} catch (cbErr) {
					rlog().error(
						"auth",
						`onAuthInvalidated callback threw: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`,
					);
				}
			}
			throw err;
		}
	}

	getVaultId(): string | null {
		return this.vaultId;
	}

	getUserEmail(): string | null {
		return this.userEmail;
	}

	getRefreshToken(): string {
		return this.refreshToken;
	}

	invalidateAccessToken(): void {
		this.accessToken = null;
		this.expiresAt = 0;
	}

	isAuthenticated(): boolean {
		return this.authenticated;
	}

	signOut(): void {
		this.accessToken = null;
		this.refreshToken = "";
		this.expiresAt = 0;
		this.authenticated = false;
		this.vaultId = null;
		this.userEmail = null;
	}
}
