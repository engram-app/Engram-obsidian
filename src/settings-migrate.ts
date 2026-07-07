/**
 * Settings migrations for persisted plugin data (data.json `settings`).
 */

/** Collapse the three legacy diagnostics toggles — `remoteLoggingEnabled`,
 *  `diagnosticMode`, `tracingEnabled` — into the single `diagnosticsEnabled`.
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
