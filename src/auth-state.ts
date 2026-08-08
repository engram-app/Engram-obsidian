import { LEGACY_CLOUD_HOSTS } from "./tabs/urls";
import type { BackendScopedField, EngramSyncSettings } from "./types";

/** If `apiUrl` points at a legacy Cloud host (one that used to serve the REST
 *  API but no longer does — e.g. `app.engram.page`, now the SPA-only Cloudflare
 *  Pages host that 405s API POSTs), return the canonical `cloudUrl` it should be
 *  rewritten to. Returns null when no migration is needed (already canonical,
 *  self-hosted, or empty/unparseable). Pure so loadSettings can apply it without
 *  the Obsidian stack. Credentials are NOT a backend change here — same backend,
 *  only the edge hostname moved — so the caller preserves stored auth. */
export function migrateCloudApiUrl(apiUrl: string, cloudUrl: string): string | null {
	const origin = completeOrigin(apiUrl);
	if (!origin) return null;
	const host = new URL(origin).hostname;
	return LEGACY_CLOUD_HOSTS.includes(host) ? cloudUrl : null;
}

/** Returns scheme+host+port for a URL that looks like a *finished* origin
 *  (localhost, IPv4, or a domain with a real-looking TLD). Returns null for
 *  empty / unparseable / mid-typing URLs (e.g. `https://engr`). Returning null
 *  here is what stops `isBackendChange` from clearing auth on every keystroke. */
export function completeOrigin(url: string): string | null {
	if (!url) return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const host = parsed.hostname;
	const isLocalhost = host === "localhost";
	const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
	const hasTld = /\.[a-z]{2,}$/i.test(host);
	if (!isLocalhost && !isIPv4 && !hasTld) return null;
	return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}

/** Returns true only when both URLs parse to a *complete-looking* origin AND
 *  those origins differ. Path, query, trailing slash, and case differences in
 *  host do NOT count. Partial URLs (mid-keystroke) and empty URLs return false. */
export function isBackendChange(oldUrl: string, newUrl: string): boolean {
	const oldO = completeOrigin(oldUrl);
	const newO = completeOrigin(newUrl);
	if (!oldO || !newO) return false;
	return oldO !== newO;
}

/** Outcome of probing a candidate self-hosted URL's `/api/health`.
 *  - ``engram``: a healthy Engram backend answered (carries its version).
 *  - ``reachable``: something answered, but it isn't a healthy Engram server.
 *  - ``unreachable``: no response at all (DNS / refused / timeout). */
export type PreflightResult =
	| { kind: "engram"; version: string }
	| { kind: "reachable" }
	| { kind: "unreachable" };

/** Classify a `/api/health` probe response. Pure (no network) so it can be
 *  unit-tested exhaustively. The Engram fingerprint is `status === "ok"` AND a
 *  string `version` — a bare `{status:"ok"}` is a common generic health shape,
 *  so we require the version field to avoid false positives on random servers.
 *  A `status` of 0 means the request never got a response. */
export function interpretHealthProbe(status: number, body: unknown): PreflightResult {
	if (status === 0) return { kind: "unreachable" };
	if (status === 200) {
		const b = body as { status?: unknown; version?: unknown } | null;
		if (b && b.status === "ok" && typeof b.version === "string") {
			return { kind: "engram", version: b.version };
		}
	}
	return { kind: "reachable" };
}

/** Credential fields cleared on a backend change. A strict subset of
 *  BACKEND_SCOPED_FIELDS: apiUrl and remoteVaultName are backend-scoped but are
 *  not credentials, so a mode switch stashes them rather than wiping them.
 *
 *  The `satisfies` clause is the compile-time half of the drift guard. A typo,
 *  or a field that is not backend-scoped, fails tsc. The runtime half lives in
 *  tests/backend-mode.test.ts and catches the opposite direction: a field this
 *  function clears that BACKEND_SCOPED_FIELDS forgot to stash. */
