# CLAUDE.md / AGENTS.md

> `AGENTS.md` is a symlink to this file — one source of truth for both Claude Code and other agent runtimes, so they can never drift apart. Edit `CLAUDE.md`.

Obsidian plugin for bidirectional sync with Engram, distributed as "Engram Vault Sync" (plugin id `engram-vault-sync`). One half of the Engram project — backend repo is `engram-app/engram`, plugin repo is `engram-app/Engram-obsidian` (local dir name stayed `engram-obsidian-sync` after rename).

## Life OS
project: engram-obsidian
goal: income
value: financial-freedom
worklog_vault: Engram
worklog_path: 90 Work Log/todd

## Superpowers spec docs → Engram vault (overrides the skill default)

When `superpowers:brainstorming` produces a design/spec doc, save it to the **Engram vault** at `50 Engineering/_Superpowers Specs/YYYY-MM-DD-<topic>-design.md` via the engram MCP (`set_vault` → Engram `4c2057f9-a6cb-4e5e-9b4e-7ac50fb77c35`, `create_note`/`write_note`, then `set_vault()` to reset) — **not** to `docs/superpowers/specs/`. Specs are durable design rationale, so they live in the vault (searchable, dogfoods engram). This user instruction takes precedence over the skill's local-save step.

**Plans stay repo-local.** `superpowers:writing-plans` output is an ephemeral implementation checklist — keep it in `docs/superpowers/plans/` as the skill specifies; do not route plans to the vault.

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
For the 3-way merge conflict-resolution algorithm, read `docs/context/three-way-merge.md`.
For the SSE→WebSocket sync-stream migration (`channel.ts`; the live topic is `sync:{userId}:{vaultId}`, event `note_changed`), read `docs/context/websocket-migration.md`.
For the logging architecture (dev-log categories, remote-log thresholds), read `docs/context/logging-architecture.md`.
For the Obsidian mtime quirk that sync logic must account for, read `docs/context/obsidian-mtime-quirk.md`.
For the 2026-03 pull-sync bug cluster (four interrelated pull-breaking bugs, fixed), read `docs/context/pull-sync-bug-cluster.md`.
For V8 OOM prevention on large-vault operations, read `docs/context/v8-oom-prevention.md`.

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
- Generate embeddings (Engram does this — Voyage AI on SaaS; Ollama is self-host only)
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

**Worktrees**: `git worktree add` fires a `post-checkout` hook (wired via `lefthook.yml`) that hardlinks `node_modules/` from the canonical checkout into the new tree — first build / lint runs without re-fetching ~500MB of deps. Just `git worktree add <path> -b <branch> origin/main`, no `bun install` needed on the fresh tree unless `mix.lock`/`bun.lock` is being edited.

## Testing

**Tests are the spec. If a test fails, fix the app — not the test.**

```bash
bun test              # Run the full unit-test suite
bun test --verbose    # Verbose output
bun test --coverage   # With coverage report
bun run build         # Build the plugin (production)
```

### Test files

Don't hardcode test counts here — they drift. Run `bun test` for the live total,
and `ls tests/*.test.ts` for the current file list. Coverage roughly tracks
~89% funcs / ~97% lines but check `bun test --coverage` for the real number.

Broad areas under test: SyncEngine (ignore/modify/delete/rename, pull, cursor-pull,
WebSocket events, echo suppression, 3-way merge, state export/import), the cursor
+ manifest reconciliation path, the offline queue, the API client (incl. batch
push + `/sync/changes`), auth (ApiKey + OAuth device flow), the Phoenix channel,
diff/merge, remote logging, plan/limit state, and a set of compliance tests
(manifest, license, README disclosures, source/styles hygiene, command IDs).

### Test configuration

- **Bun test config:** `bunfig.toml` — preloads `tests/preload.ts` for Obsidian module mocks
- **Obsidian mock:** `tests/__mocks__/obsidian.ts` — minimal mocks for TFile, Plugin, Modal, requestUrl, etc.
- **Coverage thresholds:** 40% minimum for branches, functions, lines, statements

### Untested files (UI-heavy — test via E2E in backend repo)

`settings.ts`, `conflict-modal.ts`, `search-modal.ts`, `search-view.ts`, `main.ts`

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

## Context Docs

If you need info on the `version-bump.mjs` script (and the silent-corruption foot-gun where running it directly drops the `version` key from `manifest.json`), see `docs/context/version-bump-script.md`

If a note's content gets copied into a DIFFERENT file on file-switch with a clean noteIdMap (the editor-binding stale-buffer race, PR #194) — the bindTo await gap where the old ySync binding captured Obsidian's setViewData whole-doc replace, the sync-detach-before-await + bindEpoch + drift view-identity-guard fix, and why detach-not-release matters in the drift guard, see `docs/context/crdt-editor-bind-race-pollution.md`

If a missed CRDT delivery never heals (create-race dead local id → `crdt_channel: dropped crdt_msg → not_found` in Loki, edge-triggered announce black hole, or an ignorant push "convergently" deleting content the client never saw) — the catch-up convergence system from PRs #197 + #198 (id adoption parity, base_hash CAS 409, pull backfill, reset+enroll as the universal re-deliver primitive; per-open `verifyConvergenceOnOpen` REMOVED in the B1 rewire, superseded by socket vault-catchup on connect/reconnect via `catchupViaSocket()`), see `docs/context/sync-catchup-convergence.md`

@/home/open-claw/documents/code-projects/ops-agent/docs/self-updating-docs.md
