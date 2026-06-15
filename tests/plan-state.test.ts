import { describe, expect, test } from "bun:test";
import { attachmentCapabilityGained, parsePlanState, type PlanState } from "../src/plan-state";

const free: PlanState = { tier: "free", attachmentsTextOnly: true, maxFileBytes: 10_000_000, attachmentBytesCap: 1_000_000_000, updatedAt: 1 };
const pro: PlanState = { tier: "pro", attachmentsTextOnly: false, maxFileBytes: 500_000_000, attachmentBytesCap: null, updatedAt: 2 };

describe("attachmentCapabilityGained", () => {
  test("free → pro gains capability", () => { expect(attachmentCapabilityGained(free, pro)).toBe(true); });
  test("pro → free does not gain", () => { expect(attachmentCapabilityGained(pro, free)).toBe(false); });
  test("no prior state → gained iff now allows non-text", () => {
    expect(attachmentCapabilityGained(null, pro)).toBe(true);
    expect(attachmentCapabilityGained(null, free)).toBe(false);
  });
  test("same state → not gained", () => { expect(attachmentCapabilityGained(free, free)).toBe(false); });
});

describe("parsePlanState", () => {
  test("parses snake_case wire shape", () => {
    const p = parsePlanState({ tier: "pro", attachments_text_only: false, max_file_bytes: 500, attachment_bytes_cap: null }, 99);
    expect(p).not.toBeNull();
    expect(p?.tier).toBe("pro");
    expect(p?.attachmentsTextOnly).toBe(false);
    expect(p?.maxFileBytes).toBe(500);
    expect(p?.attachmentBytesCap).toBeNull();
    expect(p?.updatedAt).toBe(99);
  });
  test("returns null for missing/invalid shape", () => {
    expect(parsePlanState(null, 1)).toBeNull();
    expect(parsePlanState({}, 1)).toBeNull();
    expect(parsePlanState({ attachments_text_only: true }, 1)).toBeNull();
  });
  test("attachments_text_only is strict boolean (anything not true → false)", () => {
    expect(parsePlanState({ tier: "free", attachments_text_only: "yes" }, 1)?.attachmentsTextOnly).toBe(false);
  });
});
