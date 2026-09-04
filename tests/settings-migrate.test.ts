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
import { DEFAULT_SETTINGS } from "../src/types";

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
	// THE assertion that justifies extracting the list at all. Retiring a key
	// that DEFAULT_SETTINGS still provides would have Object.assign supply the
	// value and this helper delete it moments later, leaving a live setting
	// undefined at runtime while TypeScript still claims the field is present.
	// The loop-over-the-list test below cannot catch that: a key which is both
	// retired and live passes it trivially.
	test("no retired key is still a live default", () => {
		expect(RETIRED_SETTING_KEYS.filter((k) => k in DEFAULT_SETTINGS)).toEqual([]);
	});

	// Pinned by literal, not by looping RETIRED_SETTING_KEYS: a test that
	// iterates the list under test goes green the moment someone deletes an
	// entry from it, which is exactly the regression it claims to prevent.
	test("the retired list still contains every key we have retired", () => {
		expect([...RETIRED_SETTING_KEYS]).toEqual([
			"remoteLoggingEnabled",
			"diagnosticMode",
			"tracingEnabled",
			"enableCrdt",
			"featureFlags",
			"waitlistPromptSeen",
		]);
	});

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
