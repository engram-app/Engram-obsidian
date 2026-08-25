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

	test("isPlanJoinReason accepts plan rejections, rejects transient ones", () => {
		expect(isPlanJoinReason("api_access_not_available")).toBe(true);
		expect(isPlanJoinReason("no_tier")).toBe(true);
		expect(isPlanJoinReason("account_suspended")).toBe(true);
		// A backend wobble degrades to legacy and must stay log-only.
		expect(isPlanJoinReason("server_error")).toBe(false);
		expect(isPlanJoinReason("min_version")).toBe(false);
	});

	test("realtime_disabled is gone — no tier gates real-time sync", () => {
		expect(toastFor("realtime_disabled")).toBe(toastFor("some_unmapped_reason"));
	});
});
