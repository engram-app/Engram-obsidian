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
import id from "../src/i18n/locale/id";
import it from "../src/i18n/locale/it";
import ja from "../src/i18n/locale/ja";
import ko from "../src/i18n/locale/ko";
import ms from "../src/i18n/locale/ms";
import pl from "../src/i18n/locale/pl";
import pt from "../src/i18n/locale/pt";
import ptBR from "../src/i18n/locale/pt-BR";
import ru from "../src/i18n/locale/ru";
import tr from "../src/i18n/locale/tr";
import zh from "../src/i18n/locale/zh";
import zhTW from "../src/i18n/locale/zh-TW";

const LOCALES: Record<string, Dict> = {
	de,
	es,
	fr,
	id,
	it,
	ja,
	ko,
	ms,
	pl,
	pt,
	"pt-BR": ptBR,
	ru,
	tr,
	zh,
	"zh-TW": zhTW,
};

// The agreed term per locale (see src/i18n/locale/README.md). Russian declines it, so its
// pattern allows the case ending ("в Центре синхронизации"); pl and tr lowercase it
// mid-sentence ("Otwórz centrum synchronizacji").
const TERM: Record<string, RegExp> = {
	de: /Sync-Zentrale/,
	es: /Centro de sincronización/,
	fr: /Centre de synchronisation/,
	id: /Pusat Sinkronisasi/,
	it: /Centro di sincronizzazione/,
	ja: /同期センター/,
	ko: /동기화 센터/,
	ms: /Pusat Sync/,
	pl: /[Cc]entrum synchronizacji/,
	pt: /Centro de sincronização/,
	"pt-BR": /Central de sincronização/,
	ru: /Центр[а-я]* синхронизации/,
	tr: /Senkronizasyon [Mm]erkez/,
	zh: /同步中心/,
	"zh-TW": /同步中心/,
};

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

		test("every string about the Sync Center uses the agreed term", () => {
			const wrong = Object.entries(dict)
				.filter(([key]) => /sync center/i.test(key))
				.flatMap(([key, entry]) => strings(entry).map((v) => [key, v] as const))
				.filter(([, v]) => !(TERM[code] as RegExp).test(v))
				.map(([key]) => key);
			expect(wrong).toEqual([]);
		});
	});
}
