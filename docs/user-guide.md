# Engram Vault Sync: User Guide

Everything beyond the basics. For the quick pitch and install, see [README.md](../README.md). For building from source and architecture, see [DEV.md](../DEV.md).

## Using it with AI assistants

Once your vault is synced, any AI app that supports MCP (Model Context Protocol) can connect to your Engram account and read your notes: Claude Desktop, Cursor, and most modern AI tools do. Exact steps depend on the tool; full instructions live in your Engram account dashboard. In short:

1. In your Engram account, copy your MCP connection details.
2. Add them to your AI tool the same way you'd add any other MCP server.
3. Ask the assistant something like *"What notes do I have about my Q3 goals?"* and it answers from your vault.

The AI never reaches into Obsidian directly. It goes through Engram, which holds the searchable index of your notes.

## Release channels

- **Stable** (default): install from Obsidian Community Plugins. Auto-updates.
- **Testing a specific PR**: install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then "Add beta plugin" with a **frozen version** = the PR build tag (`X.Y.Z-pr.<num>.g<sha>`, shown on the PR's prerelease).

> A `main`-tracking **Beta** channel is planned; until its release workflow ships, only Stable and per-PR frozen builds are published — don't enable BRAT "beta versions" on the repo yet, as it would install an arbitrary open-PR build.

## Other ways to install

### Manual install

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/engram-app/Engram-obsidian/releases/latest). In your vault, create `.obsidian/plugins/engram-vault-sync/` and drop the three files there. Restart Obsidian and enable the plugin under **Settings → Community plugins**.

## What gets synced

- **Notes**: `.md` files (with their frontmatter).
- **Canvas**: `.canvas` files.
- **Attachments**: images (PNG, JPG, GIF, BMP, SVG, WebP), PDFs, audio (MP3, WAV, OGG, M4A, FLAC), video (MP4, MOV, WebM), and ZIP files.

Other file types are ignored automatically. The plugin never touches your `.obsidian/`, `.trash/`, or `.git/` folders.

You can also tell the plugin to skip specific files or folders: either with a pattern list in **Settings → Advanced**, or by clicking *Ignore this file* in the Sync Center.

## Handling conflicts

If you edit the same note in two places before they sync, the plugin tries to merge the changes automatically. Most of the time it just works. When it can't merge safely, you have two options (set in **Settings → Advanced**):

- **Auto** (default): keep both versions. The plugin saves the other copy as `your-note (conflict 2026-06-18).md` (the date it was created) so nothing is ever lost.
- **Modal**: a window pops up showing both versions side-by-side, and you pick what to keep, chunk by chunk.

## The Sync Center

The Sync Center is a dashboard for the plugin. Open it from the 🔄 ribbon icon or run *Engram: Open sync center*. It shows:

- What's currently being synced
- What's queued (waiting for a reconnect, for example)
- Files that failed to sync, with the reason
- Per-file *Ignore* toggles

The status bar at the bottom of Obsidian shows a quick indicator of sync state at all times.

## Privacy

- **Network use**: the plugin only talks to the Engram server URL you configure. Nothing else.
- No telemetry, no analytics.
- Optional "remote logging" (off by default) sends sync events to *your own* Engram server for debugging. It never goes to a third party.
- Your account credentials live inside Obsidian's plugin data folder, alongside your other plugin settings.

## Troubleshooting

| Something's wrong | What to check |
|-------------------|---------------|
| Can't connect to Engram | Is the URL correct (with `https://`)? Did you click *Test connection* in settings? |
| Notes aren't syncing | Open *Engram: Show sync log* or the Sync Center. Make sure the file type is supported and isn't in the ignore list. |
| Conflicts every time I save | Your device and the server probably disagree on the time. Check both system clocks. |
| Mobile crashes / won't load | File an issue with your phone OS and Obsidian version; mobile is supported and we want to know. |
| Sign-in window won't finish | Fall back to an API key from your Engram dashboard. |
| Big file won't upload | The Sync Center will show the reason. You can skip that file with *Ignore this file*. |

Still stuck? [Open an issue](https://github.com/engram-app/Engram-obsidian/issues). Include your Obsidian version, your platform (desktop/mobile/OS), and a copy of the sync log.

## Attribution

Uses [diff-match-patch](https://github.com/google/diff-match-patch) by Google for 3-way merge conflict resolution, licensed under Apache 2.0.
