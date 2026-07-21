# Context Doc: Obsidian Community Scanner Type Resolution

_Last verified: 2026-07-21_

## Status
**Fixed** (PR #262). `package-lock.json` is tracked; a clean-checkout `npm ci` + eslint run reports 0 findings and 0 advisories.

## What This Is
Why the public plugin listing's quality scorecard showed ~3000 bogus
`@typescript-eslint/no-unsafe-*` findings against plain Obsidian API calls, how to
prove it in one command, and the lockfile fix plus its drift guard.

## Symptom
The scorecard on the public listing reported:

```
@typescript-eslint/no-unsafe-call          1273
@typescript-eslint/no-unsafe-member-access 1224
@typescript-eslint/no-unsafe-assignment     530
```

pointing at lines that cannot possibly be unsafe. `src/conflict-modal.ts:33` is
literally `super(app)`; `:42-44` are `contentEl.empty()`, `contentEl.addClass()`,
`modalEl.addClass()`. Local `bun run lint:obsidian` was clean the whole time.

## Root Cause
The rule text is the tell: "of an **error** or any typed value". TypeScript assigns a
distinct *error type* when a module fails to resolve, and `no-unsafe-*` fires on it
exactly as it does on `any`.

The scanner installs with npm. This repo was bun-only and gitignored
`package-lock.json`, so the scanner's install produced no `obsidian` package, the
`obsidian` import never resolved, and every value coming out of the Obsidian API
became the error type. Every `.foo` on it, every call, every assignment, was a finding.

It was never a code-quality problem and no eslint config change could have fixed it.

## Diagnostic Method (the reusable part)
Simulate the broken sandbox by hiding the types and re-running the same lint:

```bash
# use a trap so an interrupted run still restores node_modules
trap 'mv node_modules/.obsidian-hidden node_modules/obsidian 2>/dev/null' EXIT
mv node_modules/obsidian node_modules/.obsidian-hidden
bun run lint:obsidian
```

Measured on this repo:

| | findings |
|---|---|
| types present | 0 |
| `obsidian` hidden | 3148 |

The 3148 broke down as 1138 `no-unsafe-call`, 1107 `no-unsafe-member-access`,
475 `no-unsafe-assignment`, 391 `no-unsafe-argument`, 37 `no-unsafe-return`.
**Zero other rules changed count.** That single-rule-family signature is what
identifies an unresolved-module problem as opposed to real unsafe code.

## The Scanner Itself
- Closed source. Internally called "the community scanner". Launched 2026-05-12
  alongside community.obsidian.md. It is **not** the `obsidianmd/obsidian-releases` bot.
- It wraps `eslint-plugin-obsidianmd`'s `configs.recommended` (repo:
  `obsidianmd/eslint-plugin`), applies a `toWarns()` pass, then re-escalates about 13
  rules back to error. See obsidianmd/eslint-plugin PR #173.
- The `no-unsafe-*` rules are not obsidianmd rules at all. They arrive via
  `tseslint.configs.recommendedTypeChecked`, which that config extends.
- It runs its **own config chain**, not our `eslint.config.mts`. Local rule disables
  never reach it.
- Someone else hit the identical failure and wrote it up:
  https://forum.obsidian.md/t/plugin-audit-reports-spurious-type-errors-because-it-doesnt-resolve-obsidian-types/115198
  Unlisted by Obsidian staff on 2026-06-15, never answered.
- The only feedback channel is the `#plugin-dev` Discord.

## The Fix
Track `package-lock.json`.

bun stays the install path for dev and CI. Nothing in this repo runs `npm ci`. The
lockfile exists purely as a published artifact so the scanner's npm install resolves
the same tree we build against.

Verified: clean checkout with no `node_modules`, then `npm ci`, then
`npx eslint --max-warnings 0 'src/**/*.ts'` gives 0 findings and 0 advisories.

## Gotchas

### Generating the lockfile in-repo silently produces a broken one
Running `npm install --package-lock-only` inside the repo makes npm reconcile against
bun's existing `node_modules` instead of the registry. The result was a 141KB lockfile
with `resolved`/`integrity` on **3 of 473** entries, which is useless to the scanner.

Generate it in a scratch directory holding only `package.json`. That yields the correct
243KB / 473-entry lockfile. The exact command is printed in the failure output of
`scripts/check-npm-lockfile.mjs`:

```bash
rm -rf /tmp/lockgen && mkdir -p /tmp/lockgen \
  && cp package.json /tmp/lockgen/ \
  && (cd /tmp/lockgen && npm install --package-lock-only --ignore-scripts) \
  && cp /tmp/lockgen/package-lock.json .
```

### npm has no drift oracle
Measured on npm 10.9.7 against a `package.json` whose `yaml: ^2.9.0` did not satisfy
the locked `2.8.3`:

| command | behavior |
|---|---|
| `npm ci` | installed a mismatched tree, exit 0 |
| `npm ci --dry-run` | exit 0 |
| `npm ls --package-lock-only` | silently re-resolved from the registry, exit 0 |

Nothing npm ships fails on a drifted lockfile. That is why
`scripts/check-npm-lockfile.mjs` is a hand-written structural check.

### Regenerate-and-diff is the wrong guard here
Our ranges float (`^`), so a regeneration picks up newly published patch versions and
the check would go red on unrelated PRs. The guard has to be structural.

## What the Guard Checks
`scripts/check-npm-lockfile.mjs`:
1. The lockfile root `packages[""].dependencies` / `devDependencies` deep-equal
   `package.json`'s.
2. Every `overrides` pin resolves to a satisfying version in the tree.

Check 2 cannot be structural because npm records `overrides` **nowhere** in the
lockfile (verified by grep) even though it does apply them. `brace-expansion` 1.1.16,
`js-yaml` 4.3.0 and `picomatch` 2.3.2 are correctly pinned in the tree with no trace of
the override that put them there.

Wired into `.github/workflows/lint.yml` (`npm-lockfile-sync` job), lefthook pre-commit,
and `bun run lint:lockfile`.

## Dependabot Coupling
Dependabot updates neither lockfile. `dependabot-lockfile-fix.yml` is **TF-managed in
engram-infra** (`main/github/dependabot_lockfile_fix.tf` +
`files/dependabot-lockfile-fix.yml.tftpl`) and must NOT be edited in this repo.
engram-infra PR #868 adds a per-repo `npm_lock` flag so it regenerates both lockfiles.
**Merge the infra PR first.**

## Comparison Points
- `obsidian-excalidraw-plugin` and `obsidianmd/obsidian-sample-plugin` both commit
  `package-lock.json`. The sample plugin's AGENTS.md states "Package manager: npm
  (required)".
- Excalidraw is on `eslint-plugin-obsidianmd` `^0.4.0`; we are on `^0.3.0`.
  Open follow-up: 0.4.0 realigned rule severities to match the scanner and adds
  `eslint-comments/*` rules that forbid disabling obsidianmd rules inline.

## References
- `package-lock.json`, `scripts/check-npm-lockfile.mjs`, `.gitignore`
- `.github/workflows/lint.yml` (`npm-lockfile-sync`), `lefthook.yml`
- `docs/context/obsidian-community-submission.md`: the 2026-05 investigation that first
  suspected the lockfile (via a peer-dep theory) but never confirmed the mechanism
- engram-app/Engram-obsidian#262 (fix), engram-app/engram-infra#868 (Dependabot flag)
- https://github.com/obsidianmd/eslint-plugin: scanner's rule source, PR #173
