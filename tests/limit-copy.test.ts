/**
 * Tests for limit-copy.ts — toast-friendly one-liners for 402 limit reasons.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isPlanJoinReason, toastFor } from "../src/limit-copy";
import { __setLanguage } from "./__mocks__/obsidian";

describe("limit-copy localization", () => {
	afterEach(() => __setLanguage("en"));

	// Regression: the table used to be a module-scope object literal whose values
	// were t() calls, so all 18 strings froze to whichever language was active
	// when this module was first imported. A language set afterwards was ignored,
	// and which language that was depended on test file import order.
	test("a known reason follows a language set after import", () => {
		__setLanguage("ja");
		const ja = toastFor("api_access_not_available");
		__setLanguage("en");
		const en = toastFor("api_access_not_available");
		expect(ja).not.toBe(en);
		expect(en).toMatch(/API key access is turned off/);
	});

	// The fallback is the branch every reason code the backend adds after this
	// build takes, so it must not stay English while known reasons translate.
	test("an unknown reason is translated too, not just the known ones", () => {
		__setLanguage("de");
		const unknown = toastFor("some_reason_this_build_never_heard_of");
		expect(unknown).toMatch(/^Engram: /);
		expect(unknown).not.toMatch(/Limit reached\. Upgrade to continue\./);
	});
});

describe("limit-copy", () => {
	test("maps notes_cap_exceeded", () => {
		const msg = toastFor("notes_cap_exceeded");
		expect(msg).toMatch(/Engram:/);
		expect(msg.toLowerCase()).toMatch(/note limit/);
	});

	// NEITHER of these is a tier gate any more. `attachments_enabled` and
	// `attachments_all_types` are both `true` on Free, Starter and Pro as of
	// 2026-08-24, so on SaaS these reasons cannot fire at all — they are
	// self-host capability gates. These assertions used to pin "paid plan"
	// wording, which sent a self-hoster to a pricing page for a setting on
	// their own server, and told a Free user their own attachments needed an
	// upgrade they already had.
	test("maps attachments_disabled without naming a tier", () => {
		const msg = toastFor("attachments_disabled").toLowerCase();
		expect(msg).toMatch(/attachment sync is disabled/);
		expect(msg).not.toMatch(/paid plan|upgrade/);
	});

	test("maps attachment_must_be_text as a capability, not a tier", () => {
		const msg = toastFor("attachment_must_be_text").toLowerCase();
		expect(msg).toMatch(/file type/);
		expect(msg).not.toMatch(/paid plan|notes only/);
	});

	// The one AI cap a user can actually hit. Three predecessors
	// (`ai_conversations_per_day`, `ai_queries_per_conversation`,
	// `ai_queries_per_day`) were deleted backend-side when `ai_searches_per_day`
	// consolidated six meters into one, leaving this reason with no copy and
	// falling through to the generic fallback.
	// No number: the plugin ships separately from the backend, so an installed
	// build cannot know the current cap. It told users 20 after the cap moved.
	test("maps ai_searches_per_day_exceeded without naming the cap", () => {
		const msg = toastFor("ai_searches_per_day_exceeded").toLowerCase();
		expect(msg).toMatch(/daily ai search limit/);
		expect(msg).not.toMatch(/\d/);
		expect(msg).toMatch(/upgrade/);
	});

	test("dead AI reasons are gone from the table", () => {
		for (const dead of [
			"ai_conversations_per_day_exceeded",
			"ai_queries_per_conversation_exceeded",
			"ai_queries_per_day_exceeded",
		]) {
			expect(toastFor(dead)).toMatch(/Limit reached\. Upgrade to continue\./);
		}
	});

	test("maps attachments_quota_exceeded (quota copy)", () => {
		expect(toastFor("attachments_quota_exceeded").toLowerCase()).toMatch(/storage is full/);
	});

	// Free allows 2 devices, so "another device" was wrong on every plan.
	test("concurrent_devices_exceeded names a limit, not a single other device", () => {
		const msg = toastFor("concurrent_devices_exceeded").toLowerCase();
		expect(msg).toMatch(/device limit reached/);
		expect(msg).not.toMatch(/another device|multi-device/);
	});

	test("falls back for unknown reason", () => {
		expect(toastFor("zzz_unknown")).toMatch(/Engram:.*[Ll]imit/);
	});
});

describe("API-key plan reasons", () => {
	// API keys work on every plan (backend #1974). ChannelGate and
	// RequireApiRpsBudget emit this ONLY when a per-user `api_rps_cap` override
	// is 0, a kill switch for one account. The old copy blamed the plan, which
	// told a Free user to upgrade for something Free already includes.
	test("api_access_not_available names no plan and points at sign-in", () => {
		const msg = toastFor("api_access_not_available").toLowerCase();
		expect(msg).toMatch(/api key access is turned off for this account/);
		expect(msg).toMatch(/sign in/);
		expect(msg).not.toMatch(/pro|upgrade|plan/);
	});

	// Both reasons were deleted backend-side with their gates (#1974):
	// `api_write_enabled` and the MCP connection cap no longer exist, so the
	// server never sends either. Copy for them was a claim about a gate that
	// is gone.
	test("removed API and MCP gate reasons are gone from the table", () => {
		for (const dead of ["api_write_not_available", "mcp_connections_exceeded"]) {
			expect(toastFor(dead)).toBe(toastFor("some_unmapped_reason"));
		}
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
