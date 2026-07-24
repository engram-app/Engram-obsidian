import { describe, expect, mock, test } from "bun:test";
import {
	type ApiUrlSwitchTarget,
	applyApiUrlChange,
	cloudTabAction,
	completeOrigin,
	interpretHealthProbe,
	isBackendChange,
	migrateCloudApiUrl,
	withClearedAuth,
} from "../src/auth-state";
import { ENGRAM_CLOUD_URL } from "../src/tabs/urls";
import type { EngramSyncSettings } from "../src/types";

const fullSettings = (override: Partial<EngramSyncSettings> = {}): EngramSyncSettings => ({
	apiUrl: "https://engram.ras.band",
	apiKey: "engram_secret123",
	refreshToken: "refresh_token_abc",
	userEmail: "todd@example.com",
	authMethod: "oauth",
	vaultId: "1",
	clientId: "client-uuid",
	ignorePatterns: "node_modules",
	debounceMs: 2000,
	diagnosticsEnabled: false,
	...override,
});

describe("isBackendChange", () => {
	test("false when both URLs empty", () => {
		expect(isBackendChange("", "")).toBe(false);
	});

	test("false when old URL is empty (first-time setup, nothing to clear)", () => {
		expect(isBackendChange("", "https://engram.ras.band")).toBe(false);
	});

	test("false when new URL is partial (still typing)", () => {
		expect(isBackendChange("https://engram.ras.band", "https://engr")).toBe(false);
	});

	test("false when both URLs target the same origin", () => {
		expect(isBackendChange("https://engram.ras.band", "https://engram.ras.band")).toBe(false);
	});

	test("false when only trailing slash differs", () => {
		expect(isBackendChange("https://engram.ras.band/", "https://engram.ras.band")).toBe(false);
	});

	test("false when path differs but origin matches", () => {
		expect(isBackendChange("https://engram.ras.band", "https://engram.ras.band/api")).toBe(
			false,
		);
	});

	test("false when only case of host differs", () => {
		expect(isBackendChange("https://Engram.Ras.Band", "https://engram.ras.band")).toBe(false);
	});

	test("true when host differs", () => {
		expect(isBackendChange("https://engram.ras.band", "https://engram.ax")).toBe(true);
	});

	test("true when scheme differs (http vs https)", () => {
		expect(isBackendChange("https://engram.ras.band", "http://engram.ras.band")).toBe(true);
	});

	test("true when port differs", () => {
		expect(isBackendChange("http://localhost:8000", "http://localhost:8001")).toBe(true);
	});

	test("true when IPv4 hosts differ", () => {
		expect(isBackendChange("http://10.0.20.214:8000", "http://10.0.20.215:8000")).toBe(true);
	});

	test("false when IPv4 host + port match", () => {
		expect(isBackendChange("http://10.0.20.214:8000", "http://10.0.20.214:8000/api")).toBe(
			false,
		);
	});

	test("false when new URL is empty (cleared field)", () => {
		expect(isBackendChange("https://engram.ras.band", "")).toBe(false);
	});

	test("false when new URL is unparseable garbage", () => {
		expect(isBackendChange("https://engram.ras.band", "not a url")).toBe(false);
	});

	test("false when new URL has no scheme (host-only paste)", () => {
		expect(isBackendChange("https://engram.ras.band", "engram.ax")).toBe(false);
	});
});

describe("completeOrigin", () => {
	test("null for empty / partial / garbage / scheme-less", () => {
		expect(completeOrigin("")).toBeNull();
		expect(completeOrigin("https://engr")).toBeNull();
		expect(completeOrigin("not a url")).toBeNull();
		expect(completeOrigin("engram.ax")).toBeNull();
	});

	test("origin for localhost, IPv4, and real TLD", () => {
		expect(completeOrigin("http://localhost:8000")).toBe("http://localhost:8000");
		expect(completeOrigin("http://10.0.20.214:8000/api")).toBe("http://10.0.20.214:8000");
		expect(completeOrigin("https://Engram.AX")).toBe("https://engram.ax");
	});
});

