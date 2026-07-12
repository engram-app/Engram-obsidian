import { beforeEach, describe, expect, test } from "bun:test";
import {
	IssueStore,
	RETRY_CAP,
	categorizeError,
	healthCheckDelay,
	issueDisposition,
	limitReasonToCategory,
	parseStatusToIssue,
	remediation,
	shouldGoOffline,
	shouldRetryAfterFailure,
} from "../src/issue-store";
import { LimitExceededError } from "../src/limit-error";
import type { SyncIssue, SyncIssueCategory } from "../src/types";

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

	test("402 attachment_must_be_text → needs_pro, terminal", () => {
		const err = new LimitExceededError(
			"attachment_must_be_text",
			"https://u",
			"attachments_text_only",
			true,
			null,
		);
		const c = categorizeError(err);
		expect(c.category).toBe("needs_pro");
		expect(c.terminal).toBe(true);
		expect(c.status).toBe(402);
		expect(c.upgradeUrl).toBe("https://u");
	});

	test("402 attachments_disabled → needs_pro, terminal", () => {
		expect(
			categorizeError(
				new LimitExceededError(
					"attachments_disabled",
					null,
					"attachments_enabled",
					false,
					null,
				),
			).category,
		).toBe("needs_pro");
	});

	test("402 attachments_quota_exceeded → quota, terminal", () => {
		const c = categorizeError(
			new LimitExceededError(
				"attachments_quota_exceeded",
				"https://u",
				"attachment_bytes_cap",
				1024,
				1024,
			),
		);
		expect(c.category).toBe("quota");
		expect(c.terminal).toBe(true);
	});

	test("402 file_too_large → too_large, terminal", () => {
		expect(
			categorizeError(
				new LimitExceededError("file_too_large", null, "max_file_bytes", 5000000, null),
			).category,
		).toBe("too_large");
	});

	test("402 notes_cap_exceeded → other, not the attachment needs_pro surface", () => {
		const c = categorizeError(
			new LimitExceededError("notes_cap_exceeded", "https://u", "notes_cap", 10000, 10000),
		);
		expect(c.category).toBe("other");
		expect(c.category).not.toBe("needs_pro");
		expect(c.terminal).toBe(true);
	});

	test("402 unknown reason → needs_pro (informational, not network)", () => {
		const c = categorizeError(
			new LimitExceededError("some_new_reason", "https://u", null, null, null),
		);
		expect(c.terminal).toBe(true);
		expect(c.category).not.toBe("network");
	});

	test("limitReasonToCategory maps backend reasons to categories", () => {
		expect(limitReasonToCategory("attachment_must_be_text")).toBe("needs_pro");
		expect(limitReasonToCategory("attachments_disabled")).toBe("needs_pro");
		expect(limitReasonToCategory("attachments_quota_exceeded")).toBe("quota");
		expect(limitReasonToCategory("file_too_large")).toBe("too_large");
		expect(limitReasonToCategory("anything_else")).toBe("needs_pro");
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

describe("issueDisposition", () => {
	test("needs_pro and quota are informational", () => {
		expect(issueDisposition("needs_pro")).toBe("informational");
		expect(issueDisposition("quota")).toBe("informational");
	});

	test("too_large/auth/conflict are actionable", () => {
		expect(issueDisposition("too_large")).toBe("actionable");
		expect(issueDisposition("auth")).toBe("actionable");
		expect(issueDisposition("conflict")).toBe("actionable");
	});

	test("server/network/other are transient", () => {
		expect(issueDisposition("server")).toBe("transient");
		expect(issueDisposition("network")).toBe("transient");
		expect(issueDisposition("other")).toBe("transient");
	});

	test("a 402 limit error does not flap the plugin offline", () => {
		expect(
			shouldGoOffline(
				new LimitExceededError("attachment_must_be_text", null, null, true, null),
			),
		).toBe(false);
	});
});

describe("remediation", () => {
	test("every category has a non-empty title and hint", () => {
		const cats: SyncIssueCategory[] = [
			"too_large",
			"needs_pro",
			"quota",
			"auth",
			"conflict",
			"server",
			"network",
			"other",
		];
		for (const c of cats) {
			const r = remediation(c);
			expect(r.title.length).toBeGreaterThan(0);
			expect(r.hint.length).toBeGreaterThan(0);
		}
	});

	test("needs_pro points at upgrading; too_large explains the size limit", () => {
		expect(remediation("needs_pro").hint.toLowerCase()).toContain("upgrade");
		expect(remediation("too_large").hint).toContain("5 MB");
	});

	test("quota has its own remediation copy", () => {
		expect(remediation("quota").title.length).toBeGreaterThan(0);
		expect(remediation("quota").title).not.toBe(remediation("other").title);
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

describe("frontmatter parse issues", () => {
	test("frontmatter category is actionable", () => {
		expect(issueDisposition("frontmatter")).toBe("actionable");
	});

	test("remediation copy exists for frontmatter (no em dash)", () => {
		const { title, hint } = remediation("frontmatter");
		expect(title.length).toBeGreaterThan(0);
		expect(hint.length).toBeGreaterThan(0);
		expect(`${title} ${hint}`).not.toContain("—");
	});

	test("parseStatusToIssue returns null when ok", () => {
		expect(parseStatusToIssue("ok", null)).toBeNull();
		expect(parseStatusToIssue(undefined, undefined)).toBeNull();
	});

	test("maps frontmatter_invalid_yaml to frontmatter category with reason", () => {
		const reason = {
			code: "frontmatter_invalid_yaml",
			message: "Frontmatter isn't valid YAML",
			detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
		};
		const got = parseStatusToIssue("degraded", reason);
		expect(got).not.toBeNull();
		expect(got?.category).toBe("frontmatter");
		expect(got?.message).toBe("Frontmatter isn't valid YAML");
		expect(got?.parseReason).toEqual(reason);
	});

	test("maps frontmatter_unparseable_key to frontmatter category", () => {
		const reason = {
			code: "frontmatter_unparseable_key",
			message: "A frontmatter value could not be parsed",
			detail: { key: "tags", line: 3, snippet: "tags: [unclosed" },
		};
		expect(parseStatusToIssue("degraded", reason)?.category).toBe("frontmatter");
	});

	test("maps note_processing_failed to other category (generic failure)", () => {
		const reason = {
			code: "note_processing_failed",
			message: "Processing failed",
			detail: null,
		};
		expect(parseStatusToIssue("degraded", reason)?.category).toBe("other");
	});

	test("note_processing_failed remediation is accurate and does not claim auto-retry", () => {
		const reason = {
			code: "note_processing_failed" as const,
			message: "Processing failed",
			detail: null,
		};
		const { title, hint } = remediation("other", reason);
		expect(title.length).toBeGreaterThan(0);
		expect(hint.length).toBeGreaterThan(0);
		expect(`${title} ${hint}`).not.toContain("—");
		// A per-entry server-side failure will not self-heal on identical re-push,
		// so the generic transient "retrying automatically" copy is misleading.
		expect(hint.toLowerCase()).not.toContain("retrying");
		expect(hint).not.toBe(remediation("other").hint);
	});

	test("degraded with null reason still yields a frontmatter issue", () => {
		const got = parseStatusToIssue("degraded", null);
		expect(got?.category).toBe("frontmatter");
		expect(got?.message.length).toBeGreaterThan(0);
	});
});