const CLEARED_AUTH_VALUES = {
	apiKey: "",
	refreshToken: undefined,
	userEmail: undefined,
	authMethod: null,
	vaultId: null,
	// The cached access token (plus its expiry + vault binding) is signed by
	// the minting backend and only valid there. Leaving it set lets a backend
	// switch replay a stale token against the new origin → signature_error.
	accessToken: undefined,
	accessTokenExpiresAt: undefined,
	accessTokenVaultId: undefined,
} as const satisfies Partial<Record<BackendScopedField, unknown>>;

/** Returns a copy of settings with all backend-scoped auth state cleared.
 *  Preserves clientId (stable per-install), apiUrl (caller sets it separately),
 *  and unrelated user prefs (ignorePatterns, debounceMs, etc.). */
export function withClearedAuth(settings: EngramSyncSettings): EngramSyncSettings {
	return { ...settings, ...CLEARED_AUTH_VALUES };
}

/** Minimal plugin surface needed to apply an apiUrl change. Defined here so
 *  the orchestration helper can be unit-tested without dragging in the full
 *  plugin / Obsidian DOM stack. */
export interface ApiUrlSwitchTarget {
	settings: EngramSyncSettings;
	api: { setAuthProvider: (provider: null) => void };
	noteStream: { disconnect: () => void } | null;
	/** Drop the plugin's in-memory auth provider. The cleared settings only stop
	 *  a *future* (post-reload) provider from being rebuilt with stale auth; the
	 *  live provider object holds an old-backend-signed access token in memory and
	 *  would replay it against the new origin until reload. Resetting it makes a
	 *  backend switch behave like a fresh load. */
	resetAuthProvider: () => void;
}

/** The ApiUrlSwitchTarget for the live plugin instance. One construction site
 *  — this literal was copy-pasted at three settings-tab call sites. */
export function pluginSwitchTarget(plugin: {
	settings: ApiUrlSwitchTarget["settings"];
	api: ApiUrlSwitchTarget["api"];
	noteStream: ApiUrlSwitchTarget["noteStream"];
	authProvider: unknown;
}): ApiUrlSwitchTarget {
	return {
		settings: plugin.settings,
		api: plugin.api,
		noteStream: plugin.noteStream,
		resetAuthProvider: () => {
			plugin.authProvider = null;
		},
	};
}

/** Outcome of a URL change. `rejected` means nothing was written: the value did
 *  not parse as a complete origin. Such a value was previously stored silently,
 *  leaving apiUrl set to something no downstream consumer could resolve, with no
 *  error surfaced to the user. */
export interface ApiUrlChangeResult {
	cleared: boolean;
	rejected: boolean;
}

/** Update `target.settings.apiUrl` and, if the new URL points at a different
 *  backend origin, wipe backend-scoped auth state, null out the API auth
 *  provider, reset the live in-memory auth provider (so a stale old-backend
 *  access token can't be replayed against the new origin), and disconnect the
 *  live note stream — then persist via `save`.
 *  Mutates `target.settings` in place so external references (SyncEngine, etc.)
 *  keep observing the same object. */
export async function applyApiUrlChange(
	target: ApiUrlSwitchTarget,
	newUrl: string,
	save: () => Promise<void>,
): Promise<ApiUrlChangeResult> {
	if (target.settings.apiUrl === newUrl) return { cleared: false, rejected: false };
	// Refuse anything that is not a complete origin. Storing it would leave the
	// plugin pointed at an unusable address with nothing shown to the user.
	if (!completeOrigin(newUrl)) return { cleared: false, rejected: true };
	const cleared = isBackendChange(target.settings.apiUrl, newUrl);
	if (cleared) {
		// Mutate in place — withClearedAuth is the single source of truth for
		// which fields are backend-scoped, so any future addition stays one-place.
		Object.assign(target.settings, withClearedAuth(target.settings));
		target.api.setAuthProvider(null);
		target.resetAuthProvider();
		target.noteStream?.disconnect();
	}
	target.settings.apiUrl = newUrl;
	await save();
	return { cleared, rejected: false };
}
