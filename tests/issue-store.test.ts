import { beforeEach, describe, expect, test } from "bun:test";
import {
	IssueStore,
	RETRY_CAP,
	categorizeError,
	healthCheckDelay,
	shouldGoOffline,
	shouldRetryAfterFailure,
} from "../src/issue-store";
import { LimitExceededError } from "../src/limit-error";
import type { SyncIssue } from "../src/types";

function makeIssue(overrides: Partial<SyncIssue> = {}): SyncIssue {
	const now = Date.now();
	return {
		path: "notes/big.pdf",
		kind: "attachment",
		category: "too_large",
		status: 413,
		message: "Request failed, status 413",
		sizeBytes: 6_500_000,
		firstFailedAt: now,
		lastFailedAt: now,
		attempts: 1,
		...overrides,
	};
}

describe("IssueStore", () => {
	let store: IssueStore;

	beforeEach(() => {
		store = new IssueStore();
	});

	test("starts empty", () => {
		expect(store.all()).toEqual([]);
		expect(store.count()).toBe(0);
	});

	test("records new issue", () => {
		store.record(makeIssue({ path: "a.pdf" }));
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0].path).toBe("a.pdf");
	});

	test("dedupes by path — increments attempts and updates lastFailedAt", () => {
		const t0 = 1_000_000;
		store.record(
			makeIssue({ path: "a.pdf", firstFailedAt: t0, lastFailedAt: t0, attempts: 1 }),
		);
		store.record(
			makeIssue({
				path: "a.pdf",
				firstFailedAt: t0 + 5_000,
				lastFailedAt: t0 + 5_000,
				attempts: 1,
			}),
		);
		const issues = store.all();
		expect(issues).toHaveLength(1);
		expect(issues[0].attempts).toBe(2);
		expect(issues[0].firstFailedAt).toBe(t0); // preserved from first
		expect(issues[0].lastFailedAt).toBe(t0 + 5_000); // updated
	});

	test("clear(path) removes matching issue", () => {
		store.record(makeIssue({ path: "a.pdf" }));
		store.record(makeIssue({ path: "b.pdf" }));
		store.clear("a.pdf");
		expect(store.all()).toHaveLength(1);
		expect(store.all()[0].path).toBe("b.pdf");
	});

	test("clear(path) is a noop for unknown path", () => {
		store.record(makeIssue({ path: "a.pdf" }));
		store.clear("ghost.pdf");
		expect(store.all()).toHaveLength(1);
	});

	test("clearAll empties the store", () => {
		store.record(makeIssue({ path: "a.pdf" }));
		store.record(makeIssue({ path: "b.pdf" }));
		store.clearAll();
		expect(store.all()).toEqual([]);
	});

	test("count(category) filters", () => {
		store.record(makeIssue({ path: "a.pdf", category: "too_large" }));
		store.record(makeIssue({ path: "b.pdf", category: "too_large" }));
		store.record(makeIssue({ path: "c.md", category: "auth" }));
		expect(store.count()).toBe(3);
		expect(store.count("too_large")).toBe(2);
		expect(store.count("auth")).toBe(1);
		expect(store.count("network")).toBe(0);
	});

	test("byCategory groups issues", () => {
		store.record(makeIssue({ path: "a.pdf", category: "too_large" }));
		store.record(makeIssue({ path: "b.pdf", category: "too_large" }));
		store.record(makeIssue({ path: "c.md", category: "auth" }));
		const groups = store.byCategory();
		expect(groups.too_large?.length).toBe(2);
		expect(groups.auth?.length).toBe(1);
		expect(groups.network).toBeUndefined();
	});

	test("serialize+hydrate round-trip preserves issues", () => {
		store.record(makeIssue({ path: "a.pdf" }));
		store.record(makeIssue({ path: "c.md", category: "auth", status: 401 }));
		const json = store.serialize();
		const next = new IssueStore();
		next.hydrate(json);
		expect(next.all()).toHaveLength(2);
		expect(next.all().find((i) => i.path === "a.pdf")?.category).toBe("too_large");
		expect(next.all().find((i) => i.path === "c.md")?.status).toBe(401);
	});

	test("hydrate is tolerant of malformed input", () => {
		expect(() => store.hydrate(undefined)).not.toThrow();
		expect(() => store.hydrate(null)).not.toThrow();
		expect(() => store.hydrate("garbage")).not.toThrow();
		expect(() => store.hydrate({})).not.toThrow();
		expect(store.all()).toEqual([]);
	});

	test("all() returns a copy, not the internal array", () => {
		store.record(makeIssue());
		const a = store.all();
		const b = store.all();
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
	});
});

