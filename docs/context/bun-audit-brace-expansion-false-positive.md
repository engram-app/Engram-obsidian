# `bun audit` brace-expansion false-positive

_Last verified: 2026-07-30_

## The Problem

`bun audit` (run in the "Security audit" step of `.github/workflows/ci.yml`, part
of the required `build-and-test` check) started failing on `main` for advisory
**GHSA-mh99-v99m-4gvg** (brace-expansion ReDoS), flagging our already-patched
`brace-expansion@1.1.16`.

Root cause: bun collapses that advisory into a single vulnerable range `<=5.0.7`
and only considers `>=5.0.8` safe. The 1.x line was actually fixed in 1.1.12
(and `1.1.16` ships on the npm `maintenance-v1` tag with that fix), but bun's
over-broad merged range false-flags every 1.x version regardless. Our existing
`"brace-expansion": "^1.1.16"` override was correct for the real advisory but
does not satisfy bun's range check.

## The Fix (plugin PR #324)

Add **both** overrides in `package.json`:

```jsonc
"overrides": {
  "brace-expansion": "^5.0.8",
  "minimatch": "^10.0.1"
}
```

Why both:

- Bumping `brace-expansion` to `^5.0.8` alone breaks eslint. Its transitive
  `minimatch@3` does `require('brace-expansion')` expecting the **bare function**,
  but brace-expansion 5.x's CJS build exports `{ expand }` → `TypeError: expand
  is not a function` in `Minimatch.braceExpand`.
- `minimatch@10` consumes the **named** `{ expand }` export, so bumping it too
  restores compatibility.
- `minimatch` is eslint-toolchain-only (not imported in `src/`), so there is no
  runtime or bundle impact.

Verified: `bun audit` clean, eslint pass, `bun run build` pass, 2224 tests pass.

## Reusable Lesson

When `bun audit` flags a transitive dep that looks already-patched, check whether
bun merged the advisory ranges too broadly (only accepting the latest major as
safe). The fix may require jumping the dep to the newest major **and** bumping
the intermediate consumer (here `minimatch`) to a version compatible with the
new module shape (bare-function export → named `{ expand }` export).

## It recurred in engram-marketing (2026-07-30)

The identical advisory took `engram-marketing`'s nightly `Audit` red for three
nights, reaching it through the same shape of dev-only lint tooling:

```
linkinator  > glob > minimatch > brace-expansion
remark-cli  > unified-args > unified-engine > glob > minimatch > brace-expansion
```

Fixed there with the **same paired override** (`brace-expansion ^5.0.8` +
`minimatch ^10.0.1`) in marketing PR #156. If a third repo trips this, apply the
pair — not `brace-expansion` alone.

That same audit run also flagged **`sharp <0.35.0`**
([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
inherited libvips CVE-2026-33327/33328/35590/35591). Unlike brace-expansion that
one is a **real** vulnerability, not a merged-range artifact — do not assume every
`bun audit` high is a false positive. Check each advisory individually.

Still valid on this repo as of 2026-07-30: after the biome 1→2 / eslint 9→10 bump
(#350) the overrides are unchanged and `bun audit` is clean.

## References

- `package.json` `overrides`
- `.github/workflows/ci.yml` "Security audit" step
- GHSA-mh99-v99m-4gvg (brace-expansion ReDoS)
- plugin PR #324 (`fix/brace-expansion-audit`), rebased dependabot PR #319
