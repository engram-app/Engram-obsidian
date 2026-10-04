# Orphaned preview / RC prereleases and the reconcile that removes them

_Last verified: 2026-10-03_

Read this for "the releases page is full of `-pr.N` / `-rc.N` entries" or "my PR closed and its preview is still there". Fixed in PRs #397 and #400 (found 2026-08-06: 34 prereleases, 33 orphaned, over three months).

## Why previews orphaned

1. 22 legacy `-rc.N` tags from the retired pre-1.13 manual RC scheme: `pr-cleanup.yml` only ever matched `-pr.<N>`.
2. 11 PR previews whose PRs were closed. `pr-cleanup.yml` triggers on `pull_request: closed`, a single event with no retry. For a dependabot PR closed unmerged after supersession, the branch conflicts with main once its replacement lands, GitHub cannot compute `refs/pull/N/merge`, and the run is never scheduled at all (a human-closed, unconflicted dependabot PR fired 2 seconds after close). The workflow was fine; the trigger just never happens.
3. Nobody noticed: all three preview-deleting workflows ended their DELETEs with `|| true` and had no verification step, and `release-audit.yml` only checks MISLABELED releases and missing assets, never orphaned prereleases.

## How removal works now

- `.github/scripts/prereleases.sh` is the single removal path (`list`, `orphans`, `for-pr`, `release-less-tags`, `delete`, `selftest`). Deletes use `curl --fail`; only a 404/422 on the tag ref (already gone) is tolerated.
- `.github/workflows/preview-reconcile.yml`: daily cron plus `workflow_dispatch` (`dry_run` defaults TRUE on manual runs, always deletes on schedule). State-based, so a missed close event self-heals within a day. `selftest` runs first on every reconcile and needs no network.
- Rules: a `-pr.<N>` preview lives exactly as long as its PR is open (the PR's state is authoritative). A legacy `-rc.N` is spent once stable reaches its base version; an RC ahead of stable survives.

Dry run, then read the log (`orphans` writes its keep/orphan decision per tag to stderr):

```bash
gh workflow run preview-reconcile.yml --field dry_run=true
```

## Traps (all caught by testing, not review)

1. The RC version compare MUST be numeric (`sort -t. -k1,1n -k2,2n -k3,3n`); lexically `1.9.26` and `1.2.0` sort above `1.20.1`, which would keep spent RCs forever.
2. Never pass an escaped regex through `awk -v`: awk unescapes the assignment, `\.` degrades to "any character", and PR #35 then matches PR #354's tag. `filter_pr` compares the PR field exactly.
3. A sweep driven by the releases API cannot see a TAG whose release is already gone (what `|| true` produced). `release-less-tags` reaches those; `delete` skips the releases endpoint for a `-` id.

## Lesson

A cleanup driven by a single non-retried event needs a state-based reconcile behind it, and a delete that ends in `|| true` is a report generator, not a cleanup.
