import { describe, expect, test } from "bun:test";
import { LimitExceededError } from "../src/limit-error";

describe("LimitExceededError", () => {
	test("carries HTTP status 402", () => {
		const err = new LimitExceededError(
			"attachment_must_be_text",
			"https://u",
			"attachments_text_only",
			true,
			null,
		);
		expect(err.status).toBe(402);
	});
});
