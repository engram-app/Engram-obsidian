/**
 * limit-copy.ts — toast-friendly one-liners for backend 402 limit reasons.
 *
 * Parallel to the web app's `frontend/src/billing/limit-copy.ts`, which returns
 * `{ title, body }` for modal display. The plugin variant returns a single
 * string prefixed with "Engram: " for use in Obsidian Notice toasts.
 *
 * See spec §4.8: docs/superpowers/specs/2026-06-07-free-tier-launch-design.md
 */

const TABLE: Record<string, string> = {
	notes_cap_exceeded: "Note limit reached. Upgrade to keep adding notes.",
	// CRDT channel variant of the note-cap reject (crdt_channel.ex): same copy.
	notes_cap_reached: "Note limit reached. Upgrade to keep adding notes.",
	// Do NOT name a tier here. `vaults_cap` is per-tier (Free 1, Starter 10,
	// Pro unlimited), so hardcoding "Free" told a Starter user at 10 vaults
	// that their Free plan allowed 10. The web app hit the same bug and fixed
	// it by naming the user's actual plan; the plugin has no plan label at this
	// call site, so it says nothing about the tier instead of saying the wrong
	// thing.
	vaults_cap_exceeded: "Vault limit reached. Upgrade for more vaults.",
	// A capability gate (self-host / storage config), NOT the Free-tier policy
	// it used to be. `attachments_all_types` has been true on every tier since
	// 2026-08-24, so the old "Free syncs notes only" copy named a rule that no
	// longer exists.
	attachment_must_be_text: "This file type isn't accepted by this server.",
	attachments_disabled: "Attachment sync is disabled for this account.",
	attachments_quota_exceeded: "Attachment storage is full — upgrade for more.",
	file_too_large: "File too large for your plan.",
	concurrent_devices_exceeded: "Already signed in on another device. Upgrade for multi-device.",
	device_swap_cooldown: "Device swap cooldown active. Wait or upgrade.",
	obsidian_connections_exceeded: "Too many connected Obsidian vaults. Disconnect one or upgrade.",
	mcp_connections_exceeded: "Too many connected AI clients. Disconnect one or upgrade.",
	// ONE key, replacing `ai_conversations_per_day_exceeded`,
	// `ai_queries_per_conversation_exceeded` and `ai_queries_per_day_exceeded`.
	// Those three were dead strings: the backend deleted the keys behind them
	// when `ai_searches_per_day` consolidated six meters into one, so the only
	// AI cap a user can now hit fell through to the generic fallback. Emitted
	// by `search_controller.ex`. Copy tracks the web app's wording so the same
	// limit does not read as two different products.
	ai_searches_per_day_exceeded:
		"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.",
	// Server rejects an API-key-authed socket or REST call outright: Cloud
	// gates API keys behind Pro. Point at sign-in, which works on every plan,
	// rather than at a generic "upgrade".
	api_access_not_available: "API keys need Pro. Sign in with your Engram account instead.",
	api_write_not_available: "API keys need Pro. Sign in with your Engram account instead.",
	account_suspended: "Account suspended. Contact support.",
	no_tier: "Account setup incomplete.",
	account_deleted: "This account was deleted. Contact support if that is wrong.",
	onboarding_required: "Finish setting up your account at app.engram.page to start syncing.",
};

/** Join-rejection reasons a retry can never clear, so the user has to be told
 *  rather than left watching a silent degrade to legacy. This is the exact set
 *  `ChannelGate` emits minus `rotation_in_progress`, which IS transient and
 *  stays log-only. `no_tier` is deliberately absent: it lives in the table
 *  above for HTTP 402s but the socket never emits it, and listing it here
 *  would be the same dead-string bug this set exists to fix. */
const PLAN_JOIN_REASONS = new Set([
	"api_access_not_available",
	"account_suspended",
	"account_deleted",
	"onboarding_required",
]);

export function isPlanJoinReason(reason: string): boolean {
	return PLAN_JOIN_REASONS.has(reason);
}

export function toastFor(reason: string): string {
	return `Engram: ${TABLE[reason] ?? "Limit reached. Upgrade to continue."}`;
}
