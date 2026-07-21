# Context Doc: Obsidian Community Scanner Type Resolution

_Last verified: 2026-07-21_

## Status
**Cause fixed, scorecard unconfirmed** (PR #262). Every tracked lockfile now
resolves from public registries. `package-lock.json` is **not** tracked. Whether the
public scorecard actually clears still needs a preview scan (see
[Remaining Uncertainty](#remaining-uncertainty)).

## What This Is
Why the public plugin listing's quality scorecard showed ~3000 bogus
`@typescript-eslint/no-unsafe-*` findings against plain Obsidian API calls, how to
prove it in one command, and the real root cause: one line in `~/.npmrc` that
poisoned every lockfile we have ever committed.

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

### The proximate mechanism
The rule text is the tell: "of an **error** or any typed value". TypeScript assigns a
distinct *error type* when a module fails to resolve, and `no-unsafe-*` fires on it
exactly as it does on `any`.

The scanner installs in its own sandbox. When that install fails, there is no
`obsidian` package, the `obsidian` import never resolves, and every value coming out
of the Obsidian API becomes the error type. Every `.foo` on it, every call, every
assignment, is a finding.

It was never a code-quality problem and no eslint config change could have fixed it.

### Why the install failed
One line in `~/.npmrc` on our dev machines and self-hosted CI runners:

```
registry=http://10.0.20.214:4873
```

That is the LAN Verdaccio proxy. Both npm and bun bake the configured host into
every tarball URL they **resolve**, and that URL is written into the lockfile. npm's
docs state it plainly:

> if you create a lock file while using a custom registry packages will be installed
> from that registry even after you change to another registry

(https://docs.npmjs.com/cli/v11/using-npm/registry)

So every lockfile we have ever committed pinned all 473 packages to an RFC1918
address. It installs perfectly for us and is unusable for everyone else: the
scanner's sandbox, and any outside contributor. **This repo is public.**

## Why the 2026-05 Attempt Failed
PR #125 committed a `package-lock.json` specifically to fix the scorecard, saw no
change, concluded "the audit ignores `package-lock.json`", then deleted the file and
re-gitignored it.

That lockfile had **466 of 466** tarballs on `10.0.20.214:4873`. npm could not fetch a
single one. The experiment was sound; the artifact under test was silently invalid.

The lesson worth keeping: a negative result from an invalid input is worse than no
result. It gets written into a commit message as settled fact and closes off the
correct hypothesis. It cost two months here.

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
1. Removed the global `registry=` line from `~/.npmrc`.
2. Regenerated `bun.lock` with **no** registry configured.

With nothing configured, bun writes no tarball URL at all. Entries carry an empty
registry field:

```
"@babel/code-frame": ["@babel/code-frame@7.29.7", "", { ... }, "sha512-Aup7aU..."],
```

Consumers resolve from whatever registry *they* configure. That is what portable
looks like.

`package-lock.json` is **not** tracked. bun remains the only install path here.

## Measured bun Behaviour
All measured on bun 1.3.11. These are the durable gotchas.

| situation | behaviour |
|---|---|
| URL-less lock + custom registry configured | fetches **through** that registry, does not rewrite the lockfile |
| URL-baked lock + dead-port registry | installs fine |

The second row is the nasty one: bun honours the URL baked into the lockfile over
`.npmrc`, `bunfig.toml`, the environment **and** the `--registry` flag. A poisoned
lockfile cannot be fixed by configuration. It has to be deleted and regenerated.

The first row is what keeps the Verdaccio cache usable: a frozen install with an
explicit `--registry` still hits the proxy and cannot write the host back, because
frozen installs never re-resolve. (The engram backend's `verify.yml` already passes
that flag; those flags were no-ops until the lockfiles became portable.)

Two more:

- **`bun add <pkg>` rewrites EVERY entry in the lockfile** to the configured
  registry, not just the new package. Poisoning cannot be contained to install time,
  which is why the global `registry=` line had to go rather than be scoped.
- **bun has no `replace-registry-host` equivalent.** npm does (default `npmjs`),
  which is why npm-only shops do not hit this as hard. Upstream:
  oven-sh/bun#18411 (open, "don't save registry prefix in bun.lock", cites pnpm and
  yarn berry as the reference design) and oven-sh/bun#16543.

### If anyone re-adds an npm lockfile
Generating one in a directory that already has `node_modules` makes npm reconcile
against the tree on disk instead of the registry. Measured result: `resolved` /
`integrity` on **3 of 473** entries, which is useless to any consumer. Generate it in
a scratch directory holding only `package.json`.

## The Guard
`scripts/check-lockfile-registry.mjs` greps `bun.lock` and `package-lock.json` (the
latter only if present) for RFC1918 and loopback hosts, and fails with the `sed`
rewrite command.

Wired into `.github/workflows/lint.yml` (job `lockfile registry`), lefthook
pre-commit, and `bun run lint:lockfile`.

`lockfile-lint` is the industry-standard answer to exactly this and would have been
the lazy choice, but it supports only `package-lock.json` and `yarn.lock`, **not**
`bun.lock`. Hence the hand-rolled grep.

## Blast Radius
The `~/.npmrc` line was global, so this was never one repo:

| repo | poisoned URLs | status |
|---|---|---|
| `engram-app/Engram-obsidian` (this repo, public) | 481 | fixed, PR #262 |
| `engram-app/engram` `frontend/bun.lock` (public) | 1629 | fixed, PR #1048 |
| `engram-marketing` (private) | 1060 | fixed |
| `Rasbandit/homelab` CI runners | n/a | homelab#12 stops writing the global override |

`engram-marketing` also carried a legacy `bun.lockb`, which bun silently prefers over
`bun.lock`. That is how its poisoned text lockfile went unnoticed.

## Dependabot Coupling
`dependabot-lockfile-fix.yml` regenerates `bun.lock` on Dependabot PRs and is
**TF-managed in engram-infra** (`main/github/dependabot_lockfile_fix.tf` +
`files/dependabot-lockfile-fix.yml.tftpl`). Do NOT edit it in this repo. It runs
`bun install` on a self-hosted runner, so it re-poisons the lockfile unless the
runner has no global registry override (homelab#12). The `lockfile registry` job
catches it if that regresses.

## Remaining Uncertainty
State this honestly rather than assuming the fix landed:

- **The scorecard is not confirmed fixed.** Verifying needs a preview scan from the
  Obsidian developer dashboard, which is authenticated UI.
- **It is still unconfirmed whether the scanner installs with npm or bun.** If npm, a
  portable `package-lock.json` may still be needed. The guard already covers that
  case, so adding one is a one-commit change.

## Comparison Points
- `obsidian-excalidraw-plugin` and `obsidianmd/obsidian-sample-plugin` both commit
  `package-lock.json`. The sample plugin's AGENTS.md states "Package manager: npm
  (required)". That is the main evidence for the npm hypothesis above.
- Excalidraw is on `eslint-plugin-obsidianmd` `^0.4.0`; we are on `^0.3.0`.
  Open follow-up: 0.4.0 realigned rule severities to match the scanner and adds
  `eslint-comments/*` rules that forbid disabling obsidianmd rules inline.

## References
- `bun.lock`, `scripts/check-lockfile-registry.mjs`, `.gitignore`
- `.github/workflows/lint.yml` (`lockfile registry`), `lefthook.yml`
- `docs/context/obsidian-community-submission.md`: the 2026-05 investigation that
  first suspected the lockfile (via a peer-dep theory) but tested a poisoned artifact
- engram-app/Engram-obsidian#262 (fix), #125 (the 2026-05 false negative),
  engram-app/engram#1048, Rasbandit/homelab#12
- https://docs.npmjs.com/cli/v11/using-npm/registry: the documented pinning behaviour
- https://github.com/oven-sh/bun/issues/18411: bun should not save the registry prefix
- https://github.com/obsidianmd/eslint-plugin: scanner's rule source, PR #173
