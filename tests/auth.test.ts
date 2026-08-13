import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ApiKeyAuth, OAuthAuth, seededAccessToken } from "../src/auth";
import type { EngramSyncSettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

function settings(overrides: Partial<EngramSyncSettings> = {}): EngramSyncSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("seededAccessToken", () => {
	const future = 9_999_999_999_999;

	it("seeds a token minted for the currently-active vault", () => {
		const r = seededAccessToken(
			settings({
				refreshToken: "rt",
				accessToken: "good",
				accessTokenExpiresAt: future,
				accessTokenVaultId: "v1",
				vaultId: "v1",
			}),
		);
		expect(r.token).toBe("good");
		expect(r.expiresAt).toBe(future);
	});

	it("does NOT seed a token minted for a different vault (stale after account swap)", () => {
		// The bug: an account swap sets a new vaultId but leaves the previous
		// session's access token in settings. Reusing it sends an old-user JWT
		// at the new vault → 404, not 401. The token must be discarded so the
		// provider refreshes against the new refresh token instead.
		const r = seededAccessToken(
			settings({
				refreshToken: "rt-new",
				accessToken: "stale",
				accessTokenExpiresAt: future,
				accessTokenVaultId: "v-old",
				vaultId: "v-new",
			}),
		);
		expect(r.token).toBeNull();
		expect(r.expiresAt).toBe(0);
	});

	it("does NOT seed when no vault binding was recorded (pre-upgrade data)", () => {
		const r = seededAccessToken(
			settings({
				refreshToken: "rt",
				accessToken: "x",
				accessTokenExpiresAt: future,
				vaultId: "v1",
			}),
		);
		expect(r.token).toBeNull();
	});

	it("seeds nothing when there is no access token", () => {
		const r = seededAccessToken(settings({ refreshToken: "rt", vaultId: "v1" }));
		expect(r.token).toBeNull();
		expect(r.expiresAt).toBe(0);
	});
});

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
		let persisted: { refreshToken: string; accessToken: string; expiresAt: number } | null =
			null;
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

describe("OAuthAuth self-heal on definitive rejection", () => {
	const throwingRefresh = (status: number) =>
		mock(async () => {
			const e = new Error(`Refresh failed: ${status}`) as Error & { status?: number };
			e.status = status;
			throw e;
		});

	it("clears the refresh token and fires onAuthInvalidated on a 4xx rejection", async () => {
		const refresh = throwingRefresh(404);
		const onInvalidated = mock(() => {});
		const auth = new OAuthAuth(
			"engram_rt_dead",
			"vault-1",
			"user@test.com",
			refresh,
			undefined,
			null,
			0,
			onInvalidated,
		);

		await expect(auth.getToken()).rejects.toThrow();
		expect(onInvalidated).toHaveBeenCalledTimes(1);
		expect(auth.getRefreshToken()).toBe("");
		expect(auth.isAuthenticated()).toBe(false);

		// Token cleared → a later getToken must fast-fail without replaying it,
		// and must not fire the callback again.
		refresh.mockClear();
		await expect(auth.getToken()).rejects.toThrow();
		expect(refresh).not.toHaveBeenCalled();
		expect(onInvalidated).toHaveBeenCalledTimes(1);
	});

	it("keeps the refresh token and does NOT fire onAuthInvalidated on a transient 5xx", async () => {
		const refresh = throwingRefresh(503);
		const onInvalidated = mock(() => {});
		const auth = new OAuthAuth(
			"engram_rt_live",
			"vault-1",
			"user@test.com",
			refresh,
			undefined,
			null,
			0,
			onInvalidated,
		);

		await expect(auth.getToken()).rejects.toThrow();
		expect(onInvalidated).not.toHaveBeenCalled();
		expect(auth.getRefreshToken()).toBe("engram_rt_live");
	});
});

describe("OAuthAuth.dispose — the token-chain fork fence (#420)", () => {
	// Prod incident 2026-08-12: a provider swap left the OLD OAuthAuth instance
	// alive and wired somewhere; both instances refreshed the same rotating
	// token chain, the server's reuse detection saw the fork and revoked the
	// whole family mid-first-sync. dispose() is the fence: a replaced provider
	// must never touch the network, the chain, or persisted tokens again.
	let mockRefreshFn: ReturnType<typeof mock>;
	beforeEach(() => {
		mockRefreshFn = mock();
	});

	it("getToken on a disposed provider rejects without calling refreshFn", async () => {
		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mockRefreshFn);
		auth.dispose();

		await expect(auth.getToken()).rejects.toThrow(/disposed/);
		expect(mockRefreshFn).not.toHaveBeenCalled();
	});

	it("a refresh resolving AFTER dispose serves waiters but adopts nothing — no state update, no persistence", async () => {
		let resolveRefresh!: (v: unknown) => void;
		mockRefreshFn.mockReturnValue(new Promise((r) => (resolveRefresh = r)));
		const rotated: unknown[] = [];
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn as any,
			(tokens) => void rotated.push(tokens),
		);

		const inflight = auth.getToken();
		auth.dispose();
		resolveRefresh({
			access_token: "jwt_late",
			refresh_token: "engram_rt_forked",
			expires_in: 3600,
		});

		// Callers already parked on the shared in-flight refresh get the access
		// token (valid server-side regardless of the swap) so a mid-flight sync
		// finishes cleanly instead of aborting with errors...
		await expect(inflight).resolves.toBe("jwt_late");
		// ...but the rotation is NOT adopted or persisted — that would clobber
		// the NEW provider's freshly-linked tokens on disk with a forked chain.
		expect(rotated).toHaveLength(0);
		expect(auth.getRefreshToken()).not.toBe("engram_rt_forked");
		// And brand-new callers on the disposed instance still reject.
		await expect(auth.getToken()).rejects.toThrow(/disposed/);
	});
	it("a definitive rejection after dispose does not fire onAuthInvalidated", async () => {
		const err = Object.assign(new Error("revoked"), { status: 401 });
		let rejectRefresh!: (e: unknown) => void;
		mockRefreshFn.mockReturnValue(new Promise((_r, rej) => (rejectRefresh = rej)));
		let invalidated = 0;
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			mockRefreshFn as any,
			undefined,
			null,
			0,
			() => void invalidated++,
		);

		const inflight = auth.getToken();
		auth.dispose();
		rejectRefresh(err);

		await expect(inflight).rejects.toThrow();
		// The DISPOSED provider's fate says nothing about the NEW chain — it
		// must not clear persisted auth or prompt a re-link.
		expect(invalidated).toBe(0);
	});
});