describe("interpretHealthProbe", () => {
	test("engram when 200 + status ok + version string", () => {
		expect(interpretHealthProbe(200, { status: "ok", version: "0.5.42" })).toEqual({
			kind: "engram",
			version: "0.5.42",
		});
	});

	test("reachable when 200 but no version (generic health endpoint)", () => {
		expect(interpretHealthProbe(200, { status: "ok" })).toEqual({ kind: "reachable" });
	});

	test("reachable when version is not a string", () => {
		expect(interpretHealthProbe(200, { status: "ok", version: 123 })).toEqual({
			kind: "reachable",
		});
	});

	test("reachable when 200 body is null / non-JSON / empty object", () => {
		expect(interpretHealthProbe(200, null)).toEqual({ kind: "reachable" });
		expect(interpretHealthProbe(200, "<html>")).toEqual({ kind: "reachable" });
		expect(interpretHealthProbe(200, {})).toEqual({ kind: "reachable" });
	});

	test("reachable when server responds non-200 (there, but not healthy engram)", () => {
		expect(interpretHealthProbe(404, {})).toEqual({ kind: "reachable" });
		expect(interpretHealthProbe(500, null)).toEqual({ kind: "reachable" });
	});

	test("unreachable when status is 0 (no response)", () => {
		expect(interpretHealthProbe(0, null)).toEqual({ kind: "unreachable" });
	});
});

describe("withClearedAuth", () => {
	test("clears all backend-scoped auth fields", () => {
		const cleared = withClearedAuth(fullSettings());
		expect(cleared.apiKey).toBe("");
		expect(cleared.refreshToken).toBeUndefined();
		expect(cleared.userEmail).toBeUndefined();
		expect(cleared.authMethod).toBeNull();
		expect(cleared.vaultId).toBeNull();
	});

	test("clears the cached access token triplet (backend-scoped)", () => {
		// A cached access token is signed by — and only valid against — the
		// backend that minted it. On a backend switch it MUST be dropped, or it
		// gets replayed against the new origin and is rejected with a signature
		// error (stale stage token presented to prod → WS reconnect loop).
		const cleared = withClearedAuth(
			fullSettings({
				accessToken: "stage_signed_jwt",
				accessTokenExpiresAt: 1782252724000,
				accessTokenVaultId: "stage-vault",
			}),
		);
		expect(cleared.accessToken).toBeUndefined();
		expect(cleared.accessTokenExpiresAt).toBeUndefined();
		expect(cleared.accessTokenVaultId).toBeUndefined();
	});

	test("preserves apiUrl, clientId, and unrelated settings", () => {
		const before = fullSettings({
			apiUrl: "http://engram.ax",
			clientId: "stable-client-id",
			ignorePatterns: "tmp/**",
			debounceMs: 1500,
			diagnosticsEnabled: true,
		});
		const cleared = withClearedAuth(before);
		expect(cleared.apiUrl).toBe("http://engram.ax");
		expect(cleared.clientId).toBe("stable-client-id");
		expect(cleared.ignorePatterns).toBe("tmp/**");
		expect(cleared.debounceMs).toBe(1500);
		expect(cleared.diagnosticsEnabled).toBe(true);
	});

	test("does not mutate input settings object", () => {
		const before = fullSettings();
		const cleared = withClearedAuth(before);
		expect(before.apiKey).toBe("engram_secret123");
		expect(before.refreshToken).toBe("refresh_token_abc");
		expect(before.vaultId).toBe("1");
		expect(cleared).not.toBe(before);
	});
});

function makeTarget(overrides: Partial<EngramSyncSettings> = {}): ApiUrlSwitchTarget & {
	api: { setAuthProvider: ReturnType<typeof mock> };
	noteStream: { disconnect: ReturnType<typeof mock> } | null;
	resetAuthProvider: ReturnType<typeof mock>;
} {
	return {
		settings: fullSettings(overrides),
		api: { setAuthProvider: mock(() => {}) },
		noteStream: { disconnect: mock(() => {}) },
		resetAuthProvider: mock(() => {}),
	};
}

