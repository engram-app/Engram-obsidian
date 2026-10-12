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
import ms from "./locale/ms";
import pt from "./locale/pt";
import ru from "./locale/ru";
import vi from "./locale/vi";
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
	ms,
	pt,
	ru,
	vi,
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

/** `1234` as the locale writes it ("1,234", "1.234"); the raw digits if Intl
 *  rejects the code. */
function formatCount(n: number, code: string): string {
	try {
		return new Intl.NumberFormat(code).format(n);
	} catch {
		return String(n);
	}
}

/** Replace `{name}` from `vars`, leaving an unsupplied placeholder visible. A
 *  numeric `{count}` is written in the locale's number format. */
function fill(template: string, vars?: Vars, code = currentLocale()): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
		const value = vars[name];
		if (value === undefined) return whole;
		return name === "count" && typeof value === "number"
			? formatCount(value, code)
			: String(value);
	});
}

type Build = (parent: HTMLElement) => void;
type IntoOpts = { textCls?: string; vars?: Vars };

/**
 * Render a translated sentence into `el`, building one styled child where each
 * `{slot}` placeholder sits.
 *
 * Without this, a sentence wrapped around a styled span has to be split into
 * literal fragments ("Your vault shares " + span + " of its data"), and a
 * fragment cannot be translated: the translator can neither see the whole
 * sentence nor move the slot, which most languages need to do.
 *
 * Pass one `slot` + `build`, or a `{ slot: build }` map for a sentence with
 * several (two links, say).
 *
 * A translation that drops a placeholder still renders: the built child is
 * appended at the end so its value is never lost.
 */
export function tInto(
	el: HTMLElement,
	key: string,
	slot: string,
	build: Build,
	opts?: IntoOpts,
): void;
export function tInto(
	el: HTMLElement,
	key: string,
	slots: Record<string, Build>,
	opts?: IntoOpts,
): void;
export function tInto(
	el: HTMLElement,
	key: string,
	slotOrSlots: string | Record<string, Build>,
	buildOrOpts?: Build | IntoOpts,
	maybeOpts?: IntoOpts,
): void {
	const single = typeof slotOrSlots === "string";
	const builds: Record<string, Build> = single
		? { [slotOrSlots]: buildOrOpts as Build }
		: slotOrSlots;
	const { textCls, vars } = (single ? maybeOpts : (buildOrOpts as IntoOpts | undefined)) ?? {};
	// Select the plural form with every var, but fill only the non-slot ones so
	// a `{count}` slot can be a styled span while the count still picks the form.
	const fillVars =
		vars && Object.fromEntries(Object.entries(vars).filter(([k]) => !(k in builds)));
	const template = fill(lookup(key, vars), fillVars);
	const pending = new Set(Object.keys(builds));
	let text = "";
	let last = 0;
	const flush = () => {
		if (text) el.createSpan({ text, cls: textCls });
		text = "";
	};
	for (const m of template.matchAll(/\{(\w+)\}/g)) {
		const name = m[1] ?? "";
		const build = builds[name];
		text += template.slice(last, m.index);
		last = m.index + m[0].length;
		if (!build || !pending.has(name)) {
			text += m[0];
			continue;
		}
		flush();
		build(el);
		pending.delete(name);
	}
	text += template.slice(last);
	flush();
	// A translation that lost a placeholder still has to show the value.
	// Skipping `build` here would silently delete the data the sentence is
	// about: the version number, the link, or the literal word the user is
	// being told to type. Appending reads oddly; dropping it is a bug.
	for (const name of pending) builds[name]?.(el);
}

/**
 * Translate `key` into the app's language.
 *
 * `key` is the English sentence, with `{name}` where a value goes. Pass a
 * numeric `count` for any string whose wording depends on quantity.
 */
export function t(key: string, vars?: Vars): string {
	return fill(lookup(key, vars), vars);
}

/** The translated, unfilled template for `key`, plural form chosen by `vars.count`. */
function lookup(key: string, vars?: Vars): string {
	const code = currentLocale();
	const entry = dictFor(code)?.[key] ?? enPlurals[key];
	if (typeof entry === "string") return entry;
	if (entry) return pickPlural(entry, code, vars) ?? key;
	return key;
}
