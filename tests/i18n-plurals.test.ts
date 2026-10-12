/**
 * A `{count}` key that is not registered in en-plurals.ts is translated as ONE
 * string, so Russian says "{count} retrying" in the singular for every count and
 * English says "1 notes have frontmatter problems". And a plural key without
 * `{count}` never shows the model a sample number, so ru `few` came out equal
 * to `many`. Both are invisible until a user reads them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { usedKeys } from "../src/i18n/keys-scan";
import enPlurals from "../src/i18n/locale/en-plurals";

const repoRoot = join(import.meta.dir, "..");

/**
 * `{count}` keys that are deliberately NOT plurals: the number is a bare badge
 * in parentheses that no word agrees with. Add a key here only if that holds
 * in every language, not just English.
 */
const BARE_COUNTERS = new Set([
	"Engram: syncing ({count})",
	"Engram: pending ({count})",
	"Not synced on your plan ({count})",
	"Show files ({count}) ▾",
	"Needs attention ({count})",
	"Retrying automatically ({count})",
]);

function keysUsedInSource(): Set<string> {
	const sources = [...new Glob("src/**/*.ts").scanSync(repoRoot)]
		.filter((rel) => !rel.includes("i18n/locale"))
		.map((rel) => readFileSync(join(repoRoot, rel), "utf8"));
	return usedKeys(sources);
}

describe("plural registration", () => {
	const used = keysUsedInSource();

	test("every used {count} key is a registered plural or a listed bare counter", () => {
		const unregistered = [...used].filter(
			(key) => key.includes("{count}") && !(key in enPlurals) && !BARE_COUNTERS.has(key),
		);
		expect(unregistered).toEqual([]);
	});

	test("every en-plurals key carries {count}, so the number reaches the translator", () => {
		const missing = Object.keys(enPlurals).filter((key) => !key.includes("{count}"));
		expect(missing).toEqual([]);
	});

	test("every en-plurals `one` form carries {count} too", () => {
		const missing = Object.entries(enPlurals).filter(
			([, forms]) =>
				typeof forms === "object" &&
				forms.one !== undefined &&
				!forms.one.includes("{count}"),
		);
		expect(missing).toEqual([]);
	});

	test("the bare-counter allowlist holds only keys the source still uses", () => {
		expect([...BARE_COUNTERS].filter((key) => !used.has(key))).toEqual([]);
	});
});
