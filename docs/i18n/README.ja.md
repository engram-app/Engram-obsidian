<div align="center">

# Engram Vault Sync

![Engram Vault Sync: あなたのノートが AI の記憶になり、全デバイスで同期され、AI が読み書きします](../../assets/vault-banner.gif)

**保管庫をすべてのデバイスで同期し、どの AI からでも読み書きできるようにします。** あなたのノートは、AI が検索し、引用し、その上で考えを積み上げられる記憶になります。

**[engram.page で無料で始める →](https://engram.page)** · クレジットカード不要、数分で使えます。

[セットアップ](#セットアップ) · [AI を接続する](#ai-を接続する) · [API](https://engram.page/docs/api) · [ユーザーガイド](../user-guide.md) · [セルフホスト](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · **日本語** · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="../../assets/setup-video.jpg" alt="セットアップ手順の動画: Obsidian を任意の AI につなぐ" width="640"></a>

</div>

> プラグインの UI は現在英語のみです。このドキュメントが翻訳されていることは、ソフトウェア本体が日本語化されていることを意味しません。

## できること

- **AI が保管庫の*なか*で動きます。** [MCP](#ai-を接続する) 経由で Claude、Cursor、ChatGPT を接続します。ノートを文脈として読み取り、新しいノートを書き戻します。
- **ノートがすべてのデバイスに届きます。** ノートパソコンで書けばスマートフォンにも反映され、AI が加えた変更も届きます。
- **意味でも、書かれた語そのままでも探せます。** 検索アイコンを押してモードを選びます。*セマンティック*検索は*「返金のポリシー」*から **「カスタマーサポートの手引き」** を導き出します。そのノートに「ポリシー」という語が一度も出てこなくても見つかります。*キーワード*はローカルで完全一致します（オフラインで動作し、上限を消費しません）。*ハイブリッド*は両方を組み合わせます。
- **保管庫をプログラムから扱えます。** すべてのノートを [REST + WebSocket API](https://engram.page/docs/api) から操作できます。自動化、連携、あるいは自分の知識の上にアプリを作ることもできます。

```text
あなた    Henderson 社について分かっていることをまとめて。

Claude   🔎  保管庫を検索しました ·  4 件のノートが見つかりました
         現在は更新の時期で、Q2 に導入時の課題を挙げており、
         分析アドオンについて問い合わせがありました。

あなた    更新のリスクに絞ってノートを作って。

Claude   📝  「Henderson: 更新リスク」を作成しました  ✓
         出典となる 4 件のノートにリンクしました。
```

<video src="../../assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

内容が黙って上書きされることはありません。オフライン中の編集は再接続時に同期されます。ノートは Engram にのみ送られ、第三者を経由せず、トラッキングもありません。

## セットアップ

**1. Engram のアカウントを用意します。** ホスト版は **[engram.page](https://engram.page)**（無料プランあり、インストール不要）。または[ソース公開のバックエンド](https://github.com/engram-app/engram)をセルフホストすれば、ノートが自分のハードウェアから出ることはありません。

**2. 接続します。** *Settings → Engram Vault Sync* を開きます。**ホスト版:** Cloud タブで **Sign in** をクリックします。**セルフホスト版:** Self-hosted タブにサーバー URL とキーを入力します。どちらの場合もプラグインが初回同期を案内します。あなたが確認するまで、何も送信されません。

そのあとは、作業に合わせて同期が自動で行われます。

**動画で見たい場合は?** [セットアップ手順の動画](https://www.youtube.com/watch?v=rwnPeZ-8Lqo)が上記 2 ステップを最後まで説明しています。

## AI を接続する

Engram は **MCP (Model Context Protocol)** を話します。Claude、Cursor、ChatGPT などのアプリが外部ツールに接続するために使う、オープンな標準です。一度つなげば、AI はあなた自身の保管庫からノートを検索し、新しいノートを書き、既存のノートを更新できます。

クライアントを Engram の MCP サーバー (ホスト版では `https://mcp.engram.page`) に向けてください。アプリごとの手順は **[連携ドキュメント](https://engram.page/docs/integrations)** にあります。

<video src="../../assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## プライバシー

- **通信とアカウント。** プラグインが通信するのはあなたの Engram サーバーだけです。ほかのどこにも送らず、仲介もありません。接続は Engram アカウントの OAuth サインインで行い、すべてのプランで利用できます。API キーにも対応していますが、Engram Cloud では Pro プランが必要です。セルフホストのサーバーにはこの制限はありません。
- **テレメトリなし。** 任意のリモートログ (既定ではオフ) は、エラーとライフサイクルのイベントだけをあなたのサーバーへ送ります。
- **ホスト版のプライバシー。** [engram.page/privacy](https://engram.page/privacy) をご覧ください。有料プランは保存容量と検索の上限が上がります。セルフホストは無料です。

## さらに

- **[AI を接続する](https://engram.page/docs/integrations)**: Claude、Cursor、ChatGPT、Windsurf などの MCP 設定。
- **[API リファレンス](https://engram.page/docs/api)**: REST + WebSocket API の上に作る。
- **[ユーザーガイド](../user-guide.md)**: AI アシスタント、競合、Sync Center、トラブルシューティング。
- **[開発者ガイド](../../DEV.md)**: ソースからのビルド、アーキテクチャ、リリース。
- **問題がありますか?** [issue を作成してください](https://github.com/engram-app/Engram-obsidian/issues)。
- **コミュニティへ。** [Discord](https://discord.gg/NKWcU2mm7N) でユーザーや開発者と話せます。
- **気に入りましたか?** [GitHub Sponsors](https://github.com/sponsors/engram-app) または [Ko-fi](https://ko-fi.com/engrams_sync) で開発を支援できます。任意ですが、とても助かります。

## ライセンス

[MIT](../../LICENSE). 一部はサードパーティの MIT ライセンス成果物に由来します。詳細は [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) を参照してください。
