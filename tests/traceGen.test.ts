import { newTraceContext } from "../src/observability/traceGen";

describe("traceGen", () => {
	test("newTraceContext returns a well-formed sampled traceparent", () => {
		const { traceparent, traceId, spanId } = newTraceContext();
		expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
		expect(traceparent).toBe(`00-${traceId}-${spanId}-01`);
	});

	test("two contexts have distinct ids", () => {
		expect(newTraceContext().traceId).not.toBe(newTraceContext().traceId);
	});


});
