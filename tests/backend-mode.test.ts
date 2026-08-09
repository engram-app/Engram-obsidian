import { describe, expect, test } from "bun:test";
import { withClearedAuth } from "../src/auth-state";
import {
	applySlot,
	captureSlot,
	connectionState,
	migrateBackendMode,
	modeForUrl,
	switchMode,
} from "../src/backend-mode";
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

const CLOUD = "https://api.engram.page";

describe("connectionState", () => {
	test("needs-url when apiUrl is empty", () => {
		expect(connectionState({ apiUrl: "", apiKey: "", refreshToken: undefined })).toBe(
			"needs-url",
		);
	});

	test("needs-auth when a URL is set but no credential", () => {
		expect(connectionState({ apiUrl: CLOUD, apiKey: "", refreshToken: undefined })).toBe(
			"needs-auth",
		);
	});

	test("connected with an apiKey", () => {
		expect(
			connectionState({ apiUrl: CLOUD, apiKey: "engram_k", refreshToken: undefined }),
		).toBe("connected");
	});

	test("connected with a refreshToken", () => {
		expect(connectionState({ apiUrl: CLOUD, apiKey: "", refreshToken: "r" })).toBe("connected");
	});
});

describe("switchMode", () => {
	test("no-op when already in the target mode", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		expect(switchMode(settings, "selfhost", CLOUD)).toBe(false);
		expect(settings.apiUrl).toBe("https://engram.example.com");
	});

	test("switching to cloud with no stash seeds the cloud URL and clears credentials", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		expect(switchMode(settings, "cloud", CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("cloud");
		expect(settings.apiUrl).toBe(CLOUD);
		expect(settings.apiKey).toBe("");
		expect(settings.refreshToken).toBeUndefined();
		expect(connectionState(settings)).toBe("needs-auth");
	});

	test("switching to selfhost with no stash leaves the URL empty", () => {
		const settings = fullSettings({ backendMode: "cloud", apiUrl: CLOUD });
		expect(switchMode(settings, "selfhost", CLOUD)).toBe(true);
		expect(settings.apiUrl).toBe("");
		expect(connectionState(settings)).toBe("needs-url");
	});

	test("round-trip restores the original backend's credentials", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		switchMode(settings, "cloud", CLOUD);
		settings.apiKey = "cloud_key";
		settings.userEmail = "cloud@example.com";

		switchMode(settings, "selfhost", CLOUD);
		expect(settings.apiUrl).toBe("https://engram.example.com");
		expect(settings.apiKey).toBe("engram_secret123");
		expect(settings.userEmail).toBe("todd@example.com");

		switchMode(settings, "cloud", CLOUD);
		expect(settings.apiKey).toBe("cloud_key");
		expect(settings.userEmail).toBe("cloud@example.com");
	});

	test("mutates settings in place", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		const before = settings;
		switchMode(settings, "cloud", CLOUD);
		expect(settings).toBe(before);
	});

	test("a stash missing apiUrl is treated as empty, never half-restored", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		settings.inactiveBackend = { apiKey: "orphan_key" } as never;
		switchMode(settings, "cloud", CLOUD);
		expect(settings.apiUrl).toBe(CLOUD);
		expect(settings.apiKey).toBe("");
	});
});

describe("migrateBackendMode", () => {
	test("infers cloud from a stored cloud URL", () => {
		const settings = fullSettings({ apiUrl: CLOUD });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("cloud");
	});

	test("infers selfhost from any other URL", () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("selfhost");
	});

	// CHANGED deliberately: a fresh install now onboards to Cloud, restoring what
	// the deleted cloudTabAction "auto-switch" branch did. Classifying it
	// "selfhost" sent new users to the self-hosted form and made the Welcome
	// tab's sign-in run a device flow against an empty base URL.
	test("infers cloud from an empty URL (fresh install onboards to Cloud)", () => {
		const settings = fullSettings({ apiUrl: "" });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("cloud");
	});

	test("is a no-op once backendMode is set", () => {
		const settings = fullSettings({ apiUrl: CLOUD, backendMode: "selfhost" });
		expect(migrateBackendMode(settings, CLOUD)).toBe(false);
		expect(settings.backendMode).toBe("selfhost");
	});

	test("never signs anyone out", () => {
		const settings = fullSettings({ apiUrl: CLOUD });
		settings.backendMode = undefined;
		migrateBackendMode(settings, CLOUD);
		expect(settings.apiKey).toBe("engram_secret123");
		expect(settings.refreshToken).toBe("refresh_abc");
		expect(settings.vaultId).toBe("vault-1");
		expect(settings.inactiveBackend).toBeUndefined();
	});
});

describe("modeForUrl", () => {
	test("empty URL onboards to cloud", () => {
		expect(modeForUrl("", CLOUD)).toBe("cloud");
	});

	test("cloud URL with a trailing slash is still cloud", () => {
		expect(modeForUrl("https://api.engram.page/", CLOUD)).toBe("cloud");
	});

	test("cloud URL with an /api path is still cloud", () => {
		expect(modeForUrl("https://api.engram.page/api", CLOUD)).toBe("cloud");
	});

	test("any other host is selfhost", () => {
		expect(modeForUrl("https://engram.example.com", CLOUD)).toBe("selfhost");
		expect(modeForUrl("http://127.0.0.1:4000", CLOUD)).toBe("selfhost");
	});
});

describe("migrateBackendMode onboarding", () => {
	test("a fresh install adopts cloud AND the cloud URL", () => {
		const settings = fullSettings({ apiUrl: "", apiKey: "", refreshToken: undefined });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("cloud");
		// Without this a new user lands in the self-hosted form and the Welcome
		// tab's sign-in runs a device flow against an empty base URL.
		expect(settings.apiUrl).toBe(CLOUD);
	});

	test("a configured self-host install is untouched", () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		settings.backendMode = undefined;
		migrateBackendMode(settings, CLOUD);
		expect(settings.backendMode).toBe("selfhost");
		expect(settings.apiUrl).toBe("https://engram.example.com");
	});

	test("a cloud install with a trailing slash is classified cloud, not selfhost", () => {
		const settings = fullSettings({ apiUrl: "https://api.engram.page/" });
		settings.backendMode = undefined;
		migrateBackendMode(settings, CLOUD);
		expect(settings.backendMode).toBe("cloud");
	});
});

describe("switchMode carries planState", () => {
	test("plan limits do not leak across backends", () => {
		const settings = fullSettings({ backendMode: "cloud", apiUrl: CLOUD });
		settings.planState = { tier: "pro" } as never;
		switchMode(settings, "selfhost", CLOUD);
		expect(settings.planState).toBeNull();
		switchMode(settings, "cloud", CLOUD);
		expect(settings.planState).toEqual({ tier: "pro" } as never);
	});
});
