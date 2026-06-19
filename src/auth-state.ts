import { LEGACY_CLOUD_HOSTS } from "./tabs/urls";
import type { EngramSyncSettings } from "./types";

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

/** Returns a copy of settings with all backend-scoped auth state cleared.
 *  Preserves clientId (stable per-install), apiUrl (caller sets it separately),
 *  and unrelated user prefs (ignorePatterns, debounceMs, etc.). */
export function withClearedAuth(settings: EngramSyncSettings): EngramSyncSettings {
	return {
		...settings,
		apiKey: "",
		refreshToken: undefined,
		userEmail: undefined,
		authMethod: null,
		vaultId: null,
	};
}

/** Minimal plugin surface needed to apply an apiUrl change. Defined here so
 *  the orchestration helper can be unit-tested without dragging in the full
 *  plugin / Obsidian DOM stack. */
export interface ApiUrlSwitchTarget {
	settings: EngramSyncSettings;
	api: { setAuthProvider: (provider: null) => void };
	noteStream: { disconnect: () => void } | null;
}

/** What renderAccountTab should do given the current settings and cloud URL.
 *
 *  - ``render``: already on cloud (or path-only difference) — just render the tab.
 *  - ``prompt-switch``: on a different backend AND has stored credentials.
 *    Render an explicit "Switch to Engram cloud" button; do NOT auto-wipe.
 *  - ``auto-switch``: on a different backend with NO credentials to lose —
 *    safe to silently apply the cloud URL.
 *
 *  Why this exists: ``renderAccountTab`` used to auto-call ``applyApiUrlChange``
 *  on every tab activation. For self-hosted users with valid credentials,
 *  simply navigating to the "Cloud" tab silently nuked their apiKey/refreshToken/
 *  vaultId via ``withClearedAuth`` — destructive UX, surfaced by the e2e
 *  apiKey-wipe diagnostic on PR #162 (test_65 → test_69 cascade). */
export function cloudTabAction(
	settings: EngramSyncSettings,
	cloudUrl: string,
): "render" | "prompt-switch" | "auto-switch" {
	// Fresh install (apiUrl never set) — adopt cloud silently. No creds to
	// preserve and no existing backend to migrate from.
	if (!settings.apiUrl) return "auto-switch";
	// Same-origin (even with /api path difference) — no apply needed.
	if (!isBackendChange(settings.apiUrl, cloudUrl)) return "render";
	const hasAuth = Boolean(settings.apiKey || settings.refreshToken);
	return hasAuth ? "prompt-switch" : "auto-switch";
}

/** Update `target.settings.apiUrl` and, if the new URL points at a different
 *  backend origin, wipe backend-scoped auth state, null out the API auth
 *  provider, and disconnect the live note stream — then persist via `save`.
 *  Returns true when auth was cleared. Mutates `target.settings` in place so
 *  external references (SyncEngine, etc.) keep observing the same object. */
export async function applyApiUrlChange(
	target: ApiUrlSwitchTarget,
	newUrl: string,
	save: () => Promise<void>,
): Promise<boolean> {
	if (target.settings.apiUrl === newUrl) return false;
	const cleared = isBackendChange(target.settings.apiUrl, newUrl);
	if (cleared) {
		// Mutate in place — withClearedAuth is the single source of truth for
		// which fields are backend-scoped, so any future addition stays one-place.
		Object.assign(target.settings, withClearedAuth(target.settings));
		target.api.setAuthProvider(null);
		target.noteStream?.disconnect();
	}
	target.settings.apiUrl = newUrl;
	await save();
	return cleared;
}
