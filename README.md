<div align="center">

# Engram Vault Sync

![Engram Vault Sync: your notes are your AI's memory, synced everywhere, read and written by your AI](assets/vault-banner.gif)

**Sync your vault everywhere, and let any AI read and write it.** Your notes become memory your AI can search, cite, and build on.

**[Start free at engram.page →](https://engram.page)** · No credit card, ready in minutes.

[Setup](#setup) · [Connect your AI](#connect-your-ai) · [API](https://engram.page/docs/api) · [User guide](docs/user-guide.md) · [Self-host](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="assets/setup-video.jpg" alt="Watch the setup walkthrough: connect Obsidian to any AI" width="640"></a>

</div>

<details>
<summary><b>中文说明</b> · Chinese</summary>

**你的笔记就是 AI 的记忆。** 多设备同步你的 Obsidian 库，让 Claude、Cursor、ChatGPT 等 AI 应用通过 MCP 直接读写笔记。

- **AI 在你的库里工作。** 通过 [MCP](#connect-your-ai) 连接 Claude、Cursor 或 ChatGPT：读取笔记作为上下文，并把新笔记写回来。
- **笔记同步到每台设备。** 在电脑上写，手机上就能看到，AI 做的修改也会同步过来。
- **按语义或关键词搜索。** *语义*搜索能用「退款政策」找到通篇没出现「政策」二字的笔记；*关键词*在本地精确匹配（离线可用，不消耗额度）；*混合*模式两者兼顾。
- **知识库可编程。** 完整的 [REST + WebSocket API](https://engram.page/docs/api) 覆盖每条笔记。

**开始使用：**

1. 在 **[engram.page](https://engram.page)** 注册（有免费额度，无需安装），或[自托管后端](https://github.com/engram-app/engram)，笔记就不会离开你自己的硬件。
2. 打开 *Settings → Engram Vault Sync*。**云端：** 在 Cloud 标签页点击 **Sign in**。**自托管：** 在 Self-hosted 标签页填写服务器地址和密钥。首次同步前插件会先向你确认，不会擅自上传。

不会有任何内容被静默覆盖。离线期间的修改会在重新联网后同步。笔记只会发送到 Engram，不经过第三方，也没有任何追踪。

> 插件界面目前仅提供英文。

[上手视频](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) · [使用手册](docs/user-guide.md) · [API](https://engram.page/docs/api) · [Discord](https://discord.gg/NKWcU2mm7N)

</details>

<details>
<summary><b>日本語の説明</b> · Japanese</summary>

**あなたのノートが AI の記憶になります。** Obsidian の保管庫を全デバイスで同期し、Claude・Cursor・ChatGPT などの AI アプリが MCP 経由でノートを直接読み書きできるようにします。

- **AI が保管庫の中で動く。** [MCP](#connect-your-ai) で Claude や Cursor、ChatGPT を接続。ノートを文脈として読み、新しいノートを書き戻します。
- **すべてのデバイスにノートを同期。** ノートパソコンで書けばスマートフォンにも反映され、AI による変更も届きます。
- **意味でも完全一致でも検索。** *セマンティック*検索は「返金のポリシー」から、「ポリシー」という語が一度も出てこないノートを見つけます。*キーワード*はローカルで完全一致（オフライン可・上限を消費しません）。*ハイブリッド*は両方を組み合わせます。
- **保管庫をプログラマブルに。** すべてのノートを [REST + WebSocket API](https://engram.page/docs/api) から扱えます。

**セットアップ:**

1. **[engram.page](https://engram.page)** でアカウントを作成（無料プランあり、インストール不要）。または[セルフホスト版のバックエンド](https://github.com/engram-app/engram)を使えば、ノートは自分のハードウェアから出ません。
2. *Settings → Engram Vault Sync* を開きます。**ホスト版:** Cloud タブで **Sign in**。**セルフホスト版:** Self-hosted タブにサーバー URL とキーを入力。どちらの場合も初回同期は確認してから始まり、勝手に送信されることはありません。

内容が黙って上書きされることはありません。オフライン中の編集は再接続時に同期されます。ノートは Engram にのみ送られ、第三者を経由せず、トラッキングもありません。

> プラグインの UI は現在英語のみです。

[セットアップ動画](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) · [ユーザーガイド](docs/user-guide.md) · [API](https://engram.page/docs/api) · [Discord](https://discord.gg/NKWcU2mm7N)

</details>

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
