/**
 * The Sync Center is a user-facing surface in every locale: the settings tab, the
 * command palette entry and the notices that point at it all use one translated name.
 * A locale that slides back to the English name (a stale copy, a new notice written
 * with the English literal) fails here.
 */

import { describe, expect, test } from "bun:test";
import type { Dict, Entry } from "../src/i18n";
import de from "../src/i18n/locale/de";
import es from "../src/i18n/locale/es";
import fr from "../src/i18n/locale/fr";
import it from "../src/i18n/locale/it";
import ja from "../src/i18n/locale/ja";
import ko from "../src/i18n/locale/ko";
import pt from "../src/i18n/locale/pt";
import ru from "../src/i18n/locale/ru";
import zh from "../src/i18n/locale/zh";
import zhTW from "../src/i18n/locale/zh-TW";

const LOCALES: Record<string, Dict> = { de, es, fr, it, ja, ko, pt, ru, zh, "zh-TW": zhTW };

const TAB = "🔄 Sync Center";
const COMMAND = "Open sync center";

const strings = (e: Entry): string[] => (typeof e === "string" ? [e] : Object.values(e));

for (const [code, dict] of Object.entries(LOCALES)) {
	describe(`Sync Center in ${code}`, () => {
		test("the settings tab keeps its emoji but not the English name", () => {
			const label = dict[TAB];
			expect(typeof label).toBe("string");
			expect(label).toStartWith("🔄 ");
			expect(label).not.toBe(TAB);
		});

		test("the command palette entry is translated", () => {
			expect(dict[COMMAND]).toBeDefined();
			expect(strings(dict[COMMAND] as Entry).join(" ")).not.toContain("Sync Center");
		});

		test("no translated value still says 'Sync Center'", () => {
			const leaks = Object.entries(dict)
				.filter(([, e]) => strings(e).some((s) => /Sync Center/i.test(s)))
				.map(([k]) => k);
			expect(leaks).toEqual([]);
		});

		test("the tab label and command use the same term", () => {
			const term = (dict[TAB] as string).replace(/^🔄\s*/, "");
			expect(strings(dict[COMMAND] as Entry).join(" ")).toContain(term);
		});
	});
}
