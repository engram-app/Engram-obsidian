// The plugin's translategemma profile: languages, register, glossary and brand
// names. The pipeline itself is the shared core in ./core (see core/README.md).
import type { Dict, PluralForms } from ".";
import { type Profile, type Spec, translator } from "./core/core";

const HAN = /\p{Script=Han}/u;

// Keyed by Obsidian's own locale codes (`getLanguage()`): `pt` is Portugal, `pt-BR` Brazil, `zh` Simplified.
// `native` is each catalog file's header comment, in the language itself.
const SPECS = {
	de: {
		name: "German",
		native: "Deutsch",
		tone: "Address the user informally (du, dein), never Sie.",
		formal: /\b(?:Ihr(?:e[nmrs]?)?|Ihnen)\b|[\p{Ll},] Sie\b/u,
	},
	es: {
		name: "Spanish",
		native: "Español",
		tone: "Address the user informally (tú), never usted. Use neutral Spanish understood in Latin America and Spain.",
		formal: /\busted(?:es)?\b/iu,
	},
	fr: {
		name: "French",
		native: "Français",
		tone: "Address the user informally (tu, ton), never vous.",
		formal: /\b(?:vous|votre|vos)\b/iu,
	},
	id: {
		name: "Indonesian",
		native: "Bahasa Indonesia",
		tone: "Address the user as Anda, never kamu.",
		formal: /(?:^|[^\p{L}])(?:kamu|kau|engkau|dikau)(?![\p{L}])/iu,
	},
	it: {
		name: "Italian",
		native: "Italiano",
		tone: "Address the user informally (tu, tuo), never Lei.",
		formal: /\b(?:Lei|Suo|Sua|Suoi|Sue)\b/u,
	},
	ja: {
		name: "Japanese",
		native: "日本語",
		tone: "Use polite, concise UI Japanese.",
		script: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
		spaceless: true,
	},
	ko: {
		name: "Korean",
		native: "한국어",
		tone: "Use polite, concise UI Korean.",
		script: /\p{Script=Hangul}/u,
	},
	ms: { name: "Malay", native: "Bahasa Melayu", tone: "Address the user as anda." },
	pl: {
		name: "Polish",
		native: "Polski",
		tone: "Address the user informally (ty, twój), never Pan or Pani.",
		// \b is ASCII-only even with u: letter guards as ru (no lookbehind: Obsidian lint), every case form.
		formal: /(?:^|[^\p{L}])(?:pan|pani|pana|panu|panem|panie|panią|państwo|państwa|państwu|państwem|pańsk\p{L}*)(?![\p{L}])/iu,
	},
	pt: {
		name: "European Portuguese",
		native: "Português (Portugal)",
		tone: "Write European Portuguese as used in Portugal (ficheiro, guardar, definições, ecrã), never Brazilian forms. Address the user formally in the third person (Escolha, Guarde), never tu.",
		formal: /\b(?:tu|teu|tua|teus|tuas)\b/iu,
	},
	"pt-BR": {
		name: "Brazilian Portuguese",
		native: "Português (do Brasil)",
		tone: "Address the user as você.",
	},
	ru: {
		name: "Russian",
		native: "Русский",
		tone: "Address the user formally (вы, ваш), never ты.",
		formal: /(?:^|[^\p{L}])(?:ты|твой|твоя|твоё|твои|тебя|тебе)(?![\p{L}])/iu,
		script: /\p{Script=Cyrillic}/u,
	},
	tr: {
		name: "Turkish",
		native: "Türkçe",
		// Naming the pronouns made gemma paste "{siz}" in as a placeholder (web app, 2026-10-16).
		tone: "Use polite, concise UI Turkish.",
		formal: /(?:^|[^\p{L}])(?:sen|senin|sana|seni|sende|senden|seninle)(?![\p{L}])/iu,
	},
	vi: { name: "Vietnamese", native: "Tiếng Việt", tone: "Address the user as bạn." },
	zh: {
		name: "Simplified Chinese",
		native: "简体中文",
		tone: "Use concise Simplified Chinese UI wording.",
		script: HAN,
		spaceless: true,
	},
	"zh-TW": {
		name: "Traditional Chinese",
		native: "繁體中文",
		tone: "Use concise Traditional Chinese (Taiwan) UI wording.",
		script: HAN,
		spaceless: true,
	},
} satisfies Record<string, Spec & { native: string }>;

