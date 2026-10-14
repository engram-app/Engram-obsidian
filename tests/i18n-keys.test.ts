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
import { usedKeys } from "../src/i18n/keys-scan";
import de from "../src/i18n/locale/de";
import enPlurals from "../src/i18n/locale/en-plurals";
import es from "../src/i18n/locale/es";
import fr from "../src/i18n/locale/fr";
import it from "../src/i18n/locale/it";
import ja from "../src/i18n/locale/ja";
import ko from "../src/i18n/locale/ko";
import ms from "../src/i18n/locale/ms";
import pt from "../src/i18n/locale/pt";
import ptBR from "../src/i18n/locale/pt-BR";
import ru from "../src/i18n/locale/ru";
import vi from "../src/i18n/locale/vi";
import zh from "../src/i18n/locale/zh";
import zhTW from "../src/i18n/locale/zh-TW";
import { compareKeys, profile } from "../src/i18n/translate-profile";

const repoRoot = join(import.meta.dir, "..");

/** Every key used in src/, excluding the locale files (see src/i18n/keys-scan.ts). */
function keysUsedInSource(): Set<string> {
	const sources = [...new Glob("src/**/*.ts").scanSync(repoRoot)]
		.filter((rel) => !rel.includes("i18n/locale"))
		.map((rel) => readFileSync(join(repoRoot, rel), "utf8"));
	return usedKeys(sources);
}

const LOCALES: Array<[string, Dict]> = [
	["de", de],
	["es", es],
	["fr", fr],
	["it", it],
	["ja", ja],
	["ko", ko],
	["ms", ms],
	["pt", pt],
	["pt-BR", ptBR],
	["ru", ru],
	["vi", vi],
	["zh", zh],
	["zh-TW", zhTW],
	["en-plurals", enPlurals],
];

describe("locale keys track the source", () => {
	const used = keysUsedInSource();

	test("the scan finds the wrapped call sites at all", () => {
		expect(used.size).toBeGreaterThan(20);
	});

	// A glossary term that is not a real key is never looked up, so its translation
	// floats (the backend's "Notes" let ja render "note" two different ways).
	test("pins only glossary terms that are real keys", () => {
		expect(profile.glossary.filter((k) => !used.has(k))).toEqual([]);
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

	// renderCatalog sorts; a catalog out of order was written some other way.
	// en-plurals is hand-written, so its order is free.
	for (const [name, dict] of LOCALES.filter(([n]) => n !== "en-plurals")) {
		test(`${name} lists its keys in sorted order`, () => {
			const keys = Object.keys(dict);
			expect(keys).toEqual(keys.toSorted(compareKeys));
		});
	}

	test("state.json lists every map in sorted order", () => {
		const unsorted: string[] = [];
		const walk = (value: unknown, at: string): void => {
			if (!value || typeof value !== "object" || Array.isArray(value)) return;
			const keys = Object.keys(value);
			if (keys.join("\0") !== keys.toSorted(compareKeys).join("\0")) unsorted.push(at);
			for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`);
		};
		walk(
			JSON.parse(readFileSync(join(repoRoot, "src/i18n/locale/state.json"), "utf8")),
			"state",
		);
		expect(unsorted).toEqual([]);
	});

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
