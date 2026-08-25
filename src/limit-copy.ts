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
	vaults_cap_exceeded: "Free tier includes 1 vault. Upgrade for more.",
	attachment_must_be_text: "Free syncs notes only — images & PDFs need a paid plan.",
	attachments_disabled: "Attachment sync needs a paid plan.",
	attachments_quota_exceeded: "Attachment storage is full — upgrade for more.",
	file_too_large: "File too large for your plan.",
	concurrent_devices_exceeded: "Already signed in on another device. Upgrade for multi-device.",
	device_swap_cooldown: "Device swap cooldown active. Wait or upgrade.",
	ai_conversations_per_day_exceeded: "Daily AI limit reached.",
	ai_queries_per_conversation_exceeded: "Conversation length limit reached.",
	ai_queries_per_day_exceeded: "Daily AI query limit reached.",
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
