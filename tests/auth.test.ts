import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ApiKeyAuth, OAuthAuth } from "../src/auth";

describe("ApiKeyAuth", () => {
	it("returns the API key as token", async () => {
		const auth = new ApiKeyAuth("engram_test123", "vault-1");
		expect(await auth.getToken()).toBe("engram_test123");
	});

	it("reports authenticated when key is set", () => {
		const auth = new ApiKeyAuth("engram_test123", "vault-1");
		expect(auth.isAuthenticated()).toBe(true);
	});

	it("reports not authenticated when key is empty", () => {
		const auth = new ApiKeyAuth("", null);
		expect(auth.isAuthenticated()).toBe(false);
	});

	it("returns vault ID", () => {
		const auth = new ApiKeyAuth("engram_test123", "vault-1");
		expect(auth.getVaultId()).toBe("vault-1");
	});

	it("clears state on sign out", () => {
		const auth = new ApiKeyAuth("engram_test123", "vault-1");
		auth.signOut();
		expect(auth.isAuthenticated()).toBe(false);
	});
});

describe("OAuthAuth", () => {
	const mockRefreshFn = mock();

	beforeEach(() => {
		mockRefreshFn.mockReset();
	});

	it("refreshes on first getToken call", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		const token = await auth.getToken();

		expect(token).toBe("jwt_123");
		expect(mockRefreshFn).toHaveBeenCalledWith("engram_rt_old");
	});

	it("returns cached token when not expired", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		await auth.getToken();
		mockRefreshFn.mockClear();

		const token = await auth.getToken();
		expect(token).toBe("jwt_123");
		expect(mockRefreshFn).not.toHaveBeenCalled();
	});

	it("refreshes when token is about to expire", async () => {
		mockRefreshFn
			.mockResolvedValueOnce({
				access_token: "jwt_first",
				refresh_token: "engram_rt_second",
				expires_in: 30, // expires in 30s, below 60s buffer
			})
			.mockResolvedValueOnce({
				access_token: "jwt_second",
				refresh_token: "engram_rt_third",
				expires_in: 3600,
			});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		await auth.getToken(); // first call, gets jwt_first but it's expiring soon

		const token = await auth.getToken(); // should refresh
		expect(token).toBe("jwt_second");
		expect(mockRefreshFn).toHaveBeenCalledTimes(2);
	});

	it("reuses a seeded access token on load without refreshing", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "should_not_be_used",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});
		// Seed a still-valid access token (10 min out), as restored from disk.
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn,
			undefined,
			"seeded_access",
			Date.now() + 10 * 60 * 1000,
		);
		const token = await auth.getToken();
		expect(token).toBe("seeded_access");
		expect(mockRefreshFn).not.toHaveBeenCalled();
	});

	it("refreshes when the seeded access token is already expired", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_fresh",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn,
			undefined,
			"stale_access",
			Date.now() - 1000, // already expired
		);
		const token = await auth.getToken();
		expect(token).toBe("jwt_fresh");
		expect(mockRefreshFn).toHaveBeenCalledTimes(1);
	});

	it("hands the rotated refresh + access token and expiry to onTokenRotated", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});
		let persisted: { refreshToken: string; accessToken: string; expiresAt: number } | null = null;
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn,
			(t) => {
				persisted = t;
			},
		);
		await auth.getToken();
		expect(persisted).toMatchObject({
			refreshToken: "engram_rt_new",
			accessToken: "jwt_123",
		});
		expect(persisted?.expiresAt).toBeGreaterThan(Date.now());
	});

	it("sets isAuthenticated to false on refresh failure", async () => {
		mockRefreshFn.mockRejectedValue(new Error("401"));

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);

		await expect(auth.getToken()).rejects.toThrow("401");
		expect(auth.isAuthenticated()).toBe(false);
	});

	it("clears state on sign out", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		await auth.getToken();
		auth.signOut();

		expect(auth.isAuthenticated()).toBe(false);
		expect(auth.getVaultId()).toBeNull();
	});

	it("updates refresh token after rotation", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_rotated",
			expires_in: 3600,
		});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		await auth.getToken();

		expect(auth.getRefreshToken()).toBe("engram_rt_rotated");
	});

	it("deduplicates concurrent refresh calls (race condition)", async () => {
		let callCount = 0;
		const slowRefresh = mock(async (_token: string) => {
			callCount++;
			// Simulate network delay so concurrent calls overlap
			await new Promise((r) => setTimeout(r, 50));
			return {
				access_token: `jwt_${callCount}`,
				refresh_token: `engram_rt_${callCount}`,
				expires_in: 3600,
			};
		});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", slowRefresh);

		// Fire 5 concurrent getToken() calls — simulates plugin startup
		const results = await Promise.all([
			auth.getToken(),
			auth.getToken(),
			auth.getToken(),
			auth.getToken(),
			auth.getToken(),
		]);

		// Only ONE refresh call should have been made
		expect(slowRefresh).toHaveBeenCalledTimes(1);
		// All callers get the same token
		expect(new Set(results).size).toBe(1);
	});

	it("calls onTokenRotated callback after successful refresh", async () => {
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});

		const onRotated = mock();
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn,
			onRotated,
		);
		await auth.getToken();

		expect(onRotated).toHaveBeenCalledWith(
			expect.objectContaining({ refreshToken: "engram_rt_new", accessToken: "jwt_123" }),
		);
	});

	it("awaits onTokenRotated before resolving getToken", async () => {
		// Reproduces the 1.3.0 regression: a fire-and-forget save inside the
		// rotation callback could lose the new refresh token if the plugin was
		// updated/reloaded before the disk write flushed. doRefresh must wait
		// for the persistence promise to settle so callers can't act on the
		// access token until the rotated refresh token is durable.
		mockRefreshFn.mockResolvedValue({
			access_token: "jwt_123",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});

		let persistResolved = false;
		const onRotated = mock(
			() =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						persistResolved = true;
						resolve();
					}, 25);
				}),
		);

		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn,
			onRotated,
		);
		await auth.getToken();

		expect(persistResolved).toBe(true);
	});

	it("does not call onTokenRotated on refresh failure", async () => {
		mockRefreshFn.mockRejectedValue(new Error("401"));

		const onRotated = mock();
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn,
			onRotated,
		);

		await expect(auth.getToken()).rejects.toThrow("401");
		expect(onRotated).not.toHaveBeenCalled();
	});

	it("invalidateAccessToken forces next getToken to refresh", async () => {
		mockRefreshFn
			.mockResolvedValueOnce({
				access_token: "jwt_first",
				refresh_token: "engram_rt_second",
				expires_in: 3600,
			})
			.mockResolvedValueOnce({
				access_token: "jwt_second",
				refresh_token: "engram_rt_third",
				expires_in: 3600,
			});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		expect(await auth.getToken()).toBe("jwt_first");

		auth.invalidateAccessToken();

		expect(await auth.getToken()).toBe("jwt_second");
		expect(mockRefreshFn).toHaveBeenCalledTimes(2);
	});

	it("retries refresh after a failed attempt (not permanently stuck)", async () => {
		mockRefreshFn.mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce({
			access_token: "jwt_recovered",
			refresh_token: "engram_rt_recovered",
			expires_in: 3600,
		});

		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);

		await expect(auth.getToken()).rejects.toThrow("network error");
		expect(auth.isAuthenticated()).toBe(false);

		// Second attempt should try again, not stay stuck
		const token = await auth.getToken();
		expect(token).toBe("jwt_recovered");
		expect(auth.isAuthenticated()).toBe(true);
	});
});
