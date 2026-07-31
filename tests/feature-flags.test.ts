import { describe, expect, test } from "bun:test";
import {
	type FeatureFlags,
	FLAG_SCHEMA,
	flagsForCategory,
	resolveFlags,
	visibleFlags,
} from "../src/feature-flags";

describe("resolveFlags", () => {
	test("applies schema defaults when settings carry no overrides", () => {
		const flags = resolveFlags(undefined);

		for (const key of Object.keys(FLAG_SCHEMA) as (keyof FeatureFlags)[]) {
			expect(flags[key]).toBe(FLAG_SCHEMA[key].default);
		}
	});

	test("a stored override wins over the default", () => {
		const flags = resolveFlags({ crdtRecording: true });

		expect(flags.crdtRecording).toBe(true);
	});

	test("ignores unknown keys — a removed flag left in data.json must not leak through", () => {
		const flags = resolveFlags({ someRetiredFlag: true } as Partial<FeatureFlags>);

		expect("someRetiredFlag" in flags).toBe(false);
	});

	test("ignores a non-boolean stored value rather than trusting it", () => {
		// data.json is user-editable; a hand-edited "true" must not turn a danger
		// flag on by truthiness.
		const flags = resolveFlags({ crdtRecording: "true" } as unknown as Partial<FeatureFlags>);

		expect(flags.crdtRecording).toBe(FLAG_SCHEMA.crdtRecording.default);
	});
});

describe("FLAG_SCHEMA", () => {
	test("every flag declares a category, title and description", () => {
		for (const [key, entry] of Object.entries(FLAG_SCHEMA)) {
			expect(entry.category, `${key} category`).toBeOneOf(["labs", "debugging", "danger"]);
			expect(entry.title.length, `${key} title`).toBeGreaterThan(0);
			expect(entry.description.length, `${key} description`).toBeGreaterThan(0);
		}
	});

	test("no flag ships defaulted-on in the danger category", () => {
		// A danger flag changes persistence or sync semantics. Shipping one on by
		// default makes it an un-reviewed migration, not a flag.
		for (const [key, entry] of Object.entries(FLAG_SCHEMA)) {
			if (entry.category === "danger") {
				expect(entry.default, `${key} must default off`).toBe(false);
			}
		}
	});
});

describe("visibleFlags", () => {
	test("hides debugging and danger flags while diagnostics are off", () => {
		const visible = visibleFlags(false).map(([key]) => key);

		for (const key of visible) {
			expect(FLAG_SCHEMA[key].category).toBe("labs");
		}
	});

	test("shows every flag once diagnostics are on", () => {
		expect(visibleFlags(true)).toHaveLength(Object.keys(FLAG_SCHEMA).length);
	});
});

describe("flagsForCategory", () => {
	test("groups by category and keeps schema order stable", () => {
		const danger = flagsForCategory("danger").map(([key]) => key);
		const all = Object.keys(FLAG_SCHEMA) as (keyof FeatureFlags)[];

		expect(danger).toEqual(all.filter((k) => FLAG_SCHEMA[k].category === "danger"));
	});
});
