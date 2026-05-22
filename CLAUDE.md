# CLAUDE.md

Obsidian plugin for bidirectional sync with Engram, distributed as "Engram Vault Sync" (plugin id `engram-vault-sync`). One half of the Engram project — backend repo is `engram-app/engram`, plugin repo is `engram-app/Engram-obsidian` (local dir name stayed `engram-obsidian-sync` after rename).

## Life OS
project: engram-obsidian
goal: income
value: financial-freedom

## Issue Tracker

TODOs and open issues live in GitHub Issues for this repo — `gh issue list` to view, `gh issue create` to file. Don't track work in CLAUDE.md, docs/, or ad-hoc TODO.md files.

> **Multi-repo project.** This plugin is one half of Engram. For cross-project work (API changes, debugging plugin↔backend, deploy), open `../engram-workspace/` instead. See `../engram-workspace/docs/workspace-pattern.md` for when to use what.

For plugin internals (class map, sync algorithm, API endpoints, type definitions), read `docs/internals.md`.
For CDP and Obsidian remote debugging (MCP devtools, evaluate_script), read `docs/engram-ops.md`.
For server ops, infrastructure, and deployment, read `../engram-workspace/docs/deployment.md`.
For backend REST API (all endpoints, pipelines, auth, config), read `../engram-workspace/docs/api-contract.md`.
For cross-project debugging workflows, read `../engram-workspace/docs/debugging.md`.
For Obsidian API best practices and correct usage patterns, read `docs/context/obsidian-api-reference.md`.
For audit of API misuses and improvement opportunities, read `docs/context/obsidian-api-audit.md`.
For submitting to the Community Plugins directory (new flow as of 2026-05-12), read `docs/context/obsidian-community-submission.md`.

## What This Plugin Does

A TypeScript sync client. It does NOT parse markdown, generate embeddings, or talk to Qdrant — Engram handles all of that. The plugin just pushes/pulls notes via REST.

### Responsibilities

1. **Watch vault events** — `app.vault.on("create")`, `on("modify")`, `on("delete")`, `on("rename")`
2. **Push changes to Engram** — `POST /api/notes` with file content + metadata
3. **Pull changes from Engram** — `GET /api/notes/changes` on startup and periodically (plus authoritative inventory via `GET /api/sync/manifest`)
4. **Write remote changes to vault** — files created/edited via MCP, the web SPA editor, or other devices
5. **Settings panel + Sync Center** — Engram URL, API key, ignore patterns, conflict resolution, sync preview, push/pull-all flows

### Does NOT

- Parse markdown or chunk text (Engram does this)
- Generate embeddings (Engram does this via Ollama)
- Talk to Qdrant (Engram does this)
- Perform search indexing (Engram does this — plugin provides the search UI via `POST /api/search`)
- Manage auth/users (Engram does this)

## Git Workflow

**Everything goes through a PR. No exceptions, no admin bypass, no "doc-only" shortcuts that stretch into code.**

`main` is protected with `enforce_admins=true`. Required status checks (`build-and-test`, `version-check`, `backend/e2e`) must pass before merge. The release pipeline (`release.yml`) only fires on **PR merge to main** — direct pushes skip it and break the deploy.

Workflow for any change, including doc updates:

