# AGENTS.md

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

Obsidian plugin "Engram Vault Sync" (plugin id `engram-vault-sync`), the sync client half of Engram. Repo `engram-app/Engram-obsidian`; backend is `engram-app/engram`. Cross-repo work (API changes, plugin-to-backend debugging, deploys) happens in the `engram-workspace` repo (`docs/workspace-pattern.md` there).

## What it does

Watches vault events, pushes markdown and canvas as CRDT ops over the socket (`crdt_create` for new notes) and attachments via `/api/attachments`, pulls via socket catch-up (`catchupViaSocket`) plus `GET /api/sync/manifest`, writes remote changes to disk, and hosts settings, Sync Center and the search UI (`POST /api/search`). It does NOT parse or chunk markdown, embed, talk to Qdrant, index, or manage users: the backend does.

## Layout and docs

- `src/` plugin source (`src/crdt/` CRDT layer, `src/i18n/` translations), `tests/` Bun unit tests (`tests/sim/` convergence sim), `scripts/` repo tooling, `wasm/` shared Rust core build.
- `docs/internals.md`: source map, CRDT layer, sync flows, file types, time units. Read before touching sync.
- `DEV.md`: toolchain, testing, local vault deploy, release workflows, settings, commands.
- `docs/engram-ops.md`: CDP / Obsidian remote debugging.
- `docs/context/INDEX.md`: one line per gotcha doc ("symptom -> doc"). Check it before debugging sync, CRDT, release or scanner issues.
- Issues and TODOs live in GitHub Issues (`gh issue list`), never in markdown files (CI forbids `TODO*.md` and root-level checkbox lists).

## Commands

Use `bun`, never `npm`.

```bash
bun install
bun test tests/<file>.test.ts   # targeted; full suite runs in CI
bun run build                   # tsc check + esbuild -> main.js
bun run dev                     # watch mode
```

These run only in CI, so run the relevant ones before pushing: `./node_modules/.bin/biome ci` (not `check`, not `bunx biome`: wrong version), `bun run lint:obsidian`, `bun run lint:css` (stylelint, pre-commit skips it), `bun run build`.

## Hard rules

**Git.** Everything goes through a PR, docs included. `main` is protected by the `protect-main` ruleset: squash merge only, signed commits required, required check `build-and-test` (branch must be up to date), review threads resolved. `lint`, `version-check` and backend e2e also run; do not merge on red. Conventional Commits, subject 50 chars or less. Worktrees: `git worktree add <path> -b <branch> origin/main`; a lefthook `post-checkout` hook hardlinks `node_modules`, so no `bun install` unless you edit `bun.lock`.

**Tests are the spec.** A failing test means fix the app, not the test. UI-heavy files (`settings.ts`, `search-modal.ts`, `search-view.ts`, `main.ts`) are covered by the backend repo's Obsidian e2e suite; removing a UI selector can break that suite, so grep the backend `e2e/tests/` first.

**Releases.** release-please owns versions. Never bump `manifest.json`, `package.json` or `versions.json` in a feature PR, and never run `version-bump.mjs` directly (`docs/context/version-bump-script.md`). Stable release = merge the release-please PR; tags are bare `x.y.z` (no `v`) for BRAT/Obsidian. Details in `DEV.md` "Release process".

**Lockfile.** `bun.lock` must stay portable: never regenerate it with a `registry=` in `~/.npmrc`, or the private host is baked in and outside contributors plus the Obsidian community scanner break. `scripts/check-lockfile-registry.mjs` enforces it (`docs/context/scanner-type-resolution.md`).

**Obsidian API.** `vault.modify()` resets mtime to now, so never decide "already applied" from mtime (`docs/context/obsidian-mtime-quirk.md`). `file.stat.mtime` is ms, API `mtime` is seconds. A failed `requestUrl` with default `throw: true` drops the error body (`docs/context/requesturl-error-body-dropped.md`).

**Sync safety.** Sync bugs lose user notes. Before changing delete, rename, first sync, flush-to-disk, the load gate, or any `SyncEngine` / `SyncStore` state, read the matching doc in `docs/context/INDEX.md`. Recurring traps: a new `Map`/`Set` on `SyncEngine` must join the sweep registry; every local "hide" set needs a clearing event; a 0-byte file is not "nothing to protect"; disk writes from a CRDT doc must use the projected text (frontmatter included); flush functions must not return `true` when nothing was written.

**Docs style.** No em or en dashes in `README.md`, `DEV.md`, `docs/user-guide.md` (CI and pre-commit enforce). No stale domains, pricing or org names in agent docs (`lint.yml` staleness job).

**Translations.** Never hand-write or self-translate catalog strings in `src/i18n/locale/`. They come from the `translategemma` pipeline (`bun run i18n:translate`) or the `i18n-translate.yml` bot PR after merge. `src/i18n/core/` is vendored from the backend repo: edit it there, never here. Never suppress the i18n catalog or key tests. Full rules: `src/i18n/locale/README.md`.
