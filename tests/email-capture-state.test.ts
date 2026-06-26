import { describe, expect, it, jest } from "bun:test";
import { EmailCaptureState, isLikelyEmail } from "../src/email-capture-modal";

describe("isLikelyEmail", () => {
	it.each(["a@b.com", "x.y+z@sub.domain.io"])("accepts %s", (e) =>
		expect(isLikelyEmail(e)).toBe(true),
	);
	it.each(["", "nope", "a@b", "a @b.com"])("rejects %s", (e) =>
		expect(isLikelyEmail(e)).toBe(false),
	);
});

describe("EmailCaptureState", () => {
	it("cannot submit an invalid email", () => {
		const s = new EmailCaptureState();
		s.setEmail("nope");
		expect(s.canSubmit()).toBe(false);
	});

	it("submit() calls the sender and lands on success", async () => {
		const s = new EmailCaptureState();
		s.setEmail("a@b.com");
		const send = jest.fn().mockResolvedValue(undefined);
		await s.submit(send);
		expect(send).toHaveBeenCalledWith("a@b.com");
		expect(s.view).toBe("success");
	});

	it("submit() failure surfaces an error and returns to form-with-error", async () => {
		const s = new EmailCaptureState();
		s.setEmail("a@b.com");
		await s.submit(jest.fn().mockRejectedValue(new Error("boom")));
		expect(s.view).toBe("error");
		expect(s.errorText).toMatch(/try again/i);
	});
});
