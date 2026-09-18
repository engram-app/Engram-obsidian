/**
 * Plugin UI translation.
 *
 * The English string IS the lookup key, so there is no `en` dictionary to
 * maintain and nothing to drift: a missing translation falls through to a
 * readable English sentence rather than to a bare identifier. (The reference
 * plugins in this ecosystem ship a hand-written identity map for English and
 * have measurably drifted from it.)
 *
 * The only exception is `en-plurals.ts`, which carries the singular form of the
 * handful of strings whose wording changes with a count. Its keys are the plural
 * form, so English still needs no entry for the common case.
 *
 * Locale codes are Obsidian's own (`zh`, `zh-TW`, `pt-BR`, ...), taken straight
 * from `getLanguage()`. Keying on those avoids the normalization layer the
 * reference plugins need because they read `moment.locale()` instead, which
 * reports `zh-cn` for the locale Obsidian calls `zh`.
 */
import { getLanguage } from "obsidian";
import de from "./locale/de";
import enPlurals from "./locale/en-plurals";
import es from "./locale/es";
import fr from "./locale/fr";
import it from "./locale/it";
import ja from "./locale/ja";
import ko from "./locale/ko";
import pt from "./locale/pt";
import ru from "./locale/ru";
import zh from "./locale/zh";
import zhTW from "./locale/zh-TW";

/** One form per CLDR plural category. `other` is the fallback within a locale. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Entry = string | PluralForms;
export type Dict = Record<string, Entry>;
export type Vars = Record<string, string | number>;

const LOCALES: Record<string, Dict> = {
	de,
	es,
	fr,
	it,
	ja,
	ko,
	pt,
	ru,
	zh,
	"zh-TW": zhTW,
};

/**
 * The ISO code Obsidian is running in, defaulting to `en`.
 *
 * `getLanguage()` is the documented API, but it may postdate our `minAppVersion`
 * floor of 1.7.2. The `typeof` guard keeps an older app from throwing on an
 * undefined import; such an app simply gets English.
 */
export function currentLocale(): string {
	if (typeof getLanguage !== "function") return "en";
	return getLanguage() || "en";
}

/** Exact code first, then its base language, so `en-GB` reaches `en`. */
function dictFor(code: string): Dict | undefined {
	const base = code.split("-")[0] ?? code;
	return LOCALES[code] ?? LOCALES[base];
}

function pickPlural(forms: PluralForms, code: string, vars?: Vars): string | undefined {
	const count = vars?.count;
	if (typeof count !== "number") return forms.other;
	let category: Intl.LDMLPluralRule = "other";
	try {
		category = new Intl.PluralRules(code).select(count);
	} catch {
		// Intl rejects a code it does not know; `other` is the safe form.
	}
	return forms[category] ?? forms.other;
}

/** Replace `{name}` from `vars`, leaving an unsupplied placeholder visible. */
function fill(template: string, vars?: Vars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
		const value = vars[name];
		return value === undefined ? whole : String(value);
	});
}

/**
 * Translate `key` into the app's language.
 *
 * `key` is the English sentence, with `{name}` where a value goes. Pass a
 * numeric `count` for any string whose wording depends on quantity.
 */
/**
 * Render a translated sentence into `el`, building one styled child where the
 * `{slot}` placeholder sits.
 *
 * Without this, a sentence wrapped around a styled span has to be split into
 * literal fragments ("Your vault shares " + span + " of its data"), and a
 * fragment cannot be translated: the translator can neither see the whole
 * sentence nor move the slot, which most languages need to do.
 *
 * A translation that drops the placeholder still renders, as plain text.
 */
export function tInto(
	el: HTMLElement,
	key: string,
	slot: string,
	build: (parent: HTMLElement) => void,
	opts: { textCls?: string; vars?: Vars } = {},
): void {
	const { textCls, vars } = opts;
	const token = `{${slot}}`;
	const template = t(key, vars);
	const at = template.indexOf(token);
	if (at < 0) {
		// A translation that lost the placeholder still has to show the value.
		// Skipping `build` here would silently delete the data the sentence is
		// about: the version number, the link, or the literal word the user is
		// being told to type. Appending reads oddly; dropping it is a bug.
		el.createSpan({ text: template, cls: textCls });
		build(el);
		return;
	}
	const head = template.slice(0, at);
	if (head) el.createSpan({ text: head, cls: textCls });
	build(el);
	const tail = template.slice(at + token.length);
	if (tail) el.createSpan({ text: tail, cls: textCls });
}

export function t(key: string, vars?: Vars): string {
	const code = currentLocale();
	const entry = dictFor(code)?.[key] ?? enPlurals[key];

	let template = key;
	if (typeof entry === "string") {
		template = entry;
	} else if (entry) {
		template = pickPlural(entry, code, vars) ?? key;
	}

	return fill(template, vars);
}
