/**
 * Migration: the three legacy diagnostics toggles (remoteLoggingEnabled,
 * diagnosticMode, tracingEnabled) collapse into one `diagnosticsEnabled`.
 * On upgrade, diagnostics is ON if ANY of the legacy toggles was on, so a user
 * who had remote logging or tracing enabled keeps it. An explicit new value
 * always wins (re-migration must be idempotent).
 */
import { describe, expect, test } from "bun:test";
import {
	migrateDiagnosticsEnabled,
	RETIRED_SETTING_KEYS,
	stripRetiredSettings,
} from "../src/settings-migrate";

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

describe("stripRetiredSettings", () => {
	// A retired key that survives the load is written back on the next save, so
	// data.json keeps a setting the code no longer reads — it reads like a live
	// switch to anyone opening the file, and it is the reason `enableCrdt`
	// needed cleaning up long after the setting itself was deleted.
	test("removes every retired key", () => {
		const settings: Record<string, unknown> = {
			apiUrl: "https://engram.example",
			diagnosticsEnabled: true,
			remoteLoggingEnabled: true,
			diagnosticMode: true,
			tracingEnabled: true,
			enableCrdt: true,
			featureFlags: { crdtRecording: true },
		};

		stripRetiredSettings(settings);

		for (const key of RETIRED_SETTING_KEYS) {
			expect(settings).not.toHaveProperty(key);
		}
	});

	test("leaves live settings alone", () => {
		const settings: Record<string, unknown> = {
			apiUrl: "https://engram.example",
			diagnosticsEnabled: true,
		};

		stripRetiredSettings(settings);

		expect(settings).toEqual({
			apiUrl: "https://engram.example",
			diagnosticsEnabled: true,
		});
	});

	// The flag framework is gone; a stored override must not resurrect it.
	test("drops a stored featureFlags override", () => {
		const settings: Record<string, unknown> = { featureFlags: { crdtRecording: true } };
		stripRetiredSettings(settings);
		expect(settings.featureFlags).toBeUndefined();
	});
});
