/**
 * Buttons that sit side by side but do different things must not share a label.
 * The Sync Center's attention card has "Dismiss" (clear the errors) next to each
 * row's "Ignore" (stop syncing the file for good): pt, vi and zh once rendered
 * both as one word, so a user clearing the card could stop a note syncing.
 */
import { describe, expect, test } from "bun:test";
import type { Dict, Entry } from "../src/i18n";
import de from "../src/i18n/locale/de";
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

const LOCALES: Record<string, Dict> = {
	de,
	es,
	fr,
	it,
	ja,
	ko,
	ms,
	pt,
	"pt-BR": ptBR,
	ru,
	vi,
	zh,
	"zh-TW": zhTW,
};

const PAIRS: [string, string][] = [["Dismiss", "Ignore"]];

const text = (e: Entry | undefined): string | undefined =>
	typeof e === "string" ? e.trim().toLowerCase() : undefined;

describe("side-by-side actions keep distinct labels", () => {
	for (const [code, dict] of Object.entries(LOCALES)) {
		for (const [a, b] of PAIRS) {
			test(`${code}: "${a}" and "${b}"`, () => {
				const [x, y] = [text(dict[a]), text(dict[b])];
				expect(x).toBeDefined();
				expect(x).not.toBe(y);
			});
		}
	}
});
