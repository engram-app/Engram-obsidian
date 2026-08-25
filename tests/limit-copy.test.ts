/**
 * Tests for limit-copy.ts — toast-friendly one-liners for 402 limit reasons.
 */
import { describe, expect, test } from "bun:test";
import { isPlanJoinReason, toastFor } from "../src/limit-copy";

describe("limit-copy", () => {
	test("maps notes_cap_exceeded", () => {
		const msg = toastFor("notes_cap_exceeded");
		expect(msg).toMatch(/Engram:/);
		expect(msg.toLowerCase()).toMatch(/note limit/);
	});

	test("maps attachments_disabled", () => {
		expect(toastFor("attachments_disabled").toLowerCase()).toMatch(/attachment.*paid plan/);
	});

	test("maps attachment_must_be_text (capability copy)", () => {
		expect(toastFor("attachment_must_be_text").toLowerCase()).toMatch(/notes only.*paid plan/);
	});

	test("maps attachments_quota_exceeded (quota copy)", () => {
		expect(toastFor("attachments_quota_exceeded").toLowerCase()).toMatch(/storage is full/);
	});

	test("falls back for unknown reason", () => {
		expect(toastFor("zzz_unknown")).toMatch(/Engram:.*[Ll]imit/);
	});
});

describe("API-key plan reasons", () => {
	// These two used to be unreachable: socket join rejections only logged,
	// and RequireApiWriteEnabled's 402 body has no `reason` key, so both fell
	// through to the generic "Limit reached" copy.
	test("api_access_not_available names the cause and the way out", () => {
		const msg = toastFor("api_access_not_available").toLowerCase();
		expect(msg).toMatch(/api keys? need pro/);
		expect(msg).toMatch(/sign in/);
	});

	test("api_write_not_available uses the same copy", () => {
		expect(toastFor("api_write_not_available")).toBe(toastFor("api_access_not_available"));
	});

	// The set must track what ChannelGate actually emits: account_deleted,
	// account_suspended, api_access_not_available, rotation_in_progress,
	// onboarding_required. Anything listed here that the server never sends is
	// a dead string; anything omitted degrades to legacy in silence.
	test("isPlanJoinReason covers every unrecoverable ChannelGate reason", () => {
		for (const r of [
			"api_access_not_available",
			"account_suspended",
			"account_deleted",
			"onboarding_required",
		]) {
			expect(isPlanJoinReason(r)).toBe(true);
			// Each must also have real copy, or the toast says "Limit reached".
			expect(toastFor(r)).not.toBe(toastFor("some_unmapped_reason"));
		}
	});

	test("transient and non-emitted reasons stay log-only", () => {
		// rotation_in_progress clears on its own; degrading to legacy is a real
		// recovery, so interrupting the user would be noise.
		expect(isPlanJoinReason("rotation_in_progress")).toBe(false);
		// no_tier is an HTTP 402 reason the socket never emits.
		expect(isPlanJoinReason("no_tier")).toBe(false);
		expect(isPlanJoinReason("server_error")).toBe(false);
	});

	test("realtime_disabled is gone — no tier gates real-time sync", () => {
		expect(toastFor("realtime_disabled")).toBe(toastFor("some_unmapped_reason"));
	});
});
