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
		const row = buildRow("Notes searchable", { used: 300, limit: 2000 }, (n) => String(n));
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

	it("drops a hideWhenUnlimited row on an unlimited plan", () => {
		const opts = { hideWhenUnlimited: true };
		expect(buildRow("Notes searchable", { used: 1240, limit: null }, String, opts)).toBeNull();
		expect(buildRow("Notes searchable", { used: 1240, limit: -1 }, String, opts)).toBeNull();
		// Still shown when there IS a cap to report.
		expect(buildRow("Notes searchable", { used: 300, limit: 2000 }, String, opts)?.value).toBe(
			"300 / 2000",
		);
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

	it("leads with searchable notes, the limit that binds first and silently", () => {
		expect(planUsageRows(free)[0]?.label).toBe("Notes searchable");
	});

	it("shows a healthy Free vault rather than nothing", () => {
		// The whole reason this panel exists: at 300/2,000 the old behaviour
		// showed no indication at all, so a user could not see where they stood
		// until something silently stopped working.
		const row = planUsageRows(free)[0];
		expect(row?.value).toBe("300 / 2,000");
		expect(row?.atLimit).toBe(false);
	});

	it("formats attachment bytes, not raw numbers", () => {
		const row = planUsageRows(free).find((r) => r.label === "Attachments");
		expect(row?.value).toBe("12.4 MB / 1.00 GB");
	});

	it("pairs searchable with stored so the gap is legible", () => {
		const labels = planUsageRows(free).map((r) => r.label);
		expect(labels.slice(0, 2)).toEqual(["Notes searchable", "Notes stored"]);
	});

	it("explains that capped notes still sync, and which ones fall out", () => {
		const hint = planUsageRows(free)[0]?.hint ?? "";
		expect(hint).toContain("still sync");
		expect(hint).toContain("oldest");
	});

	it("hides searchable on paid, where it would just repeat stored", () => {
		const pro = {
			tier: "pro",
			usage: {
				notes: { used: 1240, limit: null },
				indexed_notes: { used: 1240, limit: null },
				attachment_bytes: { used: 5_000_000, limit: 53_687_091_200 },
			},
		};
		const labels = planUsageRows(pro).map((r) => r.label);
		expect(labels).not.toContain("Notes searchable");
		expect(labels).toContain("Notes stored");
	});

	it("keeps the note limit visible on Free, which is the point of the row", () => {
		const labels = planUsageRows(free).map((r) => r.label);
		expect(labels).toContain("Notes searchable");
		expect(planUsageRows(free).find((r) => r.label === "Notes stored")?.value).toBe(
			"300 / 10,000",
		);
	});

	it("skips rows the backend omitted instead of rendering blanks", () => {
		const rows = planUsageRows({ tier: "free", usage: { notes: { used: 5, limit: 100 } } });
		expect(rows.map((r) => r.label)).toEqual(["Notes stored"]);
	});
});
