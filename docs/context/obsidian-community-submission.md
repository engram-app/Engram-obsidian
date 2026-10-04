# Obsidian Community Plugin submission

_Last verified: 2026-10-03_

Submission is through the Developer Dashboard at https://community.obsidian.md/ (account page after sign-in). The old GitHub PR flow to `obsidianmd/obsidian-releases` was deprecated 2026-05-12 (the fork now rejects PRs: `pull_request_creation_policy: collaborators_only`). Discord `#plugin-dev` (https://discord.gg/obsidianmd) is the channel for review issues, Verified Developer and the Official label.

## Auth and ownership

Sign in with the Obsidian account (the one tied to the Obsidian subscription, NOT GitHub login), then connect GitHub to claim repos. Only the repo OWNER can edit it in the dashboard; for org repos you need public membership in the org.

## Submitting

- **New plugin (one time):** Developer Dashboard, "Submit new project", pick the repo, fill title, description, screenshots, category and pricing label, submit. Automated review runs in minutes; on pass it is live in search within 24h.
- **New version:** push a GitHub release with a matching tag; the automated review runs on every release tag. On failure the dashboard shows details and the plugin is pulled from search within 24h until fixed.
- **Pre-check:** "Run preview scan" in the dashboard on any branch/tag/commit, or locally `bun run lint:obsidian`, `bun run lint:css`, `bun test`, `bun run build`.

### Pricing labels (must be accurate)

- **Free:** no payments and no paid services. Donation/sponsorship links (Ko-fi, GitHub Sponsors) ARE allowed, so we qualify.
- **Optional payments:** users CAN pay for extra features OR the plugin connects to a paid service (even with a free tier).
- **Paid:** primary features locked behind payment.

## Listing copy (Developer Dashboard)

_Added 2026-05-27._ The dashboard listing has two description fields: a **short description (200 char max)** and a **long description (2000 char max)**. Keep both concise. The short description should also match `manifest.json` `description` (shown in-app).

### Short description (184 / 200)
The manifest description must be ASCII-only (dashboard reviewer rule), so this uses a comma, not an em dash, and matches `manifest.json`.
```
Your notes are your AI's memory. Sync your vault everywhere, search by meaning, and let Claude, Cursor, and other AI apps read and write your notes. Hosted or self-host, free to start.
```

### Long description (980 / 2000)
The long-description field is **plain text only — no markdown, line breaks, or bullets render**. Keep it one flowing blob. It shows alongside the short description, so it should *expand* rather than repeat the short's hook and feature list.
```
Stop pasting the same context into every chat. Engram Vault Sync keeps your Obsidian vault in lock-step across every device you write on and connects it to the AI tools you already use, so when you ask "what did we decide last quarter?" the answer comes from notes you actually wrote. Everything stays plain markdown in folders you own — no proprietary format, no lock-in. Find ideas by describing them in your own words instead of hunting for the exact title, and let your assistant pull the right notes itself or write new ones straight back into your vault. Conflicting edits are merged or saved side by side, never lost, and changes you make offline replay automatically once you reconnect. Your notes travel only to the Engram server you point at — nothing is sold, analyzed, or used to train a model. Start hosted at engram.page in minutes, or run the source-available, Docker-ready backend on your own hardware for a fully private, local setup. Works on desktop and mobile.
```

## Gotchas

- **Dashboard validator warnings that local lint cannot reproduce** are the scanner running its own config in a sandbox: see `scanner-type-resolution.md` (poisoned lockfile, not code). `eslint.config.mts` stays aligned with `obsidianmd/obsidian-sample-plugin`.
- **CSS validator** flags `:has()` (broad invalidation), `!important`, multicolumn properties and 3-digit hex shorthand. `.stylelintrc.json` mirrors it and `ci.yml` runs `Lint CSS (stylelint, mirrors dashboard CSS checks)`. Avoid `:has()` by applying parent classes from JS (`setting.settingEl.addClass(...)`).
- **Closed-source plugins are not accepted** into the new directory (existing ones grandfathered). This plugin is MIT.
- **`minAppVersion`:** adopting a newer API makes `obsidianmd/no-unsupported-api` tell you which version each call needs; `manifest.json` `minAppVersion` is currently 1.8.7 and `obsidian` is pinned to 1.8.7 in devDependencies. Known pending bump: see `../engram-workspace/docs/context/obsidian-1-13-setwarning-deprecation.md`.
- **The manifest description must be ASCII-only** (dashboard reviewer rule) and match the dashboard short description.

## References

- https://obsidian.md/blog/future-of-plugins/ (2026-05-12 announcement)
- https://docs.obsidian.md/Developer+policies and https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- https://github.com/obsidianmd/eslint-plugin (rule source; master has more rules than the published package)