describe("OAuthAuth.settle — drain an in-flight rotation before retiring (#420)", () => {
	it("resolves immediately when no refresh is in flight", async () => {
		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", mock());
		await auth.settle();
	});

	it("waits for the in-flight refresh so its rotation persists, then dispose discards nothing", async () => {
		let resolveRefresh!: (v: unknown) => void;
		const refreshFn = mock(() => new Promise((r) => (resolveRefresh = r)));
		const rotated: string[] = [];
		const auth = new OAuthAuth(
			"engram_rt_old",
			"vault-1",
			"user@test.com",
			refreshFn as never,
			(tokens) => void rotated.push(tokens.refreshToken),
		);

		const inflight = auth.getToken();
		const settled = auth.settle();
		resolveRefresh({
			access_token: "jwt_1",
			refresh_token: "engram_rt_new",
			expires_in: 3600,
		});
		await settled;

		// The rotation completed and persisted BEFORE settle resolved — the
		// caller may now stash/capture settings knowing they hold the live token.
		expect(rotated).toEqual(["engram_rt_new"]);
		expect(await inflight).toBe("jwt_1");
		auth.dispose();
		expect(auth.getRefreshToken()).toBe("engram_rt_new");
	});

	it("swallows a failing in-flight refresh", async () => {
		let rejectRefresh!: (e: unknown) => void;
		const refreshFn = mock(() => new Promise((_r, rej) => (rejectRefresh = rej)));
		const auth = new OAuthAuth("engram_rt_old", "vault-1", "user@test.com", refreshFn as never);

		const inflight = auth.getToken().catch(() => "swallowed");
		const settled = auth.settle();
		rejectRefresh(new Error("network down"));
		await settled;
		expect(await inflight).toBe("swallowed");
	});
});