1. `git switch -c <type>/<slug>` — `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.
2. Commit on the branch. Conventional Commits, ≤50-char subject.
3. `git push -u origin <branch>` and open a PR with `gh pr create`.
4. Let CI run. If anything fails, fix it on the branch, never on main.
5. Merge through GitHub (`gh pr merge --squash` or the web UI). **Do not push directly to main, even to "fix the test" or "ship a doc tweak".**

The previous "doc-only changes can land on main" carve-out is rescinded — it drifted into code commits and bypassed the test gate that caught the missing README disclosure.

## Testing

**Tests are the spec. If a test fails, fix the app — not the test.**

```bash
bun test              # Run all 313 unit tests
bun test --verbose    # Verbose output
bun test --coverage   # With coverage report (89% funcs, 97% lines)
bun run build         # Build the plugin (production)
```

### Test files (313 tests across 11 files)

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/sync.test.ts` | 134 | SyncEngine: shouldIgnore, handleModify/Delete/Rename, pull, WebSocket events, echo suppression, status tracking, first sync detection, 3-way merge, destroy, sync state export/import, updateSettings, arrayBuffersEqual |
| `tests/api.test.ts` | 47 | All EngramApi methods, base64 utilities, auth headers, URL encoding, error handling, auth provider integration, attachment methods, pushLogs |
| `tests/dev-log.test.ts` | 20 | Ring buffer (log, dump, filter, stats, clear), 500-entry cap, singleton lifecycle (init/destroy), noop logger |
| `tests/diff.test.ts` | 17 | computeDiff, groupIntoHunks, buildMergedContent (line-by-line diff, hunk context, merge choices) |
| `tests/three-way-merge.test.ts` | 15 | 3-way merge via diff-match-patch: clean merges, overlap detection, fallback behavior |
| `tests/offline-queue.test.ts` | 17 | Enqueue/dequeue, deduplication by path, oldest-first ordering, load/clear, debounced persistence, coalesced writes, destroy cancels timers |
| `tests/remote-log.test.ts` | 15 | Buffer management, flush threshold (20 entries), ring buffer overflow (200 cap), flush-on-disable, singleton lifecycle |
| `tests/base-store.test.ts` | 13 | BaseStore: persist/retrieve last-synced content for 3-way merge base |
| `tests/channel.test.ts` | 10 | Phoenix channel: topic format, vault_deleted events, updateConfig, isConnected, setAuthProvider, auth token flow |
| `tests/auth.test.ts` | 20 | ApiKeyAuth, OAuthAuth: token management, refresh, deduplication, persistence |
| `tests/search.test.ts` | 5 | EngramApi.search, SearchModal debounce |

### Test configuration

- **Bun test config:** `bunfig.toml` — preloads `tests/preload.ts` for Obsidian module mocks
- **Obsidian mock:** `tests/__mocks__/obsidian.ts` — minimal mocks for TFile, Plugin, Modal, requestUrl, etc.
- **Coverage thresholds:** 40% minimum for branches, functions, lines, statements

### Untested files (UI-heavy — test via E2E in backend repo)

`settings.ts`, `conflict-modal.ts`, `first-sync-modal.ts`, `search-modal.ts`, `search-view.ts`, `main.ts`

## Package Manager

**Use `bun`, not `npm`.** The only exception is `npm version patch|minor|major` which requires npm's lifecycle hooks to run `version-bump.mjs`. All other commands (`install`, `test`, `build`, `run`, `lint`, `audit`) must use `bun`.

## Build & Install

```bash
bun install
bun run build
```

## Release Process

Releases are automated via GitHub Actions. Tags use `x.y.z` format (no `v` prefix) for BRAT/Obsidian compatibility.

### CI Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | Push to any branch | Build, lint, test + trigger backend E2E |
| `version-check.yml` | PR to main | Blocks merge if version not bumped or out of sync |
| `rc-release.yml` | PR to main (each push) | Creates BRAT-compatible pre-release (`X.Y.Z-rc.N`) |
| `release.yml` | PR merged to main | Cleans up RCs, creates final `X.Y.Z` release |

### 1. Version Bump (only manual step)

```bash
npm version patch   # or minor, major
```

This updates `package.json`, runs `version-bump.mjs` to sync `manifest.json` + `versions.json`, and commits.

### 2. Push to PR → RC Pre-releases

Every push to a PR targeting main automatically:
- Builds and tests the plugin
- Creates an RC tag (`X.Y.Z-rc.1`, `rc.2`, ...) incrementing automatically
- Publishes a GitHub pre-release with `main.js`, `manifest.json`, `styles.css`
- Install via BRAT: add repo with frozen version `X.Y.Z-rc.N`

### 3. Merge PR → Final Release

Merging the PR to main automatically:
- Deletes all RC tags and pre-releases for that version
- Creates annotated tag `X.Y.Z` on the merge commit
- Publishes final GitHub release with assets and auto-generated notes

### 4. Deploy to Local Vault

```bash
bun run build
cp main.js manifest.json styles.css "/home/open-claw/Obsidian Vault/.obsidian/plugins/engram-vault-sync/"
```

Restart Obsidian or disable/re-enable the plugin to pick up changes.

### Branch Protection (GitHub Settings)

Required status checks on `main`: `build-and-test`, `version-check / version-check`

@/home/open-claw/documents/code-projects/ops-agent/docs/self-updating-docs.md
