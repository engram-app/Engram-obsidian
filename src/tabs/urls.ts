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
export const ENGRAM_MCP_URL = "https://engram.page/mcp";

/** Self-hosted backend repo (setup instructions live here). */
export const ENGRAM_SELFHOST_URL = "https://github.com/engram-app/engram";

/** Plugin issue tracker. */
export const ENGRAM_ISSUES_URL = "https://github.com/engram-app/Engram-obsidian/issues";
