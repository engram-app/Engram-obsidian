# Obsidian community scanner: bogus `no-unsafe-*` findings and the poisoned lockfile

_Last verified: 2026-10-03_

## Status

Cause fixed (PR #262): every tracked lockfile resolves from public registries and `package-lock.json` is not tracked. Whether the public scorecard actually cleared was never confirmed (it needs a preview scan from the authenticated Obsidian developer dashboard), and it is unknown whether the scanner installs with npm or bun. If it is npm a portable `package-lock.json` may still be needed; the guard below already covers that file, so adding one is a one-commit change.

## Symptom

The public listing's scorecard reported ~3000 `@typescript-eslint/no-unsafe-call|member-access|assignment` findings on lines that cannot be unsafe (`super(app)`, `contentEl.empty()`), while local `bun run lint:obsidian` was clean.

## Root cause

The rule text is the tell ("an **error** or any typed value"): TypeScript assigns a distinct *error type* when a module fails to resolve, and `no-unsafe-*` fires on it like on `any`. The scanner installs in its own sandbox; when that install fails there is no `obsidian` package and every API value becomes the error type. No eslint config change could fix it.

Why the install failed: `registry=http://10.0.20.214:4873` (the LAN Verdaccio proxy) in `~/.npmrc` on dev machines and self-hosted CI runners. npm and bun bake the configured host into every tarball URL they RESOLVE and write it into the lockfile, so every committed lockfile pinned all packages to an RFC1918 address: fine for us, unusable for the scanner and any outside contributor (this repo is public). The 2026-05 attempt (PR #125) committed a `package-lock.json` with 466 of 466 tarballs on that host, saw no change, and concluded "the audit ignores package-lock.json". A negative result from an invalid input is worse than no result: it closed off the correct hypothesis for two months.

## Diagnostic (reusable)

Simulate the broken sandbox by hiding the types and re-running the lint:

```bash
trap 'mv node_modules/.obsidian-hidden node_modules/obsidian 2>/dev/null' EXIT
mv node_modules/obsidian node_modules/.obsidian-hidden
bun run lint:obsidian
```

Types present: 0 findings. Hidden: 3148, all in the `no-unsafe-*` family with zero other rules changing. That single-rule-family signature identifies an unresolved-module problem rather than real unsafe code.

## The scanner

Closed source, launched 2026-05-12 with community.obsidian.md; not the `obsidianmd/obsidian-releases` bot. It wraps `eslint-plugin-obsidianmd`'s `configs.recommended` (which extends `tseslint.configs.recommendedTypeChecked`, source of `no-unsafe-*`) and runs its OWN config chain, so local rule disables never reach it. Feedback channel: `#plugin-dev` on Obsidian's Discord.

## The fix and bun behaviour (bun 1.3.11)

Remove the global `registry=` line from `~/.npmrc`, regenerate `bun.lock` with NO registry configured. Entries then carry an empty registry field and consumers resolve from whatever registry they configure.

| situation | behaviour |
|---|---|
| URL-less lock + custom registry configured | fetches through that registry, does not rewrite the lockfile |
| URL-baked lock + dead-port registry | installs fine |

- bun honours the URL baked into the lockfile over `.npmrc`, `bunfig.toml`, the environment AND `--registry`: a poisoned lockfile cannot be fixed by configuration, only deleted and regenerated.
- `bun add <pkg>` rewrites EVERY lockfile entry to the configured registry, so the poison cannot be contained to install time; the global line had to go rather than be scoped. A frozen install with an explicit `--registry` still hits the proxy and cannot write the host back.
- bun has no `replace-registry-host` equivalent (npm does). Upstream: oven-sh/bun#18411, #16543.
- If an npm lockfile is ever re-added, generate it in a scratch directory holding only `package.json`; in a directory with `node_modules` npm reconciles against the tree on disk and leaves `resolved`/`integrity` on almost nothing.

## The guard

`scripts/check-lockfile-registry.mjs` greps `bun.lock` and `package-lock.json` (if present) for RFC1918 and loopback hosts and fails with the `sed` rewrite command. Wired into `.github/workflows/lint.yml` (job `lockfile registry`), lefthook pre-commit (`lockfile-registry`) and `bun run lint:lockfile`. `lockfile-lint` was the lazy choice but does not support `bun.lock`.

## Blast radius and Dependabot

The `~/.npmrc` line was global: the same poison hit `engram-app/engram` `frontend/bun.lock` (PR #1048) and `engram-marketing` (which also carried a legacy `bun.lockb` that bun silently prefers over `bun.lock`, hiding it). Any workflow that runs `bun install` on a self-hosted runner (including lockfile regeneration on Dependabot PRs) re-poisons the lockfile unless the runner has no global registry override (Rasbandit/homelab#12); the `lockfile registry` job catches a regression.