describe("applyApiUrlChange", () => {
	test("same origin: updates apiUrl, preserves auth, returns false", async () => {
		const target = makeTarget({ apiUrl: "https://engram.ras.band" });
		const save = mock(async () => {});
		const cleared = await applyApiUrlChange(target, "https://engram.ras.band/api", save);
		expect(cleared).toBe(false);
		expect(target.settings.apiUrl).toBe("https://engram.ras.band/api");
		expect(target.settings.apiKey).toBe("engram_secret123");
		expect(target.settings.refreshToken).toBe("refresh_token_abc");
		expect(target.settings.vaultId).toBe("1");
		expect(target.api.setAuthProvider).not.toHaveBeenCalled();
		expect(target.noteStream?.disconnect).not.toHaveBeenCalled();
		expect(target.resetAuthProvider).not.toHaveBeenCalled();
		expect(save).toHaveBeenCalledTimes(1);
	});

	test("identical URL: skips save and stream disconnect (no-op)", async () => {
		const target = makeTarget({ apiUrl: "https://engram.ras.band" });
		const save = mock(async () => {});
		const cleared = await applyApiUrlChange(target, "https://engram.ras.band", save);
		expect(cleared).toBe(false);
		expect(target.settings.apiKey).toBe("engram_secret123");
		expect(target.api.setAuthProvider).not.toHaveBeenCalled();
		expect(target.noteStream?.disconnect).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
	});

	test("different origin: clears auth, disconnects stream, nulls api provider", async () => {
		const target = makeTarget({ apiUrl: "https://engram.ras.band" });
		const save = mock(async () => {});
		const cleared = await applyApiUrlChange(target, "http://engram.ax", save);
		expect(cleared).toBe(true);
		expect(target.settings.apiUrl).toBe("http://engram.ax");
		expect(target.settings.apiKey).toBe("");
		expect(target.settings.refreshToken).toBeUndefined();
		expect(target.settings.userEmail).toBeUndefined();
		expect(target.settings.authMethod).toBeNull();
		expect(target.settings.vaultId).toBeNull();
		expect(target.api.setAuthProvider).toHaveBeenCalledWith(null);
		expect(target.noteStream?.disconnect).toHaveBeenCalledTimes(1);
		expect(target.resetAuthProvider).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledTimes(1);
	});

	test("different origin: resets the live in-memory auth provider", async () => {
		// The stale provider holds an old-backend-signed access token in memory;
		// without this it replays against the new origin → signature_error loop.
		const target = makeTarget({ apiUrl: "https://staging.engram.page" });
		const save = mock(async () => {});
		await applyApiUrlChange(target, "https://api.engram.page", save);
		expect(target.resetAuthProvider).toHaveBeenCalledTimes(1);
	});

	test("partial URL (still typing): updates apiUrl, preserves auth, returns false", async () => {
		const target = makeTarget({ apiUrl: "https://engram.ras.band" });
		const save = mock(async () => {});
		const cleared = await applyApiUrlChange(target, "https://engr", save);
		expect(cleared).toBe(false);
		expect(target.settings.apiUrl).toBe("https://engr");
		expect(target.settings.apiKey).toBe("engram_secret123");
		expect(target.api.setAuthProvider).not.toHaveBeenCalled();
		expect(target.noteStream?.disconnect).not.toHaveBeenCalled();
	});

	test("noteStream null: does not throw", async () => {
		const target = makeTarget({ apiUrl: "https://engram.ras.band" });
		target.noteStream = null;
		const save = mock(async () => {});
		const cleared = await applyApiUrlChange(target, "http://engram.ax", save);
		expect(cleared).toBe(true);
		expect(target.api.setAuthProvider).toHaveBeenCalledWith(null);
	});

	test("preserves settings reference identity (in-place mutation)", async () => {
		const target = makeTarget({ apiUrl: "https://engram.ras.band" });
		const settingsRef = target.settings;
		const save = mock(async () => {});
		await applyApiUrlChange(target, "http://engram.ax", save);
		expect(target.settings).toBe(settingsRef);
	});
});

