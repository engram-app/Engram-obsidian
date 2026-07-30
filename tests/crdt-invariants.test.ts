/**
 * Each invariant here corresponds to a bug class we have actually shipped, so
 * the tests are written as "the broken state we saw in prod is detected".
 */
import { describe, expect, test } from "bun:test";
import {
	InvariantChecker,
	type InvariantContext,
	STANDARD_INVARIANTS,
} from "../src/crdt/invariants";
import { ManualTimeProvider } from "../src/time-provider";

function ctx(overrides: Partial<InvariantContext> = {}): InvariantContext {
	const idByPath = new Map<string, string>();
	const base: InvariantContext = {
		removedNoteIds: new Set(),
		residentNoteIds: new Set(),
		enrolledNoteIds: new Set(),
		liveBoundPaths: new Set(),
		mappedPaths: new Set(),
		idForPath: (p) => idByPath.get(p) ?? null,
		pathForId: (id) => {
			for (const [p, v] of idByPath) if (v === id) return p;
			return null;
		},
	};
	return { ...base, ...overrides };
}

const check = async (c: InvariantContext) => {
	const seen: string[] = [];
	const checker = new InvariantChecker({
		getContext: () => c,
		onViolation: (v) => seen.push(v.id),
	});
	await checker.checkAll();
	return seen;
};

describe("standard invariants", () => {
	test("a healthy vault reports nothing", async () => {
		const idByPath = new Map([["a.md", "id-a"]]);
		const healthy = ctx({
			residentNoteIds: new Set(["id-a"]),
			enrolledNoteIds: new Set(["id-a"]),
			liveBoundPaths: new Set(["a.md"]),
			mappedPaths: new Set(["a.md"]),
			idForPath: (p) => idByPath.get(p) ?? null,
			pathForId: (id) => (id === "id-a" ? "a.md" : null),
		});

		expect(await check(healthy)).toEqual([]);
	});

	test("detects a deleted note whose room was rebuilt (2026-07-28 resurrection)", async () => {
		const violations = await check(
			ctx({ removedNoteIds: new Set(["id-gone"]), residentNoteIds: new Set(["id-gone"]) }),
		);

		expect(violations).toContain("removed-implies-not-resident");
	});

	test("detects a deleted note still holding an open room", async () => {
		const violations = await check(
			ctx({ removedNoteIds: new Set(["id-gone"]), enrolledNoteIds: new Set(["id-gone"]) }),
		);

		expect(violations).toContain("removed-implies-not-enrolled");
	});

	test("detects a phantom room with no doc behind it", async () => {
		const violations = await check(ctx({ enrolledNoteIds: new Set(["id-ghost"]) }));

		expect(violations).toContain("enrolled-implies-resident");
	});

	test("detects a live-bound path with no note_id (onEmptyStep2 'no known path')", async () => {
		const violations = await check(ctx({ liveBoundPaths: new Set(["orphan.md"]) }));

		expect(violations).toContain("live-bound-implies-mapped");
	});

	test("detects a NoteIdMap whose two directions disagree", async () => {
		const violations = await check(
			ctx({
				mappedPaths: new Set(["a.md"]),
				idForPath: (p) => (p === "a.md" ? "id-a" : null),
				// Reverse map drifted to a different path — the stale-NoteIdMap class.
				pathForId: () => "b.md",
			}),
		);

		expect(violations).toContain("id-map-bijective");
	});

	test("a throwing invariant is reported, never treated as passing", async () => {
		const seen: string[] = [];
		const checker = new InvariantChecker({
			getContext: () => ctx(),
			onViolation: (v) => seen.push(`${v.id}:${v.detail}`),
			invariants: [
				{
					id: "explodes",
					description: "throws",
					check() {
						throw new Error("boom");
					},
				},
			],
		});

		await checker.checkAll();

		expect(seen).toEqual(["explodes:check threw: boom"]);
	});
});

describe("periodic checking", () => {
	test("runs on the injected interval and stops cleanly", async () => {
		const clock = new ManualTimeProvider();
		let runs = 0;
		const checker = new InvariantChecker({
			getContext: () => {
				runs++;
				return ctx();
			},
			onViolation: () => {},
			setInterval: (cb, ms) => clock.setInterval(cb, ms),
			clearInterval: (id) => clock.clearInterval(id),
		});

		checker.startPeriodicChecks(30_000);
		clock.advance(90_000);
		expect(runs).toBe(3);

		checker.stop();
		clock.advance(90_000);
		expect(runs).toBe(3);
	});
});

describe("invariant catalogue", () => {
	test("every invariant has a unique id", () => {
		const ids = STANDARD_INVARIANTS.map((i) => i.id);

		expect(new Set(ids).size).toBe(ids.length);
	});
});
