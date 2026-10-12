// The plugin's translategemma profile: languages, register, glossary and brand
// names. The pipeline itself is the shared core in ./core (see core/README.md).
import type { Dict, PluralForms } from ".";
import { type Profile, type Spec, translator } from "./core/core";

const HAN = /\p{Script=Han}/u;

// Keyed by Obsidian's own locale codes (`getLanguage()`): `pt` is Brazilian, `zh` Simplified.
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
	pt: {
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
// Hand overrides, each copied from Obsidian's own translation of the same
// string, where the model's answer meant something else ("Dismiss" as Cancel).
const PINNED: Partial<Record<Target, readonly string[]>> = {
	de: ["Dismiss"],
	fr: ["Uploading"],
	it: ["Dismiss"],
	ko: ["Back"],
	pt: ["Dismiss"],
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
const profile: Profile<Target> = {
	subject:
		"the Engram Obsidian plugin, which syncs an Obsidian vault with Engram, a notes app that exposes it to AI assistants",
	specs: SPECS,
	brands: BRANDS,
	glossary: GLOSSARY_KEYS,
	pinned: PINNED,
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

// The catalog file shape (`const zhTW: Dict = {...}; export default zhTW;`).
function renderCatalog(code: Target, catalog: Dict): string {
	const ident = code.replace(/-(?<c>\w)/gu, (_m, c: string) => c.toUpperCase());
	const body = Object.entries(catalog)
		.map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(collapsePlural(v))},\n`)
		.join("");
	return `import type { Dict } from "..";\n\n// ${SPECS[code].native}\nconst ${ident}: Dict = {\n${body}};\n\nexport default ${ident};\n`;
}

type Target = keyof typeof SPECS;

export type { Target };
export { LEGACY_VERSION, profile, renderCatalog, tr };
