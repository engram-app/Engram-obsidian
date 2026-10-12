/**
 * The gate the translator's answers must pass, run over the committed catalogs with
 * the same checks (core catalogProblems). No model, so it stays in the per-PR suite:
 * it catches a hand edit, a bad merge, a missing key or an orphan. A key the
 * translator gave up on is tolerated only while it is listed in state.json.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import type { Dict } from "../src/i18n";
import { coreHeaderOk, type LocaleState, sourceProblems } from "../src/i18n/core/core";
import { usedEntries } from "../src/i18n/keys-scan";
import enPlurals from "../src/i18n/locale/en-plurals";
import state from "../src/i18n/locale/state.json";
import { profile, renderCatalog, type Target, tr } from "../src/i18n/translate-profile";

const root = join(import.meta.dir, "..");
const sources = [...new Glob("src/**/*.ts").scanSync(root)]
	.filter((rel) => !rel.includes("i18n/locale"))
	.map((rel) => readFileSync(join(root, rel), "utf8"));
const entries = usedEntries(sources, enPlurals);
const states = state as unknown as Record<string, LocaleState>;
const catalogs = await Promise.all(
	(Object.keys(profile.specs) as Target[]).map(async (code) => {
		const mod: { default: Dict } = await import(`../src/i18n/locale/${code}.ts`);
		return [code, mod.default] as const;
	}),
);

describe("committed catalogs", () => {
	test.each(catalogs)("%s passes the translation checks", (code, catalog) => {
		expect(tr.catalogProblems(entries, catalog, code, states[code])).toEqual([]);
	});
	test("source strings can be translated", () => {
		expect(sourceProblems(entries)).toEqual([]);
	});
});

describe("renderCatalog", () => {
	test("writes the catalog file shape, single-form plurals as plain strings", () => {
		expect(
			renderCatalog("zh-TW", { Sync: "同步", "{count} files": { other: "{count} 個檔案" } }),
		).toBe(
			'import type { Dict } from "..";\n\n// 繁體中文\nconst zhTW: Dict = {\n\t"Sync": "同步",\n\t"{count} files": "{count} 個檔案",\n};\n\nexport default zhTW;\n',
		);
	});
});

// The core is vendored from engram-app/Engram (frontend/src/i18n/core). A copy
// edited here fails; edit the canonical copy and run `make i18n-core-sync`.
describe("i18n core header", () => {
	test.each(["core.ts", "run.ts"])("%s matches its content", (name) => {
		expect(coreHeaderOk(readFileSync(join(root, "src", "i18n", "core", name), "utf8"))).toBe(
			true,
		);
	});
});
