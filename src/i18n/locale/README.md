# Translations

The plugin UI follows Obsidian's own language setting, read via `getLanguage()`.

## Adding a language

1. Find your language's code in [Obsidian's translations repo](https://github.com/obsidianmd/obsidian-translations/tree/master/translations). Use that code exactly, so `zh` for Simplified Chinese and `zh-TW` for Traditional. There is no `zh-CN`.
2. Copy an existing file to `<code>.ts` and translate the values. Leave the keys untouched: the key is the English string and is what the code looks up.
3. Register it in the `LOCALES` map in `../index.ts`.
4. Run `bun test tests/i18n-keys.test.ts`. It fails if a key does not match a real call site, which is how a typo or a stale copy gets caught.

A regional code falls back to its base language, so `en-GB` reaches `en` and `pt-BR` reaches `pt`. You only need a regional file when the wording genuinely differs.

## Partial translations are fine

Any key you leave out falls through to the English sentence, because the key *is* the English sentence. There is no `en.ts` to maintain. Translate what you are sure of and leave the rest.

## Strings that change with a count

Give a form per [CLDR plural category](https://cldr.unicode.org/index/cldr-spec/plural-rules) instead of a single string:

```ts
"Engram Sync: pushed {count} files": {
  one: "Engram Sync: {count} Datei gesendet",
  other: "Engram Sync: {count} Dateien gesendet",
},
```

`Intl.PluralRules` picks the category for your locale, so Russian gets `one`/`few`/`many` and Chinese, Japanese and Korean need only the single plain string. `other` is the fallback within a locale. English singulars live in `en-plurals.ts`, since the key itself is the plural.

## What not to translate

Leave "Engram" alone, and leave the names of UI surfaces that are still English, such as "Sync Center" and "Engram settings". A translated label the user cannot find on screen is worse than an English one.
