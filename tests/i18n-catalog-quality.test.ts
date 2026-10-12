/**
 * The checks translategemma's answers must pass, run over the committed catalogs.
 * No model, so it stays in the per-PR suite: it catches a hand edit or a bad merge
 * that drops a placeholder, a brand name, a URL, a label's emoji or the register.
 */
import { describe, expect, test } from "bun:test";
import type { Dict } from "../src/i18n";
import { problems, SPECS, type Target } from "../src/i18n/auto-translate";

const catalogs = await Promise.all(
	(Object.keys(SPECS) as Target[]).map(async (code) => {
		const mod: { default: Dict } = await import(`../src/i18n/locale/${code}.ts`);
		return [code, mod.default] as const;
	}),
);

describe("committed catalogs pass the translation checks", () => {
	test.each(catalogs)("%s", (code, catalog) => {
		const failures = Object.entries(catalog).flatMap(([key, value]) =>
			// A plural form is checked against the key (the `other` form); `one` may drop {count}.
			(typeof value === "string" ? [value] : Object.values(value)).flatMap((form) => {
				const src = form.includes("{count}") ? key : key.replaceAll("{count}", "");
				const found = problems(src, form, code);
				return found.length > 0 ? [{ key, form, found }] : [];
			}),
		);
		expect(failures).toEqual([]);
	});
});
