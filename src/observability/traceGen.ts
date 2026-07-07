// W3C traceparent generation and parsing. Zero dependencies: uses Web Crypto, available
// in Obsidian's Electron renderer. Clients own the trace id; the backend
// generates each beacon span's own id, so we only ever mint a root here.

function hex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newTraceContext(): { traceparent: string; traceId: string; spanId: string } {
	const traceId = hex(16);
	const spanId = hex(8);
	return { traceparent: `00-${traceId}-${spanId}-01`, traceId, spanId };
}

export function parseTraceparent(tp: string): { traceId: string; parentSpanId: string } | null {
	const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(tp);
	return m ? { traceId: m[1]!, parentSpanId: m[2]! } : null;
}
