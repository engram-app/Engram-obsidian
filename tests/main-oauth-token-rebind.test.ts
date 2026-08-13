/**
 * Tests: saveOAuthTokens (main.ts) — auth-provider wiring order.
 *
 * Root cause (e2e-clerk test_84/85, CI runs 28936382212 / 29142154258): an OAuth
 * account/vault switch mutates settings then `await saveSettings()`, which
 * rebuilds the note channel (setupNoteStream → connectChannel). The channel
 * freezes its topic userId from `this.api.getMe()` at construction. If the auth
 * provider is still the OLD user's when that getMe() runs, the new channel is
 * minted as `crdt:<oldUserId>:<newVaultId>` while the socket later authenticates
 * with the NEW user's token → the backend rejects the join "unauthorized" and
 * live sync stays silently dead until a reload.
 *
 * The prior `shouldReuseLiveStream` guard only helps a path with a SECOND
 * setupNoteStream after the provider swap (the e2e swap helper); production
 * saveOAuthTokens has none, so the doomed channel persists. The fix is to wire
 * the new provider onto `this.api` BEFORE saveSettings() runs the rebuild.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { OAuthAuth } from "../src/auth";
import EngramSyncPlugin from "../src/main";

describe("saveOAuthTokens auth-provider ordering", () => {
	test("installs the new auth provider on this.api BEFORE saveSettings()", async () => {
		const order: string[] = [];
		const newProvider = { tag: "new-oauth-provider" };
		const fakeThis = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: {} as Record<string, unknown>,
			createAuthProvider() {
				return newProvider;
			},
			api: {
				setAuthProvider(p: unknown) {
					order.push(
						p === newProvider ? "api.setAuthProvider:new" : "api.setAuthProvider:other",
					);
				},
				getMe() {
					return Promise.resolve({ id: "new-user" });
				},
			},
			noteStream: {
				setAuthProvider(_p: unknown) {
					order.push("noteStream.setAuthProvider");
				},
				setAuthProbe(_f: unknown) {
					order.push("noteStream.setAuthProbe");
				},
			},
			async saveSettings() {
				order.push("saveSettings");
			},
			syncEngine: {
				bumpAuthGeneration() {
					order.push("bumpAuthGeneration");
				},
			},
		});

		await EngramSyncPlugin.prototype.saveOAuthTokens.call(
			fakeThis as never,
			"refresh-tok",
			"new-vault",
			"new@example.com",
		);

		const apiSwapIdx = order.findIndex((o) => o.startsWith("api.setAuthProvider"));
		const saveIdx = order.indexOf("saveSettings");

		// #283: the identity-swap bump must fire before the racy saveSettings/rebuild.
		const bumpIdx = order.indexOf("bumpAuthGeneration");
		expect(bumpIdx).toBeGreaterThanOrEqual(0);
		expect(bumpIdx).toBeLessThan(saveIdx);

		expect(apiSwapIdx).toBeGreaterThanOrEqual(0);
		expect(saveIdx).toBeGreaterThanOrEqual(0);
		// The provider must reach this.api BEFORE the channel-rebuilding
		// saveSettings(), or getMe() freezes the old user's id into the topic.
		expect(apiSwapIdx).toBeLessThan(saveIdx);
		expect(order).toContain("api.setAuthProvider:new");

		// Settings carry the new identity before the save.
		expect(fakeThis.settings.refreshToken).toBe("refresh-tok");
		expect(fakeThis.settings.vaultId).toBe("new-vault");
		expect(fakeThis.settings.authMethod).toBe("oauth");
		expect(fakeThis.settings.accessToken).toBeUndefined();
	});

	test("clearOAuthTokens installs the apiKey provider on this.api BEFORE saveSettings()", async () => {
		// Mirror bug: clearing OAuth back to an apiKey identity has the same
		// channel-rebuild-before-provider-swap hole — saveSettings() would freeze
		// the outgoing OAuth user's id into the topic while the socket then
		// authenticates as the apiKey identity.
		const order: string[] = [];
		const fakeThis = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: {
				apiKey: "ak-123",
				vaultId: "v1",
				refreshToken: "r",
				authMethod: "oauth",
			} as Record<string, unknown>,
			api: {
				setAuthProvider(_p: unknown) {
					order.push("api.setAuthProvider");
				},
				getMe() {
					return Promise.resolve({ id: "apikey-user" });
				},
			},
			noteStream: {
				setAuthProvider(_p: unknown) {
					order.push("noteStream.setAuthProvider");
				},
				setAuthProbe(_f: unknown) {
					order.push("noteStream.setAuthProbe");
				},
			},
			async saveSettings() {
				order.push("saveSettings");
			},
			syncEngine: {
				bumpAuthGeneration() {
					order.push("bumpAuthGeneration");
				},
			},
		});

		await EngramSyncPlugin.prototype.clearOAuthTokens.call(fakeThis as never);

		const apiSwapIdx = order.indexOf("api.setAuthProvider");
		const saveIdx = order.indexOf("saveSettings");
		expect(apiSwapIdx).toBeGreaterThanOrEqual(0);
		expect(saveIdx).toBeGreaterThanOrEqual(0);
		expect(apiSwapIdx).toBeLessThan(saveIdx);

		// #283: logout also swaps the provider — the bump must precede saveSettings.
		const bumpIdx = order.indexOf("bumpAuthGeneration");
		expect(bumpIdx).toBeGreaterThanOrEqual(0);
		expect(bumpIdx).toBeLessThan(saveIdx);

		// OAuth fields cleared before the save.
		expect(fakeThis.settings.refreshToken).toBeUndefined();
		expect(fakeThis.settings.authMethod).toBeNull();
	});
});

describe("provider swaps dispose the outgoing OAuthAuth (#420)", () => {
	// Two live OAuthAuth instances refreshing the same rotating token chain fork
	// it; the server's reuse detection revokes the whole family (prod incident
	// 2026-08-12). Every path that replaces this.authProvider must dispose the
	// outgoing instance first.
	function oldOAuthProvider() {
		const old = new OAuthAuth("engram_rt_old", "vault-1", "old@test.com", mock());
		return { old, disposeSpy: spyOn(old, "dispose") };
	}

	function baseFake(old: OAuthAuth) {
		return Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: {} as Record<string, unknown>,
			authProvider: old,
			createAuthProvider() {
				return { tag: "new-provider" };
			},
			api: {
				setAuthProvider(_p: unknown) {},
				getMe() {
					return Promise.resolve({ id: "u" });
				},
			},
			noteStream: {
				disconnect() {},
				setAuthProvider(_p: unknown) {},
				setAuthProbe(_f: unknown) {},
			},
			async saveSettings() {},
			syncEngine: {
				bumpAuthGeneration() {},
				getLastSync() {
					return 0;
				},
				getStatus() {
					return "idle";
				},
			},
			async savePluginData(_ls: unknown) {},
			updateStatusBar(_s: unknown) {},
		});
	}

	test("saveOAuthTokens disposes the outgoing provider", async () => {
		const { old, disposeSpy } = oldOAuthProvider();
		await EngramSyncPlugin.prototype.saveOAuthTokens.call(
			baseFake(old) as never,
			"rt",
			"vault-2",
			"new@test.com",
		);
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	test("switchBackendMode disposes the outgoing provider", async () => {
		const { old, disposeSpy } = oldOAuthProvider();
		const fake = baseFake(old);
		fake.settings = { backendMode: "cloud", apiUrl: "https://api.engram.page" };
		const switched = await EngramSyncPlugin.prototype.switchBackendMode.call(
			fake as never,
			"selfhost",
		);
		expect(switched).toBe(true);
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	test("clearOAuthTokens disposes the outgoing provider", async () => {
		const { old, disposeSpy } = oldOAuthProvider();
		await EngramSyncPlugin.prototype.clearOAuthTokens.call(baseFake(old) as never);
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	test("clearAuthAndPromptRelink disposes the outgoing provider", async () => {
		const { old, disposeSpy } = oldOAuthProvider();
		const fake = baseFake(old);
		fake.settings = { refreshToken: "rt" };
		fake.noteStream = null;
		await (
			EngramSyncPlugin.prototype as unknown as {
				clearAuthAndPromptRelink(reason: string, notify: boolean): Promise<void>;
			}
		).clearAuthAndPromptRelink.call(fake as never, "test", false);
		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});
});

describe("swap-site hardening round 2 (#420 review)", () => {
	test("switchBackendMode stashes the ROTATED token when a refresh is in flight", async () => {
		let resolveRefresh!: (v: unknown) => void;
		const refreshFn = mock(() => new Promise((r) => (resolveRefresh = r)));
		const settings: Record<string, unknown> = {
			backendMode: "cloud",
			apiUrl: "https://api.engram.page",
			refreshToken: "engram_rt_consumed",
		};
		const old = new OAuthAuth(
			"engram_rt_consumed",
			"vault-1",
			"u@test.com",
			refreshFn as never,
			(tokens) => {
				settings.refreshToken = tokens.refreshToken;
			},
		);
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings,
			authProvider: old,
			createAuthProvider() {
				return null;
			},
			api: { setAuthProvider(_p: unknown) {} },
			noteStream: null,
			async saveSettings() {},
			syncEngine: { bumpAuthGeneration() {} },
		});

		void old.getToken();
		const switching = EngramSyncPlugin.prototype.switchBackendMode.call(
			fake as never,
			"selfhost",
		);
		resolveRefresh({
			access_token: "jwt_1",
			refresh_token: "engram_rt_rotated",
			expires_in: 3600,
		});
		expect(await switching).toBe(true);

		// The server consumed engram_rt_consumed mid-switch. The stash must hold
		// the ROTATED token, or switching back replays a dead token and trips
		// the server's reuse detection (revoking the whole family).
		const stash = settings.inactiveBackend as { refreshToken?: string };
		expect(stash.refreshToken).toBe("engram_rt_rotated");
	});

	test("clearOAuthTokens with no apiKey wires null onto the api (not the disposed provider)", async () => {
		const old = new OAuthAuth("engram_rt_old", "vault-1", "u@test.com", mock());
		const wired: unknown[] = [];
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: {} as Record<string, unknown>,
			authProvider: old,
			api: {
				setAuthProvider(p: unknown) {
					wired.push(p);
				},
			},
			noteStream: null,
			async saveSettings() {},
			syncEngine: { bumpAuthGeneration() {} },
		});

		await EngramSyncPlugin.prototype.clearOAuthTokens.call(fake as never);
		// The api must not be left holding the disposed provider — every later
		// call would throw "OAuthAuth disposed" instead of running unauthenticated.
		expect(wired).toEqual([null]);
	});
});
