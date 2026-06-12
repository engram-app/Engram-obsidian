/**
 * Tests for limit-toast.ts — central 402 → Notice handler.
 *
 * Uses the shared obsidian mock's __noticeCapture to assert message + button
 * wiring without rendering any real DOM.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LimitExceededError } from "../src/limit-error";
import { notifyLimitExceeded } from "../src/limit-toast";
import { __noticeCapture } from "./__mocks__/obsidian";

describe("notifyLimitExceeded", () => {
	beforeEach(() => {
		__noticeCapture.notices.length = 0;
	});

	test("renders a Notice with the reason-mapped toast copy", () => {
		const err = new LimitExceededError(
			"notes_cap_exceeded",
			"https://app.engram.page/settings/billing",
			"notes_cap",
			10000,
			10000,
		);
		notifyLimitExceeded(err);

		expect(__noticeCapture.notices).toHaveLength(1);
		const n = __noticeCapture.notices[0];
		expect(n.message).toMatch(/Engram:/);
		expect(n.message.toLowerCase()).toMatch(/note limit/);
		// Toast lingers long enough to read + click Upgrade.
		expect(n.duration).toBeGreaterThanOrEqual(5_000);
	});

	test("appends an Upgrade button when upgradeUrl is present", () => {
		const err = new LimitExceededError(
			"vaults_cap_exceeded",
			"https://app.engram.page/settings/billing",
			"vaults_cap",
			1,
			1,
		);
		notifyLimitExceeded(err);

		const n = __noticeCapture.notices[0];
		expect(n.buttons).toHaveLength(1);
		expect(n.buttons[0].text).toBe("Upgrade");
	});

	test("Upgrade button click opens upgradeUrl in a new tab", () => {
		const err = new LimitExceededError(
			"attachments_disabled",
			"https://app.engram.page/settings/billing",
			"attachments_enabled",
			false,
			null,
		);
		const opener = mock(() => null);
		const origOpen = window.open;
		(window as unknown as { open: typeof window.open }).open =
			opener as unknown as typeof window.open;

		notifyLimitExceeded(err);
		const n = __noticeCapture.notices[0];
		n.buttons[0].click();

		expect(opener).toHaveBeenCalledTimes(1);
		expect(opener.mock.calls[0][0]).toBe("https://app.engram.page/settings/billing");
		expect(opener.mock.calls[0][1]).toBe("_blank");

		(window as unknown as { open: typeof window.open }).open = origOpen;
	});

	test("skips the Upgrade button when upgradeUrl is null", () => {
		const err = new LimitExceededError("account_suspended", null, null, null, null);
		notifyLimitExceeded(err);

		const n = __noticeCapture.notices[0];
		expect(n.buttons).toHaveLength(0);
		expect(n.message.toLowerCase()).toMatch(/suspended|contact/);
	});

	test("falls back to the generic limit copy for an unknown reason", () => {
		const err = new LimitExceededError("totally_made_up_reason", null, null, null, null);
		notifyLimitExceeded(err);
		expect(__noticeCapture.notices[0].message).toMatch(/Engram:.*[Ll]imit/);
	});
});
