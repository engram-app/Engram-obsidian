import { describe, expect, test } from "bun:test";
import { withClearedAuth } from "../src/auth-state";
import { applySlot, captureSlot } from "../src/backend-mode";
import { BACKEND_SCOPED_FIELDS, type EngramSyncSettings } from "../src/types";

const fullSettings = (override: Partial<EngramSyncSettings> = {}): EngramSyncSettings => ({
	apiUrl: "https://engram.example.com",
	apiKey: "engram_secret123",
	refreshToken: "refresh_abc",
	userEmail: "todd@example.com",
	authMethod: "oauth",
	vaultId: "vault-1",
	remoteVaultName: "My Vault",
	accessToken: "access_xyz",
	accessTokenExpiresAt: 1234567890,
	accessTokenVaultId: "vault-1",
	clientId: "client-uuid",
	ignorePatterns: "node_modules",
	debounceMs: 2000,
	diagnosticsEnabled: false,
	remoteLogLevel: "info",
	searchDefaultMode: "hybrid",
	...override,
});

describe("captureSlot / applySlot", () => {
	test("captures every backend-scoped field", () => {
		const slot = captureSlot(fullSettings());
		for (const key of BACKEND_SCOPED_FIELDS) {
			expect(Object.hasOwn(slot, key)).toBe(true);
		}
		expect(slot.apiUrl).toBe("https://engram.example.com");
		expect(slot.accessTokenExpiresAt).toBe(1234567890);
	});

	test("applySlot mutates in place so live references stay valid", () => {
		const settings = fullSettings();
		const before = settings;
		applySlot(settings, captureSlot(fullSettings({ apiUrl: "https://other.example.com" })));
		expect(settings).toBe(before);
		expect(settings.apiUrl).toBe("https://other.example.com");
	});

	test("round-trip restores every field exactly", () => {
		const original = fullSettings();
		const slot = captureSlot(original);
		const scratch = fullSettings({ apiUrl: "", apiKey: "", refreshToken: undefined });
		applySlot(scratch, slot);
		for (const key of BACKEND_SCOPED_FIELDS) {
			expect(scratch[key]).toEqual(original[key]);
		}
	});
});

describe("drift guard", () => {
	test("every field withClearedAuth clears is backend-scoped", () => {
		const before = fullSettings();
		const after = withClearedAuth(before);
		const cleared = (Object.keys(before) as (keyof EngramSyncSettings)[]).filter(
			(k) => before[k] !== after[k],
		);
		expect(cleared.length).toBeGreaterThan(0);
		for (const key of cleared) {
			expect(BACKEND_SCOPED_FIELDS as readonly string[]).toContain(key);
		}
	});
});