describe("categorizeError", () => {
	test("413 → too_large", () => {
		const err = Object.assign(new Error("Request failed, status 413"), { status: 413 });
		expect(categorizeError(err).category).toBe("too_large");
	});

	test("401/403 → auth", () => {
		expect(categorizeError(Object.assign(new Error("auth"), { status: 401 })).category).toBe(
			"auth",
		);
		expect(categorizeError(Object.assign(new Error("auth"), { status: 403 })).category).toBe(
			"auth",
		);
	});

	test("5xx → server", () => {
		expect(categorizeError(Object.assign(new Error("boom"), { status: 500 })).category).toBe(
			"server",
		);
		expect(categorizeError(Object.assign(new Error("boom"), { status: 503 })).category).toBe(
			"server",
		);
	});

	test("no status (network/DNS/timeout) → network", () => {
		expect(categorizeError(new Error("Failed to fetch")).category).toBe("network");
		expect(categorizeError(new TypeError("network")).category).toBe("network");
	});

	test("unknown 4xx → other", () => {
		expect(categorizeError(Object.assign(new Error("?"), { status: 418 })).category).toBe(
			"other",
		);
	});

	test("isTerminal — 413 and auth (401/403) are terminal; 5xx/network retry", () => {
		expect(categorizeError(Object.assign(new Error(), { status: 413 })).terminal).toBe(true);
		expect(categorizeError(Object.assign(new Error(), { status: 401 })).terminal).toBe(true);
		expect(categorizeError(Object.assign(new Error(), { status: 403 })).terminal).toBe(true);
		expect(categorizeError(Object.assign(new Error(), { status: 500 })).terminal).toBe(false);
		expect(categorizeError(new Error("network")).terminal).toBe(false);
	});

	test("status code is preserved on result", () => {
		const result = categorizeError(Object.assign(new Error("x"), { status: 413 }));
		expect(result.status).toBe(413);
	});

	test("LimitExceededError attachments_disabled → needs_pro + terminal", () => {
		const err = new LimitExceededError(
			"attachments_disabled",
			"https://app.engram.page/settings/billing",
			"attachments_enabled",
			false,
			null,
		);
		const result = categorizeError(err);
		expect(result.category).toBe("needs_pro");
		expect(result.terminal).toBe(true);
		expect(result.status).toBe(402);
	});

	test("LimitExceededError for other reasons does NOT map to needs_pro", () => {
		// notes_cap and vaults_cap have their own handling (toast + bail) and
		// should not pollute the Sync Center "Needs Pro" surface.
		const err = new LimitExceededError(
			"notes_cap_exceeded",
			"https://app.engram.page/settings/billing",
			"notes_cap",
			10000,
			10000,
		);
		const result = categorizeError(err);
		expect(result.category).not.toBe("needs_pro");
	});

	test("prefers the backend JSON error message over the bare HTTP message", () => {
		// Obsidian's requestUrl rejection carries the parsed body on `.json`.
		const err = Object.assign(new Error("Request failed, status 502"), {
			status: 502,
			json: { error: "failed to upload to storage backend" },
		});
		expect(categorizeError(err).message).toBe("failed to upload to storage backend");
	});

	test("falls back to parsing the body from `.text` when `.json` is absent", () => {
		const err = Object.assign(new Error("Request failed, status 502"), {
			status: 502,
			text: JSON.stringify({ error: "failed to upload to storage backend" }),
		});
		expect(categorizeError(err).message).toBe("failed to upload to storage backend");
	});

	test("falls back to the bare message when the body has no error field", () => {
		const err = Object.assign(new Error("Request failed, status 500"), {
			status: 500,
			json: { something_else: true },
		});
		expect(categorizeError(err).message).toBe("Request failed, status 500");
	});
});

describe("shouldGoOffline", () => {
	test("true only for true connection loss (no HTTP status)", () => {
		expect(shouldGoOffline(new Error("Failed to fetch"))).toBe(true);
		expect(shouldGoOffline(new TypeError("network"))).toBe(true);
	});

	test("false for any HTTP status error — a server/per-file failure is not a disconnect", () => {
		expect(shouldGoOffline(Object.assign(new Error(), { status: 502 }))).toBe(false);
		expect(shouldGoOffline(Object.assign(new Error(), { status: 500 }))).toBe(false);
		expect(shouldGoOffline(Object.assign(new Error(), { status: 413 }))).toBe(false);
		expect(shouldGoOffline(Object.assign(new Error(), { status: 404 }))).toBe(false);
	});
});

describe("shouldRetryAfterFailure", () => {
	test("retries non-terminal errors below the cap", () => {
		const server = categorizeError(Object.assign(new Error(), { status: 502 }));
		expect(shouldRetryAfterFailure(server, 1)).toBe(true);
		expect(shouldRetryAfterFailure(server, RETRY_CAP - 1)).toBe(true);
	});

	test("parks (stops retrying) once attempts reach the cap", () => {
		const server = categorizeError(Object.assign(new Error(), { status: 502 }));
		expect(shouldRetryAfterFailure(server, RETRY_CAP)).toBe(false);
		expect(shouldRetryAfterFailure(server, RETRY_CAP + 3)).toBe(false);
	});

	test("never retries terminal errors regardless of attempts", () => {
		const tooLarge = categorizeError(Object.assign(new Error(), { status: 413 }));
		expect(shouldRetryAfterFailure(tooLarge, 1)).toBe(false);
	});
});

describe("healthCheckDelay (exponential backoff)", () => {
	test("grows exponentially from the base and caps", () => {
		expect(healthCheckDelay(0)).toBe(5_000);
		expect(healthCheckDelay(1)).toBe(10_000);
		expect(healthCheckDelay(2)).toBe(20_000);
		expect(healthCheckDelay(10)).toBe(60_000); // capped
	});
});
