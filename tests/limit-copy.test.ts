/**
 * Tests for limit-copy.ts — toast-friendly one-liners for 402 limit reasons.
 */
import { describe, expect, test } from "bun:test";
import { toastFor } from "../src/limit-copy";

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
