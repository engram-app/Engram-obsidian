# Translations

The plugin UI follows Obsidian's own language setting, read via `getLanguage()`.

## Who translates: translategemma

Every catalog entry comes from `translategemma:12b` on FastRaid's Ollama through `bun run i18n:translate`. Do not hand-translate, and do not translate with another model: the pipeline pins the glossary and each language's register, so hand edits drift and the next full pass overwrites them.

- **Changed or added a string:** wrap it in `t()` or `tInto()`, then run `I18N_OLLAMA_URL=http://10.0.20.214:11434 bun run i18n:translate`. It is diff-only: it translates the keys a catalog lacks (an edited English string is a new key), retries keys that failed last time, drops keys the source no longer uses, and takes minutes. Commit the catalog diff with your change. If Ollama is out of reach, merge anyway: `.github/workflows/i18n-translate.yml` opens a bot PR after merge (English shows until then).
- **A bad translation:** fix the profile in `../translate-profile.ts` (or a check in the shared core, canonical in engram-app/Engram). `state.json` fingerprints the prompt, profile and model digest, so the next run redoes the locale; there is no version to bump.
- **A key the model cannot translate** is listed in `state.json` `failed` with the day it first failed. The tests tolerate it while listed; the script and nightly bot fail once it is stuck past 14 days. Reword the English string or fix the prompt.
- **Gates (no model, every PR):** `tests/i18n-catalog-quality.test.ts` runs the same checks the model's answers must pass (placeholders, brand names, URLs, a label's emoji, length, register, script); `tests/i18n-keys.test.ts` fails on orphans and on a glossary entry that is not a real key. Never weaken them to go green.
- **Registers:** de, es, fr and it address the user informally (du, tú, tu); ru formally (вы); pt as você; vi as bạn; ms as anda.
- **Glossary (`GLOSSARY_KEYS` in `../translate-profile.ts`):** core terms are pinned to each catalog's current value and never sent to the model, even on a redo. Editing a term redoes every sentence that uses it. For a new language, copy them from Obsidian's official translations first, so the words match the app users already know.

## Adding a language

1. Find its code in [Obsidian's translations repo](https://github.com/obsidianmd/obsidian-translations/tree/master/translations). Use that code exactly, so `zh` for Simplified Chinese and `zh-TW` for Traditional. There is no `zh-CN`.
2. Add it to `SPECS` in `../translate-profile.ts` (name, native name, tone; `spaceless: true` for a script without spaces between words).
3. Create `<code>.ts` holding only the glossary terms copied from that repo's `translations/<code>.txt`, and register it in the `LOCALES` map in `../index.ts` and in `tests/i18n-keys.test.ts`.
4. Run `bun run i18n:translate --locale <code>`, then `bun test`.

A regional code falls back to its base language, so `en-GB` reaches `en` and `pt-BR` reaches `pt`. You only need a regional file when the wording genuinely differs.

## A missing key shows English

Any key a catalog lacks falls through to the English sentence, because the key *is* the English sentence. There is no `en.ts` to maintain. That is the state between merging a new string and the bot PR landing.

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

Leave "Engram" alone.

UI surfaces ARE translated, and each locale uses ONE term for a surface everywhere (the settings tab, the command palette entry, notices that point at it, and the docs). A name the user sees on screen must match the name in the notice that tells them to open it, so change a surface name in all of those places at once. `tests/i18n-sync-center.test.ts` guards the Sync Center.

| Locale | "Sync Center" |
|---|---|
| de | Sync-Zentrale |
| es | Centro de sincronización |
| fr | Centre de synchronisation |
| it | Centro di sincronizzazione |
| ja | 同期センター |
| ko | 동기화 센터 |
| ms | Pusat Sync |
| pt | Central de sincronização |
| ru | Центр синхронизации |
| zh | 同步中心 |
| zh-TW | 同步中心 |

The marketing site docs (`engram-marketing`, `src/content/docs/<locale>/`) quote these terms. Update them together.
