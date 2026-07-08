/**
 * Tests: partitionStrandedFlushes (src/crdt/wiring.ts), the pure retry/give-up decision
 * for one strand-heal drain pass.
 *
 * Root cause (e2e test_43 brand-new-note burst, round 3): drainStrandedFlushes
 * did a SINGLE manifest reconcile, then permanently dropped any id whose path
 * was still unresolved (no retry, no timer) — "onFlushToDisk: still no path
 * for note_id=X after heal — retained in Y.Doc", forever. A brand-new note in
 * a rapid multi-note burst can strand (crdt_doc_ready racing ahead of the
 * note_changed broadcast that carries id->path) at the exact moment the
 * manifest fetch runs one beat before the server durably reflects it — a
 * single miss then meant the note NEVER materializes for the rest of the
 * session, matching CI's "received=yes materialized=no" on one note out of
 * a 4-note burst while the others succeed.
 */
import { describe, expect, test } from "bun:test";
import { partitionStrandedFlushes } from "../src/crdt/wiring";

describe("partitionStrandedFlushes", () => {
	test("flushes ids whose path resolves, clearing their attempt count", () => {
		const attempts = new Map<string, number>([["id-a", 2]]);
		const { toFlush, toRetry, toGiveUp } = partitionStrandedFlushes(
			new Map([["id-a", "content-a"]]),
			(id) => (id === "id-a" ? "Notes/A.md" : null),
			attempts,
			5,
		);
		expect(toFlush).toEqual([{ id: "id-a", path: "Notes/A.md", content: "content-a" }]);
		expect(toRetry).toEqual([]);
		expect(toGiveUp).toEqual([]);
		expect(attempts.has("id-a")).toBe(false);
	});

	test("retries an id whose path is still unresolved, under the attempt cap", () => {
		// Pins the bug: BEFORE the fix, one unresolved id after the manifest
		// reconcile was dropped forever. After the fix, it must come back as a
		// retry candidate (not silently discarded) so drainStrandedFlushes
		// re-queues it for another debounced heal cycle.
		const attempts = new Map<string, number>();
		const { toFlush, toRetry, toGiveUp } = partitionStrandedFlushes(
			new Map([["id-fresh-burst", "content-b"]]),
			() => null, // manifest fetch raced the note's own commit — still unknown
			attempts,
			5,
		);
		expect(toFlush).toEqual([]);
		expect(toRetry).toEqual([{ id: "id-fresh-burst", content: "content-b" }]);
		expect(toGiveUp).toEqual([]);
		expect(attempts.get("id-fresh-burst")).toBe(1);
	});

	test("gives up only after maxAttempts consecutive misses, not on the first", () => {
		const attempts = new Map<string, number>([["id-orphan", 3]]);
		const { toRetry, toGiveUp } = partitionStrandedFlushes(
			new Map([["id-orphan", "content-c"]]),
			() => null,
			attempts,
			4, // this call is the 4th miss -> hits the cap
		);
		expect(toRetry).toEqual([]);
		expect(toGiveUp).toEqual(["id-orphan"]);
		expect(attempts.get("id-orphan")).toBe(4);
	});

	test("a burst of several ids resolves independently — one miss does not affect siblings", () => {
		// e2e test_43 shape: 4 notes stranded together; 3 resolve on the first
		// heal, 1 (e.g. Sub/B.md) is still unresolved and must retry alone.
		const attempts = new Map<string, number>();
		const resolved = new Map([
			["id-a", "Notes/A.md"],
			["id-c", "Notes/Sub/Deep/C.md"],
			["id-d", "Notes/Sub/Deep/Deeper/D.md"],
		]);
		const { toFlush, toRetry, toGiveUp } = partitionStrandedFlushes(
			new Map([
				["id-a", "content-a"],
				["id-b", "content-b"],
				["id-c", "content-c"],
				["id-d", "content-d"],
			]),
			(id) => resolved.get(id) ?? null,
			attempts,
			5,
		);
		expect(toFlush.map((f) => f.id).sort()).toEqual(["id-a", "id-c", "id-d"]);
		expect(toRetry).toEqual([{ id: "id-b", content: "content-b" }]);
		expect(toGiveUp).toEqual([]);
	});
});
