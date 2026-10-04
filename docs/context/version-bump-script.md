# `version-bump.mjs` foot-gun

_Last verified: 2026-10-03_

Versions are owned by release-please (see CLAUDE.md "Release Process"); do not bump in feature PRs. If you do touch `manifest.json`/`versions.json` by script: `version-bump.mjs` is wired as the npm `version` lifecycle (`package.json` `scripts.version`) and reads `process.env.npm_package_version`, which only the `npm version` / `bun run version` lifecycle sets.

Running `node version-bump.mjs` directly leaves `targetVersion` undefined, the script assigns `manifest.version = undefined`, and `JSON.stringify` drops undefined keys: the `"version"` key silently disappears from `manifest.json`, with no error. Symptom: a `manifest.json` with no `version` after a "bump". Restore the key and re-bump through the lifecycle (or edit the three files by hand).
