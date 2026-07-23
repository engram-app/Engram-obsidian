/**
 * Tests: CrdtEnrollment — per-note startSync enrollment tracker.
 *
 * Task 7B: opening a note triggers exactly one startSync; reset on reconnect
 * allows a fresh startSync; multiple paths each get their own startSync.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { CrdtEnrollment } from "../../src/crdt/enrollment";
import { rlog } from "../../src/remote-log";

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
// Bounded-concurrency drain queue — fix connect storm (fan-out throttle)
// ---------------------------------------------------------------------------

describe("CrdtEnrollment bounded concurrency", () => {
	test("never runs more than `concurrency` startSyncs in flight at once", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const release: Array<() => void> = [];
		const startSync = (_id: string) =>
			new Promise<void>((resolve) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				release.push(() => {
					inFlight--;
					resolve();
				});
			});
		const e = new CrdtEnrollment({ startSync, resetSync: () => {}, concurrency: 4 });

		for (let i = 0; i < 50; i++) e.enroll(`id-${i}`);
		// Only `concurrency` should have started; the rest are queued.
		expect(release.length).toBe(4);
		expect(maxInFlight).toBe(4);

		// Drain: releasing one starts exactly one more, never exceeding the cap.
		while (release.length > 0) {
			release.shift()!();
			await Promise.resolve(); // let the drain microtask run
			await Promise.resolve();
			expect(inFlight).toBeLessThanOrEqual(4);
		}
		expect(maxInFlight).toBe(4);
	});

	test("all 50 notes eventually enroll (none dropped)", async () => {
		const seen = new Set<string>();
		const startSync = async (id: string) => {
			seen.add(id);
		};
		const e = new CrdtEnrollment({ startSync, resetSync: () => {}, concurrency: 4 });
		for (let i = 0; i < 50; i++) e.enroll(`id-${i}`);
		// flush all queued microtasks
		for (let i = 0; i < 200; i++) await Promise.resolve();
		expect(seen.size).toBe(50);
	});

	test("enroll is still idempotent per note_id", async () => {
		let calls = 0;
		const e = new CrdtEnrollment({
			startSync: async () => {
				calls++;
			},
			resetSync: () => {},
			concurrency: 4,
		});
		e.enroll("id-1");
		e.enroll("id-1");
		e.enroll("id-1");
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(calls).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Failed handshake: a rejected startSync must not permanently latch the
// once-per-session guard (the note would stay deaf all session, silently).
// ---------------------------------------------------------------------------

describe("CrdtEnrollment failed handshake", () => {
	test("a rejected startSync logs a warn and un-marks enrollment so a later enroll retries", async () => {
		let calls = 0;
		const resetSyncCalls: string[] = [];
		const e = new CrdtEnrollment({
			startSync: async () => {
				calls++;
				if (calls === 1) throw new Error("transport down");
			},
			resetSync: (id) => {
				resetSyncCalls.push(id);
			},
		});
		const warnSpy = spyOn(rlog(), "warn");

		e.enroll("id-1");
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toBe(1);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const [category, message] = warnSpy.mock.calls[0] as unknown as [string, string];
		expect(category).toBe("crdt");
		expect(message).toContain("id-1");

		// The channel's once-per-doc `initiated` latch is set BEFORE startSync's
		// first await (channel.ts) — without resetSync the "retry" would early
		// return there and never send a STEP1. The catch must clear BOTH latches.
		expect(resetSyncCalls).toEqual(["id-1"]);

		// The failed handshake must be retryable — a permanent `enrolled` latch
		// leaves the note deaf to remote CRDT state for the whole session.
		e.enroll("id-1");
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toBe(2);

		warnSpy.mockRestore();
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
