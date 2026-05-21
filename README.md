# Engram Vault Sync

> Your notes are your AI's memory. This is the Obsidian half.

Engram is an AI memory layer where your notes are the storage — markdown you and your AI assistants both read and write to. This plugin keeps your Obsidian vault synced across every device and lets Claude, Cursor, ChatGPT Desktop, and any MCP client read and write directly into it. Inside Obsidian, you also get **semantic search**: type what you mean and find the right note even if you can't remember the exact words.

It works on desktop and mobile.

## What you get

- **Sync your vault across devices.** Edit a note on your laptop, see it on your phone. Edits made by AI assistants show up too.
- **Search by meaning.** Open the command palette and run *Engram: Semantic search*. Searches "how do I deal with anxiety" and "stress management techniques" both surface the right notes — keywords don't have to match.
- **Let AI use your notes.** Once your vault is synced, any AI assistant that supports MCP (Model Context Protocol) can read your notes, answer questions about them, and even add new ones. Claude Desktop, Cursor, and most modern AI tools support this.
- **Safe by default.** Conflicting edits never get silently overwritten — the plugin either auto-merges them or asks you what to do.
- **Works offline.** Edits made without internet are queued and sent when you reconnect.
- **Private.** Your notes only go to the Engram server you choose. No third parties, no analytics, no telemetry.

## You need an Engram account

This plugin is the Obsidian half of a two-part system. The other half — Engram — does the actual sync, search, and AI integration. You have two options:

### Option 1: Hosted (recommended)

Sign up at **[engram.page](https://engram.page)**. It works in minutes — no servers to set up, no Docker, no terminal commands. There's a free tier.

### Option 2: Self-host (advanced)

If you'd rather run everything on your own machine or server, the Engram backend is open source: **[github.com/engram-app/engram](https://github.com/engram-app/engram)**. That repo has full setup instructions. It's a normal Docker app — comfortable terminal users only.

Either way, you'll end up with a server URL and a way to sign in (OAuth or an API key). That's what you'll paste into the plugin.

## Install

### From inside Obsidian (recommended)

1. Open **Settings → Community plugins**.
2. Click **Browse**.
3. Search for **Engram Vault Sync**.
4. Click **Install**, then **Enable**.

### Beta / pre-release builds

If you want to test upcoming features, install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add the repo `engram-app/Engram-obsidian`.

### Manual install

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/engram-app/Engram-obsidian/releases/latest). In your vault, create `.obsidian/plugins/engram-vault-sync/` and drop the three files there. Restart Obsidian and enable the plugin under **Settings → Community plugins**.

Requires Obsidian 1.7.2 or newer.

## Get started in 3 steps

1. **Get an account** at [engram.page](https://engram.page) (or self-host).
2. **Open the plugin settings** — *Settings → Engram Vault Sync*. Enter your Engram URL and sign in (one click with *Sign in with Engram*, or paste an API key).
3. **First sync** — the plugin walks you through pushing your vault. Nothing is sent until you confirm.

After that, sync happens automatically as you work.

## Using semantic search

- **Command palette** — press `Ctrl/Cmd + P` and type *Engram: Semantic search*.
- **Sidebar** — click the 🔍 icon in the left ribbon, or run *Engram: Open search sidebar* to keep results visible while you write.

Just describe what you're looking for. You don't need to remember the exact title or keywords.

## Using it with AI assistants

Once your vault is synced, any AI tool that supports MCP can connect to your Engram account and read your notes. Set-up steps depend on the AI tool — full instructions live in your Engram account dashboard and the [Engram backend docs](https://github.com/engram-app/engram). In short:

1. In your Engram account, copy your MCP connection details.
2. Add them to your AI tool (Claude Desktop, Cursor, etc.) the same way you'd add any other MCP server.
3. Ask the assistant something like *"What notes do I have about my Q3 goals?"* and it can answer from your vault.

The AI never reaches into Obsidian directly — it goes through Engram, which has the searchable index of your notes.

## What gets synced

- **Notes** — `.md` files (with their frontmatter).
- **Canvas** — `.canvas` files.
- **Attachments** — images (PNG, JPG, GIF, BMP, SVG, WebP), PDFs, audio (MP3, WAV, OGG, M4A, FLAC), video (MP4, MOV, WebM), and ZIP files.

Other file types are ignored automatically. The plugin never touches your `.obsidian/`, `.trash/`, or `.git/` folders.

You can also tell the plugin to skip specific files or folders — either with a pattern list in **Settings → Advanced**, or by clicking *Ignore this file* in the Sync Center.

## Handling conflicts

If you edit the same note in two places before they sync, the plugin tries to merge the changes automatically. Most of the time it just works. When it can't merge safely, you have two options (set in **Settings → Advanced**):

- **Auto** (default) — keep both versions. The plugin saves the other copy as `your-note.conflict.md` so nothing is ever lost.
- **Modal** — a window pops up showing both versions side-by-side, and you pick what to keep, chunk by chunk.

## Where to look when something seems off

The **Sync Center** is a dashboard for the plugin. Open it from the 🔄 ribbon icon or run *Engram: Open sync center*. It shows:

- What's currently being synced
- What's queued (waiting for a reconnect, for example)
- Files that failed to sync, with the reason
- Per-file *Ignore* toggles

The status bar at the bottom of Obsidian shows a quick indicator of sync state at all times.

## Privacy

- **Network use** — the plugin only talks to the Engram server URL you configure. Nothing else.
- No telemetry, no analytics.
- Optional "remote logging" (off by default) sends sync events to *your own* Engram server for debugging. It never goes to a third party.
- Your account credentials live inside Obsidian's plugin data folder, alongside your other plugin settings.

## Troubleshooting

| Something's wrong | What to check |
|-------------------|---------------|
| Can't connect to Engram | Is the URL correct (with `https://`)? Did you click *Test connection* in settings? |
| Notes aren't syncing | Open *Engram: Show sync log* or the Sync Center. Make sure the file type is supported and isn't in the ignore list. |
| Conflicts every time I save | Your device and the server probably disagree on the time. Check both system clocks. |
| Mobile crashes / won't load | File an issue with your phone OS and Obsidian version — mobile is supported and we want to know. |
| Sign-in window won't finish | Fall back to an API key from your Engram dashboard. |
| Big file won't upload | The Sync Center will show the reason. You can skip that file with *Ignore this file*. |

If you're still stuck, open an issue: [github.com/engram-app/Engram-obsidian/issues](https://github.com/engram-app/Engram-obsidian/issues). Include your Obsidian version, your platform (desktop/mobile/OS), and a copy of the sync log.

## Support

If this plugin saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/rasbandit). Optional and appreciated.

## For developers and self-hosters

Building from source, the architecture, command/settings reference, and the release process all live in **[DEV.md](DEV.md)**.

## Attribution

Uses [diff-match-patch](https://github.com/google/diff-match-patch) by Google for 3-way merge conflict resolution, licensed under Apache 2.0.

## License

[MIT](LICENSE)
