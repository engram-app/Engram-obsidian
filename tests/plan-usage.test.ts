import { describe, expect, it } from "bun:test";
import { type BillingUsage, buildRow, isUnlimited, planUsageRows } from "../src/plan-usage";

describe("isUnlimited", () => {
	it("treats null and the negative sentinel as unlimited", () => {
		// Negative is the backend's "unlimited" marker, never a literal limit.
		// Reading it as one would claim a paid user is over cap on every row.
		expect(isUnlimited(null)).toBe(true);
		expect(isUnlimited(-1)).toBe(true);
		expect(isUnlimited(0)).toBe(false);
		expect(isUnlimited(2000)).toBe(false);
	});
});

describe("buildRow", () => {
	it("shows used over limit with a fraction", () => {
		const row = buildRow("Notes stored", { used: 300, limit: 2000 }, (n) => String(n));
		expect(row?.value).toBe("300 / 2000");
		expect(row?.fraction).toBeCloseTo(0.15);
		expect(row?.atLimit).toBe(false);
	});

	it("flags at-limit when used reaches the cap", () => {
		expect(buildRow("x", { used: 2000, limit: 2000 }, String)?.atLimit).toBe(true);
		expect(buildRow("x", { used: 2600, limit: 2000 }, String)?.atLimit).toBe(true);
	});

	it("clamps the fraction so an over-cap row cannot overfill its meter", () => {
		expect(buildRow("x", { used: 9000, limit: 2000 }, String)?.fraction).toBe(1);
	});

	it("shows a bare count on an unlimited plan, with no meter", () => {
		// Not "1240 / unlimited": a paid user has no limit to read against, and
		// the word only draws the eye to a constraint that does not exist.
		const row = buildRow("Notes stored", { used: 1240, limit: null }, String);
		expect(row?.value).toBe("1240");
		expect(row?.fraction).toBeNull();
		expect(row?.atLimit).toBe(false);
	});

	it("drops the row entirely when both usage and limit are unknown", () => {
		// "unlimited / unknown" is noise, not information.
		expect(buildRow("x", { used: null, limit: null }, String)).toBeNull();
	});

	it("shows the cap alone when usage is unknowable", () => {
		// `ai_searches.used` is null by design: the counter is a token bucket
		// with no read-without-spend API, so reading it would consume budget.
		// Bare, not "20 max": the label carries the unit, and "max" beside four
		// "used / limit" rows reads as a different kind of number than it is.
		const row = buildRow("AI searches / day", { used: null, limit: 20 }, String);
		expect(row?.value).toBe("20");
		expect(row?.fraction).toBeNull();
	});

	it("returns null for a key the backend did not send", () => {
		expect(buildRow("x", undefined, String)).toBeNull();
	});

	it("does not divide by zero on a zero cap", () => {
		expect(buildRow("x", { used: 0, limit: 0 }, String)?.fraction).toBe(1);
	});
});

describe("planUsageRows", () => {
	const free: BillingUsage = {
		tier: "free",
		usage: {
			notes: { used: 300, limit: 10000 },
			vaults: { used: 1, limit: 1 },
			attachment_bytes: { used: 13_002_342, limit: 1_073_741_824 },
			indexed_notes: { used: 300, limit: 2000 },
			ai_searches: { used: null, limit: 20 },
		},
	};

	// Prod: every stored note is searchable and `indexed_notes` is a compat
	// shim (`limit: nil`). The row it fed claimed a search cap that no longer
	// exists, and its hint said the index keeps your OLDEST notes, while the
	// backend actually keeps the most recently edited ones on full search.
	it("shows no searchable-notes row, even if a backend still sends a cap", () => {
		const labels = planUsageRows(free).map((r) => r.label);
		expect(labels).not.toContain("Notes searchable");
		expect(labels[0]).toBe("Notes stored");
	});

	it("shows a healthy Free vault rather than nothing", () => {
		const row = planUsageRows(free)[0];
		expect(row?.value).toBe("300 / 10,000");
		expect(row?.atLimit).toBe(false);
	});

	it("formats attachment bytes, not raw numbers", () => {
		const row = planUsageRows(free).find((r) => r.label === "Attachments");
		expect(row?.value).toBe("12.4 MB / 1.00 GB");
	});

	it("folds the local file count into the attachments row", () => {
		// Two rows before: a device file COUNT and an account BYTE quota. Not
		// comparable, so neither could be dropped the way the duplicate note
		// count was, but they answer one question and read better as one line.
		const row = planUsageRows(free, { localAttachmentCount: 24 }).find(
			(r) => r.label === "Attachments",
		);
		expect(row?.value).toBe("24 files · 12.4 MB / 1.00 GB");
	});

	it("says 'file', not 'files', for exactly one", () => {
		const row = planUsageRows(free, { localAttachmentCount: 1 }).find(
			(r) => r.label === "Attachments",
		);
		expect(row?.value).toBe("1 file · 12.4 MB / 1.00 GB");
	});

	it("still counts zero files rather than dropping the prefix", () => {
		// An empty vault should read "0 files", not silently lose the count —
		// `0` is falsy and an `if (count)` guard would have swallowed it.
		const row = planUsageRows(free, { localAttachmentCount: 0 }).find(
			(r) => r.label === "Attachments",
		);
		expect(row?.value).toBe("0 files · 12.4 MB / 1.00 GB");
	});

	it("keeps the count on an unlimited attachment quota", () => {
		const row = planUsageRows(
			{ tier: "pro", usage: { attachment_bytes: { used: 5_000_000, limit: null } } },
			{ localAttachmentCount: 3 },
		).find((r) => r.label === "Attachments");
		expect(row?.value).toBe("3 files · 4.8 MB");
	});

	it("puts the unit on the AI-search ceiling, not in its label", () => {
		// The one row with a cap and no usage beside it. Under a label ending in
		// "/ day", a bare "20" read as "you have run 20 today" — the inverse of
		// what it means. The unit belongs where the reader is already looking.
		const row = planUsageRows(free).find((r) => r.label === "AI searches");
		expect(row?.value).toBe("20 per day");
		expect(planUsageRows(free).map((r) => r.label)).not.toContain("AI searches / day");
	});

	it("skips rows the backend omitted instead of rendering blanks", () => {
		const rows = planUsageRows({ tier: "free", usage: { notes: { used: 5, limit: 100 } } });
		expect(rows.map((r) => r.label)).toEqual(["Notes stored"]);
	});
});
