# `bun audit` brace-expansion false-positive

_Last verified: 2026-10-03_

`bun audit` (the "Security audit" step in `.github/workflows/ci.yml`, part of the required `build-and-test` check) failed on GHSA-mh99-v99m-4gvg (brace-expansion ReDoS) against the already-patched `brace-expansion@1.1.16`. bun collapses the advisory into one range `<=5.0.7` and treats only `>=5.0.8` as safe, so every 1.x version is flagged although 1.x was fixed in 1.1.12.

## Fix: both overrides, as a pair

In `package.json` `overrides`: `"brace-expansion": "^5.0.x"` AND `"minimatch": "^10.0.1"` (see the current file for the exact brace-expansion range).

- Bumping `brace-expansion` alone breaks eslint: its transitive `minimatch@3` does `require('brace-expansion')` expecting the bare function, but 5.x's CJS build exports `{ expand }` (`TypeError: expand is not a function`).
- `minimatch@10` consumes the named `{ expand }` export. `minimatch` is eslint-toolchain-only (not imported in `src/`), so there is no runtime or bundle impact.

The same pair fixed `engram-marketing` (it hit the identical advisory through dev-only lint tooling). If a third repo trips it, apply the pair, not `brace-expansion` alone.

## Lesson

When `bun audit` flags a transitive dep that looks already patched, check whether bun merged the advisory ranges too broadly, then bump the dep to the newest major AND the intermediate consumer to a version that matches the new module shape. Do not assume every `bun audit` high is a false positive: the same run flagged `sharp <0.35.0` (GHSA-f88m-g3jw-g9cj), which was real. Check each advisory individually.
