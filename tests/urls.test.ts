import { describe, expect, test } from "bun:test";
import { ENGRAM_APP_URL, ENGRAM_CLOUD_URL, engramWebUrl } from "../src/tabs/urls";

describe("engramWebUrl", () => {
	test("cloud apiUrl resolves to the managed SPA host", () => {
		expect(engramWebUrl(ENGRAM_CLOUD_URL)).toBe(ENGRAM_APP_URL);
	});

	test("self-hosted apiUrl serves its own SPA, so it maps to itself", () => {
		expect(engramWebUrl("https://engram.example.com")).toBe("https://engram.example.com");
	});

	test("trailing slash on a self-hosted apiUrl is preserved as-is", () => {
		expect(engramWebUrl("https://my.host:4000")).toBe("https://my.host:4000");
	});
});

/**
 * `settings.apiUrl` is stored VERBATIM — applyApiUrlChange (auth-state.ts:217)
 * writes whatever the user typed, and isSaveableUrl accepts a trailing slash
 * and a path. EngramApi.normalizeBaseUrl compensates at request time by
 * stripping trailing slashes and appending "/api" (and has an explicit branch
 * for a value that already ends in "/api", so that paste is an expected input).
 *
 * engramWebUrl had no such compensation: an exact `===` against the cloud
 * constant, and the raw string back otherwise. Both consumers build paths on
 * the result, so both stored shapes produced a 404.
 */
describe("engramWebUrl — unnormalized stored values", () => {
	test("a trailing slash still resolves to the cloud SPA host", () => {
		// Missed the === by one character and handed back the API host, so the
		// user landed on api.engram.page//settings/... instead of the web app.
		expect(engramWebUrl(`${ENGRAM_CLOUD_URL}/`)).toBe(ENGRAM_APP_URL);
	});

	test("the cloud address pasted with its /api suffix still resolves", () => {
		expect(engramWebUrl(`${ENGRAM_CLOUD_URL}/api`)).toBe(ENGRAM_APP_URL);
	});

	// Phoenix serves the SPA shell from the root scope only, never under /api,
	// so "<host>/api/settings/account" is a guaranteed 404 — on a self-hoster
	// whose preflight showed a green "server reachable" for that exact address.
	test("a self-hosted address pasted with /api drops back to the web root", () => {
		expect(engramWebUrl("https://engram.example.test/api")).toBe("https://engram.example.test");
	});

	test("a self-hosted address with a trailing slash loses it", () => {
		expect(engramWebUrl("https://engram.example.test/")).toBe("https://engram.example.test");
	});
});
