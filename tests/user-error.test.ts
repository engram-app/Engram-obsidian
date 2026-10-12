import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { RequestTimeoutError } from "../src/api";
import { NotAuthenticatedError } from "../src/error-util";
import { parseReasonMessage, userErrorMessage } from "../src/i18n/user-error";
import { LimitExceededError } from "../src/limit-error";
import { __setLanguage } from "./__mocks__/obsidian";

afterAll(() => __setLanguage("en"));

describe("userErrorMessage never shows the raw English message", () => {
	beforeEach(() => __setLanguage("en"));

	const secret = "ENOENT: /home/t/vault/Medical/biopsy.md failed upstream";

	test("a plain Error gets the translated generic fallback", () => {
		const out = userErrorMessage(new Error(secret));
		expect(out).toBe("Unknown error");
	});

	test("non-Error values get the fallback too", () => {
		expect(userErrorMessage(secret)).toBe("Unknown error");
		expect(userErrorMessage(undefined)).toBe("Unknown error");
		expect(userErrorMessage(null)).toBe("Unknown error");
	});

	test("classifies by HTTP status, not by message", () => {
		const http = (status: number) => Object.assign(new Error(secret), { status });
		expect(userErrorMessage(http(401))).toContain("Sign in again");
		expect(userErrorMessage(http(403))).toContain("Sign in again");
		expect(userErrorMessage(http(429))).toContain("Too many requests");
		expect(userErrorMessage(http(413))).toContain("too large");
		expect(userErrorMessage(http(503))).toBe("Server error (503) — check Engram logs");
		expect(userErrorMessage(http(404))).toBe("Request failed (404)");
		for (const s of [401, 413, 429, 503, 404])
			expect(userErrorMessage(http(s))).not.toContain(secret);
	});

	test("classifies by error class", () => {
		expect(userErrorMessage(new NotAuthenticatedError("no token"))).toContain("Sign in again");
		expect(userErrorMessage(new RequestTimeoutError(15_000))).toContain("too long");
		const limit = new LimitExceededError("attachments_disabled", null, null, null, null);
		expect(userErrorMessage(limit)).toStartWith("Engram: ");
	});

	test("a network failure reads as a connection problem", () => {
		expect(userErrorMessage(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(
			"Could not reach Engram — check connection",
		);
		expect(userErrorMessage(new TypeError("Failed to fetch"))).toBe(
			"Could not reach Engram — check connection",
		);
	});

	test("the result is translated", () => {
		__setLanguage("ru");
		expect(userErrorMessage(new Error(secret))).toBe("Неизвестная ошибка");
	});
});

describe("parseReasonMessage maps the backend code, not its English message", () => {
	beforeEach(() => __setLanguage("en"));
	const english = "backend english text";

	test("each code has its own sentence", () => {
		const out = new Set(
			(
				[
					"frontmatter_invalid_yaml",
					"frontmatter_unparseable_key",
					"note_processing_failed",
				] as const
			).map((code) => parseReasonMessage({ code, message: english, detail: null })),
		);
		expect(out.size).toBe(3);
		for (const msg of out) expect(msg).not.toContain(english);
	});

	test("names the offending key when the backend reports one", () => {
		const msg = parseReasonMessage({
			code: "frontmatter_unparseable_key",
			message: english,
			detail: { key: "tags", line: 3, snippet: "tags: [" },
		});
		expect(msg).toContain('"tags"');
	});

	test("an unknown future code falls back to the generic frontmatter sentence", () => {
		const reason = { code: "something_new", message: english, detail: null } as never;
		expect(parseReasonMessage(reason)).toBe("Frontmatter could not be parsed");
	});
});
