/**
 * Tests: shouldNoticeJoinRejection (main.ts) — the plan-reason toast latch.
 *
 * Regression guard for the fix in #535. Cycling the socket on
 * `onboarding_required` (so the join-failure backoff can retry it) turned a
 * once-per-session toast into a permanent one: `onCrdtJoinError` fires on
 * EVERY join rejection, `notifyLimitExceeded` has no latch of its own, and the
 * backoff retries forever. A user who installs the plugin and never finishes
 * onboarding would get a 10-second Notice at ~0s, 2.5s, 7.5s, 17s, 36s, 75s,
 * and then one a minute until they quit Obsidian.
 *
 * `unauthorized` was safe to cycle precisely because it is NOT a plan reason
 * and never toasted. The same escape does not exist here, so the latch does.
 */
import { describe, expect, test } from "bun:test";
import { shouldNoticeJoinRejection } from "../src/main";

describe("shouldNoticeJoinRejection", () => {
	test("tells the user once, then stays quiet while the backoff retries", () => {
		const shown = new Set<string>();
		expect(shouldNoticeJoinRejection("onboarding_required", shown)).toBe(true);
		shown.add("onboarding_required");
		// Every subsequent retry of the same rejection must be silent.
		for (let i = 0; i < 20; i++) {
			expect(shouldNoticeJoinRejection("onboarding_required", shown)).toBe(false);
		}
	});

	// A reason we never retry never spammed, so latching it only creates a new
	// failure: one 10-second Notice that Obsidian auto-dismisses, silence on
	// every reconnect after it, and no way back — the latch clears only on a
	// SUCCESSFUL join, which a suspended account cannot achieve.
	test("a plan reason we do NOT retry is never latched", () => {
		const shown = new Set<string>(["account_suspended", "account_deleted"]);
		expect(shouldNoticeJoinRejection("account_suspended", shown)).toBe(true);
		expect(shouldNoticeJoinRejection("account_deleted", shown)).toBe(true);
		expect(shouldNoticeJoinRejection("api_access_not_available", shown)).toBe(true);
	});

	test("the predicate does not record — the caller owns the latch", () => {
		// A `should…` that mutates is a trap: a second call site (a log line)
		// would consume the latch and swallow the real toast.
		const shown = new Set<string>();
		shouldNoticeJoinRejection("onboarding_required", shown);
		shouldNoticeJoinRejection("onboarding_required", shown);
		expect(shown.size).toBe(0);
	});

	test("a non-plan reason never toasts", () => {
		const shown = new Set<string>();
		expect(shouldNoticeJoinRejection("unauthorized", shown)).toBe(false);
		expect(shouldNoticeJoinRejection("rate_limited", shown)).toBe(false);
		// Retried, but deliberately toast-free: an operator rotation is not the
		// user's problem and clears on its own.
		expect(shouldNoticeJoinRejection("rotation_in_progress", shown)).toBe(false);
	});

	test("an absent reason is not a toast", () => {
		expect(shouldNoticeJoinRejection(undefined, new Set())).toBe(false);
	});

	test("clearing the latch re-arms the toast (a successful join did happen)", () => {
		const shown = new Set<string>();
		expect(shouldNoticeJoinRejection("onboarding_required", shown)).toBe(true);
		shown.add("onboarding_required");
		expect(shouldNoticeJoinRejection("onboarding_required", shown)).toBe(false);
		// onCrdtTopicJoined clears it: the situation genuinely changed, so a
		// LATER regression deserves to be surfaced again.
		shown.clear();
		expect(shouldNoticeJoinRejection("onboarding_required", shown)).toBe(true);
	});
});
