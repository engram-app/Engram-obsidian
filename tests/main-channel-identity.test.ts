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
import { topicUserIdIsStale } from "../src/channel";
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

/**
 * Tests: topicUserIdIsStale (channel.ts), the RECONNECT-path identity guard.
 *
 * Second half of the test_84 unauthorized bug. The build-time channelIdentityMatches
 * guard only covers freshly BUILT channels. On a rebind BACK to a prior identity A
 * (A -> B -> A) the email-based channelConnectionKey coincides, so
 * shouldReuseLiveStream KEEPS the live NoteChannel instead of rebuilding it. The
 * plugin then swaps the auth provider onto that kept channel (setAuthProvider) but
 * never re-derives its frozen `this.userId`, so the next socket reconnect rejoins
 * `crdt:<staleUserId>:<vaultId>` while the socket authenticates as the current user,
 * and the backend rejects it "unauthorized". Before rejoining after a provider swap
 * the channel re-derives its userId from getMe(); topicUserIdIsStale decides when a
 * refresh is required. Ids are case-sensitive UUIDs (unlike emails), so no casing
 * fold here.
 */
describe("topicUserIdIsStale", () => {
	test("stale when the channel's frozen id disagrees with the authenticated id", () => {
		// Rebind-back reused a channel minted as user B; getMe() now authenticates
		// as A. Rejoining crdt:<B> would be refused unauthorized, so must refresh.
		expect(topicUserIdIsStale("user-b", "user-a")).toBe(true);
	});

	test("not stale when the ids agree (the healthy reconnect, no needless refresh)", () => {
		expect(topicUserIdIsStale("user-a", "user-a")).toBe(false);
	});

	test("case-sensitive: UUID ids are not folded", () => {
		expect(topicUserIdIsStale("USER-A", "user-a")).toBe(true);
	});

	test("not stale when getMe returned no id (cannot verify, no worse than before)", () => {
		expect(topicUserIdIsStale("user-a", undefined)).toBe(false);
		expect(topicUserIdIsStale("user-a", "")).toBe(false);
	});
});
