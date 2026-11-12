/**
 * limit-copy.ts — toast-friendly one-liners for backend 402 limit reasons.
 *
 * Parallel to the web app's `frontend/src/billing/limit-copy.ts`, which returns
 * `{ title, body }` for modal display. The plugin variant returns a single
 * string prefixed with "Engram: " for use in Obsidian Notice toasts.
 *
 * See spec §4.8: docs/superpowers/specs/2026-06-07-free-tier-launch-design.md
 */

import { t } from "./i18n";

/**
 * Resolved per call, not at module load.
 *
 * As a module-scope object literal, all 16 `t()` calls would run once when the
 * bundle is first evaluated and freeze to whatever language was active then.
 * Every other `t()` in the plugin resolves per call, and the test mock's
 * language is mutable module state, so the frozen form also made the result
 * depend on import order.
 *
 * ponytail: rebuilds 16 entries per toast. A toast is a human-speed event, so
 * the allocation is free; memoize per locale only if this ever shows up hot.
 */
function table(): Record<string, string> {
	return {
		notes_cap_exceeded: t("Note limit reached. Upgrade to keep adding notes."),
		// CRDT channel variant of the note-cap reject (crdt_channel.ex): same copy.
		notes_cap_reached: t("Note limit reached. Upgrade to keep adding notes."),
		// Do NOT name a tier here. `vaults_cap` is per-tier (Free 1, Starter 10,
		// Pro unlimited), so hardcoding "Free" told a Starter user at 10 vaults
		// that their Free plan allowed 10. The web app hit the same bug and fixed
		// it by naming the user's actual plan; the plugin has no plan label at this
		// call site, so it says nothing about the tier instead of saying the wrong
		// thing.
		vaults_cap_exceeded: t("Vault limit reached. Upgrade for more vaults."),
		// A capability gate (self-host / storage config), NOT the Free-tier policy
		// it used to be. `attachments_all_types` has been true on every tier since
		// 2026-08-24, so the old "Free syncs notes only" copy named a rule that no
		// longer exists.
		attachment_must_be_text: t("This file type isn't accepted by this server."),
		attachments_disabled: t("Attachment sync is disabled for this account."),
		attachments_quota_exceeded: t("Attachment storage is full — upgrade for more."),
		file_too_large: t("File too large for your plan."),
		// Names no number: Free allows 2 devices, so "another device" was wrong,
		// and an installed plugin lags any change to the cap.
		concurrent_devices_exceeded: t("Device limit reached. Disconnect a device or upgrade."),
		device_swap_cooldown: t("Device swap cooldown active. Wait or upgrade."),
		obsidian_connections_exceeded: t(
			"Too many connected Obsidian vaults. Disconnect one or upgrade.",
		),
		// ONE key, replacing `ai_conversations_per_day_exceeded`,
		// `ai_queries_per_conversation_exceeded` and `ai_queries_per_day_exceeded`.
		// Those three were dead strings: the backend deleted the keys behind them
		// when `ai_searches_per_day` consolidated six meters into one, so the only
		// AI cap a user can now hit fell through to the generic fallback. Emitted
		// by `search_controller.ex`. Copy tracks the web app's wording so the same
		// limit does not read as two different products.
		// Names no number: the backend owns the cap and an installed plugin lags it.
		ai_searches_per_day_exceeded: t(
			"Daily AI search limit reached. Free searches are shared across Obsidian, the web app and MCP. Upgrade for unlimited.",
		),
		// API keys work on every plan (backend #1974). The server sends this only
		// when a per-user `api_rps_cap` override is 0, a kill switch on one
		// account, so it names no plan and points at sign-in, which still works.
		// `api_write_not_available` and `mcp_connections_exceeded` went with
		// their gates in the same change; the server never sends them.
		api_access_not_available: t(
			"API key access is turned off for this account. Sign in with your Engram account instead.",
		),
		account_suspended: t("Account suspended. Contact support."),
		no_tier: t("Account setup incomplete."),
		account_deleted: t("This account was deleted. Contact support if that is wrong."),
		onboarding_required: t(
			"Finish setting up your account at app.engram.page to start syncing.",
		),
	};
}

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
	// The fallback is translated too: it is the branch EVERY reason code the
	// backend adds after this build takes, so leaving it English would ship a
	// fully English toast for exactly the cases nobody anticipated.
	return `Engram: ${table()[reason] ?? t("Limit reached. Upgrade to continue.")}`;
}
