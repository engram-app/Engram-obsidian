<div align="center">

# Engram Vault Sync

![Engram Vault Sync: your notes are your AI's memory, synced everywhere, read and written by your AI](assets/vault-banner.gif)

**Sync your vault everywhere, and let any AI read and write it.** Your notes become memory your AI can search, cite, and build on.

Semantic + keyword + hybrid search · MCP-native · desktop & mobile · no telemetry

**[Start free at engram.page →](https://engram.page)** · No credit card, ready in minutes.

[Setup](#setup) · [Connect your AI](#connect-your-ai) · [API](https://engram.page/docs/api) · [User guide](docs/user-guide.md) · [Self-host](https://engram.page/docs/self-host/)

</div>

## What you get

- **Your notes, on every device.** Write on your laptop, it's on your phone, and changes your AI makes show up too.
- **Find anything, by meaning or exact words.** Hit the search icon and pick a mode: *Semantic* turns *"our policy on refunds"* into **"Customer support playbook,"** even when the note never says "policy"; *Keyword* matches exact terms locally (works offline, no quota); *Hybrid* blends both.
- **Your vault is programmable.** A full [REST + WebSocket API](https://engram.page/docs/api) wraps every note: automate, integrate, or build apps on your own knowledge.
- **Your AI works *inside* your vault.** Connect Claude, Cursor, or ChatGPT over [MCP](#connect-your-ai). It reads your notes for context and writes new ones back:

```text
You      Pull together what we know about the Henderson account.

Claude   🔎  searched your vault → "Henderson"  ·  found 4 notes
         They're mid-renewal, flagged onboarding gaps in Q2,
         and asked about the analytics add-on.

You      Make a note focusing on the renewal risks.

Claude   📝  created "Henderson: renewal risks"  ✓
         Linked it to the four source notes.
```

Nothing is ever silently overwritten. Offline edits sync when you reconnect. Your notes go only to Engram, never a third party, no tracking.

## Setup

**1. Get an Engram account.** Hosted at **[engram.page](https://engram.page)** (free tier, nothing to install), or self-host the [source-available backend](https://github.com/engram-app/engram) so your notes never leave your hardware.

**2. Connect.** Open *Settings → Engram Vault Sync*. **Hosted:** click **Sign in** on the Cloud tab. **Self-hosted:** add your server URL and key on the Self-hosted tab. Either way the plugin walks you through the first sync; nothing is sent until you confirm.

After that, syncing just happens as you work.

## Connect your AI

Engram speaks **MCP (Model Context Protocol)**: the open standard Claude, Cursor, ChatGPT, and other apps use to reach external tools. Plug in once and your AI can search your notes, write new ones, and update existing ones, straight from your own vault.

Point your client at the Engram MCP server (`https://mcp.engram.page` on the hosted service); step-by-step guides for each app are in the **[integration docs](https://engram.page/docs/integrations)**.

## Privacy

- **Network use & accounts.** The plugin talks only to your Engram server, nothing else, no middlemen. You connect with your Engram account via OAuth sign-in or an API key.
- **No telemetry.** Optional remote logging (off by default) sends error/lifecycle events only to your server.
- **Hosted privacy.** See [engram.page/privacy](https://engram.page/privacy). Paid tiers raise storage/search limits; self-hosting is free.

## More

- **[Connect your AI](https://engram.page/docs/integrations)**: MCP setup for Claude, Cursor, ChatGPT, Windsurf, and more.
- **[API reference](https://engram.page/docs/api)**: build on the REST + WebSocket API.
- **[User guide](docs/user-guide.md)**: AI assistants, conflicts, the Sync Center, troubleshooting.
- **[Developer guide](DEV.md)**: build from source, architecture, releases.
- **Something wrong?** [Open an issue](https://github.com/engram-app/Engram-obsidian/issues).
- **Like it?** Support development via [GitHub Sponsors](https://github.com/sponsors/engram-app) or [Ko-fi](https://ko-fi.com/engrams_sync). Optional and appreciated.

## License

[MIT](LICENSE)
