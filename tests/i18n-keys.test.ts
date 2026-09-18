/**
 * Guard against the drift that makes string-keyed i18n rot: a locale entry whose
 * key no longer appears in any `t(...)` call is dead weight that silently never
 * matches. Editing English copy without updating the locales trips this.
 *
 * The reference plugins in this ecosystem have exactly this defect in the wild
 * (an entry whose key and English value disagree), and nothing catches it there.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import type { Dict } from "../src/i18n";
import de from "../src/i18n/locale/de";
import enPlurals from "../src/i18n/locale/en-plurals";
import es from "../src/i18n/locale/es";
import fr from "../src/i18n/locale/fr";
import it from "../src/i18n/locale/it";
import ja from "../src/i18n/locale/ja";
import ko from "../src/i18n/locale/ko";
import pt from "../src/i18n/locale/pt";
import ru from "../src/i18n/locale/ru";
import zh from "../src/i18n/locale/zh";
import zhTW from "../src/i18n/locale/zh-TW";

const repoRoot = join(import.meta.dir, "..");

/**
 * Every key passed to `t("...")` or `tInto(el, "...")` anywhere in src/,
 * excluding the locale files.
 *
 * `tInto` needs its own pattern: `\bt\(` does not match inside `tInto(`, so a
 * scanner that only knows `t()` reports every `tInto` key as an orphan. That
 * fails the moment someone translates one, and the obvious fix looks like
 * deleting a perfectly good translation.
 *
 * Single quotes need their own pattern too: a key containing a double quote is
 * written `t('... "{name}" ...')`, and a double-quote-only scan calls every one
 * of those an orphan.
 */
function keysUsedInSource(): Set<string> {
	const keys = new Set<string>();
	const patterns = [
		/\bt\(\s*"((?:[^"\\]|\\.)+)"/g,
		/\bt\(\s*'((?:[^'\\]|\\.)+)'/g,
		/\btInto\([^,]+,\s*"((?:[^"\\]|\\.)+)"/g,
		/\btInto\([^,]+,\s*'((?:[^'\\]|\\.)+)'/g,
	];
	for (const rel of new Glob("src/**/*.ts").scanSync(repoRoot)) {
		if (rel.includes("i18n/locale")) continue;
		const src = readFileSync(join(repoRoot, rel), "utf8");
		for (const pattern of patterns) {
			for (const m of src.matchAll(pattern)) {
				const key = m[1];
				if (key) keys.add(key.replace(/\\(["'])/g, "$1"));
			}
		}
	}
	return keys;
}

const LOCALES: Array<[string, Dict]> = [
	["de", de],
	["es", es],
	["fr", fr],
	["it", it],
	["ja", ja],
	["ko", ko],
	["pt", pt],
	["ru", ru],
	["zh", zh],
	["zh-TW", zhTW],
	["en-plurals", enPlurals],
];

describe("locale keys track the source", () => {
	const used = keysUsedInSource();

	test("the scan finds the wrapped call sites at all", () => {
		expect(used.size).toBeGreaterThan(20);
	});

	test("the scan sees tInto keys, not just t() keys", () => {
		expect(used.has("Version: {version}")).toBe(true);
		expect(used.has("Your vault shares {percent} of its data with Engram")).toBe(true);
	});

	for (const [name, dict] of LOCALES) {
		test(`${name} has no key that no longer exists in src/`, () => {
			const orphans = Object.keys(dict).filter((key) => !used.has(key));
			expect(orphans).toEqual([]);
		});
	}

	test("every plural entry supplies at least one form", () => {
		for (const [name, dict] of LOCALES) {
			for (const [key, entry] of Object.entries(dict)) {
				if (typeof entry === "string") continue;
				expect(Object.keys(entry).length, `${name}: ${key}`).toBeGreaterThan(0);
			}
		}
	});

	test("a plural key is plural in every locale that has it, or in none", () => {
		const pluralKeys = new Set(
			LOCALES.flatMap(([, dict]) =>
				Object.entries(dict)
					.filter(([, entry]) => typeof entry !== "string")
					.map(([key]) => key),
			),
		);
		// A locale may legitimately use a single form where its grammar does not
		// inflect (zh, ja, ko), so only assert the key is known to the source.
		for (const key of pluralKeys) {
			expect(used.has(key), `plural key not used in src/: ${key}`).toBe(true);
		}
	});
});
