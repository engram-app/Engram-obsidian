import { newTraceContext, parseTraceparent } from "../src/observability/traceGen";

describe("traceGen", () => {
	test("newTraceContext returns a well-formed sampled traceparent", () => {
		const { traceparent, traceId, spanId } = newTraceContext();
		expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
		expect(traceparent).toBe(`00-${traceId}-${spanId}-01`);
	});

	test("two contexts have distinct ids", () => {
		expect(newTraceContext().traceId).not.toBe(newTraceContext().traceId);
	});

	test("parseTraceparent extracts trace and parent span id", () => {
		const p = parseTraceparent("00-11111111111111111111111111111111-2222222222222222-01");
		expect(p).toEqual({
			traceId: "11111111111111111111111111111111",
			parentSpanId: "2222222222222222",
		});
	});

	test("parseTraceparent returns null on garbage", () => {
		expect(parseTraceparent("nope")).toBeNull();
	});
});
