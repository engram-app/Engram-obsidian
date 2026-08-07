# Context Doc: orphaned preview / RC prereleases and the reconcile that removes them

_Last verified: 2026-08-06_

## Status
Fixed (PRs #397 and #400)

## What This Is
Why the releases page filled with junk prereleases for three months, why `pr-cleanup.yml` could not fix it, and how removal works now. Read this if you hit "the releases page is full of `-pr.N` / `-rc.N` entries" or "my PR closed and its preview is still there".

## The State That Was Found (2026-08-06)
34 prereleases, 33 of them orphaned. Two independent causes:

1. **22 legacy `-rc.N` tags** (1.3.1-rc.1 through 1.12.13-rc.3, May to July 2026) left by the retired pre-1.13 manual RC scheme. `pr-cleanup.yml` only ever matched `-pr.<N>`, so no workflow could ever delete them.
2. **11 PR previews whose PRs were closed.** All dependabot PRs, closed unmerged after being superseded.

## Why the Cleanup Event Never Fired
`pr-cleanup.yml` triggers on `pull_request: closed`. That is a single event with no retry. For a dependabot PR closed unmerged after supersession, the branch conflicts with main once its replacement lands, so GitHub cannot compute the `refs/pull/N/merge` ref and never schedules the run at all.

Evidence: across all 63 cleanup runs, none of the nine orphaned dependabot branches ever had one. Meanwhile PR #393 (also dependabot, but closed by a human and not conflicted) fired a run 2 seconds after close and logged `deleted 1.19.1-pr.393.g954c5bb`. So this is not tokens, not permissions, not the runner: the workflow is fine, the trigger just never happens.

## Why Nobody Noticed For Three Months
- All three preview-deleting workflows ended their DELETEs with `|| true` and had no verification step. They reported success whether they deleted 11 releases, zero, or got a 403 on every one.
- `release-audit.yml` (weekly cron) only checks for MISLABELED releases (a stable tag marked prerelease, an rc tag marked stable) and for missing assets. It has no concept of an orphaned prerelease, so it stayed green throughout.

## The Fix
- **`.github/scripts/prereleases.sh`** is the single path for removing a preview. Subcommands: `list`, `orphans`, `for-pr`, `release-less-tags`, `delete`, `selftest`. Deletes use `curl --fail`; only a 404/422 on the tag ref (already gone) is tolerated. It replaced three copies of the same paginate-then-delete loop in `pr-build.yml`, `pr-cleanup.yml`, and the new reconcile.
- **`.github/workflows/preview-reconcile.yml`**: daily cron plus `workflow_dispatch` (`dry_run` defaults to TRUE on manual runs, always deletes on schedule). It is state-based rather than event-based, so a missed close event self-heals within a day instead of orphaning forever.

Rules it enforces:
- A `-pr.<N>` preview lives exactly as long as its PR is open. The PR's own state is authoritative.
- A legacy `-rc.N` is spent once stable reaches its base version. An RC ahead of stable survives, so reviving the RC scheme does not self-destruct.

## Traps (all three caught by testing, not by review)
1. **The RC version compare MUST be numeric** (`sort -t. -k1,1n -k2,2n -k3,3n`). Lexically, `1.9.26` and `1.2.0` sort ABOVE `1.20.1`, which would keep spent RCs forever.
2. **Do not pass an escaped regex through `awk -v`.** awk unescapes the assignment, so `\.` degrades to "any character" and the PR-number boundary evaporates: PR #35 then matches PR #354's tag and deletes it. `filter_pr` compares the PR field EXACTLY instead. This is the same boundary the original jq `test("-pr\\."+$pr+"(\\.|$)")` was protecting.
3. **A sweep driven by the releases API cannot see a TAG whose release is already gone.** That state is exactly what `|| true` produced (release deleted, tag delete failed silently). Two such tags survived the first sweep and needed `release-less-tags` (PR #400) to reach. `delete` skips the releases endpoint for a `-` id.

## Ops
```bash
gh workflow run preview-reconcile.yml --field dry_run=true
```
Then read the run log: `orphans` writes its keep/orphan decision per tag to stderr, so you see exactly what it would remove before letting it delete.

`prereleases.sh selftest` runs at the top of every reconcile and needs no network. It pins the numeric-compare rule and the PR-number boundary (traps 1 and 2).

## Final State
3 prereleases remain, all belonging to open PRs. Sibling repos (`engram-app/Engram`, `engram-app/engram-infra`) have zero prereleases, so this was plugin-only.

## General Lesson
A cleanup driven by a single non-retried event needs a state-based reconcile behind it, and a delete that ends in `|| true` is not a cleanup, it is a report generator.

## References
- `.github/scripts/prereleases.sh`
- `.github/workflows/preview-reconcile.yml`, `.github/workflows/pr-cleanup.yml`, `.github/workflows/pr-build.yml`
- `.github/workflows/release-audit.yml` (what it does NOT cover)
- PR #397 (reconcile + shared script), PR #400 (release-less tags)
