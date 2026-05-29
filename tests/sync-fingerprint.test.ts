import { describe, expect, test } from "bun:test";
import { computeSyncFingerprint } from "../src/sync-fingerprint";
import type { EngramSyncSettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

function makeSettings(overrides: Partial<EngramSyncSettings> = {}): EngramSyncSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("computeSyncFingerprint", () => {
	test("returns empty string when neither auth nor vault is set", async () => {
		expect(await computeSyncFingerprint(makeSettings())).toBe("");
	});

	test("changes when apiKey changes", async () => {
		const a = await computeSyncFingerprint(makeSettings({ apiKey: "key-a", vaultId: "v1" }));
		const b = await computeSyncFingerprint(makeSettings({ apiKey: "key-b", vaultId: "v1" }));
		expect(a).not.toBe(b);
	});

	test("changes when vaultId changes", async () => {
		const a = await computeSyncFingerprint(makeSettings({ apiKey: "key", vaultId: "v1" }));
		const b = await computeSyncFingerprint(makeSettings({ apiKey: "key", vaultId: "v2" }));
		expect(a).not.toBe(b);
	});

	test("OAuth fingerprint differs from a static-key fingerprint for the same vault", async () => {
		const apiKeyFp = await computeSyncFingerprint(
			makeSettings({ apiKey: "static", vaultId: "v1" }),
		);
		const oauthFp = await computeSyncFingerprint(
			makeSettings({ refreshToken: "rt", userEmail: "u@e.com", vaultId: "v1" }),
		);
		expect(apiKeyFp).not.toBe(oauthFp);
	});

	test("stable across refresh-token rotation (the single-use token rotates every refresh)", async () => {
		// The sync gate is keyed on this fingerprint. OAuth refresh tokens are
		// single-use and rotate on every refresh, so keying on the token would
		// slam the gate shut after the first refresh — fullSync/WS then no-op.
		// Identity must be the account (userEmail), not the rotating token.
		const before = makeSettings({ refreshToken: "RT0", userEmail: "u@e.com", vaultId: "v1" });
		const afterRotation = makeSettings({
			refreshToken: "RT1",
			userEmail: "u@e.com",
			vaultId: "v1",
		});
		expect(await computeSyncFingerprint(afterRotation)).toBe(
			await computeSyncFingerprint(before),
		);
	});

	test("changes when the OAuth account (userEmail) changes", async () => {
		const a = await computeSyncFingerprint(
			makeSettings({ refreshToken: "RT", userEmail: "a@e.com", vaultId: "v1" }),
		);
		const b = await computeSyncFingerprint(
			makeSettings({ refreshToken: "RT", userEmail: "b@e.com", vaultId: "v1" }),
		);
		expect(a).not.toBe(b);
	});

	test("stable across calls with same input", async () => {
		const settings = makeSettings({ apiKey: "k", vaultId: "v" });
		const a = await computeSyncFingerprint(settings);
		const b = await computeSyncFingerprint(settings);
		expect(a).toBe(b);
	});

	test("returns non-empty string when only apiKey is set (no vaultId)", async () => {
		const fp = await computeSyncFingerprint(makeSettings({ apiKey: "somekey" }));
		expect(fp).not.toBe("");
		expect(fp).toHaveLength(64); // SHA-256 hex = 64 chars
	});

	test("returns non-empty string when only vaultId is set (no auth)", async () => {
		const fp = await computeSyncFingerprint(makeSettings({ vaultId: "vault-123" }));
		expect(fp).not.toBe("");
		expect(fp).toHaveLength(64);
	});

	test("returns 64-char hex string for valid inputs", async () => {
		const fp = await computeSyncFingerprint(makeSettings({ apiKey: "k", vaultId: "v" }));
		expect(fp).toMatch(/^[0-9a-f]{64}$/);
	});
});
