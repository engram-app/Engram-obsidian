import { beforeEach, describe, expect, test } from "bun:test";
import type { Mock } from "bun:test";
import { requestUrl } from "obsidian";
import { WAITLIST_ENDPOINT, submitWaitlistEmail } from "../src/waitlist";

// requestUrl is mocked via tests/preload.ts — it is already a mock() instance
const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

describe("submitWaitlistEmail", () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	test("POSTs the email + plugin source to the marketing endpoint", async () => {
		mockRequestUrl.mockResolvedValue({ status: 200, json: { ok: true } });
		await submitWaitlistEmail("a@b.com");
		expect(mockRequestUrl).toHaveBeenCalledWith({
			url: WAITLIST_ENDPOINT,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "a@b.com", source: "obsidian-plugin" }),
			throw: false,
		});
	});

	test("throws on a non-2xx response", async () => {
		mockRequestUrl.mockResolvedValue({ status: 400, json: { ok: false } });
		await expect(submitWaitlistEmail("a@b.com")).rejects.toThrow();
	});
});
