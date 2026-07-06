/**
 * Tests: CrdtEnrollment — per-note startSync enrollment tracker.
 *
 * Task 7B: opening a note triggers exactly one startSync; reset on reconnect
 * allows a fresh startSync; multiple paths each get their own startSync.
 */
import { describe, expect, mock, test } from "bun:test";
import { CrdtEnrollment } from "../../src/crdt/enrollment";

function makeEnrollment() {
	const startSyncCalls: string[] = [];
	const resetSyncCalls: string[] = [];

	const enrollment = new CrdtEnrollment({
		startSync: async (path) => {
			startSyncCalls.push(path);
		},
		resetSync: (path) => {
			resetSyncCalls.push(path);
		},
	});

	return { enrollment, startSyncCalls, resetSyncCalls };
}

describe("CrdtEnrollment.enroll", () => {
	test("opening a note triggers exactly one startSync", async () => {
		const { enrollment, startSyncCalls } = makeEnrollment();

		enrollment.enroll("note.md"); // first open
		enrollment.enroll("note.md"); // re-opened (same path)
		enrollment.enroll("note.md"); // again

		// flush microtasks so the void startSync(path) promise resolves
		await new Promise((r) => setTimeout(r, 0));

		expect(startSyncCalls).toEqual(["note.md"]);
	});

	test("enrolls a bare note_id with no .md extension (Task 6: keyed by id, not path)", async () => {
		// The markdown-extension gate moved to call sites (they know the path);
		// enroll() itself must accept an opaque note_id — a crdt_doc_ready
		// announce has no path to check at all.
		const { enrollment, startSyncCalls } = makeEnrollment();

		enrollment.enroll("018f5b3e-0000-7000-8000-000000000001");
		await new Promise((r) => setTimeout(r, 0));

		expect(startSyncCalls).toEqual(["018f5b3e-0000-7000-8000-000000000001"]);
	});

	test("different paths each get one startSync", async () => {
		const { enrollment, startSyncCalls } = makeEnrollment();

		enrollment.enroll("a.md");
		enrollment.enroll("b.md");
		enrollment.enroll("a.md"); // duplicate — ignored

		await new Promise((r) => setTimeout(r, 0));

		expect(startSyncCalls).toHaveLength(2);
		expect(startSyncCalls).toContain("a.md");
		expect(startSyncCalls).toContain("b.md");
	});
});

describe("CrdtEnrollment.reset", () => {
	test("reset clears enrollment so startSync fires again on next open (reconnect)", async () => {
		const { enrollment, startSyncCalls, resetSyncCalls } = makeEnrollment();

		enrollment.enroll("note.md");
		await new Promise((r) => setTimeout(r, 0));
		expect(startSyncCalls).toHaveLength(1);

		enrollment.reset("note.md"); // simulates WS reconnect
		expect(resetSyncCalls).toContain("note.md");

		enrollment.enroll("note.md"); // re-open after reconnect
		await new Promise((r) => setTimeout(r, 0));
		expect(startSyncCalls).toHaveLength(2); // second startSync sent
	});
});

describe("CrdtEnrollment.resetAll", () => {
	test("resetAll clears all enrollments and calls resetSync for each", async () => {
		const { enrollment, startSyncCalls, resetSyncCalls } = makeEnrollment();

		enrollment.enroll("a.md");
		enrollment.enroll("b.md");
		await new Promise((r) => setTimeout(r, 0));
		expect(startSyncCalls).toHaveLength(2);

		enrollment.resetAll();
		expect(resetSyncCalls).toContain("a.md");
		expect(resetSyncCalls).toContain("b.md");

		// Both paths can now be re-enrolled
		enrollment.enroll("a.md");
		enrollment.enroll("b.md");
		await new Promise((r) => setTimeout(r, 0));
		expect(startSyncCalls).toHaveLength(4);
	});
});

// ---------------------------------------------------------------------------
// Task 8C: onAfterEnroll — flattenIfBloated is called after startSync resolves
// ---------------------------------------------------------------------------

describe("CrdtEnrollment.onAfterEnroll", () => {
	test("enrollment triggers onAfterEnroll (flatten check) once per path after startSync", async () => {
		const afterEnrollCalls: string[] = [];

		const enrollment = new CrdtEnrollment({
			startSync: async (path) => {
				// Simulate an async handshake
				await new Promise((r) => setTimeout(r, 0));
				return;
			},
			resetSync: () => {},
			onAfterEnroll: async (path) => {
				afterEnrollCalls.push(path);
			},
		});

		enrollment.enroll("note.md");
		// Second call is idempotent — onAfterEnroll must NOT run twice.
		enrollment.enroll("note.md");

		// Let startSync + onAfterEnroll settle.
		await new Promise((r) => setTimeout(r, 10));

		// onAfterEnroll fires exactly once after startSync.
		expect(afterEnrollCalls).toEqual(["note.md"]);
	});

	test("onAfterEnroll fires per path (not shared across paths)", async () => {
		const afterEnrollCalls: string[] = [];

		const enrollment = new CrdtEnrollment({
			startSync: async () => {},
			resetSync: () => {},
			onAfterEnroll: async (path) => {
				afterEnrollCalls.push(path);
			},
		});

		enrollment.enroll("a.md");
		enrollment.enroll("b.md");
		await new Promise((r) => setTimeout(r, 10));

		expect(afterEnrollCalls).toHaveLength(2);
		expect(afterEnrollCalls).toContain("a.md");
		expect(afterEnrollCalls).toContain("b.md");
	});

	test("enrollment without onAfterEnroll option works (backward compat)", async () => {
		const startSyncCalls: string[] = [];

		const enrollment = new CrdtEnrollment({
			startSync: async (path) => {
				startSyncCalls.push(path);
			},
			resetSync: () => {},
			// onAfterEnroll omitted — must not throw
		});

		enrollment.enroll("note.md");
		await new Promise((r) => setTimeout(r, 10));

		expect(startSyncCalls).toEqual(["note.md"]);
	});
});
