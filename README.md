<div align="center">

# Engram Vault Sync

![Engram Vault Sync: your notes are your AI's memory, synced everywhere, read and written by your AI](assets/vault-banner.gif)

**Sync your vault everywhere, and let any AI read and write it.** Your notes become memory your AI can search, cite, and build on.

**[Start free at engram.page →](https://engram.page)** · No credit card, ready in minutes.

[Setup](#setup) · [Connect your AI](#connect-your-ai) · [API](https://engram.page/docs/api) · [User guide](docs/user-guide.md) · [Self-host](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

**English** · [简体中文](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md) · [日本語](docs/i18n/README.ja.md) · [한국어](docs/i18n/README.ko.md) · [Deutsch](docs/i18n/README.de.md) · [Français](docs/i18n/README.fr.md) · [Español](docs/i18n/README.es.md) · [Português](docs/i18n/README.pt-BR.md) · [Русский](docs/i18n/README.ru.md) · [Italiano](docs/i18n/README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="assets/setup-video.jpg" alt="Watch the setup walkthrough: connect Obsidian to any AI" width="640"></a>

</div>

**中文:** Obsidian 笔记同步 + AI 记忆。多设备同步、语义搜索、关键词搜索、知识库、MCP、Claude / Cursor / ChatGPT 读写笔记、可自托管、开放 API。 [完整中文说明](docs/i18n/README.zh-CN.md) · [繁體中文](docs/i18n/README.zh-TW.md)

**日本語:** Obsidian ノート同期 + AI メモリ。全デバイス同期、セマンティック検索、キーワード検索、知識ベース、MCP、Claude / Cursor / ChatGPT がノートを読み書き、セルフホスト可能、オープン API。 [日本語の説明](docs/i18n/README.ja.md)

**한국어:** Obsidian 노트 동기화 + AI 기억. 모든 기기 동기화, 의미 검색, 키워드 검색, 지식 베이스, MCP, Claude / Cursor / ChatGPT가 노트를 읽고 쓰기, 직접 호스팅 가능, 공개 API. [한국어 설명](docs/i18n/README.ko.md)

**Русский:** синхронизация заметок Obsidian + память для ИИ. Синхронизация на всех устройствах, смысловой поиск, поиск по ключевым словам, база знаний, MCP, Claude / Cursor / ChatGPT читают и пишут заметки, своё размещение, открытый API. [Описание на русском](docs/i18n/README.ru.md)

## What you get

- **Your AI works *inside* your vault.** Connect Claude, Cursor, or ChatGPT over [MCP](#connect-your-ai). It reads your notes for context and writes new ones back:
- **Your notes, on every device.** Write on your laptop, it's on your phone, and changes your AI makes show up too.
- **Find anything, by meaning or exact words.** Hit the search icon and pick a mode: *Semantic* turns *"our policy on refunds"* into **"Customer support playbook,"** even when the note never says "policy"; *Keyword* matches exact terms locally (works offline, no quota); *Hybrid* blends both.
- **Your vault is programmable.** A full [REST + WebSocket API](https://engram.page/docs/api) wraps every note: automate, integrate, or build apps on your own knowledge.

```text
You      Pull together what we know about the Henderson account.

Claude   🔎  searched your vault ·  found 4 notes
         They're mid-renewal, flagged onboarding gaps in Q2,
         and asked about the analytics add-on.

You      Make a note focusing on the renewal risks.

Claude   📝  created "Henderson: renewal risks"  ✓
         Linked it to the four source notes.
```

<video src="assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

Nothing is ever silently overwritten. Offline edits sync when you reconnect. Your notes go only to Engram, never a third party, no tracking.

## Setup

**1. Get an Engram account.** Hosted at **[engram.page](https://engram.page)** (free tier, nothing to install), or self-host the [source-available backend](https://github.com/engram-app/engram) so your notes never leave your hardware.

**2. Connect.** Open *Settings → Engram Vault Sync*. **Hosted:** click **Sign in** on the Cloud tab. **Self-hosted:** add your server URL and key on the Self-hosted tab. Either way the plugin walks you through the first sync; nothing is sent until you confirm.

After that, syncing just happens as you work.

**Prefer to watch?** The [setup walkthrough](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) covers both steps end to end.

## Connect your AI

Engram speaks **MCP (Model Context Protocol)**: the open standard Claude, Cursor, ChatGPT, and other apps use to reach external tools. Plug in once and your AI can search your notes, write new ones, and update existing ones, straight from your own vault.

Point your client at the Engram MCP server (`https://mcp.engram.page` on the hosted service); step-by-step guides for each app are in the **[integration docs](https://engram.page/docs/integrations)**.

<video src="assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## Privacy

- **Network use & accounts.** The plugin talks only to your Engram server, nothing else, no middlemen. You connect with your Engram account via OAuth sign-in, which works on every plan. API keys are also supported, but on Engram Cloud they require the Pro plan; self-hosted servers have no such limit.
- **No telemetry.** Optional remote logging (off by default) sends error/lifecycle events only to your server.
- **Hosted privacy.** See [engram.page/privacy](https://engram.page/privacy). Paid tiers raise storage/search limits; self-hosting is free.

## More

- **[Connect your AI](https://engram.page/docs/integrations)**: MCP setup for Claude, Cursor, ChatGPT, Windsurf, and more.
- **[API reference](https://engram.page/docs/api)**: build on the REST + WebSocket API.
- **[User guide](docs/user-guide.md)**: AI assistants, conflicts, the Sync Center, troubleshooting.
- **[Developer guide](DEV.md)**: build from source, architecture, releases.
- **Something wrong?** [Open an issue](https://github.com/engram-app/Engram-obsidian/issues).
- **Join the community.** Chat with users and devs on [Discord](https://discord.gg/NKWcU2mm7N).
- **Like it?** Support development via [GitHub Sponsors](https://github.com/sponsors/engram-app) or [Ko-fi](https://ko-fi.com/engrams_sync). Optional and appreciated.

## License

[MIT](LICENSE). Portions are derived from third-party MIT-licensed work; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
