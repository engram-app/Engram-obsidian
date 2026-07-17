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
	realtime_disabled: "Realtime sync requires upgrade.",
	account_suspended: "Account suspended. Contact support.",
	no_tier: "Account setup incomplete.",
};

export function toastFor(reason: string): string {
	return `Engram: ${TABLE[reason] ?? "Limit reached. Upgrade to continue."}`;
}
