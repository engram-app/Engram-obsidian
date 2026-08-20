/** Production Engram Cloud REST backend URL. Used to disambiguate Cloud vs
 *  Self-hosted modes — `apiUrl === ENGRAM_CLOUD_URL` means the plugin is
 *  pointed at the managed service, anything else is self-hosted.
 *
 *  This is the dedicated API host (`api.engram.page`), NOT the SPA host
 *  (`app.engram.page`). After the AWS cutover `app.engram.page` resolves to
 *  Cloudflare Pages (static SPA): it proxies GET `/api/*` but 405s API POSTs
 *  like `/api/auth/device`, which silently broke device-flow sign-in and
 *  writes. REST must point at `api.engram.page` (the ALB / Phoenix host). */
export const ENGRAM_CLOUD_URL = "https://api.engram.page";

/** Production Engram web app (SPA) host — where Cloud users browse and verify
 *  their vault. Distinct from `ENGRAM_CLOUD_URL` (the API host): the SPA lives
 *  on `app.engram.page`, the REST API on `api.engram.page`. */
export const ENGRAM_APP_URL = "https://app.engram.page";

/** The browsable web-app URL for a given backend. Cloud points at the managed
 *  SPA host; a self-hosted backend serves its own SPA from the same origin, so
 *  its apiUrl is already the web URL. Pure for testing.
 *
 *  Normalizes first, because `settings.apiUrl` is stored VERBATIM —
 *  `applyApiUrlChange` writes whatever was typed and `isSaveableUrl` accepts a
 *  trailing slash and a path. This is the inverse of
 *  `EngramApi.normalizeBaseUrl`, which strips trailing slashes and appends
 *  "/api" at request time (and has an explicit branch for a value that already
 *  ends in "/api", so that paste is an expected stored shape).
 *
 *  Without it: a stored "https://api.engram.page/" missed the cloud comparison
 *  by one character and handed back the API host, and a self-hoster who pasted
 *  the "/api" address got "<host>/api/..." — Phoenix serves the SPA shell from
 *  the root scope only, so every caller that appends a path 404s. */
export function engramWebUrl(apiUrl: string): string {
	const base = apiUrl.replace(/\/+$/, "").replace(/\/api$/, "");
	return base === ENGRAM_CLOUD_URL ? ENGRAM_APP_URL : base;
}

/** Hostnames previously used as the Cloud REST base that must be migrated to
 *  `ENGRAM_CLOUD_URL` on load. Same backend, same credentials — only the edge
 *  hostname changed, so the stored apiUrl is rewritten WITHOUT wiping auth. */
export const LEGACY_CLOUD_HOSTS = ["app.engram.page"];

/** Marketing site (account creation, docs). Linked from the Account tab. */
export const ENGRAM_MARKETING_URL = "https://engram.page";

/** Documentation site. */
export const ENGRAM_DOCS_URL = "https://engram.page/docs";

/** Pricing page (tiers + comparison). */
export const ENGRAM_PRICING_URL = "https://engram.page/pricing";

/** Guide for connecting AI assistants over MCP. */
export const ENGRAM_MCP_URL = "https://engram.page/docs/integrations";

/** Self-hosted backend repo (setup instructions live here). */
export const ENGRAM_SELFHOST_URL = "https://github.com/engram-app/engram";

/** Main project GitHub repo (linked from the waitlist popup / general "our code"). */
export const ENGRAM_GITHUB_URL = "https://github.com/engram-app/engram";

/** Plugin issue tracker. */
export const ENGRAM_ISSUES_URL = "https://github.com/engram-app/Engram-obsidian/issues";

/** Community Discord — support, questions, and issue reports from users + devs. */
export const ENGRAM_DISCORD_URL = "https://discord.gg/NKWcU2mm7N";

/** Billing page on the web app. Derived from ENGRAM_APP_URL so the cloud host
 *  is defined exactly once; surfaces with a known backend should prefer
 *  `${engramWebUrl(apiUrl)}/settings/billing` so self-hosted users aren't sent
 *  to cloud billing. */
export const DEFAULT_UPGRADE_URL = `${ENGRAM_APP_URL}/settings/billing`;
