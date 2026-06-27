import { describe, expect, it } from "bun:test";
import { shouldShowWaitlistPrompt } from "../src/waitlist";

describe("shouldShowWaitlistPrompt", () => {
	it("shows when the flag is falsy", () => {
		expect(shouldShowWaitlistPrompt({ waitlistPromptSeen: false })).toBe(true);
		expect(shouldShowWaitlistPrompt({})).toBe(true);
	});
	it("does not show once seen", () => {
		expect(shouldShowWaitlistPrompt({ waitlistPromptSeen: true })).toBe(false);
	});
});
