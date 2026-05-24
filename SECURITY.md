# Security Policy

Engram Vault Sync is an Obsidian plugin that syncs a local vault to a remote
Engram backend. This file covers vulnerabilities in **plugin code** — things
like credential handling, sync logic, file-write paths, or anything that
could compromise an Obsidian vault.

For vulnerabilities in the backend service (`app.engram.page`) or REST/MCP
API, see
[engram-app/engram SECURITY.md](https://github.com/engram-app/engram/blob/main/SECURITY.md).

## Reporting a vulnerability

Email **security@engram.page** with:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept if possible)
- Plugin version (the `version` field in `manifest.json`)
- Obsidian version + OS
- Whether you've shared this with anyone else

We aim to acknowledge reports within **48 hours** and to provide a status
update or fix within **14 days** for confirmed issues.

## In scope

- The latest tagged release of `engram-vault-sync` from the Obsidian
  community plugins store
- Source at `main` or any tagged release in this repository

## Out of scope

- Older plugin versions superseded by a newer release
- Backend / SaaS issues → see
  [engram-app/engram SECURITY.md](https://github.com/engram-app/engram/blob/main/SECURITY.md)
- Bugs in Obsidian itself →
  [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
- Findings that require an already-compromised local machine
- Missing security headers in dev or local-only surfaces

## Safe harbor

Same terms as the
[backend policy](https://github.com/engram-app/engram/blob/main/SECURITY.md#safe-harbor):
good-faith research, no data destruction, minimum-needed PoC, private
disclosure first, reasonable time to fix.

## Bounty

No paid bounty at launch. Credit in release notes is available with your
permission.
