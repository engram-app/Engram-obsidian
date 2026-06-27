# Context Doc: version-bump.mjs (plugin version bumping)

_Last verified: 2026-06-26_

## Status
Working (as designed) — but has a silent-corruption foot-gun if run wrong.

## What This Is
`version-bump.mjs` syncs the plugin version into `manifest.json` and `versions.json`. It is wired as the npm `version` lifecycle script in `package.json`:

```json
"version": "node version-bump.mjs && git add manifest.json versions.json"
```

## Key Commands / Patterns
Bump the version one of these two ways:

1. **Lifecycle (intended):** edit `package.json`'s `version`, then run the `version` lifecycle (`npm version <x.y.z>` / `bun run version`). npm sets `process.env.npm_package_version` from `package.json`, which the script reads.
2. **Manual:** edit `manifest.json` and `versions.json` (and `package.json`) by hand. No script needed.

## Gotchas
- The script reads `const targetVersion = process.env.npm_package_version;`. That env var is **only set by the `npm version` / `bun run version` lifecycle**.
- Running `node version-bump.mjs` **directly** (outside the lifecycle) leaves `targetVersion` **undefined**. The script then does `manifest.version = undefined`, and `JSON.stringify` **drops keys whose value is `undefined`** — so the `"version"` key is silently removed from `manifest.json` entirely, corrupting it with no error.
- Symptom: a `manifest.json` with no `version` field after a "bump". Fix by restoring the version key and re-bumping the correct way.

## References
- `version-bump.mjs` (repo root)
- `package.json` `scripts.version`
- `manifest.json`, `versions.json`
