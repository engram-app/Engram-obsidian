// tests/report-issue-state.test.ts
import { describe, expect, it, jest } from "bun:test";
import { ReportIssueState } from "../src/report-issue-modal";

describe("ReportIssueState", () => {
	it("cannot submit an empty description", () => {
		const s = new ReportIssueState();
		expect(s.canSubmit()).toBe(false);
		s.setDescription("   ");
		expect(s.canSubmit()).toBe(false);
	});

	it("submit() calls the sender with the trimmed description and lands on success", async () => {
		const s = new ReportIssueState();
		s.setDescription("  sync is broken  ");
		const send = jest.fn().mockResolvedValue(undefined);
		await s.submit(send);
		expect(send).toHaveBeenCalledWith("sync is broken");
		expect(s.view).toBe("success");
	});

	it("submit() lands on error when the sender throws", async () => {
		const s = new ReportIssueState();
		s.setDescription("x");
		const send = jest.fn().mockRejectedValue(new Error("network"));
		await s.submit(send);
		expect(s.view).toBe("error");
		expect(s.errorText.length).toBeGreaterThan(0);
	});
});