describe("cloudTabAction", () => {
	const CLOUD = "https://app.engram.page";

	test("already on cloud: render normally — never switch", () => {
		expect(cloudTabAction(fullSettings({ apiUrl: CLOUD }), CLOUD)).toBe("render");
	});

	test("self-hosted with apiKey: require explicit click (no auto-wipe)", () => {
		const settings = fullSettings({
			apiUrl: "http://localhost:8100",
			apiKey: "engram_key",
			refreshToken: undefined,
		});
		expect(cloudTabAction(settings, CLOUD)).toBe("prompt-switch");
	});

	test("self-hosted with refreshToken: require explicit click", () => {
		const settings = fullSettings({
			apiUrl: "http://localhost:8100",
			apiKey: "",
			refreshToken: "rt_abc",
		});
		expect(cloudTabAction(settings, CLOUD)).toBe("prompt-switch");
	});

	test("self-hosted with no creds: prompt, never silently overwrite the typed URL", () => {
		const settings = fullSettings({
			apiUrl: "http://localhost:8100",
			apiKey: "",
			refreshToken: undefined,
		});
		// A configured self-host URL (even before credentials exist) is real
		// user input — merely rendering the Cloud tab must not clobber it with
		// the cloud URL. Prompt for an explicit switch instead.
		expect(cloudTabAction(settings, CLOUD)).toBe("prompt-switch");
	});

	test("fresh install (no apiUrl) with no creds: auto-switch to cloud", () => {
		const settings = fullSettings({
			apiUrl: "",
			apiKey: "",
			refreshToken: undefined,
		});
		expect(cloudTabAction(settings, CLOUD)).toBe("auto-switch");
	});

	test("self-hosted same origin as cloud (path differs only): treat as cloud", () => {
		// applyApiUrlChange would not wipe in this case, so don't prompt either.
		const settings = fullSettings({ apiUrl: "https://app.engram.page/api" });
		expect(cloudTabAction(settings, CLOUD)).toBe("render");
	});
});

describe("migrateCloudApiUrl", () => {
	test("rewrites legacy app.engram.page host to the canonical cloud REST host", () => {
		expect(migrateCloudApiUrl("https://app.engram.page", ENGRAM_CLOUD_URL)).toBe(
			ENGRAM_CLOUD_URL,
		);
	});

	test("ignores trailing slash / path on the legacy host and still migrates", () => {
		expect(migrateCloudApiUrl("https://app.engram.page/", ENGRAM_CLOUD_URL)).toBe(
			ENGRAM_CLOUD_URL,
		);
	});

	test("is case-insensitive on the legacy host", () => {
		expect(migrateCloudApiUrl("https://APP.Engram.Page", ENGRAM_CLOUD_URL)).toBe(
			ENGRAM_CLOUD_URL,
		);
	});

	test("returns null when already on the canonical cloud host (no-op)", () => {
		expect(migrateCloudApiUrl(ENGRAM_CLOUD_URL, ENGRAM_CLOUD_URL)).toBeNull();
	});

	test("returns null for a self-hosted URL (never touch it)", () => {
		expect(migrateCloudApiUrl("https://engram.ras.band", ENGRAM_CLOUD_URL)).toBeNull();
	});

	test("returns null for empty / unset apiUrl", () => {
		expect(migrateCloudApiUrl("", ENGRAM_CLOUD_URL)).toBeNull();
	});

	test("returns null for an unparseable mid-typing URL", () => {
		expect(migrateCloudApiUrl("https://app", ENGRAM_CLOUD_URL)).toBeNull();
	});
});
