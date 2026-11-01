/**
 * Settings migrations for persisted plugin data (data.json `settings`).
 */
import type { EngramSyncSettings } from "./types";

/** Collapse the three legacy diagnostics toggles (`remoteLoggingEnabled`,
 *  `diagnosticMode`, `tracingEnabled`) into the single `diagnosticsEnabled`.
 *
 *  An already-migrated blob (has a boolean `diagnosticsEnabled`) is returned
 *  verbatim so re-running is idempotent. Otherwise diagnostics turns ON if ANY
 *  legacy toggle was on, so a user who had remote logging or tracing enabled
 *  keeps it after the upgrade. */
export function migrateDiagnosticsEnabled(raw: Record<string, unknown> | undefined): boolean {
	if (!raw) return false;
	if (typeof raw.diagnosticsEnabled === "boolean") return raw.diagnosticsEnabled;
	return Boolean(raw.remoteLoggingEnabled || raw.diagnosticMode || raw.tracingEnabled);
}

/** How long diagnostics stays on after it is switched on. */
export const DIAGNOSTICS_TTL_MS = 24 * 60 * 60 * 1000;

/** Keep the diagnostics window honest, in place. Returns true when it just
 *  EXPIRED (the caller must then apply the off state to the live logger).
 *
 *  - off: no stamp.
 *  - on without a stamp: stamp `now`. That covers a fresh toggle (settings
 *    tab, first-run checkbox, the e2e seed) AND every install upgrading from a
 *    build without expiry. Git history shows diagnostics and all three legacy
 *    toggles always defaulted OFF, so an "on" here was a user choice; it gets
 *    a fresh 24h rather than being cut mid-debug-session.
 *  - on and older than DIAGNOSTICS_TTL_MS: off, and the detail level back to
 *    the "warn" default so the next opt-in does not inherit a firehose.
 *
 *  ponytail: checked on load, save and a 10-minute interval, so expiry can lag
 *  by up to 10 minutes; tighten the interval if that ever matters. */
export function reconcileDiagnosticsWindow(
	settings: Pick<
		EngramSyncSettings,
		"diagnosticsEnabled" | "diagnosticsEnabledAt" | "remoteLogLevel"
	>,
	now: number,
): boolean {
	if (!settings.diagnosticsEnabled) {
		settings.diagnosticsEnabledAt = null;
		return false;
	}
	const at = settings.diagnosticsEnabledAt;
	if (typeof at !== "number" || !Number.isFinite(at) || at > now) {
		settings.diagnosticsEnabledAt = now;
		return false;
	}
	if (now - at < DIAGNOSTICS_TTL_MS) return false;
	settings.diagnosticsEnabled = false;
	settings.diagnosticsEnabledAt = null;
	settings.remoteLogLevel = "warn";
	return true;
}

/** Settings that used to exist and no longer do. They are deleted from the
 *  in-memory object on load, so the next save persists data.json without them.
 *
 *  Kept as an exported list rather than inline at the call site so retiring a
 *  setting is one visible edit with a test behind it — the previous inline
 *  array grew silently and nothing asserted a retired key actually stopped
 *  being written. */
export const RETIRED_SETTING_KEYS = [
	// Collapsed into diagnosticsEnabled.
	"remoteLoggingEnabled",
	"diagnosticMode",
	"tracingEnabled",
	// CRDT is the sole markdown path; there is nothing left to switch off.
	"enableCrdt",
	// The feature-flag framework is gone, and the recorder it gated with it, so
	// a stored override object would linger in data.json reading like a live
	// setting for something that no longer exists.
	"featureFlags",
	// The first-run waitlist popup is gone: registration is open, so new users
	// go straight to app.engram.page/sign-up. The flag only ever gated that
	// modal, and a stored `true` would read like a live preference.
	"waitlistPromptSeen",
	// The search panel no longer remembers the last mode: every panel opens on
	// Both. A stored value would read like a live preference for a picker that
	// stopped consulting it.
	"searchDefaultMode",
] as const;

/** Compile-time proof that nothing in the list above is still a live setting.
 *
 *  A runtime test can only check keys present in DEFAULT_SETTINGS, and several
 *  live fields are deliberately absent from it (`backendMode`,
 *  `inactiveBackend` — each says so in its own docstring). So retiring
 *  "backendMode" by fat-finger would pass every test and silently wipe every
 *  install's backend selection on the next load. This fails `tsc` instead. */
type RetiredKeyIsNotLive =
	Extract<(typeof RETIRED_SETTING_KEYS)[number], keyof EngramSyncSettings> extends never
		? true
		: never;
const _retiredKeysAreDead: RetiredKeyIsNotLive = true;
void _retiredKeysAreDead;

/** Drop retired keys from a settings object, in place. */
export function stripRetiredSettings(settings: Record<string, unknown>): void {
	for (const key of RETIRED_SETTING_KEYS) {
		delete settings[key];
	}
}
