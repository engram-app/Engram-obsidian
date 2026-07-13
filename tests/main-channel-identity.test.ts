/**
 * Tests: channelIdentityMatches (main.ts) — the connectChannel() identity guard.
 *
 * Root cause (e2e-clerk test_84_create_race, the residual #229/#996 "unauthorized"
 * flavor): connectChannel() freezes the NoteChannel's topic userId from
 * this.api.getMe()'s id at construction, while the socket later authenticates
 * with this.authProvider's token. On an OAuth rebind — one Obsidian instance
 * moved A -> B -> BACK to A — getMe() can resolve against the STALE provider,
 * so the channel is minted with user B's id (crdt:<B>:<vaultA>) while the socket
 * authenticates as A. The backend guard (crdt_channel.ex: topic userId must
 * equal the authenticated user) then rejects the join "unauthorized" and live
 * sync stays silently dead until reload.
 *
 * The email-based channelConnectionKey cannot catch a rebind BACK to a prior
 * identity: A's key is identical before and after the B detour, so
 * shouldReuseLiveStream can't tell the topic userId went stale. The fix guards
 * at connect time: refuse to build a channel whose authenticated identity
 * (getMe email) disagrees with the identity we intend to connect as
 * (settings.userEmail); retry until the provider catches up.
 */
import { describe, expect, test } from "bun:test";
import { channelIdentityMatches } from "../src/main";

describe("channelIdentityMatches", () => {
	test("rejects a stale-provider getMe identity (the test_84 unauthorized bug)", () => {
		// Intending to connect as A, but getMe() resolved against B's stale
		// provider. Building the channel here would freeze B's id into the topic.
		expect(channelIdentityMatches("a@example.com", "b@example.com")).toBe(false);
	});

	test("accepts a legitimate rebind BACK to a prior identity", () => {
		// After A -> B -> A, the provider has caught up and getMe() returns A.
		// This must NOT be blocked, or the rebind-back could never reconnect.
		expect(channelIdentityMatches("a@example.com", "a@example.com")).toBe(true);
	});

	test("is case-insensitive so a benign casing diff never loops the rebuild", () => {
		expect(channelIdentityMatches("A@Example.com", "a@example.com")).toBe(true);
	});

	test("accepts when no expected email is known (api-key auth is single-identity)", () => {
		expect(channelIdentityMatches(undefined, "anyone@example.com")).toBe(true);
		expect(channelIdentityMatches("", "anyone@example.com")).toBe(true);
	});

	test("accepts when getMe returned no email (cannot verify, no worse than before)", () => {
		expect(channelIdentityMatches("a@example.com", undefined)).toBe(true);
		expect(channelIdentityMatches("a@example.com", "")).toBe(true);
	});
});
