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
import { describe, expect, test } from "bun:test";
import EngramSyncPlugin from "../src/main";

describe("saveOAuthTokens auth-provider ordering", () => {
	test("installs the new auth provider on this.api BEFORE saveSettings()", async () => {
		const order: string[] = [];
		const newProvider = { tag: "new-oauth-provider" };
		const fakeThis = {
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
		};

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
		const fakeThis = {
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
		};

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
