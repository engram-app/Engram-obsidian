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

/**
 * `detail` is a log line.
 *
 * `wiring.ts` interpolates it straight into `rlog().warn("crdt", ...)`, so
 * every violation ships whatever the check put in the string. Two of them
 * listed vault paths — up to five per violation — and the source guard could
 * not see it: at the call site the expression reads `${v.detail}`, which names
 * nothing path-like.
 *
 * This is the behavioural pin for that. It asserts on the DETAIL text, which is
 * the thing that actually reaches Loki, rather than on the shape of the source.
 */
describe("invariant details carry no vault path", () => {
	const SECRET = "Medical/2026 biopsy results.md";

	const details = async (c: InvariantContext) => {
		const seen: string[] = [];
		const checker = new InvariantChecker({
			getContext: () => c,
			onViolation: (v) => seen.push(v.detail),
		});
		await checker.checkAll();
		return seen;
	};

	test("live-bound-implies-mapped names no folder", async () => {
		// Bound but unmapped — idForPath returns null, so the invariant fires.
		const out = await details(ctx({ liveBoundPaths: new Set([SECRET]) }));

		expect(out.length).toBe(1); // the violation really fired
		expect(out[0]).toContain("live-bound paths with no note_id");
		expect(out[0]).not.toContain("Medical");
		expect(out[0]).not.toContain("biopsy");
	});

	test("id-map-bijective names no folder", async () => {
		// A one-way map: path→id resolves, id→path does not agree.
		const broken = ctx({
			mappedPaths: new Set([SECRET]),
			idForPath: (p) => (p === SECRET ? "id-x" : null),
			pathForId: () => "Divorce 2026/settlement.md",
		});

		const out = await details(broken);

		expect(out.length).toBe(1);
		expect(out[0]).toContain("id-map direction mismatch");
		expect(out[0]).toContain("id-x"); // the note_id is kept — it is opaque
		expect(out[0]).not.toContain("Medical");
		expect(out[0]).not.toContain("Divorce");
	});

	// The three id-listing invariants must NOT be scrubbed — a note_id is an
	// opaque UUID, and blanking it would cost the whole diagnostic for nothing.
	test("note_ids stay readable", async () => {
		const out = await details(
			ctx({ removedNoteIds: new Set(["id-a"]), residentNoteIds: new Set(["id-a"]) }),
		);

		expect(out.some((d) => d.includes("id-a"))).toBe(true);
	});
});
