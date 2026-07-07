/**
 * Migration: the three legacy diagnostics toggles (remoteLoggingEnabled,
 * diagnosticMode, tracingEnabled) collapse into one `diagnosticsEnabled`.
 * On upgrade, diagnostics is ON if ANY of the legacy toggles was on, so a user
 * who had remote logging or tracing enabled keeps it. An explicit new value
 * always wins (re-migration must be idempotent).
 */
import { describe, expect, test } from "bun:test";
import { migrateDiagnosticsEnabled } from "../src/settings-migrate";

describe("migrateDiagnosticsEnabled", () => {
	test("undefined / empty persisted settings -> off", () => {
		expect(migrateDiagnosticsEnabled(undefined)).toBe(false);
		expect(migrateDiagnosticsEnabled({})).toBe(false);
	});

	test("any legacy toggle on -> on", () => {
		expect(migrateDiagnosticsEnabled({ remoteLoggingEnabled: true })).toBe(true);
		expect(migrateDiagnosticsEnabled({ diagnosticMode: true })).toBe(true);
		expect(migrateDiagnosticsEnabled({ tracingEnabled: true })).toBe(true);
	});

	test("all legacy toggles off -> off", () => {
		expect(
			migrateDiagnosticsEnabled({
				remoteLoggingEnabled: false,
				diagnosticMode: false,
				tracingEnabled: false,
			}),
		).toBe(false);
	});

	test("explicit new value wins over legacy (idempotent re-migration)", () => {
		// Already migrated: diagnosticsEnabled present -> use it verbatim.
		expect(migrateDiagnosticsEnabled({ diagnosticsEnabled: true })).toBe(true);
		expect(
			migrateDiagnosticsEnabled({ diagnosticsEnabled: false, remoteLoggingEnabled: true }),
		).toBe(false);
	});
});
