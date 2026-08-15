/**
 * Settings migrations for persisted plugin data (data.json `settings`).
 */

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
	// The feature-flag framework is gone. Its only flag (crdtRecording) now
	// follows diagnosticsEnabled, so a stored override object would linger in
	// data.json reading like a live setting.
	"featureFlags",
] as const;

/** Drop retired keys from a settings object, in place. */
export function stripRetiredSettings(settings: Record<string, unknown>): void {
	for (const key of RETIRED_SETTING_KEYS) {
		delete settings[key];
	}
}