// Terms held fixed across every batch so "vault" is not three different words.
const GLOSSARY_KEYS = [
	"Vault",
	"Sync",
	"Sync now",
	"Attachments",
	"notes",
	"🔄 Sync Center",
	"Open sync center",
	"Ignore patterns",
	"Semantic search",
	"Reconnect your account to resume syncing.",
];
// Hand overrides where the model's answer meant something else ("Dismiss" as
// Cancel, or as the same word as Ignore beside it). Each value is Obsidian's own
// translation or the "Close" most locales use. A pinned value must still pass the
// catalog gate, or it sits in state.failed until the stuck limit fails the run.
const PINNED: Partial<Record<Target, readonly string[]>> = {
	de: ["Dismiss"],
	fr: ["Uploading"],
	// The model gave "Abaikan", the same word as Ignore beside it.
	id: ["Dismiss"],
	it: ["Dismiss"],
	ko: ["Back"],
	// Dismiss sits next to Ignore in the Sync Center (tests/i18n-distinct-pairs.test.ts).
	pt: ["Dismiss", "files"],
	"pt-BR": ["Dismiss", "Upgrade"],
	vi: ["Dismiss"],
	zh: ["Dismiss"],
};
// "Engram Vault Sync" (the plugin's name) must survive whole. The "Engram Sync:" notice
// prefix is not a name: the CJK catalogs translate its "Sync" on purpose.
const BRANDS = [
	"Engram Vault Sync",
	"Engram",
	"Obsidian",
	"MCP",
	"Paddle",
	"Clerk",
	"GitHub",
	"Claude",
	"ChatGPT",
	// Plan names: must match checkout and invoices. "Free" is translated.
	"Starter",
	"Pro",
];
// What a bare or terse string means where it shows. Sent with that string only;
// changing one redoes it in every locale.
const DESCRIPTIONS: Record<string, string> = {
	"{count} retrying": "Sync Center badge: how many files are being retried after an error.",
	"{count} need attention": "Sync Center badge: how many files need the user to act.",
	"{count} missing on server":
		"Sync Center badge: how many files exist locally but not on the server.",
	"Temporary errors. These clear themselves once the server recovers.":
		"Recovers means the server starts working normally again.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"The settings file broke while saving, and the plugin restored it from a backup copy.",
	"This sync adds {count} notes.":
		"Over-limit warning: how many notes this sync would upload. First of two sentences.",
	"Your plan has room for {count}.":
		"Over-limit warning: {count} is how many more notes the user's subscription plan can hold. Follows 'This sync adds N notes.'",
	"I understand {count} notes will not sync.":
		"{count} is a number of notes that will be left out of syncing. Nothing here is about versions.",
	"{count} new":
		"Folder picker: how many of the folder's notes are new, that is not yet uploaded. Follows a count of notes.",
};
const profile: Profile<Target> = {
	subject:
		"the Engram Obsidian plugin, which syncs an Obsidian vault with Engram, a notes app that exposes it to AI assistants",
	specs: SPECS,
	brands: BRANDS,
	glossary: GLOSSARY_KEYS,
	pinned: PINNED,
	descriptions: DESCRIPTIONS,
};

const tr = translator(profile);

// TRANSLATOR_VERSION before the fingerprint replaced it (core upgradeState).
const LEGACY_VERSION = 3;

// The catalogs store a single-form plural (ja, ko, zh) as a plain string.
function collapsePlural(value: string | PluralForms): string | PluralForms {
	return typeof value === "object" && Object.keys(value).length === 1 && value.other !== undefined
		? value.other
		: value;
}

// Code-unit order. Catalogs and state.json are written sorted, not in source
// order: source order depends on which file a key is first seen in (and on
// readdir order), so every run reshuffled every catalog (Engram-obsidian#584).
function compareKeys(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

// JSON with every object's keys sorted (state.json).
function sortedJson(value: unknown): string {
	return JSON.stringify(
		value,
		(_k, v: unknown) =>
			v && typeof v === "object" && !Array.isArray(v)
				? Object.fromEntries(Object.entries(v).sort(([a], [b]) => compareKeys(a, b)))
				: v,
		"\t",
	);
}

// The catalog file shape (`const zhTW: Dict = {...}; export default zhTW;`).
function renderCatalog(code: Target, catalog: Dict): string {
	const ident = code.replace(/-(?<c>\w)/gu, (_m, c: string) => c.toUpperCase());
	const body = Object.entries(catalog)
		.sort(([a], [b]) => compareKeys(a, b))
		.map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(collapsePlural(v))},\n`)
		.join("");
	return `import type { Dict } from "..";\n\n// ${SPECS[code].native}\nconst ${ident}: Dict = {\n${body}};\n\nexport default ${ident};\n`;
}

type Target = keyof typeof SPECS;

export type { Target };
export { compareKeys, LEGACY_VERSION, profile, renderCatalog, sortedJson, tr };
